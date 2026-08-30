// Music Decision Engine — decide se ESTE vídeo precisa de música.
// Item 14 da spec. Devolve YES/NO/OPTIONAL + rationale.
//
// Considera:
//   - se já tem música (detectExistingMusic)
//   - modo de edição (podcast/tutorial NÃO precisam, viral/tiktokshop SIM)
//   - duração (< 8s NÃO precisa)
//   - narrativa (hook/cta se beneficiam de música)
//   - proporção fala/silêncio

/**
 * @typedef {Object} MusicDecision
 * @property {"yes"|"no"|"optional"} answer
 * @property {number} confidence
 * @property {string[]} reasons
 * @property {string} recommendedAction
 */

const MODES_REQUIRING_MUSIC = new Set(["viral", "tiktokshop", "dinamico"]);
const MODES_NO_MUSIC_DEFAULT = new Set(["podcast", "profissional"]);

/**
 * @param {object} args
 * @param {object} args.existingMusic  - detectExistingMusic result
 * @param {object} args.profile
 * @param {number} args.duration
 * @param {object} args.narrative
 * @returns {MusicDecision}
 */
export function decideNeedsMusic({ existingMusic, profile, duration = 60, narrative } = {}) {
  const reasons = [];
  const modeId = profile?.id;

  // 1. Se já tem música dominante — NÃO adicionar outra
  if (existingMusic?.hasMusic && existingMusic.recommendation !== "remove") {
    reasons.push(`vídeo já possui música (${existingMusic.recommendation})`);
    return {
      answer: "no",
      confidence: 0.95,
      reasons,
      recommendedAction: `manter música original (${existingMusic.recommendation})`,
    };
  }

  // 2. Muito curto — dispensável
  if (duration < 8) {
    reasons.push(`duração ${duration.toFixed(1)}s < 8s`);
    return { answer: "no", confidence: 0.8, reasons, recommendedAction: "vídeo curto demais" };
  }

  // 3. Modo explicitamente rejeita
  if (MODES_NO_MUSIC_DEFAULT.has(modeId)) {
    reasons.push(`modo ${modeId} normalmente não usa música`);
    return { answer: "optional", confidence: 0.7, reasons, recommendedAction: "usuário decide" };
  }

  // 4. Modo explicitamente pede
  if (MODES_REQUIRING_MUSIC.has(modeId)) {
    reasons.push(`modo ${modeId} espera música`);
    return { answer: "yes", confidence: 0.9, reasons, recommendedAction: "adicionar música dinâmica" };
  }

  // 5. Narrativa com hook + CTA forte → música ajuda
  const timeline = narrative?.timeline || [];
  const hasHook = timeline.some((t) => t.role === "hook");
  const hasCTA = timeline.some((t) => t.role === "cta");
  const hasProof = timeline.some((t) => t.role === "proof");
  if (hasHook && hasCTA && duration >= 15) {
    reasons.push("estrutura hook+CTA se beneficia de música");
    return { answer: "yes", confidence: 0.75, reasons, recommendedAction: "adicionar música moderada" };
  }
  if (hasProof && duration >= 30) {
    reasons.push("vídeo educacional/demonstrativo — música moderada ok");
    return { answer: "optional", confidence: 0.6, reasons, recommendedAction: "usuário decide" };
  }

  return { answer: "optional", confidence: 0.5, reasons: ["nenhum sinal forte"], recommendedAction: "usuário decide" };
}
