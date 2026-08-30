// Sound Design — catálogo de SFX e decisões automáticas de quando usar.
// Items 26, 27, 28 da spec. Não gera áudio — só emite decisões apontando
// pra placeholders que o export pode substituir por samples reais.
//
// Density por modo:
//   Natural, Profissional, Tutorial → LOW
//   Podcast → VERY_LOW
//   Dinâmico, TikTokShop → MEDIUM
//   Viral → HIGH

import { makeDecision } from "./audioTimeline.js";

export const SFX_CATALOG = {
  whoosh:       { url: null, category: "transition", volumeDb: -12 },
  click:        { url: null, category: "ui",         volumeDb: -18 },
  pop:          { url: null, category: "ui",         volumeDb: -16 },
  impact:       { url: null, category: "accent",     volumeDb: -8  },
  riser:        { url: null, category: "buildup",    volumeDb: -10 },
  swipe:        { url: null, category: "transition", volumeDb: -14 },
  notification: { url: null, category: "ui",         volumeDb: -14 },
};

const DENSITY_BY_MODE = {
  natural:      "low",
  equilibrada:  "low",
  profissional: "low",
  tutorial:     "low",
  podcast:      "very_low",
  dinamico:     "medium",
  tiktokshop:   "medium",
  viral:        "high",
};

const DENSITY_LIMITS = {
  very_low: { perMinute: 0.5, categories: [] },
  low:      { perMinute: 2,   categories: ["ui", "accent"] },
  medium:   { perMinute: 5,   categories: ["ui", "accent", "transition"] },
  high:     { perMinute: 10,  categories: ["ui", "accent", "transition", "buildup"] },
};

/**
 * Decide onde colocar SFX baseado em: transições, graphics, patternInterrupts,
 * pontos de CTA/hook, respeitando density do modo.
 *
 * @param {object} args
 * @param {object} args.profile
 * @param {object} args.transitionPlan
 * @param {object} args.graphicsPlan
 * @param {object} args.patternInterrupts
 * @param {object} args.narrative
 * @param {number} args.duration
 * @returns {import("./audioTimeline.js").AudioDecision[]}
 */
export function planSoundDesign({
  profile, transitionPlan, graphicsPlan, patternInterrupts, narrative, duration = 60,
} = {}) {
  const density = DENSITY_BY_MODE[profile?.id] || "low";
  const limits = DENSITY_LIMITS[density];
  if (density === "very_low") return [];

  const candidates = [];

  // 1. Transições marcadas como "motion"/"jump_treated" → whoosh
  for (const tr of transitionPlan?.transitions || []) {
    if (["motion", "jump_treated"].includes(tr.kind)) {
      candidates.push({
        t: tr.t,
        sfx: "whoosh",
        reason: `${tr.kind} transition`,
        priority: 0.7,
      });
    }
  }

  // 2. Graphics text_overlay entrando → pop
  for (const g of graphicsPlan?.overlays || []) {
    if (g.kind === "text_overlay") {
      candidates.push({
        t: g.start,
        sfx: "pop",
        reason: "text overlay in",
        priority: 0.6,
      });
    } else if (g.kind === "big_number") {
      candidates.push({
        t: g.start,
        sfx: "impact",
        reason: "big number reveal",
        priority: 0.9,
      });
    }
  }

  // 3. CTA arriving → riser antes + impact no start
  const timeline = narrative?.timeline || [];
  for (const item of timeline) {
    if (item.role === "cta" && item.importance !== "low") {
      candidates.push({
        t: Math.max(0, item.start - 0.8),
        sfx: "riser",
        reason: "buildup pre-CTA",
        priority: 0.85,
      });
    }
  }

  // 4. Pattern interrupts → swipe
  for (const pi of patternInterrupts?.suggestions || []) {
    candidates.push({
      t: pi.t || pi.start,
      sfx: "swipe",
      reason: "pattern interrupt",
      priority: 0.5,
    });
  }

  // Filtra por categoria permitida
  const filtered = candidates.filter((c) => {
    const cat = SFX_CATALOG[c.sfx]?.category;
    return limits.categories.includes(cat);
  });

  // Dedupe por proximidade (200ms) + limite por minuto
  filtered.sort((a, b) => a.t - b.t || (b.priority - a.priority));
  const kept = [];
  const maxTotal = Math.ceil(limits.perMinute * (duration / 60));
  for (const c of filtered) {
    if (kept.length >= maxTotal) break;
    if (kept.some((k) => Math.abs(k.t - c.t) < 0.2)) continue;
    kept.push(c);
  }

  return kept.map((c) => {
    const entry = SFX_CATALOG[c.sfx];
    return makeDecision({
      type: "sfx",
      start: c.t,
      end: c.t + 0.4,
      intensity: 1,
      reason: `${c.sfx}: ${c.reason}`,
      confidence: c.priority,
      params: { sfxId: c.sfx, category: entry.category, volumeDb: entry.volumeDb },
    });
  });
}
