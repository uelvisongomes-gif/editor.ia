// Click/Pop Detector — foca em transientes ao redor dos cortes da EDL.
// Complementa o audioAnalyzer (que já conta clicks globalmente) mas aqui
// devolve TIMESTAMPS específicos com contexto (near_cut / mid_speech / edge).
//
// Usado pra decidir onde aplicar crossfade curto (5-30ms) sem alterar a EDL.

import { makeDecision } from "./audioTimeline.js";

/**
 * @typedef {Object} ClickEvent
 * @property {number} t
 * @property {number} amplitude
 * @property {"near_cut"|"mid_speech"|"between_speech"} context
 * @property {number} confidence
 */

/**
 * @param {AudioBuffer} audioBuffer
 * @param {Array} segments
 * @returns {{ events: ClickEvent[], nearCutCount: number }}
 */
export function detectClicksNearCuts(audioBuffer, segments = []) {
  if (!audioBuffer || !segments.length) return { events: [], nearCutCount: 0 };
  const channel = audioBuffer.getChannelData(0);
  const sr = audioBuffer.sampleRate;

  const cutPoints = [];
  const active = segments.filter((s) => !s.deleted).sort((a, b) => a.start - b.start);
  for (let i = 0; i < active.length; i++) {
    if (i > 0 && active[i].start !== active[i - 1].end) {
      cutPoints.push(active[i - 1].end);
      cutPoints.push(active[i].start);
    }
  }

  const events = [];
  // Janela em cada cut point: ±60ms
  for (const t of cutPoints) {
    const startSamp = Math.max(0, Math.floor((t - 0.06) * sr));
    const endSamp = Math.min(channel.length, Math.floor((t + 0.06) * sr));
    const winSize = Math.floor(sr * 0.003); // 3ms
    for (let i = startSamp; i < endSamp - winSize; i += Math.floor(winSize / 2)) {
      let peak = 0;
      for (let j = 0; j < winSize; j++) {
        const v = Math.abs(channel[i + j]);
        if (v > peak) peak = v;
      }
      // Contexto ±40ms
      const ctxStart = Math.max(0, i - Math.floor(sr * 0.04));
      const ctxEnd = Math.min(channel.length, i + winSize + Math.floor(sr * 0.04));
      let ctxSum = 0, ctxN = 0;
      for (let j = ctxStart; j < i; j++) { ctxSum += Math.abs(channel[j]); ctxN++; }
      for (let j = i + winSize; j < ctxEnd; j++) { ctxSum += Math.abs(channel[j]); ctxN++; }
      const ctxAvg = ctxN ? ctxSum / ctxN : 0;
      if (peak > 0.12 && peak > ctxAvg * 5) {
        const clickT = i / sr;
        const distToCut = Math.min(...cutPoints.map((cp) => Math.abs(cp - clickT)));
        events.push({
          t: Math.round(clickT * 1000) / 1000,
          amplitude: Math.round(peak * 1000) / 1000,
          context: distToCut < 0.02 ? "near_cut" : "between_speech",
          confidence: Math.min(1, (peak / (ctxAvg + 1e-6)) / 10),
        });
      }
    }
  }
  // dedupe por proximidade (≤20ms)
  events.sort((a, b) => a.t - b.t);
  const deduped = [];
  for (const ev of events) {
    if (deduped.length && ev.t - deduped[deduped.length - 1].t < 0.02) continue;
    deduped.push(ev);
  }
  const nearCutCount = deduped.filter((e) => e.context === "near_cut").length;
  return { events: deduped, nearCutCount };
}

/**
 * Gera decisões de crossfade para cada click near_cut.
 * Crossfade de 15ms centrado no click.
 */
export function planCrossfadesFromClicks(clicks) {
  const dec = [];
  for (const c of clicks.filter((e) => e.context === "near_cut")) {
    dec.push(makeDecision({
      type: "crossfade",
      start: Math.max(0, c.t - 0.008),
      end: c.t + 0.008,
      intensity: 1,
      reason: `click ${c.amplitude} near cut`,
      confidence: c.confidence,
      params: { fadeMs: 16, curve: "equal_power" },
    }));
  }
  return dec;
}
