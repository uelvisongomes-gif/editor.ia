// Transition Engine — decide QUAL transição usar em cada corte.
// Prioridade da spec:
//   1. cut (padrão — 90% dos casos)
//   2. jump cut tratado (com punch-in / zoom leve)
//   3. match cut (quando cena antes/depois combina — futuro)
//   4. dissolve (mudança de assunto grande)
//   5. fade (extremos — abertura/fechamento)
//   6. motion (chamativa — só em modo viral com justificativa)
//
// Não executa render — só emite recomendação por cut point.

/**
 * @typedef {Object} TransitionSuggestion
 * @property {number} atSec           - instante do corte
 * @property {"cut"|"jump_treated"|"match_cut"|"dissolve"|"fade"|"motion"} kind
 * @property {number} durationSec
 * @property {string} reason
 * @property {number} confidence
 */

/**
 * @param {object} args
 * @param {Array} args.segments             - segments compilados
 * @param {Array} args.zoomEvents           - pra saber onde já tem punch-in
 * @param {{ timeline: Array }} args.narrative
 * @param {object} args.profile
 * @returns {{ transitions: TransitionSuggestion[], summary: object }}
 */
export function buildTransitionPlan({ segments = [], zoomEvents = [], narrative, profile = {} } = {}) {
  const transitions = [];
  const activeSegs = segments.filter((s) => !s.deleted && s.action !== "review" && s.action !== "trim")
                             .sort((a, b) => a.start - b.start);
  const timeline = narrative?.timeline || [];
  const mode = profile?.id || "equilibrada";

  // Palette permitida por modo
  const MODE_PALETTE = {
    leve: ["cut", "jump_treated"],
    equilibrada: ["cut", "jump_treated", "dissolve"],
    agressiva: ["cut", "jump_treated", "dissolve", "fade", "motion"],
    profissional: ["cut", "dissolve", "fade"],
    podcast: ["cut"],
    tiktokshop: ["cut", "jump_treated", "motion"],
    tutorial: ["cut", "dissolve"],
  };
  const allowed = new Set(MODE_PALETTE[mode] || MODE_PALETTE.equilibrada);

  for (let i = 1; i < activeSegs.length; i++) {
    const cutPoint = activeSegs[i].start;

    // Já tem zoom cobrindo o corte? Isso é "jump_treated" — não precisa de outra
    const zoomAtCut = zoomEvents.some((z) =>
      z.isTransition && Math.abs(z.start - cutPoint) < 0.3
    );
    if (zoomAtCut) {
      transitions.push({
        atSec: cutPoint,
        kind: "jump_treated",
        durationSec: 0.3,
        reason: "punch-in cobre o corte",
        confidence: 0.95,
      });
      continue;
    }

    // Mudança de role narrativo → dissolve leve (se permitido)
    const prevRole = timeline.find((s) => s.end <= cutPoint + 0.1)?.role;
    const nextRole = timeline.find((s) => s.start >= cutPoint - 0.1)?.role;
    const roleChanged = prevRole && nextRole && prevRole !== nextRole;
    const bigChange = roleChanged && (
      ["cta", "conclusion", "hook"].includes(prevRole) ||
      ["cta", "conclusion", "hook"].includes(nextRole)
    );

    if (bigChange && allowed.has("dissolve")) {
      transitions.push({
        atSec: cutPoint,
        kind: "dissolve",
        durationSec: 0.4,
        reason: `mudança ${prevRole}→${nextRole}`,
        confidence: 0.80,
      });
      continue;
    }

    // Default: cut seco
    transitions.push({
      atSec: cutPoint,
      kind: "cut",
      durationSec: 0,
      reason: "corte padrão",
      confidence: 1.0,
    });
  }

  const counts = transitions.reduce((acc, t) => {
    acc[t.kind] = (acc[t.kind] || 0) + 1;
    return acc;
  }, {});

  return { transitions, summary: { total: transitions.length, byKind: counts, mode } };
}
