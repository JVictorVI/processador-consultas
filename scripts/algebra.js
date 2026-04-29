/* ═══════════════════════════════════════════════════════
   PROCESSADOR DE CONSULTAS SQL — HU2 + HU4
   algebra.js — Conversão para Álgebra Relacional e Otimização
   Depende de: schema.js, parser.js
═══════════════════════════════════════════════════════ */
'use strict';

// ═══════════════════════════════════════════════════════
//  EXTRATOR DE ESTRUTURA PARSED (para HU2)
// ═══════════════════════════════════════════════════════
function extractParsed(sql, aliases, usedTables) {
  const selM = sql.match(/\bSELECT\s+([\s\S]+?)\s+\bFROM\b/i);
  const selectCols = selM ? selM[1].trim() : '*';

  const frM = sql.match(/\bFROM\s+([A-Za-z_][A-Za-z0-9_]*)(?=\s+JOIN\b|\s+WHERE\b|\s*$)/i);
  const fromTable = frM ? (schemaKey(frM[1]) || frM[1]) : null;
  const fromAlias = fromTable;

  const joins = [];
  const joinBlockRe = /\bJOIN\s+([\s\S]+?)(?=\s+\bJOIN\b|\s+\bWHERE\b|\s*$)/gi;
  let jm;
  while ((jm = joinBlockRe.exec(sql)) !== null) {
    const block = jm[1].trim();
    const bm = block.match(/^([A-Za-z_][A-Za-z0-9_]*)\s+ON\s+([\s\S]+)$/i);
    if (bm) {
      const table = schemaKey(bm[1]) || bm[1];
      joins.push({ table, alias: table, condition: bm[2].trim() });
    }
  }

  const whereM = sql.match(/\bWHERE\s+([\s\S]+)$/i);
  const whereCond = whereM ? whereM[1].trim() : null;

  return { selectCols, fromTable, fromAlias, joins, whereCond, aliases, usedTables };
}

