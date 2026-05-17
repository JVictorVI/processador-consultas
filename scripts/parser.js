"use strict";

// ═══════════════════════════════════════════════════════
//  PARSER / VALIDATOR PRINCIPAL  (HU1)
//
//  Etapas em ordem:
//  1)  Pré-processamento (normalização)
//  2)  Recursos fora do escopo → erro imediato
//  3)  Estrutura mínima (SELECT ... FROM ...)
//  4)  Extração de tabelas declaradas sem apelidos de tabela
//  5)  Balanceamento global de parênteses
//  6)  Validação dos atributos no SELECT (incl. duplicatas)
//  7)  Validação dos blocos JOIN individualmente
//  8)  Validação da condição WHERE
// ═══════════════════════════════════════════════════════
function parse(rawSQL) {
  const errors = [];

  // ── 1) Pré-processamento ─────────────────────────────
  const sql = cleanSqlInput(rawSQL);
  const upper = sql.toUpperCase();

  if (!sql) {
    errors.push("Consulta vazia.");
    return { errors, tokens: [], usedTables: [], parsed: null };
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
      msg: "Apelidos de tabela com 'AS' não são suportados neste trabalho.",
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
      usedTables: [],
      parsed: null,
    };
  }

  if (!/\bFROM\b/i.test(sql)) {
    errors.push("Cláusula FROM ausente.");
    return {
      errors,
      tokens: tokenize(sql),
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
  const usedTables = [];

  // Tabela base (FROM)
  const fromM = sql.match(
    /\bFROM\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s+([A-Za-z_][A-Za-z0-9_]*))?(?=\s+JOIN\b|\s+WHERE\b|\s*$)/i,
  );
  if (fromM) {
    const rawName = fromM[1];
    const tableNickname = fromM[2];
    const canonicalName = schemaKey(rawName) || rawName;

    if (tableNickname) {
      errors.push(
        `Apelido de tabela não é suportado neste trabalho: '${tableNickname}' após '${rawName}'. Use o nome da tabela diretamente.`,
      );
    }

    usedTables.push({ name: canonicalName });

    if (!schemaKey(rawName)) {
      errors.push(`Tabela não encontrada no modelo: '${rawName}'.`);
    }
  }

  // Pré-extrai tabelas dos JOINs para permitir validação de condições ON.
  // Ex: JOIN Vendas v ON ... ou JOIN Vendas ON ...
  const joinTableRe =
    /\bJOIN\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s+([A-Za-z_][A-Za-z0-9_]*))?\s+ON\b/gi;
  let jam;
  while ((jam = joinTableRe.exec(sql)) !== null) {
    const rawName = jam[1];
    const tableNickname = jam[2]; // Exemplo: JOIN Vendas v ON ...
    const canonicalName = schemaKey(rawName) || rawName;

    if (tableNickname) {
      errors.push(
        `Apelido de tabela não é suportado neste trabalho: '${tableNickname}' após '${rawName}'. Use o nome da tabela diretamente.`,
      );
    }

    if (
      !usedTables.some(
        (t) =>
          String(t.name).toUpperCase() === String(canonicalName).toUpperCase(),
      )
    ) {
      usedTables.push({ name: canonicalName });
    }
  }

  // ── 5) Balanceamento global de parênteses ─────────────
  // Exemplo de erro: SELECT * FROM Vendas WHERE (Valor > 100
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
    "Apelido de tabela não é suportado",
    "Apelidos de tabela com 'AS'",
  ];

  // Se algum erro estrutural grave foi detectado, interrompe a validação.
  if (errors.some((e) => structKeywords.some((k) => e.includes(k)))) {
    return { errors, tokens: rawToks, usedTables, parsed: null };
  }

  // ── 6) Valida atributos no SELECT ────────────────────
  // Captura o que está entre SELECT e FROM para validação de atributos.
  // Exemplo: SELECT id, Nome FROM Produto → selM[1] = "id, Nome"
  const selM = sql.match(/\bSELECT\s+([\s\S]+?)\s+\bFROM\b/i);
  if (selM) {
    const colsPart = selM[1].trim();
    if (colsPart !== "*") {
      // Detecta atributos duplicados
      const seen = new Set();
      colsPart
        .split(",")
        .map((c) => c.trim())
        .forEach((col) => {
          if (!col) return;

          // Retorna no formato Tabela.Atributo
          const key = canonicalSelectAttr(col, usedTables);

          if (seen.has(key)) {
            errors.push(`Atributo duplicado no SELECT: '${col}'.`);
          } else {
            seen.add(key);
          }
        });

      colsPart
        .split(",")
        .map((c) => c.trim())
        .forEach((col) => {
          if (!col) return;
          // Verficaa se o atributo é qualificado com tabela (Tabela.Atributo)
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
          }

          // Verifica se o atributo é um nome simples  e tenta resolver unicamente entre as tabelas usadas.
          else if (/^[A-Za-z_]/.test(col)) {
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
  // Após a extracão das tabelas utlizadas, cada bloco JOIN é extraído e validado individualmente
  const joins = extractAndValidateJoins(sql, usedTables, errors);

  // ── 8) Valida condição WHERE ──────────────────────────
  // WHERE vem sempre após os JOINs; captura até o fim da string.
  const whereM = sql.match(/\bWHERE\s+([\s\S]+)$/i);
  if (whereM) {
    validateCondition(whereM[1].trim(), usedTables, errors, "WHERE");
  }

  const ok = errors.length === 0;
  const parsed = ok ? extractParsed(sql, usedTables, joins) : null;
  return { errors, tokens: rawToks, usedTables, parsed };
}
