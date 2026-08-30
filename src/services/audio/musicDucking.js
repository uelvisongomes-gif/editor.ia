// Music Ducking — computa envelope de volume da música que baixa
// automaticamente quando há fala (side-chain compressor virtual).
//
// Consome speechActivity (Fase 1) + waveform + configuração de ducking.
// Emite envelope de volume aplicável ao track de música na exportação.

/**
 * @typedef {Object} DuckingEnvelope
 * @property {number} t
 * @property {number} musicGain   - 0-1 (multiplicador aplicado ao volume base da música)
 * @property {string} reason
 */

/**
 * @param {object} args
 * @param {{ segments: Array }} args.speechActivity
 * @param {number} [args.duration]
 * @param {number} [args.duckLevel=0.30]  - quanto abaixa quando há fala (30% do normal)
 * @param {number} [args.normalLevel=1.0]
 * @param {number} [args.attackSec=0.15]  - transição pra baixar
 * @param {number} [args.releaseSec=0.4]  - transição pra voltar
 * @returns {DuckingEnvelope[]}
 */
export function computeDuckingEnvelope({ speechActivity, duration = 0, duckLevel = 0.30, normalLevel = 1.0, attackSec = 0.15, releaseSec = 0.4 } = {}) {
  if (!speechActivity?.segments?.length) return [];
  const step = 0.1;
  const envelope = [];
  let currentGain = normalLevel;
  const totalDur = duration || speechActivity.segments[speechActivity.segments.length - 1].end;
  for (let t = 0; t < totalDur; t += step) {
    const seg = speechActivity.segments.find((s) => t >= s.start && t < s.end);
    const isSpeech = seg && seg.state === "SPEECH";
    const target = isSpeech ? duckLevel : normalLevel;
    // Smoothing exponencial
    const rate = target < currentGain ? attackSec : releaseSec;
    const alpha = Math.min(1, step / rate);
    currentGain = currentGain + (target - currentGain) * alpha;
    envelope.push({
      t: Math.round(t * 100) / 100,
      musicGain: Math.round(currentGain * 100) / 100,
      reason: isSpeech ? "duck_speech" : "normal",
    });
  }
  return envelope;
}

/**
 * Retorna o gain aplicado num instante t.
 */
export function musicGainAt(envelope, t) {
  if (!envelope?.length) return 1;
  let best = envelope[0];
  for (const e of envelope) {
    if (e.t <= t) best = e;
    else break;
  }
  return best.musicGain;
}
