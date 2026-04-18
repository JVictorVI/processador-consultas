/* ═══════════════════════════════════════════════════════
   PROCESSADOR DE CONSULTAS SQL — HU3
   grafo.js — Grafo de Operadores (Árvore de Consulta)
   Depende de: schema.js, algebra.js
═══════════════════════════════════════════════════════ */
"use strict";

// ═══════════════════════════════════════════════════════
//  HU3 — GRAFO DE OPERADORES
//
//  Reutiliza a AST da HU2 sem reprocessar a consulta.
//
//  ETAPAS:
//  1. astToGraph(tree)   → constrói { nodes, edges, rootId } em memória
//  2. buildGraphHtml()   → renderiza a árvore visualmente (cima→baixo)
//  3. renderGrafo()      → monta o painel: árvore + tabelas de nós e arestas
//
//  Raiz  = sempre π (projeção mais externa)
//  Folhas = relações base (tabelas)
//  Arestas = fluxo de resultado intermediário filho → pai
// ═══════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────
//  1) Construção do grafo em memória
// ─────────────────────────────────────────────────────
/**
 * Percorre a AST recursivamente e produz um grafo formal:
 *   nodes : [{ id, type, label }]
 *   edges : [{ from, to, kind: 'intermediate_result' }]
 *   rootId: id do nó raiz (sempre π)
 *
 * As arestas apontam de filho para pai, representando o
 * fluxo de resultado intermediário que sobe pela árvore.
 */
function astToGraph(tree) {
  let counter = 0;
  const nodes = [];
  const edges = [];

  function nodeLabel(n) {
    switch (n.type) {
      case "pi":
        return `π  ${n.attrs}`;
      case "sigma":
        return `σ  ${n.cond}`;
      case "equi":
        return `⋈  ${n.cond}`;
      case "theta":
        return `⋈θ  ${n.cond}`;
      case "rel":
        return n.name;
      default:
        return n.type;
    }
  }

  function visit(node) {
    if (!node) return null;
    const id = `n${++counter}`;
    nodes.push({ id, type: node.type, label: nodeLabel(node) });

    // Nó unário (π, σ)
    if (node.inner) {
      const childId = visit(node.inner);
      if (childId)
        edges.push({ from: childId, to: id, kind: "intermediate_result" });
    }

    // Nó binário (⋈)
    if (node.left) {
      const leftId = visit(node.left);
      if (leftId)
        edges.push({ from: leftId, to: id, kind: "intermediate_result" });
    }
    if (node.right) {
      const rightId = visit(node.right);
      if (rightId)
        edges.push({ from: rightId, to: id, kind: "intermediate_result" });
    }

    return id;
  }

  const rootId = visit(tree);
  return { nodes, edges, rootId };
}

// ─────────────────────────────────────────────────────
//  2) Renderização visual da árvore
// ─────────────────────────────────────────────────────

/** Metadados de exibição por tipo de nó */
const NODE_META = {
  pi: { cls: "node-pi", symbol: "π", labelFn: (n) => n.attrs },
  sigma: { cls: "node-sigma", symbol: "σ", labelFn: (n) => n.cond },
  equi: { cls: "node-join", symbol: "⋈", labelFn: (n) => n.cond },
  theta: { cls: "node-join", symbol: "⋈θ", labelFn: (n) => n.cond },
  rel: { cls: "node-rel", symbol: null, labelFn: (n) => n.name },
};

/**
 * Renderização recursiva da árvore visual a partir da AST.
 * Suporta nós unários (pi, sigma → inner)
 * e nós binários (equi, theta → left + right).
 */
