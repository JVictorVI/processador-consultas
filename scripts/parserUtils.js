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

/** Normaliza a consulta para o subconjunto aceito pelo trabalho. */
function cleanSqlInput(sql) {
  return String(sql || "")
    .replace(/;\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractParsed(sql, usedTables, validatedJoins = null) {
  sql = cleanSqlInput(sql);
  const selM = sql.match(/\bSELECT\s+([\s\S]+?)\s+\bFROM\b/i);
  const selectCols = selM ? selM[1].trim() : "*";

  const frM = sql.match(
    /\bFROM\s+([A-Za-z_][A-Za-z0-9_]*)(?=\s+JOIN\b|\s+WHERE\b|\s*$)/i,
  );
  const fromTable = frM ? schemaKey(frM[1]) || frM[1] : null;
  const joins = Array.isArray(validatedJoins) ? [...validatedJoins] : [];
  if (!joins.length) {
    const joinBlockRe =
      /\bJOIN\s+([\s\S]+?)(?=\s+\bJOIN\b|\s+\bWHERE\b|\s*$)/gi;
    let jm;
    while ((jm = joinBlockRe.exec(sql)) !== null) {
      const block = jm[1].trim();
      const bm = block.match(
        /^([A-Za-z_][A-Za-z0-9_]*)\s+ON\s+([\s\S]+)$/i,
      );
      if (bm) {
        const table = schemaKey(bm[1]) || bm[1];
        joins.push({ table, condition: bm[2].trim() });
      }
    }
  }

  const whereM = sql.match(/\bWHERE\s+([\s\S]+)$/i);
  const whereCond = whereM ? whereM[1].trim() : null;

  return { selectCols, fromTable, joins, whereCond, usedTables };
}

function tokenize(sql) {
  const toks = [];
  const re =
    /([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)?|<>|>=|<=|[<>=]|[(),*]|\d+(?:\.\d+)?|'[^']*')/g;
  let m;
  while ((m = re.exec(sql)) !== null) toks.push(m[1]);
  return toks;
}

function classifyTok(tok) {
  const u = tok.toUpperCase();
  if (["SELECT", "FROM", "WHERE", "JOIN", "ON", "AND"].includes(u))
    return "keyword";
  if (tok.includes(".")) {
    const [a, f] = tok.split(".");
    const tk = schemaKey(a);
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
function validateCondition(condRaw, usedTables, errors, ctx) {
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

  parts.forEach((part) => validateAtom(part.trim(), usedTables, errors, ctx));
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

function validateAtom(atom, usedTables, errors, ctx) {
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
      validateAtom(part.trim(), usedTables, errors, ctx),
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
    validateOperand(left, usedTables, errors, ctx);
  }

  if (!right) {
    errors.push(
      `Operador de comparação sem operando à direita na cláusula ${ctx}.`,
    );
  } else {
    validateOperand(right, usedTables, errors, ctx);
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

function referencedTablesInExpression(expr) {
  const refs = new Set();
  const re = /\b([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)\b/g;
  let m;

  while ((m = re.exec(expr)) !== null) {
    const tableName = schemaKey(m[1]);
    if (tableName) refs.add(tableName);
  }

  return Array.from(refs);
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
 * Observação: apelidos de tabela foram removidos do escopo do projeto. Portanto,
 * o prefixo antes do ponto deve ser sempre o nome real da tabela.
 */
function validateOperand(tok, usedTables, errors, ctx) {
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
//  - apelido de tabela não permitido
//  - ON presente e com condição não vazia
//  - condição ON validada com validateCondition()
// ═══════════════════════════════════════════════════════
function extractAndValidateJoins(sql, usedTables, errors) {
  const joins = [];
  const joinBlockRe = /\bJOIN\s+([\s\S]+?)(?=\s+\bJOIN\b|\s+\bWHERE\b|\s*$)/gi;
  let jm;
  const availableTables = [...usedTables];

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
    const tableNickname = bm[2];
    const onCond = bm[3].trim();
    const canonicalTable = schemaKey(rawTable) || rawTable;

    if (!schemaKey(rawTable)) {
      errors.push(`Tabela não encontrada no modelo: '${rawTable}'.`);
    }

    if (tableNickname) {
      errors.push(
        `Apelido de tabela não é suportado neste trabalho: '${tableNickname}' após '${rawTable}'. Use o nome da tabela diretamente.`,
      );
    }

    if (!onCond) {
      errors.push(
        `Cláusula ON do JOIN com '${rawTable}' sem condição de junção.`,
      );
      continue;
    }

    validateCondition(onCond, usedTables, errors, "ON");
    validateJoinConnectivity(onCond, canonicalTable, availableTables, errors);
    joins.push({
      table: canonicalTable,
      condition: onCond,
    });

    if (
      !availableTables.some(
        (t) =>
          String(t.name).toUpperCase() === String(canonicalTable).toUpperCase(),
      )
    ) {
      availableTables.push({ name: canonicalTable });
    }
  }

  function validateJoinConnectivity(
    onCond,
    joinTable,
    availableTables,
    errors,
  ) {
    const referenced = referencedTablesInExpression(onCond);
    const joinTableName = schemaKey(joinTable) || joinTable;

    if (!referenced.length) {
      errors.push(
        `Cláusula ON do JOIN com '${joinTableName}' deve referenciar atributos qualificados das tabelas envolvidas. Exemplo: ${joinTableName}.campo = OutraTabela.campo.`,
      );
      return;
    }

    const referencesJoinTable = referenced.some(
      (tableName) =>
        String(tableName).toUpperCase() === String(joinTableName).toUpperCase(),
    );

    const referencesPreviousTable = referenced.some((tableName) =>
      availableTables.some(
        (t) => String(t.name).toUpperCase() === String(tableName).toUpperCase(),
      ),
    );

    if (!referencesJoinTable || !referencesPreviousTable) {
      errors.push(
        `Cláusula ON do JOIN com '${joinTableName}' deve conectar '${joinTableName}' a uma tabela já declarada no FROM/JOIN.`,
      );
    }
  }

  return joins;
}

function canonicalSelectAttr(col, usedTables) {
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
  // Símbolos totalmente inválidos no escopo do trabalho
  if (/[#$¨^?`´:\[\]{}\\]/.test(expr)) {
    return true;
  }

  // Combinações inválidas com operadores de comparação
  // Exemplos: %>, *=, %=, +>, /=, -=, &=, _=, !=
  if (/[!%*+\/&_|-](?:=|>|<)/.test(expr)) {
    return true;
  }

  if (/(?:=|>|<)[!%*+\/&_|-]/.test(expr)) {
    return true;
  }

  // Operadores aritméticos/modulares isolados fora do escopo
  // Exemplo: Preco % 2 = 0
  if (/(^|\s)[%*+\/&|](\s|$)/.test(expr)) {
    return true;
  }

  return false;
}
