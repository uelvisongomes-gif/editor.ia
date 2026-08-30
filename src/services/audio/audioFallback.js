// Audio Fallback — reverte tratamentos que pioraram o áudio (Item 34).
// Recebe QCFinding[] e uma lista de decisões aplicadas; devolve lista
// filtrada (sem os stages que causaram regressão).
//
// Regra: nunca entregar áudio pior que o original. Prefere qualidade
// original a "processado ruim".

/**
 * Mapa: kind de finding → stages que podem ser a causa.
 */
const CAUSATION = {
  clipping:        ["compressor", "limiter", "gain"],
  metallic_voice:  ["noise_reduction", "de_esser", "eq"],
  volume_delta:    ["gain", "compressor"],
  noise_residual:  ["noise_reduction"],
  click_residual:  ["compressor", "de_esser"],
  distortion:      ["compressor", "limiter"],
};

/**
 * @param {import("./audioTimeline.js").AudioDecision[]} decisions
 * @param {import("./audioQC.js").QCFinding[]} findings
 * @returns {{ kept: Array, reverted: Array, actions: string[] }}
 */
export function applyFallback(decisions, findings) {
  if (!findings?.length) return { kept: decisions, reverted: [], actions: [] };
  const suspectTypes = new Set();
  for (const f of findings) {
    if (f.severity < 0.4) continue;
    for (const t of CAUSATION[f.kind] || []) suspectTypes.add(t);
  }
  if (!suspectTypes.size) return { kept: decisions, reverted: [], actions: [] };
  const kept = [];
  const reverted = [];
  for (const d of decisions) {
    if (suspectTypes.has(d.type) && d.intensity > 0.3) {
      // Reduz pela metade ao invés de remover — mais graceful
      reverted.push({ ...d, _revertedFromIntensity: d.intensity });
      kept.push({ ...d, intensity: d.intensity * 0.5, reason: d.reason + " [reduzido pelo fallback]" });
    } else {
      kept.push(d);
    }
  }
  const actions = reverted.map((d) => `${d.type} reduzido (${(d._revertedFromIntensity).toFixed(2)} → ${(d.intensity * 0.5).toFixed(2)})`);
  return { kept, reverted, actions };
}
