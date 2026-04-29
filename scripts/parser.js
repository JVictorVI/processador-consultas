/* ═══════════════════════════════════════════════════════
   PROCESSADOR DE CONSULTAS SQL — HU1
   parser.js — Validação e parsing da consulta SQL sem suporte a aliases
   Depende de: schema.js
═══════════════════════════════════════════════════════ */
"use strict";

// ═══════════════════════════════════════════════════════
//  UTILITÁRIOS LÉXICOS
// ═══════════════════════════════════════════════════════

/** Retorna nome canônico da tabela no schema (case-insensitive) ou null */
function schemaKey(name) {
  return (
    Object.keys(SCHEMA).find((k) => k.toUpperCase() === name.toUpperCase()) ||
    null
  );
}

/** Verifica se uma palavra é reservada */
function isReserved(word) {
  return RESERVED.has(word.toUpperCase());
}

/** Verifica se um token é literal aceitável como operando (número ou string) */
function isLiteral(tok) {
  return /^\d+(\.\d+)?$/.test(tok) || /^'[^']*'$/.test(tok);
}

/** Verifica se um token é um identificador simples (não reservado, não literal) */
function isIdentifier(tok) {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(tok) && !isLiteral(tok);
}

// ═══════════════════════════════════════════════════════
//  TOKENIZADOR — gera lista de tokens para exibição
// ═══════════════════════════════════════════════════════

function tokenize(sql) {
  const toks = [];
  const re =
    /([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)?|<>|>=|<=|[<>=]|[(),*]|\d+(?:\.\d+)?|'[^']*')/g;
  let m;
  while ((m = re.exec(sql)) !== null) toks.push(m[1]);
  return toks;
}

function classifyTok(tok, aliases) {
  const u = tok.toUpperCase();
  if (["SELECT", "FROM", "WHERE", "JOIN", "ON", "AND"].includes(u))
    return "keyword";
  if (tok.includes(".")) {
    const [a, f] = tok.split(".");
    const tn = aliases[a.toUpperCase()] || a;
    const tk = schemaKey(tn);
    if (tk)
      return SCHEMA[tk].fields.some((x) => x.toUpperCase() === f.toUpperCase())
        ? "attr"
        : "other";
    return "other";
  }
  if (schemaKey(tok)) return "table";
  if (
    Object.values(SCHEMA).some((s) =>
      s.fields.some((f) => f.toUpperCase() === u),
    )
  )
    return "attr";
  if (/^(<>|>=|<=|[<>=])$/.test(tok)) return "op";
  return "other";
}

// ═══════════════════════════════════════════════════════
//  VALIDAÇÃO DE CONDIÇÃO
//
//  Valida uma expressão condicional (WHERE ou ON):
//  1. Balanceamento de parênteses
//  2. AND em posição inválida (início, fim, duplicado, após '(' ou antes de ')')
//  3. Divide por AND e valida cada predicado atômico
//  4. Cada predicado: operando esquerdo + operador + operando direito
//  5. Ambos os operandos são validados contra o schema
// ═══════════════════════════════════════════════════════
function validateCondition(condRaw, aliases, usedTables, errors, ctx) {
  if (!condRaw || !condRaw.trim()) return;
  const cond = condRaw.trim();

  // ── Balanceamento de parênteses ───────────────────
  let depth = 0;
  for (const ch of cond) {
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth < 0) {
        errors.push(`Parênteses desbalanceados na cláusula ${ctx}.`);
        depth = 0;
      }
    }
  }
  if (depth > 0) {
    errors.push(`Parênteses desbalanceados na cláusula ${ctx}.`);
    return;
  }

  // ── AND em posições inválidas ─────────────────────
  if (/^\s*AND\b/i.test(cond)) {
    errors.push(`Conectivo AND em posição inválida na cláusula ${ctx}.`);
    return;
  }
  if (/\bAND\s*$/i.test(cond)) {
    errors.push(`Conectivo AND em posição inválida na cláusula ${ctx}.`);
    return;
  }
  if (/\bAND\s+AND\b/i.test(cond)) {
    errors.push(`Conectivo AND duplicado na cláusula ${ctx}.`);
    return;
  }
  if (/\(\s*AND\b/i.test(cond)) {
    errors.push(`Conectivo AND em posição inválida na cláusula ${ctx}.`);
    return;
  }
  if (/\bAND\s*\)/i.test(cond)) {
    errors.push(`Conectivo AND em posição inválida na cláusula ${ctx}.`);
    return;
  }

  // ── Divide por AND e valida cada parte ───────────
  const parts = splitByAnd(cond);

  if (parts.length === 0) {
    errors.push(`Condição incompleta na cláusula ${ctx}.`);
    return;
  }

  parts.forEach((part) =>
    validateAtom(part.trim(), aliases, usedTables, errors, ctx),
  );
}

