// ═══════════════════════════════════════════════════════
//  UTILITÁRIOS LÉXICOS
// ═══════════════════════════════════════════════════════

/** Retorna nome canônico da tabela no schema ou null
 * Ex: "vendas" -> "Vendas", "VENdas" -> "Vendas", "Venda" -> null
 */
function schemaKey(name) {
  return (
    Object.keys(SCHEMA).find((k) => k.toUpperCase() === name.toUpperCase()) ||
    null
  );
}

// ═══════════════════════════════════════════════════════
//  TOKENIZADOR — gera lista de tokens para exibição
// ═══════════════════════════════════════════════════════

/** Normaliza a consulta para o subconjunto aceito pelo trabalho. */
// Remove ponto-e-vírgula final, remove espaços.
function cleanSqlInput(sql) {
  return String(sql || "")
    .replace(/;\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ══════════════════════════════════════════════════════
// EXTRAÇÃO DE COMPONENTES DA CONSULTA
// Pega o SQL em texto e gera uma estrutura organizada com SELECT, FROM, JOIN e WHERE
// Os JOINs podem ser pré-validados e passados como argumento.
// ══════════════════════════════════════════════════════
function extractParsed(sql, usedTables, validatedJoins = null) {
  sql = cleanSqlInput(sql);

  // Extrai colunas do SELECT
  const selM = sql.match(/\bSELECT\s+([\s\S]+?)\s+\bFROM\b/i);
  // Se não encontrar, assume SELECT *
  const selectCols = selM ? selM[1].trim() : "*";

  // Extrai tabela do FROM
  const frM = sql.match(
    /\bFROM\s+([A-Za-z_][A-Za-z0-9_]*)(?=\s+JOIN\b|\s+WHERE\b|\s*$)/i,
  );

  // Tenta resolver nome da tabela contra o schema, mas mantém forma textual se não encontrar.
  const fromTable = frM ? schemaKey(frM[1]) || frM[1] : null;

  // Extrai blocos de JOIN pré-validados ou, se não fornecidos, tenta extrair diretamente da string SQL.
  const joins = Array.isArray(validatedJoins) ? [...validatedJoins] : [];

  // Se não foram pré-validados, tenta extrair diretamente da string SQL.
  if (!joins.length) {
    const joinBlockRe =
      /\bJOIN\s+([\s\S]+?)(?=\s+\bJOIN\b|\s+\bWHERE\b|\s*$)/gi;
    let jm;
    while ((jm = joinBlockRe.exec(sql)) !== null) {
      const block = jm[1].trim();
      const bm = block.match(/^([A-Za-z_][A-Za-z0-9_]*)\s+ON\s+([\s\S]+)$/i);
      if (bm) {
        const table = schemaKey(bm[1]) || bm[1];
        joins.push({ table, condition: bm[2].trim() });
      }
    }
  }

  // Extrai condição do WHERE
  const whereM = sql.match(/\bWHERE\s+([\s\S]+)$/i);
  // Se não encontrar, assume condição nula (sem WHERE)
  const whereCond = whereM ? whereM[1].trim() : null;

  return { selectCols, fromTable, joins, whereCond, usedTables };
}

// ══════════════════════════════════════════════════════
//  TOKENIZADOR — gera lista de tokens para exibição
// ══════════════════════════════════════════════════════
function tokenize(sql) {
  const toks = [];
  const re =
    /([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)?|<>|>=|<=|[<>=]|[(),*]|\d+(?:\.\d+)?|'[^']*')/g;
  let m;
  while ((m = re.exec(sql)) !== null) toks.push(m[1]);
  return toks;
}

// Classifica um token para fins de exibição: palavra-chave, tabela, atributo, operador ou outro.
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
//  5. Verifica se ambos os lados da comparação estão presentes
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
  // Ex: AND no início: WHERE AND Nome = 'Ana'
  if (/^\s*AND\b/i.test(cond)) {
    errors.push(`Conectivo AND em posição inválida na cláusula ${ctx}.`);
    return;
  }

  // Ex: AND no fim: WHERE Nome = 'Ana' AND
  if (/\bAND\s*$/i.test(cond)) {
    errors.push(`Conectivo AND em posição inválida na cláusula ${ctx}.`);
    return;
  }

  // Ex: AND duplicado: WHERE Nome = 'Ana' AND AND TipoCliente_idTipoCliente = 1
  if (/\bAND\s+AND\b/i.test(cond)) {
    errors.push(`Conectivo AND duplicado na cláusula ${ctx}.`);
    return;
  }

  // Ex: AND após '(': WHERE (AND Nome = 'Ana')
  if (/\(\s*AND\b/i.test(cond)) {
    errors.push(`Conectivo AND em posição inválida na cláusula ${ctx}.`);
    return;
  }

  // Ex: AND antes de ')': WHERE (Nome = 'Ana' AND TipoCliente_idTipoCliente = 1 AND)
  if (/\bAND\s*\)/i.test(cond)) {
    errors.push(`Conectivo AND em posição inválida na cláusula ${ctx}.`);
    return;
  }

  // ── Divide por AND FORA de parênteses e valida cada parte ───────────
  // Ex: WHERE Nome = 'Ana' AND TipoCliente_idTipoCliente = 1
  // partes: ["Nome = 'Ana'", "TipoCliente_idTipoCliente = 1"]
  const parts = splitByAnd(cond);

  if (parts.length === 0) {
    errors.push(`Condição incompleta na cláusula ${ctx}.`);
    return;
  }

  // Valida cada parte atômica da condição, que deve ser uma comparação simples.
  parts.forEach((part) => validateAtom(part.trim(), usedTables, errors, ctx));
}

// Divide uma condição por AND, respeitando o balanceamento de parênteses.
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

    // Encontra AND fora de parênteses e garante que não é parte de outro token (ex: "AND" em "SANDWICH").
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

// Valida um predicado atômico, que deve ser da forma "operando operador operando",
// Como "Nome = 'Ana'" ou "Produto.Preco > 50".
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

  // Exemplo: (Nome = 'Ana' AND CPF = '123')
  const innerParts = splitByAnd(expr);

  if (innerParts.length > 1) {
    innerParts.forEach((part) =>
      validateAtom(part.trim(), usedTables, errors, ctx),
    );
    return;
  }

  //; Exemplo: AND Nome = 'Ana' (AND no início)
  if (/^\s*AND\b/i.test(expr)) {
    errors.push(`Conectivo AND em posição inválida na cláusula ${ctx}.`);
    return;
  }

  // Exemplo: Nome = 'Ana' AND (AND no fim)
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
    // Procura o operador na expressão
    const idx = findOperatorIndex(expr, op);
    if (idx !== -1) {
      // Quando houver operadores parecidos, o maior seja escolhido primeiro, como >= em vez de >.
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

  // Divide a expressão em operando esquerdo e direito com base no operador encontrado.
  const left = expr.slice(0, opIdx).trim(); //  Exemplo: "Produto.Preco > 50" -> left = "Produto.Preco"
  const right = expr.slice(opIdx + opFound.length).trim(); // Exemplo: "Produto.Preco > 50" -> right = "50"

  // Exemplo de erro: "Produto.Preco >" (operando direito ausente)
  if (!left) {
    errors.push(
      `Operador de comparação sem operando à esquerda na cláusula ${ctx}.`,
    );
  }

  // Ex: "> 50" (operando esquerdo ausente)
  if (!right) {
    errors.push(
      `Operador de comparação sem operando à direita na cláusula ${ctx}.`,
    );
  }
}

// Procura quais tabelas usadas na consulta possuem o atributo indicado.
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

// Retorna lista de tabelas referenciadas por atributos qualificados dentro de uma expressão condicional
// (ON ou WHERE).
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
 * Ex: "(a = b)" -> true,  "(a) = (b)" -> false
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
 * Procura qual operador de comparação existe dentro de uma condição.
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
      // Evita confundir > com >=, por exemplo.
      // Se encontrar >, verifica se o próximo caractere forma um operador maior.
      if ((op === ">" || op === "<") && i + op.length < expr.length) {
        const next = expr[i + op.length];
        if (next === "=" || next === ">") continue;
      }
      return i;
    }
  }
  return -1;
}

