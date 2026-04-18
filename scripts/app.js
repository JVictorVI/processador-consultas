/* ═══════════════════════════════════════════════════════
   PROCESSADOR DE CONSULTAS SQL — HU1 + HU2 + HU3
   app.js — Interface, renderização e ponto de entrada
   Depende de: schema.js, parser.js, algebra.js, grafo.js
═══════════════════════════════════════════════════════ */
"use strict";

// ═══════════════════════════════════════════════════════
//  SCHEMA SIDEBAR — constrói a listagem lateral
// ═══════════════════════════════════════════════════════
function buildSchema() {
  const list = document.getElementById("schema-list");
  Object.entries(SCHEMA).forEach(([tbl, info]) => {
    const wrap = document.createElement("div");
    wrap.className = "schema-table-card";

    const hdr = document.createElement("div");
    hdr.className = "schema-table-header";
    hdr.innerHTML = `<span>🗂</span>${tbl}
      <span style="margin-left:auto;font-size:.62rem;color:var(--muted)">${info.fields.length} ▾</span>`;

    const flds = document.createElement("div");
    flds.className = "schema-fields";
    info.fields.forEach((f) => {
      const isPK = f === info.pk;
      const isFK = FK_FIELDS.includes(f);
      flds.innerHTML += `<div class="schema-field">
        <span>${isPK ? '<span class="pk">🔑</span>' : isFK ? '<span class="fk-c">🔗</span>' : "◦"}</span>
        <span class="field-name">${f}</span>
      </div>`;
    });

    hdr.onclick = () => flds.classList.toggle("open");
    wrap.appendChild(hdr);
    wrap.appendChild(flds);
    list.appendChild(wrap);
  });
}

// ═══════════════════════════════════════════════════════
//  EDITOR — numeração de linhas
// ═══════════════════════════════════════════════════════
document.getElementById("sql-input").addEventListener("input", function () {
  const n = this.value.split("\n").length;
  document.getElementById("ln").innerHTML = Array.from(
    { length: n },
    (_, i) => i + 1,
  ).join("<br>");
  document.getElementById("cc").textContent = `${this.value.length} chars`;
});

// ═══════════════════════════════════════════════════════
//  RENDER — ÁLGEBRA RELACIONAL (HU2)
// ═══════════════════════════════════════════════════════
function renderAlgebra(result) {
  const { exprHtml, steps } = result;
  let h = `<div class="animate-in">`;
  h += `<div class="section-label">Expressão de Álgebra Relacional</div>`;
  h += `<div class="algebra-expr">${exprHtml}</div>`;
  h += `<div class="section-label">Construção Passo a Passo (de dentro para fora)</div>`;
  h += `<div class="steps-wrap">`;
  steps.forEach((s, i) => {
    const icon =
      s.type === "from"
        ? "🗂"
        : s.type === "join"
          ? "⋈"
          : s.type === "sigma"
            ? "σ"
            : "π";
    h += `<div class="step-card">
      <div class="step-header" onclick="toggleStep(this)">
        <div class="step-num" style="background:${s.color}22;color:${s.color};border:1px solid ${s.color}55">${i + 1}</div>
        <span style="color:${s.color};font-size:.9rem">${icon}</span>
        <span style="color:var(--text)">${esc(s.label)}</span>
        <span style="margin-left:auto;color:var(--muted);font-size:.65rem">▾</span>
      </div>
      <div class="step-body">
        <div class="step-desc">${esc(s.desc)}</div>
        <div>${treeToHtml(s.tree)}</div>
      </div>
    </div>`;
  });
  h += `</div></div>`;
  return h;
}

function toggleStep(el) {
  el.nextElementSibling.classList.toggle("open");
  el.querySelector("span:last-child").textContent =
    el.nextElementSibling.classList.contains("open") ? "▴" : "▾";
}

// ═══════════════════════════════════════════════════════
//  RENDER — VALIDAÇÃO (HU1)
// ═══════════════════════════════════════════════════════
function renderValidacao(errors, tokens, aliases, usedTables) {
  const ok = errors.length === 0;
  const dot = document.getElementById("dot-v");
  dot.style.background = ok ? "var(--success)" : "var(--error)";
  dot.style.boxShadow = ok ? "0 0 8px var(--success)" : "0 0 8px var(--error)";

  let h = `<div class="animate-in" style="padding:14px">`;
  h += `<div class="status-banner ${ok ? "ok" : "err"}">
    <span>${ok ? "✓" : "✕"}</span>
    <span>${ok ? "Consulta válida! Sintaxe, tabelas e atributos verificados." : `${errors.length} erro(s) encontrado(s).`}</span>
  </div>`;

  if (errors.length) {
    h += `<div class="section-label">Erros Detectados</div><div class="error-list">`;
    errors.forEach((e) => {
      h += `<div class="error-item"><span>✕</span><span>${esc(e)}</span></div>`;
    });
    h += `</div>`;
  }

  if (tokens.length) {
    h += `<div class="section-label">Tokens Identificados</div><div class="tokens-wrap">`;
    tokens.forEach((t) => {
      const c = classifyTok(t, aliases);
      const cls =
        c === "keyword"
          ? "token-keyword"
          : c === "table"
            ? "token-table"
            : c === "attr"
              ? "token-attr"
              : c === "op"
                ? "token-op"
                : "token-other";
      h += `<span class="token ${cls}">${esc(t)}</span>`;
    });
    h += `</div>`;
  }

  if (usedTables && usedTables.length) {
    h += `<div class="section-label">Tabelas Referenciadas</div><div class="tokens-wrap">`;
    usedTables.forEach((t) => {
      const ex = !!schemaKey(t.name);
      h += `<span class="token ${ex ? "token-table" : "token-other"}"
        style="${ex ? "" : "color:var(--error);border-color:var(--error)"}">
        ${esc(t.name)}${t.alias !== t.name ? ` <span style="opacity:.5">→ ${esc(t.alias)}</span>` : ""}
      </span>`;
    });
    h += `</div>`;
  }

  h += `</div>`;
  document.getElementById("result-panel").innerHTML = h;
}

