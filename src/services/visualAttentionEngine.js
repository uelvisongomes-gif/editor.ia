// Visual Attention Engine — decide se um determinado trecho da EDL está
// visualmente parado demais e sugere ESTÍMULOS.
//
// Não executa nada — só sugere. Quem aplica é:
//   - smartZoom (pra ZOOM_SUGGESTED)
//   - captionCompilation (pra CAPTION_EMPHASIS)
//   - futuro B-roll module (pra VISUAL_INSERT_SUGGESTED)
//
// Regras:
//   - Não sugerir estímulo em cima de outro estímulo recente (< 3s)
//   - Priorizar hooks, points, CTAs (do narrativeAnalysis)
//   - Se referenceProfile.visual.maxDeadIntervalSec é X, dispara
//     sugestão quando passa X segundos sem nenhuma mudança
//
// Retorna eventos ORDENADOS por prioridade. Consumidores pegam os
// primeiros N conforme desejado.

/**
 * @typedef {Object} VisualSuggestion
 * @property {number} atSec              - instante alvo
 * @property {"ZOOM_IN"|"ZOOM_OUT"|"CAPTION_EMPHASIS"|"VISUAL_INSERT"|"OK"} type
 * @property {number} priority           - 0-1 (usar quando decidir quantos aplicar)
 * @property {string} reason
 */

/**
 * @param {object} args
 * @param {Array} args.segments             - segmentos KEEP da EDL compilada
 * @param {Array} args.zoomEvents           - zooms já planejados
 * @param {Array} args.captionEvents        - legendas planejadas
 * @param {Array} args.semanticSentences    - sentenças com roles
 * @param {object} args.referenceProfile    - perfil de referência (loadProfile)
 * @returns {VisualSuggestion[]}
 */
export function computeVisualSuggestions({
  segments = [],
  zoomEvents = [],
  captionEvents = [],
  semanticSentences = [],
  referenceProfile,
} = {}) {
  const maxDead = referenceProfile?.visual?.maxDeadIntervalSec ?? 8;
  const targetChangesPerMin = referenceProfile?.visual?.changesPerMinute ?? 15;

  const timeline = [
    ...segments.filter((s) => s.deleted).map((s) => ({ t: s.start, type: "CUT" })),
    ...zoomEvents.map((z) => ({ t: z.start, type: "ZOOM" })),
    ...captionEvents.map((c) => ({ t: c.start, type: "CAPTION" })),
  ].sort((a, b) => a.t - b.t);

  const suggestions = [];
  for (let i = 0; i < timeline.length - 1; i++) {
    const gap = timeline[i + 1].t - timeline[i].t;
    if (gap > maxDead) {
      // Achou intervalo morto. Sugere um estímulo no meio.
      const atSec = timeline[i].t + gap / 2;
      const role = roleAt(semanticSentences, atSec);
      const priority = priorityForRole(role);
      const type = pickTypeForContext(role, timeline, atSec);
      suggestions.push({
        atSec,
        type,
        priority,
        reason: `dead_interval_${gap.toFixed(1)}s${role ? "_role_" + role : ""}`,
      });
    }
  }

  // Ordena por prioridade, maior primeiro.
  suggestions.sort((a, b) => b.priority - a.priority);
  // Limita ao target de changesPerMinute pra não poluir.
  const durationSec = segments.length ? segments[segments.length - 1].end : 60;
  const maxSuggestions = Math.ceil(targetChangesPerMin * (durationSec / 60) / 3);
  return suggestions.slice(0, maxSuggestions);
}

function roleAt(sentences, t) {
  if (!sentences?.length) return null;
  const s = sentences.find((x) => t >= x.start && t < x.end);
  return s ? s.role : null;
}

function priorityForRole(role) {
  switch (role) {
    case "point": return 0.95;
    case "cta": return 0.90;
    case "hook": return 0.85;
    case "conclusion": return 0.80;
    case "development": return 0.55;
    case "context": return 0.45;
    case "aside": return 0.30;
    default: return 0.50;
  }
}

function pickTypeForContext(role, timeline, atSec) {
  // Se o último estímulo recente foi um ZOOM, sugere CAPTION emphasis.
  // Se foi caption, sugere ZOOM. Evita repetir mesmo tipo.
  const recent = timeline.filter((e) => e.t < atSec).slice(-1)[0];
  if (recent?.type === "ZOOM") return "CAPTION_EMPHASIS";
  if (recent?.type === "CAPTION") return "ZOOM_IN";
  if (role === "point" || role === "cta") return "ZOOM_IN";
  return "CAPTION_EMPHASIS";
}

/**
 * Density Guard — retorna quantos estímulos visuais estão ativos em t.
 * Consumidores (smartZoom, futuro captionEmphasis, B-roll) checam ANTES
 * de emitir um novo estímulo pra evitar poluição (3+ ao mesmo tempo).
 *
 * @param {number} t                    - timestamp em segundos
 * @param {object} args
 * @param {Array} args.segments         - segments compilados
 * @param {Array} args.zoomEvents       - zoomEvents
 * @param {Array} args.captionEvents    - legendas planejadas
 * @param {number} [args.cutRecencyWin] - janela pra considerar corte "ativo" (default 1.5s)
 * @returns {{level:"LOW"|"NORMAL"|"HIGH", count:number, active:string[]}}
 */
export function getDensityAt(t, { segments = [], zoomEvents = [], captionEvents = [], cutRecencyWin = 1.5 } = {}) {
  const active = [];

  // Corte recente (segment ativo começa nos últimos cutRecencyWin segundos)
  const activeSegs = segments.filter((s) => !s.deleted && s.action !== "review" && s.action !== "trim")
                             .sort((a, b) => a.start - b.start);
  for (let i = 1; i < activeSegs.length; i++) {
    const cutT = activeSegs[i].start;
    if (t >= cutT && t <= cutT + cutRecencyWin) { active.push("CUT"); break; }
  }

  // Zoom ativo em t
  if (zoomEvents.some((z) => t >= z.start - (z.fadeIn || 0) && t <= z.end + (z.fadeOut || 0))) {
    active.push("ZOOM");
  }

  // Caption com word-emphasis ativo em t (só highlight, não caption normal)
  if (captionEvents.some((c) => c.hasEmphasis && t >= c.start && t <= c.end)) {
    active.push("CAPTION_EMPHASIS");
  }

  const count = active.length;
  const level = count >= 3 ? "HIGH" : count >= 2 ? "NORMAL" : "LOW";
  return { level, count, active };
}