/**
 * Divide uma condição pelos AND de nível superior
 * (respeita parênteses: AND dentro de () não é separador)
 */
function splitByAnd(cond) {
  const parts = [];
  let depth = 0,
    start = 0;
  const upper = cond.toUpperCase();
  let i = 0;
  while (i < cond.length) {
    if (cond[i] === "(") {
      depth++;
      i++;
      continue;
    }
    if (cond[i] === ")") {
      depth--;
      i++;
      continue;
    }
    if (depth === 0 && upper.slice(i, i + 3) === "AND") {
      const before = i === 0 || /\W/.test(cond[i - 1]);
      const after = i + 3 >= cond.length || /\W/.test(cond[i + 3]);
      if (before && after) {
        const part = cond.slice(start, i).trim();
        if (part) parts.push(part);
        i += 3;
        start = i;
        continue;
      }
    }
    i++;
  }
  const last = cond.slice(start).trim();
  if (last) parts.push(last);
  return parts;
}

function validateAtom(atom, aliases, usedTables, errors, ctx) {
  if (!atom) {
    errors.push(`Condição vazia na cláusula ${ctx}.`);
    return;
  }

  let expr = atom.trim();

  // Remove parênteses externos quando eles envolvem a expressão inteira
  while (expr.startsWith("(") && expr.endsWith(")") && isWrapped(expr)) {
    expr = expr.slice(1, -1).trim();
  }

  // Correção: se após remover parênteses ainda existir AND em nível superior,
  // valida cada predicado interno separadamente.
  // Exemplo: (Nome = 'Ana' AND CPF = '123')
  const innerParts = splitByAnd(expr);
  if (innerParts.length > 1) {
    innerParts.forEach((part) =>
      validateAtom(part.trim(), aliases, usedTables, errors, ctx),
    );
    return;
  }

  if (/^\s*AND\b/i.test(expr)) {
    errors.push(`Conectivo AND em posição inválida na cláusula ${ctx}.`);
    return;
  }

  if (/\bAND\s*$/i.test(expr)) {
    errors.push(`Conectivo AND em posição inválida na cláusula ${ctx}.`);
    return;
  }

  if (hasInvalidSymbolicOperator(expr)) {
    errors.push(`Operador inválido na cláusula ${ctx}: "${atom}".`);
    return;
  }

  const invalidOps = [
    {
      re: /!=/,
      msg: `Operador '!=' não é suportado neste trabalho. Use '<>' para desigualdade.`,
    },
    {
      re: /==/,
      msg: `Operador '==' não é suportado neste trabalho. Use '=' para igualdade.`,
    },
    {
      re: /></,
      msg: `Operador '><' não é suportado neste trabalho.`,
    },
  ];

  for (const inv of invalidOps) {
    if (inv.re.test(expr)) {
      errors.push(inv.msg);
      return;
    }
  }

  let opFound = null;
  let opIdx = -1;

  for (const op of CMP_OPS) {
    const idx = findOperatorIndex(expr, op);
    if (idx !== -1) {
      if (opFound === null || op.length > opFound.length) {
        opFound = op;
        opIdx = idx;
      }
    }
  }

  if (!opFound) {
    errors.push(
      `Expressão condicional malformada na cláusula ${ctx}: "${atom}".`,
    );
    return;
  }

  const left = expr.slice(0, opIdx).trim();
  const right = expr.slice(opIdx + opFound.length).trim();

  if (!left) {
    errors.push(
      `Operador de comparação sem operando à esquerda na cláusula ${ctx}.`,
    );
  } else {
    validateOperand(left, aliases, usedTables, errors, ctx);
  }

  if (!right) {
    errors.push(
      `Operador de comparação sem operando à direita na cláusula ${ctx}.`,
    );
  } else {
    validateOperand(right, aliases, usedTables, errors, ctx);
  }
}

function findTablesContainingAttribute(attr, usedTables) {
  return usedTables
    .map((t) => schemaKey(t.name))
    .filter(Boolean)
    .filter((tableName) =>
      SCHEMA[tableName].fields.some(
        (field) => field.toUpperCase() === attr.toUpperCase(),
      ),
    );
}

