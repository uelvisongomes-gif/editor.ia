// Music Transitions — evita música começando/terminando abruptamente (Item 24).
// Adiciona fade_in no início (0.8-1.5s) e fade_out no fim (2-3s), com
// possibilidade de fade_out no ponto de CTA se cta_energy === "end_bang".

import { makeDecision } from "./audioTimeline.js";

/**
 * @param {object} args
 * @param {number} args.duration
 * @param {import("./musicBrief.js").MusicBrief} args.brief
 * @param {object} args.narrative
 * @returns {import("./audioTimeline.js").AudioDecision[]}
 */
export function planMusicTransitions({ duration, brief, narrative } = {}) {
  if (!Number.isFinite(duration)) return [];
  const dec = [];
  // Fade-in
  const introDur = brief?.intro === "subtle" ? 1.5 : brief?.intro === "punchy" ? 0.4 : 1.0;
  dec.push(makeDecision({
    type: "music_fade",
    start: 0,
    end: introDur,
    intensity: 1,
    reason: `fade-in (${brief?.intro || "default"})`,
    confidence: 1,
    params: { direction: "in", durationSec: introDur, curve: "equal_power" },
  }));
  // Fade-out
  const outroDur = 2.5;
  dec.push(makeDecision({
    type: "music_fade",
    start: Math.max(0, duration - outroDur),
    end: duration,
    intensity: 1,
    reason: "fade-out final",
    confidence: 1,
    params: { direction: "out", durationSec: outroDur, curve: "equal_power" },
  }));
  return dec;
}
