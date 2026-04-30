/* ═══════════════════════════════════════════════════════
   PROCESSADOR DE CONSULTAS SQL — HU2 + HU4
   algebra.js — Conversão para Álgebra Relacional e Otimização
   Depende de: schema.js, parser.js
═══════════════════════════════════════════════════════ */
"use strict";

function cleanSqlInputForAlgebra(sql) {
  if (typeof cleanSqlInput === "function") return cleanSqlInput(sql);
  return String(sql || "")
    .replace(/;\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function canonicalTableName(name) {
  return schemaKey(name) || name;
}

function canonicalFieldName(tableName, fieldName) {
  const tk = schemaKey(tableName);
  if (!tk) return fieldName;
  const found = SCHEMA[tk].fields.find(
    (f) => f.toUpperCase() === String(fieldName).toUpperCase(),
  );
  return found || fieldName;
}

function qualifyAttr(tableName, fieldName) {
  const table = canonicalTableName(tableName);
  const field = canonicalFieldName(table, fieldName);
  return `${table}.${field}`;
}

// ═══════════════════════════════════════════════════════
//  EXTRATOR DE ESTRUTURA PARSED (para HU2)
// ═══════════════════════════════════════════════════════
function extractParsed(sql, usedTables) {
  sql = cleanSqlInputForAlgebra(sql);
  const selM = sql.match(/\bSELECT\s+([\s\S]+?)\s+\bFROM\b/i);
  const selectCols = selM ? selM[1].trim() : "*";

  const frM = sql.match(
    /\bFROM\s+([A-Za-z_][A-Za-z0-9_]*)(?=\s+JOIN\b|\s+WHERE\b|\s*$)/i,
  );
  const fromTable = frM ? schemaKey(frM[1]) || frM[1] : null;
  const joins = [];
  const joinBlockRe = /\bJOIN\s+([\s\S]+?)(?=\s+\bJOIN\b|\s+\bWHERE\b|\s*$)/gi;
  let jm;
  while ((jm = joinBlockRe.exec(sql)) !== null) {
    const block = jm[1].trim();
    const bm = block.match(/^([A-Za-z_][A-Za-z0-9_]*)\s+ON\s+([\s\S]+)$/i);
    if (bm) {
      const table = schemaKey(bm[1]) || bm[1];
      joins.push({ table, condition: bm[2].trim() });
    }
  }

  const whereM = sql.match(/\bWHERE\s+([\s\S]+)$/i);
  const whereCond = whereM ? whereM[1].trim() : null;

  return { selectCols, fromTable, joins, whereCond, usedTables };
}

// ═══════════════════════════════════════════════════════
//  DETECTA TIPO DE JUNÇÃO
// ═══════════════════════════════════════════════════════
function joinKind(cond) {
  const m = cond
    .trim()
    .match(
      /^([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)$/,
    );
  return m ? "equi" : "theta";
}

function makeRel(table) {
  const name = schemaKey(table) || table;
  return { type: "rel", name };
}

// ═══════════════════════════════════════════════════════
//  CONVERSOR PARA ÁLGEBRA RELACIONAL (HU2)
// ═══════════════════════════════════════════════════════
function toAlgebra(parsed) {
  if (!parsed || !parsed.fromTable) return null;
  const { selectCols, fromTable, joins, whereCond } = parsed;
  const steps = [];

  let tree = makeRel(fromTable);
  steps.push({
    type: "from",
    color: "var(--accent)",
    label: `Relação base: ${relLabel(tree)}`,
    desc: `Ponto de partida — relação ${relLabel(tree)}. Cada linha representa uma tupla.`,
    tree: deepCopy(tree),
  });

  joins.forEach((j, i) => {
    const rel = makeRel(j.table);
    const cond = j.condition.trim();
    const kind = joinKind(cond);
    tree = { type: kind, left: tree, right: rel, cond };
    steps.push({
      type: "join",
      color: "var(--join)",
      label:
        kind === "equi"
          ? `JOIN #${i + 1} → Equijunção ⋈ com ${relLabel(rel)}`
          : `JOIN #${i + 1} → Junção-θ ⋈θ com ${relLabel(rel)}`,
      desc:
        kind === "equi"
          ? `Equijunção: igualdade entre FK e PK. Notação: ⋈_{${cond}}.`
          : `Junção theta: condição geral (${cond}). Retém tuplas que satisfazem o predicado.`,
      tree: deepCopy(tree),
    });
  });

  if (whereCond) {
    tree = { type: "sigma", cond: whereCond, inner: tree };
    steps.push({
      type: "sigma",
      color: "var(--sigma)",
      label: `WHERE → σ Seleção`,
      desc: `σ_{${whereCond}} — filtra tuplas que satisfazem a condição. Reduz linhas, mantém colunas.`,
      tree: deepCopy(tree),
    });
  }

  let attrs;
  if (selectCols.trim() === "*") {
    const tables = [fromTable, ...joins.map((j) => j.table)];
    const list = [];
    tables.forEach((table) => {
      const tk = schemaKey(table);
      if (!tk) return;
      SCHEMA[tk].fields.forEach((f) => list.push(`${table}.${f}`));
    });
    attrs = list.join(", ");
    tree = { type: "pi", attrs, inner: tree, selectAll: true };
    steps.push({
      type: "pi",
      color: "var(--pi)",
      label: `SELECT * → π (atributos qualificados por tabela)`,
      desc: `SELECT * com ${tables.length} tabela(s). Cada atributo é qualificado pelo nome da tabela para evitar ambiguidade.`,
      tree: deepCopy(tree),
    });
  } else {
    attrs = selectCols
      .split(",")
      .map((c) => c.trim())
      .join(", ");
    tree = { type: "pi", attrs, inner: tree };
    steps.push({
      type: "pi",
      color: "var(--pi)",
      label: `SELECT → π Projeção`,
      desc: `π_{${attrs}} — projeta somente os atributos solicitados. Reduz colunas.`,
      tree: deepCopy(tree),
    });
  }

  return {
    exprText: treeToText(tree),
    exprHtml: treeToHtml(tree),
    steps,
    tree,
  };
}

// ─────────────────────────────────────────────────────
//  AST → texto plano / HTML
// ─────────────────────────────────────────────────────
function treeToText(n) {
  if (!n) return "";
  switch (n.type) {
    case "rel":
      return relLabel(n);
    case "equi":
      return `(${treeToText(n.left)} ⋈_{${n.cond}} ${treeToText(n.right)})`;
    case "theta":
      return `(${treeToText(n.left)} ⋈_θ{${n.cond}} ${treeToText(n.right)})`;
    case "sigma":
      return `σ_{${n.cond}}(${treeToText(n.inner)})`;
    case "pi":
      return `π_{${n.attrs}}(${treeToText(n.inner)})`;
    default:
      return "";
  }
}

function treeToHtml(n) {
  if (!n) return "";
  const e = (s) =>
    String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  switch (n.type) {
    case "rel":
      return `<span class="s-rel">${e(relLabel(n))}</span>`;
    case "equi":
      return (
        `<span class="s-paren">( </span>` +
        treeToHtml(n.left) +
        ` <span class="s-join">⋈</span><span class="s-sub s-join-cond">${e(n.cond)}</span> ` +
        treeToHtml(n.right) +
        `<span class="s-paren"> )</span>`
      );
    case "theta":
      return (
        `<span class="s-paren">( </span>` +
        treeToHtml(n.left) +
        ` <span class="s-join">⋈</span><span class="s-sub s-join-cond">θ: ${e(n.cond)}</span> ` +
        treeToHtml(n.right) +
        `<span class="s-paren"> )</span>`
      );
    case "sigma":
      return (
        `<span class="s-sigma">σ</span><span class="s-sub s-sigma-cond">${e(n.cond)}</span>` +
        `<span class="s-paren">( </span>` +
        treeToHtml(n.inner) +
        `<span class="s-paren"> )</span>`
      );
    case "pi":
      return (
        `<span class="s-pi">π</span><span class="s-sub s-proj">${e(n.attrs)}</span>` +
        `<span class="s-paren">( </span>` +
        treeToHtml(n.inner) +
        `<span class="s-paren"> )</span>`
      );
    default:
      return "";
  }
}

function relLabel(n) {
  if (!n) return "";
  return n.name;
}

function deepCopy(o) {
  return JSON.parse(JSON.stringify(o));
}

// ═══════════════════════════════════════════════════════
//  HU4 — OTIMIZAÇÃO REAL DA ÁRVORE DE CONSULTA
// ═══════════════════════════════════════════════════════
function optimizeTree(tree) {
  if (!tree) return { optimizedTree: null, optSteps: [] };

  const optSteps = [];
  const originalTree = deepCopy(tree);
  const finalPi = tree.type === "pi" ? deepCopy(tree) : null;
  const finalAttrs = finalPi ? finalPi.attrs : "*";

  const withoutProjection = finalPi ? deepCopy(finalPi.inner) : deepCopy(tree);
  const extracted = extractTopSigma(withoutProjection);
  const baseJoinTree = extracted.inner;
  const whereConds = extracted.conds;

  optSteps.push({
    type: "original",
    label: "Árvore original",
    desc: "Forma inicial gerada pela conversão SQL → álgebra relacional, antes das heurísticas.",
    tree: deepCopy(originalTree),
  });

  const pushResult = pushSelectionsToRelations(
    baseJoinTree,
    whereConds,
    optSteps,
  );
  let optimizedInner = pushResult.tree;

  const remainingConds = whereConds.filter(
    (cond) => !pushResult.appliedConds.has(cond),
  );

  if (remainingConds.length) {
    optimizedInner = {
      type: "sigma",
      cond: remainingConds.join(" AND "),
      inner: optimizedInner,
    };
  }

  optimizedInner = reorderJoinTree(optimizedInner, optSteps);
  optimizedInner = applyIntermediateProjections(
    optimizedInner,
    finalAttrs,
    optSteps,
  );

  const optimizedTree = {
    type: "pi",
    attrs: finalAttrs,
    inner: optimizedInner,
    selectAll: finalPi ? finalPi.selectAll : false,
  };

  optSteps.push({
    type: "final",
    label: "Árvore otimizada final",
    desc: "Plano lógico final com seleções próximas das relações, projeções intermediárias e junções preservando suas dependências.",
    tree: deepCopy(optimizedTree),
  });

  return { optimizedTree, optSteps };
}

// ─────────────────────────────────────────────────────
//  Extração de σ no topo: π(σc(J)) → c + J
// ─────────────────────────────────────────────────────
function extractTopSigma(node) {
  const conds = [];
  let current = deepCopy(node);
  while (current && current.type === "sigma") {
    conds.push(...splitWhereConditions(current.cond));
    current = current.inner;
  }
  return { inner: current, conds };
}

function splitWhereConditions(cond) {
  if (!cond) return [];
  if (typeof splitByAnd === "function")
    return splitByAnd(cond)
      .map((s) => s.trim())
      .filter(Boolean);
  return String(cond)
    .split(/\s+AND\s+/i)
    .map((s) => s.trim())
    .filter(Boolean);
}

function referencedTables(expr) {
  const refs = new Set();
  const re = /\b([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)\b/g;
  let m;

  while ((m = re.exec(expr)) !== null) {
    const canonical = schemaKey(m[1]) || m[1];
    refs.add(canonical);
  }

  return Array.from(refs);
}

function conditionBelongsToSingleRelation(cond, relations = []) {
  return !!inferSingleRelationForCondition(cond, relations);
}

function inferSingleRelationForCondition(cond, relations = []) {
  const refs = referencedTables(cond);

  if (refs.length === 1) {
    const ref = schemaKey(refs[0]) || refs[0];

    return (
      relations.find((r) => {
        const relName = schemaKey(r.name) || r.name;
        return String(relName).toUpperCase() === String(ref).toUpperCase();
      }) || null
    );
  }

  if (refs.length > 1) return null;

  const identifiers = String(cond)
    .replace(/'[^']*'/g, " ")
    .replace(/\b[A-Za-z_][A-Za-z0-9_]*\./g, "")
    .split(/[^A-Za-z0-9_]+/)
    .map((x) => x.trim())
    .filter(Boolean)
    .filter((x) => !/^\d+(\.\d+)?$/.test(x))
    .filter((x) => !["AND"].includes(x.toUpperCase()));

  if (!identifiers.length) {
    return relations.length === 1 ? relations[0] : null;
  }

  const matches = relations.filter((r) => {
    const tk = schemaKey(r.name);
    if (!tk) return false;

    return identifiers.every((id) =>
      SCHEMA[tk].fields.some((f) => f.toUpperCase() === id.toUpperCase()),
    );
  });

  return matches.length === 1 ? matches[0] : null;
}

function collectRelations(node, list = []) {
  if (!node) return list;
  if (node.type === "rel") list.push(node);
  if (node.inner) collectRelations(node.inner, list);
  if (node.left) collectRelations(node.left, list);
  if (node.right) collectRelations(node.right, list);
  return list;
}

function tableNamesInTree(node) {
  return collectRelations(node).map((r) => r.name);
}

function pushSelectionsToRelations(node, whereConds, steps) {
  if (!node) return { tree: node, appliedConds: new Set() };

  const appliedConds = new Set();

  function getCondTable(cond) {
    const m = String(cond).match(/\b([A-Za-z_][A-Za-z0-9_]*)\./);
    if (!m) return null;
    return schemaKey(m[1]) || m[1];
  }

  function sameTable(a, b) {
    const ca = schemaKey(a) || a;
    const cb = schemaKey(b) || b;
    return String(ca).toUpperCase() === String(cb).toUpperCase();
  }

  function visit(n) {
    if (!n) return n;

    if (n.type === "rel") {
      const ownConds = whereConds.filter((cond) => {
        const condTable = getCondTable(cond);
        return condTable && sameTable(condTable, n.name);
      });

      if (!ownConds.length) return n;

      let wrapped = n;

      ownConds.forEach((cond) => {
        wrapped = {
          type: "sigma",
          cond,
          inner: wrapped,
        };
        appliedConds.add(cond);
      });

      return wrapped;
    }

    if (n.inner) n.inner = visit(n.inner);
    if (n.left) n.left = visit(n.left);
    if (n.right) n.right = visit(n.right);

    return n;
  }

  return {
    tree: visit(deepCopy(node)),
    appliedConds,
  };
}

function collectJoinConditions(node, list = []) {
  if (!node) return list;
  if (node.type === "equi" || node.type === "theta") list.push(node.cond);
  if (node.inner) collectJoinConditions(node.inner, list);
  if (node.left) collectJoinConditions(node.left, list);
  if (node.right) collectJoinConditions(node.right, list);
  return list;
}

function collectRequiredAttributes(tree, finalAttrs) {
  const required = {};
  const rels = collectRelations(tree);

  rels.forEach((r) => {
    const tableName = canonicalTableName(r.name);
    required[tableName] = new Set();
  });

  function addAttribute(tableName, fieldName) {
    const table = canonicalTableName(tableName);
    const field = canonicalFieldName(table, fieldName);
    if (!required[table]) required[table] = new Set();
    required[table].add(field);
  }

  function addQualified(expr) {
    const re = /\b([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)\b/g;
    let m;
    while ((m = re.exec(String(expr || ""))) !== null) {
      addAttribute(m[1], m[2]);
    }
  }

  function addUnqualifiedAttributesFromCondition(expr) {
    const clean = String(expr || "")
      .replace(/'[^']*'/g, " ")
      .replace(/\b[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*\b/g, " ");

    const identifiers = clean
      .split(/[^A-Za-z0-9_]+/)
      .map((x) => x.trim())
      .filter(Boolean)
      .filter((x) => !/^\d+(\.\d+)?$/.test(x))
      .filter((x) => !["AND"].includes(x.toUpperCase()));

    identifiers.forEach((attr) => {
      const matches = rels.filter((r) => {
        const tk = schemaKey(r.name);
        return (
          tk &&
          SCHEMA[tk].fields.some((f) => f.toUpperCase() === attr.toUpperCase())
        );
      });
      if (matches.length === 1) {
        addAttribute(matches[0].name, attr);
      }
    });
  }

  addQualified(finalAttrs || "");
  collectJoinConditions(tree).forEach(addQualified);

  // Atributos usados por seleções já empurradas para uma relação não precisam
  // sobreviver acima dessa seleção. Ex.: π nome,idCliente(σ tipo=1(Cliente)).
  // Só preservamos atributos de σ que continuam acima de junções/subárvores.
  collectSigmaNodes(tree).forEach((sigmaNode) => {
    if (sigmaNode.inner && sigmaNode.inner.type === "rel") return;
    addQualified(sigmaNode.cond);
    addUnqualifiedAttributesFromCondition(sigmaNode.cond);
  });

  String(finalAttrs || "")
    .split(",")
    .map((a) => a.trim())
    .filter(Boolean)
    .forEach((attr) => {
      if (attr === "*" || attr.includes(".")) return;
      const matches = rels.filter((r) => {
        const tk = schemaKey(r.name);
        return (
          tk &&
          SCHEMA[tk].fields.some((f) => f.toUpperCase() === attr.toUpperCase())
        );
      });
      if (matches.length === 1) {
        addAttribute(matches[0].name, attr);
      }
    });

  return required;
}

function collectSigmaNodes(node, list = []) {
  if (!node) return list;
  if (node.type === "sigma") list.push(node);
  if (node.inner) collectSigmaNodes(node.inner, list);
  if (node.left) collectSigmaNodes(node.left, list);
  if (node.right) collectSigmaNodes(node.right, list);
  return list;
}

function collectSigmaConditions(node, list = []) {
  if (!node) return list;
  if (node.type === "sigma") list.push(node.cond);
  if (node.inner) collectSigmaConditions(node.inner, list);
  if (node.left) collectSigmaConditions(node.left, list);
  if (node.right) collectSigmaConditions(node.right, list);
  return list;
}

function applyIntermediateProjections(node, finalAttrs, steps) {
  const required = collectRequiredAttributes(node, finalAttrs);

  function requiredAttrsFor(tableName) {
    const table = canonicalTableName(tableName);
    return Array.from(required[table] || []);
  }

  function makeProjectionForTable(tableName, innerNode) {
    const table = canonicalTableName(tableName);
    const attrs = requiredAttrsFor(table);
    if (!attrs.length) return innerNode;

    const projected = {
      type: "pi",
      attrs: attrs.map((a) => qualifyAttr(table, a)).join(", "),
      inner: innerNode,
    };

    steps.push({
      type: "push-pi",
      label: `π intermediária em ${table}`,
      desc: `Heurística de redução de campos: depois das seleções, mantém somente atributos necessários ao SELECT final, WHERE e JOIN: ${projected.attrs}.`,
      tree: deepCopy(projected),
    });

    return projected;
  }

  function visit(n) {
    if (!n) return n;

    if (n.type === "sigma" && n.inner && n.inner.type === "rel") {
      return makeProjectionForTable(n.inner.name, n);
    }

    if (n.type === "rel") {
      return makeProjectionForTable(n.name, n);
    }

    if (n.inner) n.inner = visit(n.inner);
    if (n.left) n.left = visit(n.left);
    if (n.right) n.right = visit(n.right);
    return n;
  }

  return visit(deepCopy(node));
}

function relationScore(node) {
  if (!node) return 0;
  if (node.type === "sigma") return 10 + relationScore(node.inner);
  if (node.type === "pi") return relationScore(node.inner);
  if (node.type === "rel") return 1;
  return 0;
}

function reorderJoinTree(node, steps) {
  function visit(n) {
    if (!n) return n;
    if (n.inner) n.inner = visit(n.inner);
    if (n.left) n.left = visit(n.left);
    if (n.right) n.right = visit(n.right);

    if ((n.type === "equi" || n.type === "theta") && n.left && n.right) {
      const leftTables = tableNamesInTree(n.left);
      const rightTables = tableNamesInTree(n.right);
      const condTables = referencedTables(n.cond);
      const canSwap = condTables.every(
        (t) =>
          leftTables.some((x) => x.toUpperCase() === t.toUpperCase()) ||
          rightTables.some((x) => x.toUpperCase() === t.toUpperCase()),
      );
      if (canSwap && relationScore(n.right) > relationScore(n.left)) {
        const swapped = { ...n, left: n.right, right: n.left };
        steps.push({
          type: "reorder-join",
          label: `Reordenação de JOIN: ${n.cond}`,
          desc: "Relações/subárvores com seleção foram priorizadas no lado esquerdo para evidenciar a execução mais restritiva primeiro, sem alterar a condição da junção.",
          tree: deepCopy(swapped),
        });
        return swapped;
      }
      steps.push({
        type: "reorder-join",
        label: `JOIN preservado: ${n.cond}`,
        desc: "A junção já respeita as dependências lógicas e evita produto cartesiano, pois possui condição ON explícita.",
        tree: deepCopy(n),
      });
    }
    return n;
  }
  return visit(deepCopy(node));
}
