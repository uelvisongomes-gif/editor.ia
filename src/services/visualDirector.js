// Visual Director — camada central de decisão visual do CRIE editor.
//
// Consome os artefatos já produzidos pelas Fases 1 e 2 (narrative timeline,
// segments, zoom, captions, density) e emite um PLANO visual: lista de
// decisões pra cada momento do vídeo, sem executar nada.
//
// Consumidores (smartZoom, captionLayoutEngine, futuro brollDirector,
// pattern interrupts, etc) leem esse plano pra saber:
//   - se devem agir num intervalo específico
//   - qual "action" é apropriada
//   - qual a prioridade
//   - por que (rastreabilidade)
//
// NÃO faz mudanças destrutivas. Apenas RECOMENDA.
//
// Determinístico, zero LLM. Reutiliza narrative.timeline (que já tem
// role/importance/confidence/weakness) + visualAttentionEngine.getDensityAt.

import { getDensityAt } from "./visualAttentionEngine.js";

/**
 * @typedef {Object} VisualDecision
 * @property {number} start
 * @property {number} end
 * @property {"keep_normal"|"zoom_in"|"punch_in"|"keyword_highlight"|"text_overlay"|"broll_suggest"|"reframe"|"transition"} action
 * @property {number} priority        - 0-1 (usar quando decidir quantas aplicar)
 * @property {string} reason          - explicação humana
 * @property {string} narrativeAnchor - role que disparou (hook/cta/point/etc)
 * @property {number} confidence      - 0-1
 * @property {string|null} weakness   - se veio de trecho fraco
 */

// Peso base por role — quanto merece atenção visual.
const ROLE_VISUAL_WEIGHT = {
  hook: 0.90,
  problem: 0.75,
  turn: 0.95,
  solution: 0.85,
  point: 0.90,
  proof: 0.70,
  cta: 0.95,
  conclusion: 0.65,
  development: 0.40,
  context: 0.25,
  aside: 0.10,
  off_topic: 0.05,
};

// Peso da importância — critical multiplica.
const IMPORTANCE_MULT = {
  critical: 1.15,
  high: 1.00,
  medium: 0.70,
  low: 0.40,
};

// Action recomendada por perfil de trecho.
function pickActionFor(item, profileMode) {
  const { role, importance } = item;
  // Trechos críticos com role forte → zoom in
  if (importance === "critical" && (role === "point" || role === "cta" || role === "turn")) {
    return "punch_in"; // enfático, com peso emocional
  }
  if (role === "hook") return "punch_in";
  if (role === "cta") return "zoom_in";
  if (role === "proof") return "broll_suggest"; // evidência → dá pra ilustrar
  if (role === "problem" && importance !== "low") return "zoom_in";
  if (role === "solution") return "zoom_in";
  if (role === "point" && importance === "high") return "zoom_in";
  if (role === "conclusion") return "zoom_in";
  // Números/dados/nomes viram keyword highlight (item 12) — heurística
  // ficará mais rica quando integrarmos parser de conteúdo.
  return null;
}

// Modo do editor influencia intensidade — modo "viral" aceita mais efeitos,
// "natural" prefere silêncio visual. Fica atrelado ao profile.id do editingProfiles.
const MODE_INTENSITY = {
  leve:        0.5,   // → futuro "natural"
  equilibrada: 1.0,   // → futuro "dinamico"
  agressiva:   1.4,   // → futuro "viral"
  natural:     0.4,
  dinamico:    1.0,
  viral:       1.4,
  profissional: 0.7,
  podcast:     0.3,
  tiktokshop:  1.2,
  tutorial:    0.8,
};

/**
 * @param {object} args
 * @param {{ timeline:Array, weakSpots:Array, criticalSpans:Array }} args.narrative
 * @param {Array} args.segments
 * @param {Array} args.zoomEvents
 * @param {Array} args.captionEvents
 * @param {object} args.profile
 * @returns {{ decisions: VisualDecision[], summary: object }}
 */
export function buildVisualPlan({ narrative, segments = [], zoomEvents = [], captionEvents = [], profile = {} } = {}) {
  const decisions = [];
  const timeline = narrative?.timeline || [];
  const mode = profile?.id || "equilibrada";
  const intensity = MODE_INTENSITY[mode] ?? 1.0;

  for (const item of timeline) {
    // Trechos fracos ou off-topic — não pede ação visual (será tratado
    // pela camada de cortes, não pela camada visual).
    if (item.role === "off_topic" || item.role === "aside") continue;
    if (item.weakness) continue;

    // Priority base = role weight * importance mult * intensity
    const roleW = ROLE_VISUAL_WEIGHT[item.role] ?? 0.30;
    const impM = IMPORTANCE_MULT[item.importance] ?? 0.70;
    const priority = Math.min(1, roleW * impM * intensity);

    // Threshold — só emite decisão pra prioridades relevantes
    if (priority < 0.55) continue;

    // Density guard — não empilhar decisões onde já há efeito visual
    const density = getDensityAt(item.start, { segments, zoomEvents, captionEvents });
    if (density.level === "HIGH") continue;

    const action = pickActionFor(item, mode);
    if (!action) continue;

    decisions.push({
      start: item.start,
      end: item.end,
      action,
      priority: Math.round(priority * 100) / 100,
      reason: describeReason(item, action),
      narrativeAnchor: item.role,
      confidence: Math.round(((item.confidence ?? 70) / 100) * 100) / 100,
      weakness: item.weakness || null,
    });
  }

  // Ordena por prioridade DESC — consumidores pegam top N conforme espaço
  decisions.sort((a, b) => b.priority - a.priority);

  return {
    decisions,
    summary: {
      totalItemsAnalyzed: timeline.length,
      decisionsEmitted: decisions.length,
      criticalCount: (narrative?.criticalSpans || []).length,
      weakSpotCount: (narrative?.weakSpots || []).length,
      mode,
      intensity,
    },
  };
}

function describeReason(item, action) {
  const roleLabel = {
    hook: "gancho", cta: "chamada pra ação", turn: "virada", solution: "solução",
    point: "insight forte", proof: "evidência", problem: "problema/dor",
    conclusion: "conclusão", development: "desenvolvimento", context: "contexto",
  }[item.role] || item.role;
  return `${action} sugerido em ${roleLabel} (importância ${item.importance})`;
}