/**
 * Verifica se a string está totalmente envolvida por um par de parênteses
 * Ex: "(a = b)" → true,  "(a) = (b)" → false
 */
function isWrapped(s) {
  if (!s.startsWith("(")) return false;
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "(") depth++;
    else if (s[i] === ")") {
      depth--;
      if (depth === 0 && i < s.length - 1) return false;
    }
  }
  return depth === 0;
}

/**
 * Encontra o índice do operador de comparação em nível de parêntese 0.
 * Garante que o operador não está dentro de parênteses.
 */
function findOperatorIndex(expr, op) {
  let depth = 0;
  for (let i = 0; i <= expr.length - op.length; i++) {
    const ch = expr[i];
    if (ch === "(") {
      depth++;
      continue;
    }
    if (ch === ")") {
      depth--;
      continue;
    }
    if (depth === 0 && expr.slice(i, i + op.length) === op) {
      if ((op === ">" || op === "<") && i + op.length < expr.length) {
        const next = expr[i + op.length];
        if (next === "=" || next === ">") continue;
      }
      return i;
    }
  }
  return -1;
}

/**
 * Valida um único operando de uma comparação:
 * - número ou string literal → sempre válido
 * - Tabela.campo → valida tabela declarada e campo no schema
 * - identificador isolado → valida nas tabelas declaradas
 *
 * Observação: aliases foram removidos do escopo do projeto. Portanto,
 * o prefixo antes do ponto deve ser sempre o nome real da tabela.
 */
function validateOperand(tok, aliases, usedTables, errors, ctx) {
  if (isLiteral(tok)) return;

  if (tok.includes(".")) {
    const [tableRef, field] = tok.split(".");
    const tableName = schemaKey(tableRef);
    if (!tableName) {
      errors.push(
        `Tabela '${tableRef}' não existe no modelo (cláusula ${ctx}).`,
      );
      return;
    }

    const declared = usedTables.some(
      (t) => String(t.name).toUpperCase() === String(tableName).toUpperCase(),
    );
    if (!declared) {
      errors.push(
        `Tabela '${tableRef}' não foi declarada no FROM/JOIN (cláusula ${ctx}).`,
      );
      return;
    }

    if (
      !SCHEMA[tableName].fields.some(
        (f) => f.toUpperCase() === field.toUpperCase(),
      )
    ) {
      errors.push(
        `Atributo '${field}' não existe na tabela '${tableName}' (cláusula ${ctx}).`,
      );
    }
    return;
  }

  if (isIdentifier(tok) && !isReserved(tok)) {
    const matches = findTablesContainingAttribute(tok, usedTables);

    if (matches.length === 0) {
      errors.push(
        `Atributo '${tok}' não encontrado nas tabelas declaradas (cláusula ${ctx}).`,
      );
      return;
    }

    if (matches.length > 1) {
      errors.push(
        `Atributo '${tok}' é ambíguo na cláusula ${ctx}. Use ${matches
          .map((tableName) => `${tableName}.${tok}`)
          .join(" ou ")}.`,
      );
    }
  }
}

// ═══════════════════════════════════════════════════════
//  EXTRAÇÃO E VALIDAÇÃO DE BLOCOS JOIN
//
//  Cada JOIN é validado individualmente:
//  - tabela presente e existente no schema
//  - alias opcional válido e não duplicado
//  - ON presente e com condição não vazia
//  - condição ON validada com validateCondition()
// ═══════════════════════════════════════════════════════
function extractAndValidateJoins(sql, aliases, usedTables, errors) {
  const joins = [];
  const joinBlockRe = /\bJOIN\s+([\s\S]+?)(?=\s+\bJOIN\b|\s+\bWHERE\b|\s*$)/gi;
  let jm;

  while ((jm = joinBlockRe.exec(sql)) !== null) {
    const block = jm[1].trim();
    const blockRe =
      /^([A-Za-z_][A-Za-z0-9_]*)(?:\s+([A-Za-z_][A-Za-z0-9_]*))?\s+ON\s+([\s\S]+)$/i;
    const bm = block.match(blockRe);

    if (!bm) {
      const tblOnly = block.match(/^([A-Za-z_][A-Za-z0-9_]*)/);
      const tblName = tblOnly ? tblOnly[1] : "(desconhecida)";
      errors.push(
        `JOIN com tabela '${tblName}' sem cláusula ON correspondente.`,
      );
      continue;
    }

    const rawTable = bm[1];
    const aliasToken = bm[2];
    const onCond = bm[3].trim();
    const canonicalTable = schemaKey(rawTable) || rawTable;

    if (!schemaKey(rawTable)) {
      errors.push(`Tabela não encontrada no modelo: '${rawTable}'.`);
    }

    if (aliasToken) {
      errors.push(
        `Alias não é suportado neste trabalho: '${aliasToken}' após '${rawTable}'. Use o nome da tabela diretamente.`,
      );
    }

    if (!onCond) {
      errors.push(
        `Cláusula ON do JOIN com '${rawTable}' sem condição de junção.`,
      );
      continue;
    }

    validateCondition(onCond, aliases, usedTables, errors, "ON");
    joins.push({
      table: canonicalTable,
      alias: canonicalTable,
      condition: onCond,
    });
  }

  return joins;
}

