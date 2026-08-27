// Pre-roll: chiado/ruído SEM fala antes da primeira palavra.
// Diferente de "hesitação inicial" (que também é ruído mas com padrão de fala).

const PRE_ROLL_MARGIN = 0.15;
const MIN_PRE_ROLL = 0.5;

export function detectPreRoll({ words } = {}) {
  if (!words?.length) return [];
  const first = words[0];
  if (first.start < MIN_PRE_ROLL + PRE_ROLL_MARGIN) return [];
  return [{
    start: 0,
    end: first.start - PRE_ROLL_MARGIN,
    confidence: 0.92,
    reason: "no_speech",
    source: "speechError",
    detectedBy: "heuristic",
    text: "(pre-roll sem fala — ruído/ambiente)",
  }];
}
