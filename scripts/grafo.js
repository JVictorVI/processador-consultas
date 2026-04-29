/* ═══════════════════════════════════════════════════════
   PROCESSADOR DE CONSULTAS SQL — HU3
   grafo.js — Grafo de Operadores (Árvore de Consulta)
   Depende de: schema.js, algebra.js
═══════════════════════════════════════════════════════ */
"use strict";

function escHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function formatGraphLabel(value, type) {
  const text = String(value || "")
    .replace(/\s+/g, " ")
    .trim();

  if (!text) return "";

  if (type === "pi") {
    return text
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean)
      .join(",\n");
  }

  if (type === "sigma") {
    return text
      .replace(/\s+AND\s+/gi, "\nAND ")
      .replace(/\s*([=<>]+)\s*/g, " $1 ");
  }

  if (type === "equi" || type === "theta") {
    return text
      .replace(/\s+AND\s+/gi, "\nAND ")
      .replace(/\s*([=<>]+)\s*/g, " $1 ");
  }

  return text;
}

function astToGraph(tree) {
  let counter = 0;
  const nodes = [];
  const edges = [];

  function nodeLabel(n) {
    switch (n.type) {
      case "pi": return `π  ${n.attrs}`;
      case "sigma": return `σ  ${n.cond}`;
      case "equi": return `⋈  ${n.cond}`;
      case "theta": return `⋈θ  ${n.cond}`;
      case "rel": return typeof relLabel === "function" ? relLabel(n) : n.name;
      default: return n.type;
    }
  }

  function visit(node) {
    if (!node) return null;
    const id = `n${++counter}`;
    nodes.push({ id, type: node.type, label: nodeLabel(node) });

    if (node.inner) {
      const childId = visit(node.inner);
      if (childId) edges.push({ from: childId, to: id, kind: "intermediate_result" });
    }
    if (node.left) {
      const leftId = visit(node.left);
      if (leftId) edges.push({ from: leftId, to: id, kind: "intermediate_result" });
    }
    if (node.right) {
      const rightId = visit(node.right);
      if (rightId) edges.push({ from: rightId, to: id, kind: "intermediate_result" });
    }
    return id;
  }

  const rootId = visit(tree);
  return { nodes, edges, rootId };
}

const NODE_META = {
  pi: { cls: "node-pi", symbol: "π", labelFn: (n) => n.attrs },
  sigma: { cls: "node-sigma", symbol: "σ", labelFn: (n) => n.cond },
  equi: { cls: "node-join", symbol: "⋈", labelFn: (n) => n.cond },
  theta: { cls: "node-join", symbol: "⋈θ", labelFn: (n) => n.cond },
  rel: { cls: "node-rel", symbol: null, labelFn: (n) => typeof relLabel === "function" ? relLabel(n) : n.name },
};

function buildGraphHtml(node) {
  if (!node) return "";
  const meta = NODE_META[node.type] || NODE_META.rel;
  const rawLabel = meta.labelFn(node) || "";
  const label = formatGraphLabel(rawLabel, node.type);
  const symbolHtml = meta.symbol ? `<span class="tree-symbol">${escHtml(meta.symbol)}</span>` : "";
  const labelHtml = label ? `<span class="tree-label">${escHtml(label)}</span>` : "";
  const box = `<div class="tree-box ${meta.cls}">${symbolHtml}${labelHtml}</div>`;

  if (node.type === "rel") return `<div class="tree-node">${box}</div>`;

  if (node.inner) {
    return `<div class="tree-node">
      ${box}
      <div class="tree-connector tree-connector--flow"></div>
      ${buildGraphHtml(node.inner)}
    </div>`;
  }

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

function getGraphZoomClass(graphOrTree) {
  const count = graphOrTree && Array.isArray(graphOrTree.nodes) ? graphOrTree.nodes.length : 0;

  if (count >= 28) return "graph-zoom-xs";
  if (count >= 20) return "graph-zoom-sm";
  if (count >= 13) return "graph-zoom-md";
  return "graph-zoom-default";
}

function renderGrafo(tree, graph) {
  const treeHtml = buildGraphHtml(tree);

  const typeLabel = {
    pi: "Projeção (π)",
    sigma: "Seleção (σ)",
    equi: "Equijunção (⋈)",
    theta: "Junção-θ (⋈θ)",
    rel: "Relação",
  };

  const nodesRows = graph.nodes.map((n) => `<tr>
      <td class="gt-id">${escHtml(n.id)}</td>
      <td class="gt-type gt-type-${n.type}">${escHtml(typeLabel[n.type] || n.type)}</td>
      <td class="gt-label">${escHtml(n.label)}</td>
      <td class="gt-role">${
        n.id === graph.rootId
          ? '<span class="gt-badge gt-root">raiz</span>'
          : n.type === "rel"
            ? '<span class="gt-badge gt-leaf">folha</span>'
            : '<span class="gt-badge gt-inner">interno</span>'
      }</td>
    </tr>`).join("");

  const edgesRows = graph.edges.map((ed) => `<tr>
      <td class="gt-id">${escHtml(ed.from)}</td>
      <td class="gt-arrow">→</td>
      <td class="gt-id">${escHtml(ed.to)}</td>
      <td class="gt-kind">resultado intermediário</td>
    </tr>`).join("");

  let h = `<div class="animate-in">`;
  h += `<div class="graph-reading-hint">
    <span class="graph-hint-icon">↑</span>
    Leia de baixo para cima: as relações (folhas) produzem dados que
    sobem pelas arestas até a projeção π (raiz), gerando o resultado final.
    O grafo é reduzido automaticamente quando há muitos nós para ampliar o campo de visão.
    <span class="graph-pan-help">↔ clique e arraste para navegar</span>
  </div>`;
  h += `<div class="exec-tree"><div class="graph-canvas ${getGraphZoomClass(graph)}">${treeHtml}</div></div>`;
  h += `<div class="graph-info-wrap">`;
  h += `<div class="section-label" style="padding:0 0 6px">Grafo em Memória — Nós (${graph.nodes.length})</div>`;
  h += `<div class="graph-table-wrap"><table class="graph-table">
    <thead><tr><th>ID</th><th>Tipo</th><th>Rótulo</th><th>Papel</th></tr></thead>
    <tbody>${nodesRows}</tbody>
  </table></div>`;
  h += `<div class="section-label" style="padding:12px 0 6px">Grafo em Memória — Arestas (${graph.edges.length}) — fluxo de resultados intermediários</div>`;
  h += `<div class="graph-table-wrap"><table class="graph-table">
    <thead><tr><th>De</th><th></th><th>Para</th><th>Tipo</th></tr></thead>
    <tbody>${edgesRows}</tbody>
  </table></div>`;
  h += `</div></div>`;
  return h;
}
