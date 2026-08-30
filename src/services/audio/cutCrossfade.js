// Cut Crossfade — planeja crossfade curto (5-25ms equal-power) em cada
// junção da EDL pra evitar click/pop. Item 10 da spec.
//
// A EDL/cortes NÃO são alterados — só emite decisões de crossfade que
// o audioMixer aplica na exportação.

import { makeDecision } from "./audioTimeline.js";

const DEFAULT_FADE_MS = 12;
const MAX_FADE_MS = 25;

/**
 * @param {Array} segments  - segments com {start, end, deleted}
 * @param {object} [opts]
 * @param {number} [opts.fadeMs=12]
 * @returns {import("./audioTimeline.js").AudioDecision[]}
 */
export function planCutCrossfades(segments = [], { fadeMs = DEFAULT_FADE_MS } = {}) {
  const active = segments.filter((s) => !s.deleted).sort((a, b) => a.start - b.start);
  const decisions = [];
  const halfFade = Math.min(MAX_FADE_MS, fadeMs) / 2 / 1000;

  for (let i = 1; i < active.length; i++) {
    const prev = active[i - 1];
    const cur = active[i];
    // Só emite crossfade se houve corte real (gap ou trim)
    if (Math.abs(cur.start - prev.end) < 0.001) continue;

    // Crossfade fica CENTRADO no ponto de corte (do lado do output, i.e. tempo relativo à edição final)
    const cutPointT = cur.start; // referência: início do próximo segmento no source
    decisions.push(makeDecision({
      type: "crossfade",
      start: Math.max(0, cutPointT - halfFade),
      end: cutPointT + halfFade,
      intensity: 1,
      reason: `junção ${prev.end.toFixed(2)}s → ${cur.start.toFixed(2)}s`,
      confidence: 0.95,
      params: {
        fadeMs: fadeMs,
        curve: "equal_power",
        joinFromEnd: prev.end,
        joinToStart: cur.start,
      },
    }));
  }
  return decisions;
}