// ═══════════════════════════════════════════════════════
//  PROCESSAR — ponto de entrada principal
// ═══════════════════════════════════════════════════════
let lastExprText = "";

function processar() {
  const sql = document.getElementById("sql-input").value;
  const { errors, tokens, aliases, usedTables, parsed } = parse(sql);

  // ── HU1: Validação ───────────────────────────────────
  renderValidacao(errors, tokens, aliases, usedTables);

  // ── HU2: Álgebra Relacional ──────────────────────────
  const dotA = document.getElementById("dot-a");
  const copyBtn = document.getElementById("copy-btn");
  const panel = document.getElementById("algebra-panel");

  // ── HU3: Grafo de Operadores ─────────────────────────
  const dotP = document.getElementById("dot-p");
  const grafoPanel = document.getElementById("grafo-panel");

  const ERR_MSG_HU2 = `<div style="padding:14px">
    <div class="status-banner err">
      <span>✕</span>
      <span>Corrija os erros de validação (HU1) antes de gerar a álgebra relacional.</span>
    </div>
  </div>`;

  const ERR_MSG_HU3 = `<div style="padding:14px">
    <div class="status-banner err">
      <span>✕</span>
      <span>Corrija os erros de validação (HU1) antes de gerar o grafo de operadores.</span>
    </div>
  </div>`;

  if (errors.length > 0) {
    // HU2 — erro
    dotA.style.background = "var(--error)";
    dotA.style.boxShadow = "0 0 8px var(--error)";
    copyBtn.style.display = "none";
    panel.innerHTML = ERR_MSG_HU2;

    // HU3 — erro
    dotP.style.background = "var(--error)";
    dotP.style.boxShadow = "0 0 8px var(--error)";
    grafoPanel.innerHTML = ERR_MSG_HU3;
  } else {
    const result = toAlgebra(parsed);
    if (result) {
      // HU2 — sucesso
      dotA.style.background = "var(--pi)";
      dotA.style.boxShadow = "0 0 8px var(--pi)";
      copyBtn.style.display = "block";
      lastExprText = result.exprText;
      panel.innerHTML = `<div style="padding:14px">${renderAlgebra(result)}</div>`;

      // HU3 — sucesso: constrói grafo em memória e renderiza
      const graph = astToGraph(result.tree);
      dotP.style.background = "var(--success)";
      dotP.style.boxShadow = "0 0 8px var(--success)";
      grafoPanel.innerHTML = renderGrafo(result.tree, graph);
    }
  }
}

function copiarAlgebra() {
  navigator.clipboard.writeText(lastExprText).then(() => {
    const b = document.getElementById("copy-btn");
    b.textContent = "✓ Copiado!";
    setTimeout(() => (b.textContent = "⧉ Copiar"), 1500);
  });
}

// ═══════════════════════════════════════════════════════
//  TABS / UTILITÁRIOS
// ═══════════════════════════════════════════════════════
function switchTab(name) {
  document
    .querySelectorAll(".tab")
    .forEach((t) => t.classList.remove("active"));
  document
    .querySelectorAll(".tab-panel")
    .forEach((p) => p.classList.remove("active"));
  document
    .querySelector(`.tab[onclick="switchTab('${name}')"]`)
    .classList.add("active");
  document.getElementById(`panel-${name}`).classList.add("active");
}

function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function limpar() {
  document.getElementById("sql-input").value = "";
  document.getElementById("cc").textContent = "0 chars";
  document.getElementById("ln").textContent = "1";
  document.getElementById("result-panel").innerHTML =
    `<div class="result-empty"><div class="empty-icon pulse">🔍</div><p>Digite e clique em <strong>Processar</strong></p></div>`;
  document.getElementById("algebra-panel").innerHTML =
    `<div class="algebra-empty"><div class="empty-icon pulse" style="font-size:2rem">π σ ⋈</div><p>Expressão gerada após processar uma consulta válida</p></div>`;
  document.getElementById("grafo-panel").innerHTML =
    `<div class="tree-empty"><div class="empty-icon pulse" style="font-size:2rem">🌳</div><p>Grafo gerado após processar uma consulta válida</p></div>`;
  ["dot-v", "dot-a", "dot-p"].forEach((id) => {
    document.getElementById(id).style.background = "var(--muted)";
    document.getElementById(id).style.boxShadow = "none";
  });
  document.getElementById("copy-btn").style.display = "none";
}

function loadEx(i) {
  const ex = EXAMPLES[i];
  document.getElementById("sql-input").value = ex;
  const n = ex.split("\n").length;
  document.getElementById("ln").innerHTML = Array.from(
    { length: n },
    (_, j) => j + 1,
  ).join("<br>");
  document.getElementById("cc").textContent = `${ex.length} chars`;
}

// ═══════════════════════════════════════════════════════
//  INIT
// ═══════════════════════════════════════════════════════
buildSchema();
