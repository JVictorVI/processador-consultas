/* ═══════════════════════════════════════════════════════
   PROCESSADOR DE CONSULTAS SQL — HU5
   plano.js — Plano de Execução da Consulta
═══════════════════════════════════════════════════════ */
'use strict';

function formatRelForPlan(node) {
  if (!node) return '';
  if (typeof relLabel === 'function') return relLabel(node);
  if (node.alias && String(node.alias).toUpperCase() !== String(node.name).toUpperCase()) {
    return `${node.name} ${node.alias}`;
  }
  return node.name || '';
}

/**
 * Gera o plano de execução percorrendo a árvore em pós-ordem (bottom-up).
 */
function astToExecutionPlan(node, plan = []) {
  if (!node) return plan;

  // 1. Visitar os filhos primeiro (pós-ordem garante leitura de baixo para cima)
  if (node.inner) astToExecutionPlan(node.inner, plan);
  if (node.left) astToExecutionPlan(node.left, plan);
  if (node.right) astToExecutionPlan(node.right, plan);

  // 2. Montar a descrição direta
  let step = { description: "" };
  
  // Usamos uma classe utilitária para deixar o SQL em destaque (JetBrains Mono)
  const sqlStyle = "font-family: var(--mono); font-weight: 800; font-size: 0.9rem; color: #ffffff; letter-spacing: 0.02em;";

  switch (node.type) {
    case 'rel':
      step.description = `Acessar relação (tabela): <span style="${sqlStyle}">${formatRelForPlan(node)}</span>`;
      break;
    case 'sigma':
      step.description = `Aplicar filtro de Seleção (σ): reter tuplas onde <span style="${sqlStyle}">${node.cond}</span>`;
      break;
    case 'equi':
      step.description = `Realizar Equijunção (⋈): combinar tuplas onde <span style="${sqlStyle}">${node.cond}</span>`;
      break;
    case 'theta':
      step.description = `Realizar Junção-θ (⋈θ): combinar tuplas onde <span style="${sqlStyle}">${node.cond}</span>`;
      break;
    case 'pi':
      step.description = `Aplicar Projeção (π): extrair os atributos <span style="${sqlStyle}">${node.attrs}</span>`;
      break;
    default:
      step.description = `Operação desconhecida: ${node.type}`;
  }

  plan.push(step);
  return plan;
}

/**
 * Renderiza o plano de execução com o layout linear (bolinha ciano + texto)
 */
function renderPlanoExecucao(tree) {
  const plan = astToExecutionPlan(tree);
  
  let h = `<div class="animate-in" style="padding:14px">`;
  h += `<div class="section-label" style="margin-bottom: 14px;">ORDEM LÓGICA DE EXECUÇÃO PASSO A PASSO</div>`;
  h += `<div style="display: flex; flex-direction: column; gap: 10px;">`;
  
  plan.forEach((step, index) => {
    h += `
      <div style="display: flex; align-items: center; gap: 16px; padding: 14px 18px; background: transparent; border: 1px solid var(--border); border-radius: 8px;">
        
        <div style="width: 28px; height: 28px; border-radius: 50%; background: var(--accent); color: #ffffff; display: flex; align-items: center; justify-content: center; font-weight: 800; font-family: var(--mono); font-size: 0.85rem; flex-shrink: 0; box-shadow: 0 0 10px rgba(0, 229, 255, 0.4);">
          ${index + 1}
        </div>
        
        <div style="font-size: 0.85rem; color: var(--text);">
          ${step.description}
        </div>

      </div>
    `;
  });
  
  h += `</div></div>`;
  return h;
}