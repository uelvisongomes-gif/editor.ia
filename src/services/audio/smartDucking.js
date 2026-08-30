// Smart Ducking — envelope dinâmico que modula por importância narrativa,
// CTA, hook, silêncio, B-roll. Estende musicDucking (que só considerava fala).
// Item 22 da spec.
//
// A base é o mesmo envelope de musicDucking, mas:
//   - Em CTA (item.role === 'cta') → duck EXTRA (25% base)
//   - Em critical/high → duck (30%)
//   - Em silence + B-roll ativo → sobe pra 100%
//   - Em silence sem B-roll → sobe pra 80%
//   - Em fim (últimos 3s) → fade out

/**
 * @typedef {Object} SmartDuckPoint
 * @property {number} t
 * @property {number} musicGain
 * @property {string} reason
 */

/**
 * @param {object} args
 * @param {{ segments: Array }} args.speechActivity
 * @param {object} args.narrative      - com timeline
 * @param {Array} args.brollPlan       - suggestions com start/end
 * @param {number} args.duration
 * @param {number} [args.baseNormal=1.0]
 * @param {number} [args.baseDuck=0.30]
 * @param {number} [args.ctaDuck=0.20]
 * @param {number} [args.brollBoost=1.0]
 * @returns {SmartDuckPoint[]}
 */
export function computeSmartDuckingEnvelope({
  speechActivity, narrative, brollPlan = [], duration = 0,
  baseNormal = 1.0, baseDuck = 0.30, ctaDuck = 0.20, brollBoost = 1.0,
} = {}) {
  if (!speechActivity?.segments?.length) return [];
  const step = 0.1;
  const envelope = [];
  const totalDur = duration || speechActivity.segments[speechActivity.segments.length - 1].end;
  const timeline = narrative?.timeline || [];
  const brollSuggestions = brollPlan?.suggestions || brollPlan || [];

  let currentGain = baseNormal;
  const attackSec = 0.15;
  const releaseSec = 0.4;

  for (let t = 0; t < totalDur; t += step) {
    const speechSeg = speechActivity.segments.find((s) => t >= s.start && t < s.end);
    const isSpeech = speechSeg && speechSeg.state === "SPEECH";
    const narrItem = timeline.find((n) => t >= n.start && t < n.end);
    const inBroll = brollSuggestions.some((b) => t >= b.start && t < b.end);
    const isEnd = t >= totalDur - 3;

    let target = baseNormal;
    let reason = "normal";

    if (isEnd) {
      // Fade out linear nos últimos 3s
      const progress = (totalDur - t) / 3;
      target = Math.max(0, baseNormal * progress);
      reason = "fade_out_end";
    } else if (isSpeech) {
      if (narrItem?.role === "cta") {
        target = ctaDuck;
        reason = "duck_cta";
      } else if (narrItem?.importance === "critical") {
        target = baseDuck * 0.85;
        reason = "duck_critical";
      } else if (narrItem?.importance === "high") {
        target = baseDuck * 0.95;
        reason = "duck_high";
      } else {
        target = baseDuck;
        reason = "duck_speech";
      }
    } else {
      // Silêncio
      if (inBroll) {
        target = brollBoost;
        reason = "boost_broll";
      } else {
        target = baseNormal * 0.85;
        reason = "silence";
      }
    }

    const rate = target < currentGain ? attackSec : releaseSec;
    const alpha = Math.min(1, step / rate);
    currentGain = currentGain + (target - currentGain) * alpha;

    envelope.push({
      t: Math.round(t * 100) / 100,
      musicGain: Math.round(currentGain * 100) / 100,
      reason,
    });
  }
  return envelope;
}