// ═══════════════════════════════════════════════════════
//  DETECTA TIPO DE JUNÇÃO
// ═══════════════════════════════════════════════════════
function joinKind(cond) {
  const m = cond.trim().match(
    /^([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)$/
  );
  return m ? 'equi' : 'theta';
}

function makeRel(table, alias) {
  const name = schemaKey(table) || table;
  return { type: 'rel', name, alias: name };
}

// ═══════════════════════════════════════════════════════
//  CONVERSOR PARA ÁLGEBRA RELACIONAL (HU2)
// ═══════════════════════════════════════════════════════
function toAlgebra(parsed) {
  if (!parsed || !parsed.fromTable) return null;
  const { selectCols, fromTable, fromAlias, joins, whereCond } = parsed;
  const steps = [];

  let tree = makeRel(fromTable, fromAlias);
  steps.push({
    type: 'from', color: 'var(--accent)',
    label: `Relação base: ${relLabel(tree)}`,
    desc:  `Ponto de partida — relação ${relLabel(tree)}. Cada linha representa uma tupla.`,
    tree:  deepCopy(tree)
  });

  joins.forEach((j, i) => {
    const rel  = makeRel(j.table, j.alias);
    const cond = j.condition.trim();
    const kind = joinKind(cond);
    tree = { type: kind, left: tree, right: rel, cond };
    steps.push({
      type: 'join', color: 'var(--join)',
      label: kind === 'equi'
        ? `JOIN #${i+1} → Equijunção ⋈ com ${relLabel(rel)}`
        : `JOIN #${i+1} → Junção-θ ⋈θ com ${relLabel(rel)}`,
      desc: kind === 'equi'
        ? `Equijunção: igualdade entre FK e PK. Notação: ⋈_{${cond}}.`
        : `Junção theta: condição geral (${cond}). Retém tuplas que satisfazem o predicado.`,
      tree: deepCopy(tree)
    });
  });

  if (whereCond) {
    tree = { type: 'sigma', cond: whereCond, inner: tree };
    steps.push({
      type: 'sigma', color: 'var(--sigma)',
      label: `WHERE → σ Seleção`,
      desc:  `σ_{${whereCond}} — filtra tuplas que satisfazem a condição. Reduz linhas, mantém colunas.`,
      tree:  deepCopy(tree)
    });
  }

  let attrs;
  if (selectCols.trim() === '*') {
    const tables = [{ table: fromTable, alias: fromAlias }, ...joins.map(j => ({ table: j.table, alias: j.alias }))];
    const list = [];
    tables.forEach(({ table, alias }) => {
      const tk = schemaKey(table);
      if (!tk) return;
      SCHEMA[tk].fields.forEach(f => list.push(`${alias || table}.${f}`));
    });
    attrs = list.join(', ');
    tree = { type: 'pi', attrs, inner: tree, selectAll: true };
    steps.push({
      type: 'pi', color: 'var(--pi)',
      label: `SELECT * → π (atributos qualificados por tabela)`,
      desc:  `SELECT * com ${tables.length} tabela(s). Cada atributo é qualificado pelo nome da tabela para evitar ambiguidade.`,
      tree:  deepCopy(tree)
    });
  } else {
    attrs = selectCols.split(',').map(c => c.trim()).join(', ');
    tree = { type: 'pi', attrs, inner: tree };
    steps.push({
      type: 'pi', color: 'var(--pi)',
      label: `SELECT → π Projeção`,
      desc:  `π_{${attrs}} — projeta somente os atributos solicitados. Reduz colunas.`,
      tree:  deepCopy(tree)
    });
  }

  return { exprText: treeToText(tree), exprHtml: treeToHtml(tree), steps, tree };
}

// ─────────────────────────────────────────────────────
//  AST → texto plano / HTML
// ─────────────────────────────────────────────────────
function treeToText(n) {
  if (!n) return '';
  switch (n.type) {
    case 'rel':   return relLabel(n);
    case 'equi':  return `(${treeToText(n.left)} ⋈_{${n.cond}} ${treeToText(n.right)})`;
    case 'theta': return `(${treeToText(n.left)} ⋈_θ{${n.cond}} ${treeToText(n.right)})`;
    case 'sigma': return `σ_{${n.cond}}(${treeToText(n.inner)})`;
    case 'pi':    return `π_{${n.attrs}}(${treeToText(n.inner)})`;
    default:      return '';
  }
}

function treeToHtml(n) {
  if (!n) return '';
  const e = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  switch (n.type) {
    case 'rel':
      return `<span class="s-rel">${e(relLabel(n))}</span>`;
    case 'equi':
      return `<span class="s-paren">( </span>` + treeToHtml(n.left) +
             ` <span class="s-join">⋈</span><span class="s-sub s-join-cond">${e(n.cond)}</span> ` +
             treeToHtml(n.right) + `<span class="s-paren"> )</span>`;
    case 'theta':
      return `<span class="s-paren">( </span>` + treeToHtml(n.left) +
             ` <span class="s-join">⋈</span><span class="s-sub s-join-cond">θ: ${e(n.cond)}</span> ` +
             treeToHtml(n.right) + `<span class="s-paren"> )</span>`;
    case 'sigma':
      return `<span class="s-sigma">σ</span><span class="s-sub s-sigma-cond">${e(n.cond)}</span>` +
             `<span class="s-paren">( </span>` + treeToHtml(n.inner) + `<span class="s-paren"> )</span>`;
    case 'pi':
      return `<span class="s-pi">π</span><span class="s-sub s-proj">${e(n.attrs)}</span>` +
             `<span class="s-paren">( </span>` + treeToHtml(n.inner) + `<span class="s-paren"> )</span>`;
    default:
      return '';
  }
}

function relLabel(n) {
  if (!n) return '';
  return n.name;
}

function deepCopy(o) { return JSON.parse(JSON.stringify(o)); }

// ═══════════════════════════════════════════════════════
//  HU4 — OTIMIZAÇÃO REAL DA ÁRVORE DE CONSULTA
// ═══════════════════════════════════════════════════════
function optimizeTree(tree) {
  if (!tree) return { optimizedTree: null, optSteps: [] };

  const optSteps = [];
  const originalTree = deepCopy(tree);
  const finalPi = tree.type === 'pi' ? deepCopy(tree) : null;
  const finalAttrs = finalPi ? finalPi.attrs : '*';

  const withoutProjection = finalPi ? deepCopy(finalPi.inner) : deepCopy(tree);
  const extracted = extractTopSigma(withoutProjection);
  const baseJoinTree = extracted.inner;
  const whereConds = extracted.conds;

  optSteps.push({
    type: 'original',
    label: 'Árvore original',
    desc: 'Forma inicial gerada pela conversão SQL → álgebra relacional, antes das heurísticas.',
    tree: deepCopy(originalTree)
  });

  let optimizedInner = pushSelectionsToRelations(baseJoinTree, whereConds, optSteps);

  const remainingConds = whereConds.filter(cond => !conditionBelongsToSingleRelation(cond, collectRelations(baseJoinTree)));
  if (remainingConds.length) {
    optimizedInner = { type: 'sigma', cond: remainingConds.join(' AND '), inner: optimizedInner };
    optSteps.push({
      type: 'push-sigma',
      label: 'Seleções compostas preservadas acima da junção',
      desc: 'Condições que dependem de mais de uma relação permanecem acima da junção para preservar equivalência.',
      tree: deepCopy(optimizedInner)
    });
  }

  optimizedInner = reorderJoinTree(optimizedInner, optSteps);
  optimizedInner = applyIntermediateProjections(optimizedInner, finalAttrs, optSteps);

  const optimizedTree = {
    type: 'pi',
    attrs: finalAttrs,
    inner: optimizedInner,
    selectAll: finalPi ? finalPi.selectAll : false
  };

  optSteps.push({
    type: 'final',
    label: 'Árvore otimizada final',
    desc: 'Plano lógico final com seleções próximas das relações, projeções intermediárias e junções preservando suas dependências.',
    tree: deepCopy(optimizedTree)
  });

  return { optimizedTree, optSteps };
}

// ─────────────────────────────────────────────────────
//  Extração de σ no topo: π(σc(J)) → c + J
// ─────────────────────────────────────────────────────
function extractTopSigma(node) {
  const conds = [];
  let current = deepCopy(node);
  while (current && current.type === 'sigma') {
    conds.push(...splitWhereConditions(current.cond));
    current = current.inner;
  }
  return { inner: current, conds };
}

function splitWhereConditions(cond) {
  if (!cond) return [];
  if (typeof splitByAnd === 'function') return splitByAnd(cond).map(s => s.trim()).filter(Boolean);
  return String(cond).split(/\s+AND\s+/i).map(s => s.trim()).filter(Boolean);
}

function referencedAliases(expr) {
  const refs = new Set();
  const re = /\b([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)\b/g;
  let m;
  while ((m = re.exec(expr)) !== null) refs.add(m[1]);
  return Array.from(refs);
}

function conditionBelongsToSingleRelation(cond, relations = []) {
  return !!inferSingleRelationForCondition(cond, relations);
}

function inferSingleRelationForCondition(cond, relations = []) {
  const refs = referencedAliases(cond);

  // Com aliases removidos, refs representa nomes reais de tabelas.
  if (refs.length === 1) {
    return relations.find(r =>
      String(r.name).toUpperCase() === String(refs[0]).toUpperCase()
    ) || null;
  }

  if (refs.length > 1) return null;

  // Condição sem prefixo: tentar inferir pela existência do atributo.
  const identifiers = String(cond)
    .replace(/'[^']*'/g, ' ')
    .split(/[^A-Za-z0-9_]+/)
    .map(x => x.trim())
    .filter(Boolean)
    .filter(x => !/^\d+(\.\d+)?$/.test(x))
    .filter(x => !['AND'].includes(x.toUpperCase()));

  if (!identifiers.length || !relations.length) return relations.length === 1 ? relations[0] : null;

  const matches = relations.filter(r => {
    const tk = schemaKey(r.name);
    if (!tk) return false;
    return identifiers.every(id =>
      SCHEMA[tk].fields.some(f => f.toUpperCase() === id.toUpperCase())
    );
  });

  return matches.length === 1 ? matches[0] : null;
}

function collectRelations(node, list = []) {
  if (!node) return list;
  if (node.type === 'rel') list.push(node);
  if (node.inner) collectRelations(node.inner, list);
  if (node.left) collectRelations(node.left, list);
  if (node.right) collectRelations(node.right, list);
  return list;
}

function aliasesInTree(node) {
  return collectRelations(node).map(r => r.alias || r.name);
}

function subtreeHasAlias(node, alias) {
  return aliasesInTree(node).some(a => String(a).toUpperCase() === String(alias).toUpperCase());
}

function pushSelectionsToRelations(node, whereConds, steps) {
  if (!node) return node;

  const relations = collectRelations(node);
  const condTarget = new Map();

  whereConds.forEach(cond => {
    const target = inferSingleRelationForCondition(cond, relations);
    if (target) condTarget.set(cond, target.name);
  });

  function visit(n) {
    if (!n) return n;
    if (n.type === 'rel') {
      const ownConds = whereConds.filter(cond =>
        String(condTarget.get(cond) || '').toUpperCase() === String(n.name).toUpperCase()
      );
      if (!ownConds.length) return n;
      let wrapped = n;
      ownConds.forEach(cond => {
        wrapped = { type: 'sigma', cond, inner: wrapped };
      });
      steps.push({
        type: 'push-sigma',
        label: `σ empurrada para ${relLabel(n)}`,
        desc: `A seleção ${ownConds.join(' AND ')} usa somente atributos de ${relLabel(n)}, então pode ser aplicada antes da junção para reduzir tuplas.`,
        tree: deepCopy(wrapped)
      });
      return wrapped;
    }
    if (n.inner) n.inner = visit(n.inner);
    if (n.left) n.left = visit(n.left);
    if (n.right) n.right = visit(n.right);
    return n;
  }

  const result = visit(deepCopy(node));
  if (!condTarget.size) {
    steps.push({
      type: 'push-sigma',
      label: 'Nenhuma seleção pôde ser empurrada para relação única',
      desc: 'Não havia condições WHERE dependentes de apenas uma tabela.',
      tree: deepCopy(result)
    });
  }
  return result;
}

function collectJoinConditions(node, list = []) {
  if (!node) return list;
  if (node.type === 'equi' || node.type === 'theta') list.push(node.cond);
  if (node.inner) collectJoinConditions(node.inner, list);
  if (node.left) collectJoinConditions(node.left, list);
  if (node.right) collectJoinConditions(node.right, list);
  return list;
}

function collectRequiredAttributes(tree, finalAttrs) {
  const required = {};
  const rels = collectRelations(tree);
  rels.forEach(r => { required[r.alias || r.name] = new Set(); });

  function addQualified(expr) {
    const re = /\b([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)\b/g;
    let m;
    while ((m = re.exec(expr)) !== null) {
      if (!required[m[1]]) required[m[1]] = new Set();
      required[m[1]].add(m[2]);
    }
  }

  addQualified(finalAttrs || '');
  collectJoinConditions(tree).forEach(addQualified);
  collectSigmaConditions(tree).forEach(addQualified);

  // SELECT sem alias: resolve apenas se o atributo existir em uma única relação.
  String(finalAttrs || '')
    .split(',')
    .map(a => a.trim())
    .filter(Boolean)
    .forEach(attr => {
      if (attr === '*' || attr.includes('.')) return;
      const matches = rels.filter(r => {
        const tk = schemaKey(r.name);
        return tk && SCHEMA[tk].fields.some(f => f.toUpperCase() === attr.toUpperCase());
      });
      if (matches.length === 1) {
        const alias = matches[0].alias || matches[0].name;
        required[alias].add(attr);
      }
    });

  return required;
}

function collectSigmaConditions(node, list = []) {
  if (!node) return list;
  if (node.type === 'sigma') list.push(node.cond);
  if (node.inner) collectSigmaConditions(node.inner, list);
  if (node.left) collectSigmaConditions(node.left, list);
  if (node.right) collectSigmaConditions(node.right, list);
  return list;
}

function applyIntermediateProjections(node, finalAttrs, steps) {
  const required = collectRequiredAttributes(node, finalAttrs);

  function visit(n) {
    if (!n) return n;

    if (n.type === 'sigma' && n.inner && n.inner.type === 'rel') {
      const rel = n.inner;
      const alias = rel.alias || rel.name;
      const attrs = Array.from(required[alias] || []);
      if (!attrs.length) return n;
      const projected = { type: 'pi', attrs: attrs.map(a => `${alias}.${a}`).join(', '), inner: n };
      steps.push({
        type: 'push-pi',
        label: `π intermediária em ${relLabel(rel)}`,
        desc: `Depois da seleção, mantém apenas atributos necessários ao SELECT final, WHERE e JOIN: ${projected.attrs}.`,
        tree: deepCopy(projected)
      });
      return projected;
    }

    if (n.type === 'rel') {
      const alias = n.alias || n.name;
      const attrs = Array.from(required[alias] || []);
      if (!attrs.length) return n;
      const projected = { type: 'pi', attrs: attrs.map(a => `${alias}.${a}`).join(', '), inner: n };
      steps.push({
        type: 'push-pi',
        label: `π intermediária em ${relLabel(n)}`,
        desc: `Mantém somente atributos necessários antes da junção: ${projected.attrs}.`,
        tree: deepCopy(projected)
      });
      return projected;
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
  if (node.type === 'sigma') return 10 + relationScore(node.inner);
  if (node.type === 'pi') return relationScore(node.inner);
  if (node.type === 'rel') return 1;
  return 0;
}

function reorderJoinTree(node, steps) {
  function visit(n) {
    if (!n) return n;
    if (n.inner) n.inner = visit(n.inner);
    if (n.left) n.left = visit(n.left);
    if (n.right) n.right = visit(n.right);

    if ((n.type === 'equi' || n.type === 'theta') && n.left && n.right) {
      const leftAliases = aliasesInTree(n.left);
      const rightAliases = aliasesInTree(n.right);
      const condAliases = referencedAliases(n.cond);
      const canSwap = condAliases.every(a =>
        leftAliases.some(x => x.toUpperCase() === a.toUpperCase()) ||
        rightAliases.some(x => x.toUpperCase() === a.toUpperCase())
      );
      if (canSwap && relationScore(n.right) > relationScore(n.left)) {
        const swapped = { ...n, left: n.right, right: n.left };
        steps.push({
          type: 'reorder-join',
          label: `Reordenação de JOIN: ${n.cond}`,
          desc: 'Relações/subárvores com seleção foram priorizadas no lado esquerdo para evidenciar a execução mais restritiva primeiro, sem alterar a condição da junção.',
          tree: deepCopy(swapped)
        });
        return swapped;
      }
      steps.push({
        type: 'reorder-join',
        label: `JOIN preservado: ${n.cond}`,
        desc: 'A junção já respeita as dependências lógicas e evita produto cartesiano, pois possui condição ON explícita.',
        tree: deepCopy(n)
      });
    }
    return n;
  }
  return visit(deepCopy(node));
}