function buildGraphHtml(node) {
  if (!node) return "";
  const e = (s) =>
    String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  const meta = NODE_META[node.type] || NODE_META.rel;
  const label = meta.labelFn(node) || "";

  const symbolHtml = meta.symbol
    ? `<span class="tree-symbol">${e(meta.symbol)}</span>`
    : "";
  const labelHtml = label ? `<span class="tree-label">${e(label)}</span>` : "";

  const box = `<div class="tree-box ${meta.cls}">${symbolHtml}${labelHtml}</div>`;

  // Folha — sem filhos
  if (node.type === "rel") {
    return `<div class="tree-node">${box}</div>`;
  }

  // Nó unário (π, σ)
  if (node.inner) {
    return `<div class="tree-node">
      ${box}
      <div class="tree-connector tree-connector--flow"></div>
      ${buildGraphHtml(node.inner)}
    </div>`;
  }

  // Nó binário (⋈)
  if (node.left && node.right) {
    return `<div class="tree-node">
      ${box}
      <div class="tree-connector tree-connector--flow"></div>
      <div class="tree-children">
        <div class="tree-child-wrap">
          <div class="tree-child-line tree-connector--flow"></div>
          ${buildGraphHtml(node.left)}
        </div>
        <div class="tree-branch-gap"></div>
        <div class="tree-child-wrap">
          <div class="tree-child-line tree-connector--flow"></div>
          ${buildGraphHtml(node.right)}
        </div>
      </div>
    </div>`;
  }

  return `<div class="tree-node">${box}</div>`;
}

// ─────────────────────────────────────────────────────
//  3) Renderização do painel HU3 completo
// ─────────────────────────────────────────────────────
/**
 * Recebe a AST da HU2 e o grafo já construído em memória.
 * Exibe:
 *   - Instrução de leitura (baixo → cima)
 *   - Árvore visual
 *   - Tabela de nós do grafo
 *   - Tabela de arestas (fluxo de resultados intermediários)
 */
function renderGrafo(tree, graph) {
  const e = (s) =>
    String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  const treeHtml = buildGraphHtml(tree);

  // Tabela de nós
  const typeLabel = {
    pi: "Projeção (π)",
    sigma: "Seleção (σ)",
    equi: "Equijunção (⋈)",
    theta: "Junção-θ (⋈θ)",
    rel: "Relação",
  };
  const nodesRows = graph.nodes
    .map(
      (n) =>
        `<tr>
      <td class="gt-id">${e(n.id)}</td>
      <td class="gt-type gt-type-${n.type}">${e(typeLabel[n.type] || n.type)}</td>
      <td class="gt-label">${e(n.label)}</td>
      <td class="gt-role">${
        n.id === graph.rootId
          ? '<span class="gt-badge gt-root">raiz</span>'
          : n.type === "rel"
            ? '<span class="gt-badge gt-leaf">folha</span>'
            : '<span class="gt-badge gt-inner">interno</span>'
      }</td>
    </tr>`,
    )
    .join("");

  // Tabela de arestas
  const edgesRows = graph.edges
    .map(
      (ed) =>
        `<tr>
      <td class="gt-id">${e(ed.from)}</td>
      <td class="gt-arrow">→</td>
      <td class="gt-id">${e(ed.to)}</td>
      <td class="gt-kind">resultado intermediário</td>
    </tr>`,
    )
    .join("");

  let h = `<div class="animate-in">`;

  // Instrução de leitura
  h += `<div class="graph-reading-hint">
    <span class="graph-hint-icon">↑</span>
    Leia de baixo para cima: as relações (folhas) produzem dados que
    sobem pelas arestas até a projeção π (raiz), gerando o resultado final.
  </div>`;

  // Árvore visual
  h += `<div class="exec-tree">${treeHtml}</div>`;

  // Informações do grafo em memória
  h += `<div class="graph-info-wrap">`;

  h += `<div class="section-label" style="padding:0 0 6px">
    Grafo em Memória — Nós (${graph.nodes.length})
  </div>`;
  h += `<div class="graph-table-wrap"><table class="graph-table">
    <thead><tr><th>ID</th><th>Tipo</th><th>Rótulo</th><th>Papel</th></tr></thead>
    <tbody>${nodesRows}</tbody>
  </table></div>`;

  h += `<div class="section-label" style="padding:12px 0 6px">
    Grafo em Memória — Arestas (${graph.edges.length}) — fluxo de resultados intermediários
  </div>`;
  h += `<div class="graph-table-wrap"><table class="graph-table">
    <thead><tr><th>De</th><th></th><th>Para</th><th>Tipo</th></tr></thead>
    <tbody>${edgesRows}</tbody>
  </table></div>`;

  h += `</div>`; // /graph-info-wrap
  h += `</div>`; // /animate-in
  return h;
}