// ═══════════════════════════════════════════════════════
//  EXTRAÇÃO E VALIDAÇÃO DE BLOCOS JOIN
//
//  Cada JOIN é validado individualmente:
//  - ON presente e com condição não vazia
//  - condição ON validada com validateCondition()
// ═══════════════════════════════════════════════════════
function extractAndValidateJoins(sql, usedTables, errors) {
  const joins = [];

  // Considera casos de múltiplos JOINs e garante que cada bloco seja extraído corretamente
  const joinBlockRe = /\bJOIN\s+([\s\S]+?)(?=\s+\bJOIN\b|\s+\bWHERE\b|\s*$)/gi;
  let jm;
  const availableTables = [...usedTables];

  // Para cada bloco de JOIN encontrado, extrai tabela e condição ON
  while ((jm = joinBlockRe.exec(sql)) !== null) {
    // Ex: "Categoria ON Produto.Categoria_idCategoria = Categoria.idCategoria"
    const block = jm[1].trim();
    // Valida estrutura básica do bloco JOIN: "Tabela [Apelido] ON Condição"
    const blockRe =
      /^([A-Za-z_][A-Za-z0-9_]*)(?:\s+([A-Za-z_][A-Za-z0-9_]*))?\s+ON\s+([\s\S]+)$/i;
    const bm = block.match(blockRe);

    // Se não casar, é um JOIN malformado. Tenta extrair o nome da tabela para uma mensagem de erro mais informativa.
    // Ex: "JOIN Categoria Preco > 50"
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
      // Ex: JOIN Pedido ON (condição ON vazia)
      errors.push(
        `Cláusula ON do JOIN com '${rawTable}' sem condição de junção.`,
      );
      continue;
    }

    validateCondition(onCond, usedTables, errors, "ON");

    // Valida conectividade do JOIN: a condição ON deve referenciar atributos qualificados
    // que conectem a tabela do JOIN a pelo menos uma tabela já disponível (FROM ou JOINs anteriores).
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

  // Valida conectividade do JOIN: a condição ON deve referenciar atributos qualificados
  function validateJoinConnectivity(
    onCond,
    joinTable,
    availableTables,
    errors,
  ) {
    // Extrai e retorna as tabelas referenciadas por atributos qualificados na condição ON.
    // Exemplo: ON Produto.Categoria_idCategoria = Categoria.idCategoria -> referenced = ["Produto", "Categoria"]
    const referenced = referencedTablesInExpression(onCond);
    const joinTableName = schemaKey(joinTable) || joinTable;

    // Verifica se a condição ON referencia algum atributo qualificado.
    // Exemplo de erro: JOIN Categoria ON Preco > 50
    if (!referenced.length) {
      errors.push(
        `Cláusula ON do JOIN com '${joinTableName}' deve referenciar atributos qualificados das tabelas envolvidas. Exemplo: ${joinTableName}.campo = OutraTabela.campo.`,
      );
      return;
    }

    // Verifica se a condição ON referencia a tabela do JOIN
    // Exemplo de erro: JOIN Categoria ON Produto.Categoria_idCategoria = 1
    const referencesJoinTable = referenced.some(
      (tableName) =>
        String(tableName).toUpperCase() === String(joinTableName).toUpperCase(),
    );

    // Verifica se a condição ON referencia pelo menos uma tabela já disponível (FROM ou JOINs anteriores)
    // Exemplo de erro: JOIN Categoria ON Categoria.idCategoria = 1 (sem referência a Produto ou outra tabela do FROM/JOIN anterior)
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

// Retorna forma canônica de um atributo do SELECT, tentando resolver contra as tabelas usadas.
function canonicalSelectAttr(col, usedTables) {
  const raw = col.trim();

  if (!raw) return raw.toUpperCase();

  // Atributo qualificado: tenta resolver tabela contra o schema, mas mantém forma textual se não encontrar.
  if (raw.includes(".")) {
    const [tableRef, f] = raw.split(".");
    const tk = schemaKey(tableRef);
    if (!tk) return raw.toUpperCase();
    return `${String(tk).toUpperCase()}.${String(f).toUpperCase()}`;
  }

  // atributo simples: tentar resolver unicamente nas tabelas declaradas
  // Verifica se existe em alguma tabela usada na consulta
  const matches = usedTables.filter((t) => {
    const tk = schemaKey(t.name);
    return (
      tk &&
      SCHEMA[tk].fields.some(
        (field) => field.toUpperCase() === raw.toUpperCase(),
      )
    );
  });

  // Se encontrar exatamente uma tabela que contenha o atributo, retorna na forma Tabela.Atributo.
  if (matches.length === 1) {
    const tk = schemaKey(matches[0].name) || matches[0].name;
    return `${String(tk).toUpperCase()}.${raw.toUpperCase()}`;
  }

  // Caso contrário, mantém forma textual para exibição e possível mensagem de erro posterior.
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
