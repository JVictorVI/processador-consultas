/* ═══════════════════════════════════════════════════════
   PROCESSADOR DE CONSULTAS SQL — HU2
   algebra.js — Conversão para Álgebra Relacional
   Depende de: schema.js, parser.js
═══════════════════════════════════════════════════════ */
'use strict';

// ═══════════════════════════════════════════════════════
//  EXTRATOR DE ESTRUTURA PARSED (para HU2)
// ═══════════════════════════════════════════════════════
function extractParsed(sql, aliases, usedTables) {
  // SELECT colunas
  const selM = sql.match(/\bSELECT\s+([\s\S]+?)\s+\bFROM\b/i);
  const selectCols = selM ? selM[1].trim() : '*';

  // FROM tabela base
  const frM = sql.match(/\bFROM\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?:([A-Za-z_][A-Za-z0-9_]*)\s*)?(?:JOIN|WHERE|$)/i);
  const fromTable = frM ? frM[1] : null;
  const fromAlias = frM && frM[2] && !isReserved(frM[2]) ? frM[2] : fromTable;

  // JOINs — usa a mesma regex robusta
  const joins = [];
  const joinBlockRe = /\bJOIN\s+([\s\S]+?)(?=\s+\bJOIN\b|\s+\bWHERE\b|\s*$)/gi;
  let jm;
  while ((jm = joinBlockRe.exec(sql)) !== null) {
    const block = jm[1].trim();
    const bm = block.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*(?:([A-Za-z_][A-Za-z0-9_]*)\s+)?ON\s+([\s\S]+)$/i);
    if (bm) {
      const rawAl = bm[2] && !isReserved(bm[2]) ? bm[2] : bm[1];
      joins.push({ table: bm[1], alias: rawAl, condition: bm[3].trim() });
    }
  }

  // WHERE — captura tudo após WHERE até o fim da consulta
  const whereM = sql.match(/\bWHERE\s+([\s\S]+)$/i);
  const whereCond = whereM ? whereM[1].trim() : null;

  return { selectCols, fromTable, fromAlias, joins, whereCond, aliases };
}

