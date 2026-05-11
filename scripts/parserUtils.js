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

// Tokeniza a consulta em palavras-chave, identificadores, operadores, parênteses e literais
// Exemplo: "SELECT Nome, Idade FROM Pessoa WHERE Idade >= 18"
function tokenize(sql) {
  const toks = [];
  const re =
    /([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)?|<>|>=|<=|[<>=]|[(),*]|\d+(?:\.\d+)?|'[^']*')/g;
  let m;
  // Enquanto houver correspondências, extrai o token (m[1]) e adiciona à lista de tokens.
  while ((m = re.exec(sql)) !== null) toks.push(m[1]);

  // Exemplo de tokens retornados para uma consulta: ["SELECT", "Nome", ",", "Idade", "FROM", "Pessoa", "WHERE", "Idade", ">=", "18"]
  return toks;
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
  // Conta a profundidade de parênteses para garantir que estão balanceados.
  let depth = 0;
  for (const ch of cond) {
    // Se encontrar '(', incrementa a profundidade. Se encontrar ')', decrementa.
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
  // Verifica se há AND no início, fim, duplicado ou imediatamente após '(' ou antes de ')'.
  if (/^\s*AND\b/i.test(cond)) {
    errors.push(`Conectivo AND em posição inválida na cláusula ${ctx}.`);
    return;
  }
  // Exemplo de AND no início: "AND Idade > 30"
  if (/\bAND\s*$/i.test(cond)) {
    errors.push(`Conectivo AND em posição inválida na cláusula ${ctx}.`);
    return;
  }
  // Exemplo de AND duplicado: "Nome = 'Ana' AND AND Idade > 30"
  if (/\bAND\s+AND\b/i.test(cond)) {
    errors.push(`Conectivo AND duplicado na cláusula ${ctx}.`);
    return;
  }
  // Exemplo de AND antes de ')': "WHERE Idade > 30 AND)"
  if (/\(\s*AND\b/i.test(cond)) {
    errors.push(`Conectivo AND em posição inválida na cláusula ${ctx}.`);
    return;
  }
  // Exemplo de AND após '(': "WHERE (AND Idade > 30)"
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
  // Percorre a string, contando a profundidade de parênteses. Quando encontra um AND em nível 0, divide a string.
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
    // Detecta "AND" em nível 0, garantindo que não é parte de outro token (ex: "SANDY")
    // I + 3 deve ser menor que o comprimento da string para evitar overflow, e os caracteres antes e depois de "AND" devem ser não alfanuméricos ou limites da string.
    if (depth === 0 && upper.slice(i, i + 3) === "AND") {
      // Verifica se "AND" é um token isolado (não parte de outro identificador)
      const before = i === 0 || /\W/.test(cond[i - 1]);
      // after é verdadeiro se "AND" for seguido por um caractere não alfanumérico ou for o final da string
      const after = i + 3 >= cond.length || /\W/.test(cond[i + 3]);
      // Se "AND" for um token isolado, divide a string e continua a busca após o "AND".
      // Exemplo: "Nome = 'Ana' AND Idade > 30" → partes: ["Nome = 'Ana'", "Idade > 30"]
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
  // Adiciona a última parte após o último AND (ou toda a string se não houver AND)
  const last = cond.slice(start).trim();
  if (last) parts.push(last);
  return parts;
}

function validateAtom(atom, usedTables, errors, ctx) {
  // Valida um predicado atômico, que deve ser da forma "operando operador operando", por exemplo: "Idade >= 18" ou "Pessoa.Nome = 'Ana'".
  if (!atom) {
    errors.push(`Condição vazia na cláusula ${ctx}.`);
    return;
  }

  let expr = atom.trim();

  // Remove parênteses externos quando eles envolvem a expressão inteira
  while (expr.startsWith("(") && expr.endsWith(")") && isWrapped(expr)) {
    expr = expr.slice(1, -1).trim();
  }

  // Se após remover parênteses ainda existir AND em nível superior,
  // valida cada predicado interno separadamente.
  // Exemplo: (Nome = 'Ana' AND CPF = '123')
  const innerParts = splitByAnd(expr);
  if (innerParts.length > 1) {
    innerParts.forEach(
      (part) => validateAtom(part.trim(), usedTables, errors, ctx), // Divide quando tiver dois ANDs e valida cada parte como um átomo separado
    );
    return;
  }

  // Exemplo de AND no início: "AND Idade > 30"
  if (/^\s*AND\b/i.test(expr)) {
    errors.push(`Conectivo AND em posição inválida na cláusula ${ctx}.`);
    return;
  }

  // Exemplo de AND no fim: "Idade > 30 AND"
  if (/\bAND\s*$/i.test(expr)) {
    errors.push(`Conectivo AND em posição inválida na cláusula ${ctx}.`);
    return;
  }

  if (hasInvalidSymbolicOperator(expr)) {
    // Detecta operadores simbólicos inválidos como '!=', '==', '><'
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

  // Valida se a expressão contém operadores simbólicos inválidos antes de tentar encontrar o operador de comparação.
  for (const inv of invalidOps) {
    if (inv.re.test(expr)) {
      errors.push(inv.msg);
      return;
    }
  }

  // Encontra o operador de comparação (>=, <=, <, >, =, <>) em nível de parêntese 0.
  let opFound = null;
  // Percorre a lista de operadores de comparação, procurando o índice do operador na expressão usando findOperatorIndex, que garante que o operador não está dentro de parênteses.
  let opIdx = -1;

  for (const op of CMP_OPS) {
    // findOperatorIndex percorre a string expr, contando a profundidade de parênteses. Retorna o índice do operador se encontrado em nível 0, ou -1 se não encontrado.
    const idx = findOperatorIndex(expr, op);
    if (idx !== -1) {
      // Se encontrar um operador, verifica se é o primeiro encontrado ou se tem maior comprimento que o operador encontrado anteriormente (para priorizar operadores de comparação mais longos como >= sobre >).
      if (opFound === null || op.length > opFound.length) {
        opFound = op;
        opIdx = idx;
      }
    }
  }

  // Se nenhum operador de comparação for encontrado, a expressão é malformada.
  if (!opFound) {
    errors.push(
      `Expressão condicional malformada na cláusula ${ctx}: "${atom}".`,
    );
    return;
  }

  // Divide a expressão em operando esquerdo e direito usando o índice do operador encontrado.
  // Exemplo: "Idade >= 18" → left: "Idade", right: "18".
  const left = expr.slice(0, opIdx).trim();
  const right = expr.slice(opIdx + opFound.length).trim();

  // Valida ambos os operandos usando validateOperand, que verifica se são literais válidos ou referências a atributos existentes nas tabelas declaradas.
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
  // Dado um atributo sem qualificação (ex: "Idade"), retorna uma lista de tabelas declaradas que possuem esse atributo no schema.
  // Isso é usado para detectar ambiguidades e validar atributos não qualificados.
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
    // Verifica se o operador op é encontrado em nível 0 (depth === 0) e se os caracteres antes e depois
    // do operador são não alfanuméricos ou limites da string, para garantir que o operador é um token isolado.
    if (depth === 0 && expr.slice(i, i + op.length) === op) {
      // Verifica se o operador é um token isolado (não parte de outro identificador)
      if ((op === ">" || op === "<") && i + op.length < expr.length) {
        const next = expr[i + op.length];
        // Se o operador é '>' ou '<' e é seguido por '=' ou '>', isso indica um operador inválido como '>=' ou '><',
        // que já foi detectado anteriormente. Nesse caso, continua a busca sem retornar esse índice.
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
  // Literais são sempre válidos, não precisam de validação adicional.
  // Exemplo de literal numérico: "18", "3.14"
  // Exemplo de literal string: "'Ana'", "'São Paulo'"
  if (isLiteral(tok)) return;

  // Identificadores qualificados: Tabela.campo
  // Valida se a tabela existe no schema, se foi declarada no FROM/JOIN e se o campo existe nessa tabela.
  // Exemplo: "Pessoa.Nome" → tabela: "Pessoa", campo: "Nome"
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

  // Se for um identificador simples, tenta resolver entre as tabelas declaradas.
  // Se encontrar mais de uma tabela com esse campo, é ambíguo.
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
  // Expressão regular para extrair blocos JOIN, capturando a parte entre "JOIN" e o próximo "JOIN", "WHERE" ou o fim da string.
  const joinBlockRe = /\bJOIN\s+([\s\S]+?)(?=\s+\bJOIN\b|\s+\bWHERE\b|\s*$)/gi;

  let jm; // Variável para armazenar o resultado da correspondência do regex. Será usada para iterar sobre todos os blocos JOIN encontrados na string SQL.

  // availableTables é uma cópia de usedTables que será atualizada à medida que novos JOINs são processados,
  // para garantir que as cláusulas ON possam referenciar tabelas declaradas anteriormente no FROM/JOIN.
  const availableTables = [...usedTables];

  // Itera sobre cada bloco JOIN encontrado na string SQL usando a expressão regular joinBlockRe.
  while ((jm = joinBlockRe.exec(sql)) !== null) {
    const block = jm[1].trim();
    // Expressão regular para extrair a tabela, possível apelido e a cláusula ON de um bloco JOIN.
    const blockRe =
      /^([A-Za-z_][A-Za-z0-9_]*)(?:\s+([A-Za-z_][A-Za-z0-9_]*))?\s+ON\s+([\s\S]+)$/i;

    // O regex blockRe captura:
    // 1. O nome da tabela após JOIN (grupo 1)
    // 2. Um possível apelido de tabela (grupo 2, opcional)
    // 3. A cláusula ON que segue a palavra-chave ON (grupo 3)
    const bm = block.match(blockRe);

    // Se o bloco JOIN não corresponder ao formato esperado, registra um erro específico para ajudar na correção.
    if (!bm) {
      const tblOnly = block.match(/^([A-Za-z_][A-Za-z0-9_]*)/);
      const tblName = tblOnly ? tblOnly[1] : "(desconhecida)";
      errors.push(
        `JOIN com tabela '${tblName}' sem cláusula ON correspondente.`,
      );
      continue;
    }

    // Extrai a tabela, possível apelido e cláusula ON dos grupos capturados pelo regex.
    const rawTable = bm[1];
    const tableNickname = bm[2];

    // A cláusula ON é capturada como o terceiro grupo. É importante validar que ela não está vazia,
    // pois um JOIN sem condição de junção é inválido.
    const onCond = bm[3].trim();
    // Canonicaliza o nome da tabela usando schemaKey para garantir que a validação seja case-insensitive e consistente com o schema.
    const canonicalTable = schemaKey(rawTable) || rawTable;

    if (!schemaKey(rawTable)) {
      errors.push(`Tabela não encontrada no modelo: '${rawTable}'.`);
    }

    // Apelidos de tabela não são permitidos no escopo deste trabalho para evitar ambiguidade e complexidade adicional na validação semântica.
    // Se um apelido for detectado, registra um erro específico.
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

    // Valida a condição ON usando validateCondition, passando o contexto "ON" para mensagens de erro mais claras.
    // Também valida a conectividade da junção para garantir que a cláusula ON referencia tabelas declaradas.
    validateCondition(onCond, usedTables, errors, "ON");

    // Valida a conectividade do JOIN para garantir que a cláusula ON referencia tanto a tabela do JOIN quanto uma tabela já declarada no FROM/JOIN.
    validateJoinConnectivity(onCond, canonicalTable, availableTables, errors);
    joins.push({
      table: canonicalTable,
      condition: onCond,
    });

    // Após processar o JOIN, adiciona a tabela do JOIN à lista de tabelas disponíveis para validação das próximas cláusulas ON,
    // garantindo que a ordem dos JOINs seja respeitada.
    if (
      !availableTables.some(
        (t) =>
          String(t.name).toUpperCase() === String(canonicalTable).toUpperCase(),
      )
    ) {
      availableTables.push({ name: canonicalTable });
    }
  }

  // Valida a conectividade do JOIN garantindo que a cláusula ON referencia
  // tanto a tabela do JOIN quanto uma tabela já declarada no FROM/JOIN.

  function validateJoinConnectivity(
    onCond,
    joinTable,
    availableTables,
    errors,
  ) {
    // Extrai as tabelas referenciadas na cláusula ON usando referencedTablesInExpression,
    // que procura por identificadores qualificados do tipo Tabela.campo.
    const referenced = referencedTablesInExpression(onCond);

    // Canonicaliza o nome da tabela do JOIN para comparação case-insensitive e para mensagens de erro mais claras.
    const joinTableName = schemaKey(joinTable) || joinTable;

    // Se a cláusula ON não referencia nenhuma tabela, é um erro, pois a condição de junção deve conectar a tabela do JOIN a uma tabela já declarada.
    if (!referenced.length) {
      errors.push(
        `Cláusula ON do JOIN com '${joinTableName}' deve referenciar atributos qualificados das tabelas envolvidas. Exemplo: ${joinTableName}.campo = OutraTabela.campo.`,
      );
      return;
    }

    // Verifica se a cláusula ON referencia a tabela do JOIN.
    const referencesJoinTable = referenced.some(
      (tableName) =>
        String(tableName).toUpperCase() === String(joinTableName).toUpperCase(),
    );

    // Verifica se a cláusula ON referencia uma tabela já declarada no FROM/JOIN.
    const referencesPreviousTable = referenced.some((tableName) =>
      availableTables.some(
        (t) => String(t.name).toUpperCase() === String(tableName).toUpperCase(),
      ),
    );

    // Se a cláusula ON não referencia a tabela do JOIN ou não referencia uma tabela já declarada, é um erro, pois a condição de junção deve conectar a tabela do JOIN a uma tabela já declarada.
    if (!referencesJoinTable || !referencesPreviousTable) {
      errors.push(
        `Cláusula ON do JOIN com '${joinTableName}' deve conectar '${joinTableName}' a uma tabela já declarada no FROM/JOIN.`,
      );
    }
  }

  // Extrai as tabelas referenciadas em uma expressão condicional (WHERE ou ON) procurando por identificadores qualificados do tipo Tabela.campo.
  function referencedTablesInExpression(expr) {
    const refs = new Set();
    const re = /\b([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)\b/g;
    let m;

    // Enquanto houver correspondências, extrai o nome da tabela (m[1]) e, se for uma tabela válida no schema,
    // adiciona ao conjunto de referências.
    while ((m = re.exec(expr)) !== null) {
      const tableName = schemaKey(m[1]);
      if (tableName) refs.add(tableName);
    }

    return Array.from(refs);
  }

  return joins;
}

// Classifica um token para fins de destaque: palavra-chave, tabela, atributo, operador ou outro
// Observação: esta função é apenas para fins de exibição e não é usada para validação semântica.
function classifyTok(tok) {
  const u = tok.toUpperCase();
  // Palavras-chave SQL relevantes para o escopo do trabalho
  if (["SELECT", "FROM", "WHERE", "JOIN", "ON", "AND"].includes(u))
    return "keyword";
  // Identificadores qualificados: Tabela.campo
  if (tok.includes(".")) {
    // Tenta classificar como "attr" se o formato for Tabela.campo e a tabela existir no schema, ou "other" caso contrário.
    const [a, f] = tok.split(".");
    const tk = schemaKey(a);
    // Se a parte antes do ponto é uma tabela válida, classifica como "attr" se o campo existir nessa tabela, ou "other" caso contrário.
    if (tk)
      return SCHEMA[tk].fields.some((x) => x.toUpperCase() === f.toUpperCase())
        ? "attr"
        : "other";
    return "other";
  }
  // Identificadores simples: tenta classificar como "table" se for uma tabela válida, ou "attr" se for um campo presente em alguma tabela do schema, ou "other" caso contrário.
  if (schemaKey(tok)) return "table";

  // A classificação de "attr" para identificadores simples é apenas heurística para fins de destaque, pois a validação semântica
  // real ocorre em contextos específicos (SELECT, WHERE, ON) onde o escopo das tabelas declaradas é conhecido.
  // Portanto, aqui consideramos como "attr" qualquer identificador simples que corresponda a um campo presente em alguma
  // tabela do schema, mesmo que possa ser ambíguo ou não resolvível sem contexto.
  if (
    Object.values(SCHEMA).some((s) =>
      s.fields.some((f) => f.toUpperCase() === u),
    )
  )
    return "attr";
  // Operadores de comparação aceitos no escopo do trabalho
  if (/^(<>|>=|<=|[<>=])$/.test(tok)) return "op";
  return "other";
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
