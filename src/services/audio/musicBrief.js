// Music Brief — briefing estruturado (Item 17) que agrega style + BPM +
// mood + intro/outro + speech_priority. Alimenta o Music Provider Adapter.

/**
 * @typedef {Object} MusicBrief
 * @property {string} style
 * @property {number} bpm
 * @property {string} mood
 * @property {boolean} vocals
 * @property {"low"|"medium"|"high"} energy
 * @property {number} duration
 * @property {"subtle"|"punchy"|"fade_in"} intro
 * @property {"maintain"|"reduce"|"increase"|"end_bang"} cta_energy
 * @property {boolean} speech_priority
 * @property {string[]} keywords
 * @property {string} rationale
 */

/**
 * @param {object} args
 * @param {import("./musicStyleAnalyzer.js").MusicStyle} args.style
 * @param {{ bpm: number }} args.bpmSel
 * @param {number} args.duration
 * @param {object} args.narrative
 * @returns {MusicBrief}
 */
export function buildMusicBrief({ style, bpmSel, duration, narrative } = {}) {
  if (!style || !bpmSel) return null;

  const timeline = narrative?.timeline || [];
  const hasCTA = timeline.some((t) => t.role === "cta");
  const hasHook = timeline.some((t) => t.role === "hook");
  const criticalCount = timeline.filter((t) => t.importance === "critical").length;

  // Intro: se tem hook forte, intro subtle (não competir); senão punchy
  const intro = hasHook ? "subtle" : "punchy";

  // CTA energy: se tem CTA e é modo motivational/viral → increase
  const cta_energy = hasCTA && (style.mood === "motivational" || style.mood === "energetic" || style.mood === "upbeat")
    ? "increase"
    : hasCTA && style.energy === "low"
      ? "maintain"
      : "reduce";

  return {
    style: style.style,
    bpm: bpmSel.bpm,
    mood: style.mood,
    vocals: style.vocals,
    energy: style.energy,
    duration: Math.round(duration),
    intro,
    cta_energy,
    speech_priority: true,
    keywords: style.keywords,
    rationale: [
      style.rationale,
      bpmSel.rationale,
      hasHook ? "intro subtle (hook)" : "intro punchy",
      hasCTA ? `CTA: ${cta_energy}` : "sem CTA",
      criticalCount ? `${criticalCount} momentos críticos` : "",
    ].filter(Boolean).join(" · "),
  };
}