// ═══════════════════════════════════════════════════════
//  DETECTA TIPO DE JUNÇÃO
//  equi  → X.A = Y.B  (igualdade entre atributos de tabelas distintas)
//  theta → qualquer outra condição
// ═══════════════════════════════════════════════════════
function joinKind(cond) {
  const m = cond.trim().match(
    /^([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)$/
  );
  return m ? 'equi' : 'theta';
}

// ═══════════════════════════════════════════════════════
//  CONVERSOR PARA ÁLGEBRA RELACIONAL (HU2)
//
//  Ordem lógica correta:
//  1. Relação base (FROM)
//  2. Junções binárias aninhadas (JOIN)
//  3. Seleção (WHERE → σ)
//  4. Projeção (SELECT → π)
//     SELECT * → π com atributos qualificados por alias/tabela
//     (HU3 exige raiz sempre como projeção)
//
//  NÃO contém otimização (HU4) nem plano físico (HU5)
// ═══════════════════════════════════════════════════════
function toAlgebra(parsed) {
  if (!parsed || !parsed.fromTable) return null;
  const { selectCols, fromTable, fromAlias, joins, whereCond } = parsed;
  const steps = [];

  // Passo 1 — relação base
  let tree = { type: 'rel', name: schemaKey(fromTable) || fromTable };
  steps.push({
    type: 'from', color: 'var(--accent)',
    label: `Relação base: ${tree.name}`,
    desc:  `Ponto de partida — relação ${tree.name}. Cada linha representa uma tupla.`,
    tree:  deepCopy(tree)
  });

  // Passo 2 — JOINs: junções binárias aninhadas
  joins.forEach((j, i) => {
    const tbl  = schemaKey(j.table) || j.table;
    const cond = j.condition.trim();
    const kind = joinKind(cond);
    tree = { type: kind, left: tree, right: { type: 'rel', name: tbl }, cond };
    steps.push({
      type: 'join', color: 'var(--join)',
      label: kind === 'equi'
        ? `JOIN #${i+1} → Equijunção ⋈ com ${tbl}`
        : `JOIN #${i+1} → Junção-θ ⋈θ com ${tbl}`,
      desc: kind === 'equi'
        ? `Equijunção: igualdade entre FK e PK. Notação: ⋈_{${cond}}.`
        : `Junção theta: condição geral (${cond}). Retém tuplas que satisfazem o predicado.`,
      tree: deepCopy(tree)
    });
  });

  // Passo 3 — σ: seleção (WHERE)
  if (whereCond) {
    tree = { type: 'sigma', cond: whereCond, inner: tree };
    steps.push({
      type: 'sigma', color: 'var(--sigma)',
      label: `WHERE → σ Seleção`,
      desc:  `σ_{${whereCond}} — filtra tuplas que satisfazem a condição. Reduz linhas, mantém colunas.`,
      tree:  deepCopy(tree)
    });
  }

  // Passo 4 — π: projeção (SELECT)
  // SELECT * → π com atributos qualificados por alias (ou tabela),
  //            evitando ambiguidade em JOINs com campos de mesmo nome.
  let attrs;
  if (selectCols.trim() === '*') {
    const tables = [fromTable, ...joins.map(j => j.table)];
    const list   = [];
    tables.forEach(t => {
      const tk = schemaKey(t);
      if (!tk) return;
      // Inverte o mapa aliases (alias→tabela) para encontrar o alias desta tabela
      const alias = Object.keys(parsed.aliases).find(
        a => parsed.aliases[a] === t && a !== t.toUpperCase()
      ) || t;
      SCHEMA[tk].fields.forEach(f => list.push(`${alias}.${f}`));
    });
    attrs = list.join(', ');
    tree = { type: 'pi', attrs, inner: tree };
    steps.push({
      type: 'pi', color: 'var(--pi)',
      label: `SELECT * → π (atributos qualificados por tabela)`,
      desc:  `SELECT * com ${tables.length} tabela(s). Cada atributo é qualificado pelo alias/nome da tabela para evitar ambiguidade.`,
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
//  AST → texto plano (para copiar)
// ─────────────────────────────────────────────────────
function treeToText(n) {
  if (!n) return '';
  switch (n.type) {
    case 'rel':   return n.name;
    case 'equi':  return `(${treeToText(n.left)} ⋈_{${n.cond}} ${treeToText(n.right)})`;
    case 'theta': return `(${treeToText(n.left)} ⋈_θ{${n.cond}} ${treeToText(n.right)})`;
    case 'sigma': return `σ_{${n.cond}}(${treeToText(n.inner)})`;
    case 'pi':    return `π_{${n.attrs}}(${treeToText(n.inner)})`;
    default:      return '';
  }
}

// ─────────────────────────────────────────────────────
//  AST → HTML colorido
//  Cada operador "puxa" seu conteúdo pela cor:
//    π  → símbolo + atributos em verde      (.s-pi   / .s-proj)
//    σ  → símbolo + condição em rosa        (.s-sigma / .s-sigma-cond)
//    ⋈  → símbolo + condição em azul        (.s-join  / .s-join-cond)
//    rel → nome da tabela em ciano          (.s-rel)
//    ()  → parênteses em cinza discreto     (.s-paren)
// ─────────────────────────────────────────────────────
function treeToHtml(n) {
  if (!n) return '';
  const e = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  switch (n.type) {
    case 'rel':
      return `<span class="s-rel">${e(n.name)}</span>`;

    case 'equi':
      return `<span class="s-paren">( </span>` +
             treeToHtml(n.left) +
             ` <span class="s-join">⋈</span><span class="s-sub s-join-cond">${e(n.cond)}</span> ` +
             treeToHtml(n.right) +
             `<span class="s-paren"> )</span>`;

    case 'theta':
      return `<span class="s-paren">( </span>` +
             treeToHtml(n.left) +
             ` <span class="s-join">⋈</span><span class="s-sub s-join-cond">θ: ${e(n.cond)}</span> ` +
             treeToHtml(n.right) +
             `<span class="s-paren"> )</span>`;

    case 'sigma':
      return `<span class="s-sigma">σ</span>` +
             `<span class="s-sub s-sigma-cond">${e(n.cond)}</span>` +
             `<span class="s-paren">( </span>` +
             treeToHtml(n.inner) +
             `<span class="s-paren"> )</span>`;

    case 'pi':
      return `<span class="s-pi">π</span>` +
             `<span class="s-sub s-proj">${e(n.attrs)}</span>` +
             `<span class="s-paren">( </span>` +
             treeToHtml(n.inner) +
             `<span class="s-paren"> )</span>`;

    default:
      return '';
  }
}

function deepCopy(o) { return JSON.parse(JSON.stringify(o)); }
