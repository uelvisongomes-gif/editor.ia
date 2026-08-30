// Loudness Normalizer — aplica ganho baseado no target LUFS da plataforma
// (Item 12). Presets configuráveis por plataforma.
//
// Referências:
//   Instagram/TikTok/YouTube: -14 LUFS integrated, -1 dBTP
//   Podcast Spotify:          -16 LUFS integrated
//   Broadcast:                -23 LUFS

import { makeDecision } from "./audioTimeline.js";
import { dbToGain } from "./loudnessAnalyzer.js";

export const LOUDNESS_PRESETS = {
  social:      { target: -14, truePeak: -1,  label: "Redes sociais (-14 LUFS)" },
  podcast:     { target: -16, truePeak: -1,  label: "Podcast (-16 LUFS)" },
  broadcast:   { target: -23, truePeak: -2,  label: "Broadcast TV (-23 LUFS)" },
  cinema:      { target: -27, truePeak: -2,  label: "Cinema (-27 LUFS)" },
  loud:        { target: -10, truePeak: -1,  label: "Comercial forte (-10 LUFS)" },
};

/**
 * Escolhe preset baseado na plataforma alvo.
 */
export function pickPreset(platformId = "instagram") {
  const map = {
    instagram: "social", tiktok: "social", youtube: "social", reels: "social",
    shorts: "social", feed: "social",
    podcast: "podcast", spotify: "podcast",
    tv: "broadcast",
  };
  return LOUDNESS_PRESETS[map[platformId] || "social"];
}

/**
 * @param {object} loudness  - loudnessAnalyzer.estimateLoudness()
 * @param {object} preset    - LOUDNESS_PRESETS[key]
 * @returns {{ gainDb: number, gainLinear: number, willClip: boolean, requiresLimiter: boolean }}
 */
export function computeNormalizationGain(loudness, preset) {
  const currentLufs = loudness?.estimatedLufs ?? -14;
  const gainDb = preset.target - currentLufs;
  const gainLinear = dbToGain(gainDb);
  // Se peak atual + gain excederia truePeak, precisa limiter
  const projectedPeakDb = (loudness?.peakDb ?? -1) + gainDb;
  const willClip = projectedPeakDb > 0;
  const requiresLimiter = projectedPeakDb > preset.truePeak;
  return { gainDb, gainLinear, willClip, requiresLimiter, projectedPeakDb };
}

/**
 * Emite decisão de gain aplicável no timeline (Item 30 / Item 12).
 */
export function planLoudnessNormalization({ loudness, preset, duration }) {
  if (!loudness || !preset || !Number.isFinite(duration)) return [];
  const { gainDb, requiresLimiter } = computeNormalizationGain(loudness, preset);
  if (Math.abs(gainDb) < 0.5 && !requiresLimiter) return [];
  const dec = [makeDecision({
    type: "gain",
    start: 0, end: duration,
    intensity: Math.min(1, Math.abs(gainDb) / 12),
    reason: `normalizar pra ${preset.target} LUFS (${gainDb > 0 ? "+" : ""}${gainDb.toFixed(1)} dB)`,
    confidence: 0.9,
    params: { gainDb, targetLufs: preset.target },
  })];
  if (requiresLimiter) {
    dec.push(makeDecision({
      type: "limiter",
      start: 0, end: duration,
      intensity: 1,
      reason: `true-peak protection ${preset.truePeak} dBTP`,
      confidence: 1,
      params: { thresholdDb: preset.truePeak },
    }));
  }
  return dec;
}