// ═══════════════════════════════════════════════════════
//  PARSER / VALIDATOR PRINCIPAL  (HU1)
//
//  Etapas em ordem:
//  1)  Pré-processamento (normalização)
//  2)  Recursos fora do escopo → erro imediato
//  3)  Estrutura mínima (SELECT ... FROM ...)
//  4)  Extração de tabelas declaradas sem aliases
//  5)  Balanceamento global de parênteses
//  6)  Validação dos atributos no SELECT (incl. duplicatas)
//  7)  Validação dos blocos JOIN individualmente
//  8)  Validação da condição WHERE
// ═══════════════════════════════════════════════════════
function parse(rawSQL) {
  const errors = [];

  // ── 1) Pré-processamento ─────────────────────────────
  const sql = rawSQL.replace(/\s+/g, " ").trim();
  const upper = sql.toUpperCase();

  if (!sql) {
    errors.push("Consulta vazia.");
    return { errors, tokens: [], aliases: {}, usedTables: [], parsed: null };
  }

  // ── 2) Recursos fora do escopo → ERRO ────────────────
  const outOfScope = [
    { re: /\bOR\b/i, msg: "Operador 'OR' não é suportado neste trabalho." },
    { re: /\bNOT\b/i, msg: "Operador 'NOT' não é suportado neste trabalho." },
    { re: /\bLIKE\b/i, msg: "Operador 'LIKE' não é suportado neste trabalho." },
    { re: /\bIN\b/i, msg: "Operador 'IN' não é suportado neste trabalho." },
    {
      re: /\bBETWEEN\b/i,
      msg: "Operador 'BETWEEN' não é suportado neste trabalho.",
    },
    { re: /\bIS\b/i, msg: "Operador 'IS' não é suportado neste trabalho." },
    {
      re: /\bAS\b/i,
      msg: "Aliases com 'AS' não são suportados neste trabalho.",
    },
    {
      re: /\bGROUP\s+BY\b/i,
      msg: "Cláusula 'GROUP BY' não é suportada neste trabalho.",
    },
    {
      re: /\bORDER\s+BY\b/i,
      msg: "Cláusula 'ORDER BY' não é suportada neste trabalho.",
    },
    {
      re: /\bHAVING\b/i,
      msg: "Cláusula 'HAVING' não é suportada neste trabalho.",
    },
    {
      re: /\bDISTINCT\b/i,
      msg: "Cláusula 'DISTINCT' não é suportada neste trabalho.",
    },
    {
      re: /\bLIMIT\b/i,
      msg: "Cláusula 'LIMIT' não é suportada neste trabalho.",
    },
    {
      re: /\bCOUNT\s*\(/i,
      msg: "Função 'COUNT' não é suportada neste trabalho.",
    },
    { re: /\bSUM\s*\(/i, msg: "Função 'SUM' não é suportada neste trabalho." },
    { re: /\bAVG\s*\(/i, msg: "Função 'AVG' não é suportada neste trabalho." },
    { re: /\bMIN\s*\(/i, msg: "Função 'MIN' não é suportada neste trabalho." },
    { re: /\bMAX\s*\(/i, msg: "Função 'MAX' não é suportada neste trabalho." },
    {
      re: /\bUNION\b/i,
      msg: "Operador 'UNION' não é suportado neste trabalho.",
    },
    {
      re: /\bINTERSECT\b/i,
      msg: "Operador 'INTERSECT' não é suportado neste trabalho.",
    },
    {
      re: /\bEXCEPT\b/i,
      msg: "Operador 'EXCEPT' não é suportado neste trabalho.",
    },
    {
      re: /\(\s*SELECT\b/i,
      msg: "Subconsultas não são suportadas neste trabalho.",
    },
  ];
  outOfScope.forEach((r) => {
    if (r.re.test(sql)) errors.push(r.msg);
  });

  if (errors.length > 0) {
    return {
      errors,
      tokens: tokenize(sql),
      aliases: {},
      usedTables: [],
      parsed: null,
    };
  }

  // ── 3) Estrutura mínima ──────────────────────────────
  if (!upper.startsWith("SELECT")) {
    errors.push("A consulta deve começar com SELECT.");
    return {
      errors,
      tokens: tokenize(sql),
      aliases: {},
      usedTables: [],
      parsed: null,
    };
  }

  if (!/\bFROM\b/i.test(sql)) {
    errors.push("Cláusula FROM ausente.");
    return {
      errors,
      tokens: tokenize(sql),
      aliases: {},
      usedTables: [],
      parsed: null,
    };
  }

  if (/\bSELECT\s+FROM\b/i.test(sql)) {
    errors.push("Nenhum atributo declarado entre SELECT e FROM.");
  }

  if (/\bFROM\s*$/i.test(sql) || /\bFROM\s+(WHERE|JOIN|ON)\b/i.test(sql)) {
    errors.push("Cláusula FROM sem tabela declarada.");
  }

  if (/\bWHERE\s*$/i.test(sql)) {
    errors.push("Cláusula WHERE sem condição.");
  }

  if (/\bON\s*$/i.test(sql)) {
    errors.push("Cláusula ON sem condição de junção.");
  }

  // ── 4) Extração de tabelas declaradas ─────────────────
  const aliases = {};
  const usedTables = [];

  // Tabela base (FROM) — sem alias.
  // Internamente, mantemos alias = nome da tabela apenas para preservar
  // compatibilidade com as etapas HU2-HU5 já implementadas.
  const fromM = sql.match(
    /\bFROM\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s+([A-Za-z_][A-Za-z0-9_]*))?(?=\s+JOIN\b|\s+WHERE\b|\s*$)/i,
  );
  if (fromM) {
    const rawName = fromM[1];
    const aliasToken = fromM[2];
    const canonicalName = schemaKey(rawName) || rawName;

    if (aliasToken) {
      errors.push(
        `Alias não é suportado neste trabalho: '${aliasToken}' após '${rawName}'. Use o nome da tabela diretamente.`,
      );
    }

    aliases[canonicalName.toUpperCase()] = canonicalName;
    usedTables.push({ name: canonicalName, alias: canonicalName });

    if (!schemaKey(rawName)) {
      errors.push(`Tabela não encontrada no modelo: '${rawName}'.`);
    }
  }

  // Pré-extrai tabelas dos JOINs para permitir validação de condições ON.
  const joinTableRe =
    /\bJOIN\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s+([A-Za-z_][A-Za-z0-9_]*))?\s+ON\b/gi;
  let jam;
  while ((jam = joinTableRe.exec(sql)) !== null) {
    const rawName = jam[1];
    const aliasToken = jam[2];
    const canonicalName = schemaKey(rawName) || rawName;

    if (aliasToken) {
      errors.push(
        `Alias não é suportado neste trabalho: '${aliasToken}' após '${rawName}'. Use o nome da tabela diretamente.`,
      );
    }

    aliases[canonicalName.toUpperCase()] = canonicalName;
    if (
      !usedTables.some(
        (t) =>
          String(t.name).toUpperCase() === String(canonicalName).toUpperCase(),
      )
    ) {
      usedTables.push({ name: canonicalName, alias: canonicalName });
    }
  }

  // ── 5) Balanceamento global de parênteses ─────────────
  let depth = 0;
  for (const ch of sql) {
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth < 0) {
        errors.push(
          "Parênteses desbalanceados: fechamento sem abertura correspondente.",
        );
        depth = 0;
      }
    }
  }
  if (depth > 0)
    errors.push(
      "Parênteses desbalanceados: abertura sem fechamento correspondente.",
    );

  // Tokeniza para exibição
  const rawToks = tokenize(sql);

  // Interrompe validação semântica se há erros estruturais graves
  const structKeywords = [
    "FROM ausente",
    "FROM sem tabela",
    "SELECT e FROM",
    "WHERE sem condição",
    "ON sem condição",
    "Alias não é suportado",
    "Aliases com 'AS'",
  ];
  if (errors.some((e) => structKeywords.some((k) => e.includes(k)))) {
    return { errors, tokens: rawToks, aliases, usedTables, parsed: null };
  }

  // ── 6) Valida atributos no SELECT ────────────────────
  const selM = sql.match(/\bSELECT\s+([\s\S]+?)\s+\bFROM\b/i);
  if (selM) {
    const colsPart = selM[1].trim();
    if (colsPart !== "*") {
      // Detecta atributos duplicados (case-insensitive)
      const seen = new Set();
      colsPart
        .split(",")
        .map((c) => c.trim())
        .forEach((col) => {
          if (!col) return;

          const key = canonicalSelectAttr(col, aliases, usedTables);

          if (seen.has(key)) {
            errors.push(`Atributo duplicado no SELECT: '${col}'.`);
          } else {
            seen.add(key);
          }
        });

      // Valida existência de cada atributo
      colsPart
        .split(",")
        .map((c) => c.trim())
        .forEach((col) => {
          if (!col) return;
          if (col.includes(".")) {
            const [tableRef, f] = col.split(".");
            const tk = schemaKey(tableRef);
            if (!tk) {
              errors.push(
                `Tabela '${tableRef}' não existe no modelo em '${col}'.`,
              );
              return;
            }
            const declared = usedTables.some(
              (t) => String(t.name).toUpperCase() === String(tk).toUpperCase(),
            );
            if (!declared) {
              errors.push(
                `Tabela '${tableRef}' não foi declarada no FROM/JOIN em '${col}'.`,
              );
              return;
            }
            if (
              !SCHEMA[tk].fields.some(
                (x) => x.toUpperCase() === f.toUpperCase(),
              )
            ) {
              errors.push(`Atributo '${f}' não existe na tabela '${tk}'.`);
            }
          } else if (/^[A-Za-z_]/.test(col)) {
            const matches = findTablesContainingAttribute(col, usedTables);

            if (matches.length === 0) {
              errors.push(
                `Atributo '${col}' não encontrado nas tabelas declaradas.`,
              );
            } else if (matches.length > 1) {
              errors.push(
                `Atributo '${col}' é ambíguo no SELECT. Use ${matches
                  .map((tableName) => `${tableName}.${col}`)
                  .join(" ou ")}.`,
              );
            }
          }
        });
    }
  }

  // ── 7) Valida blocos JOIN individualmente ─────────────
  extractAndValidateJoins(sql, aliases, usedTables, errors);

  // ── 8) Valida condição WHERE ──────────────────────────
  // WHERE vem sempre após os JOINs; captura até o fim da string.
  const whereM = sql.match(/\bWHERE\s+([\s\S]+)$/i);
  if (whereM) {
    validateCondition(whereM[1].trim(), aliases, usedTables, errors, "WHERE");
  }

  const ok = errors.length === 0;
  const parsed = ok ? extractParsed(sql, aliases, usedTables) : null;
  return { errors, tokens: rawToks, aliases, usedTables, parsed };
}

function canonicalSelectAttr(col, aliases, usedTables) {
  const raw = col.trim();

  if (!raw) return raw.toUpperCase();

  // atributo qualificado: Tabela.campo
  if (raw.includes(".")) {
    const [tableRef, f] = raw.split(".");
    const tk = schemaKey(tableRef);
    if (!tk) return raw.toUpperCase();
    return `${String(tk).toUpperCase()}.${String(f).toUpperCase()}`;
  }

  // atributo simples: tentar resolver unicamente nas tabelas declaradas
  const matches = usedTables.filter((t) => {
    const tk = schemaKey(t.name);
    return (
      tk &&
      SCHEMA[tk].fields.some(
        (field) => field.toUpperCase() === raw.toUpperCase(),
      )
    );
  });

  if (matches.length === 1) {
    const tk = schemaKey(matches[0].name) || matches[0].name;
    return `${String(tk).toUpperCase()}.${raw.toUpperCase()}`;
  }

  // ambíguo ou não resolvido: mantém forma textual
  return raw.toUpperCase();
}

function hasInvalidSymbolicOperator(expr) {
  // 1. Símbolos totalmente inválidos no escopo do trabalho
  // (não fazem parte do SQL suportado)
  if (/[#$¨^?`´]/.test(expr)) {
    return true;
  }

  // 2. Símbolos que são inválidos quando usados com operadores
  // Exemplos: %>, *=, %=, +>, /=, -=, &=, _= etc.
  if (/[%*+\/&_|-](?:=|>|<)/.test(expr)) {
    return true;
  }

  if (/(?:=|>|<)[%*+\/&_|-]/.test(expr)) {
    return true;
  }

  return false;
}
