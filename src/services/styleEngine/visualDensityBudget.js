// Visual Density Budget — Item 12.
// Cada estilo tem density: low/medium/medium_high/high com limites
// perMin + perTenSec. Este controlador PODA eventos que excedem.

import { DENSITY_LIMITS } from "./styleSchema.js";

/**
 * @param {TimelineEvent[]} events
 * @param {object} args
 * @param {"low"|"medium"|"medium_high"|"high"} args.density
 * @param {number} [args.maxEventsPerMin]
 * @param {number} args.duration
 * @returns {{ kept: TimelineEvent[], dropped: TimelineEvent[], summary: object }}
 */
export function applyDensityBudget(events = [], { density = "medium", maxEventsPerMin, duration = 60 } = {}) {
  const limits = DENSITY_LIMITS[density] || DENSITY_LIMITS.medium;
  const perMinCap = maxEventsPerMin ?? limits.perMin;
  const perTenSecCap = limits.perTenSec;

  const sorted = [...events].sort((a, b) => a.start - b.start);
  const kept = [];
  const dropped = [];

  // Sliding window de 10s
  for (const evt of sorted) {
    // Legendas nao contam pro budget
    if (evt.category === "caption") { kept.push(evt); continue; }
    const inLast10s = kept.filter((k) => k.category !== "caption" && evt.start - k.start < 10);
    const inLastMin = kept.filter((k) => k.category !== "caption" && evt.start - k.start < 60);
    if (inLast10s.length >= perTenSecCap) {
      // Se novo evento tem score MAIOR que o de menor score na janela, swap
      const worst = inLast10s.reduce((min, e) => scoreEvt(e) < scoreEvt(min) ? e : min, inLast10s[0]);
      if (scoreEvt(evt) > scoreEvt(worst)) {
        const idx = kept.findIndex((k) => k.id === worst.id);
        if (idx >= 0) { kept.splice(idx, 1); dropped.push({ ...worst, droppedBy: evt.id, reason: "density_swap_10s" }); }
        kept.push(evt);
      } else {
        dropped.push({ ...evt, reason: "density_cap_10s" });
      }
      continue;
    }
    if (inLastMin.length >= perMinCap) {
      dropped.push({ ...evt, reason: "density_cap_min" });
      continue;
    }
    kept.push(evt);
  }

  return {
    kept, dropped,
    summary: {
      density, perMinCap, perTenSecCap,
      inputTotal: events.length,
      outputTotal: kept.length,
      droppedCount: dropped.length,
      effectiveDensityPerMin: kept.filter((k) => k.category !== "caption").length / Math.max(0.1, duration / 60),
    },
  };
}

function scoreEvt(e) {
  const cat = { caption: 9, camera: 10, media: 8, text: 7, graphic: 6, zoom: 5, transition: 4, special: 3, sfx: 2 }[e.category] || 0;
  return cat + (e.confidence ?? 0.5) * 3;
}

/**
 * Aplica cooldowns por categoria — evita dois zooms consecutivos < cooldown
 */
export function applyCooldowns(events = [], cooldowns = {}) {
  const sorted = [...events].sort((a, b) => a.start - b.start);
  const kept = [];
  const dropped = [];
  const lastByCat = {};
  for (const evt of sorted) {
    if (evt.category === "caption") { kept.push(evt); continue; }
    const cat = mapCatToCooldown(evt.category);
    const cd = cooldowns[cat];
    if (cd != null && lastByCat[cat] != null) {
      const gap = evt.start - lastByCat[cat];
      if (gap < cd) {
        dropped.push({ ...evt, reason: `cooldown_${cat}_${gap.toFixed(2)}s` });
        continue;
      }
    }
    lastByCat[cat] = evt.start;
    kept.push(evt);
  }
  return { kept, dropped };
}

function mapCatToCooldown(category) {
  if (category === "zoom") return "zoom";
  if (category === "text" || category === "graphic") return "text";
  if (category === "media") return "broll";
  if (category === "transition") return "transition";
  if (category === "sfx") return "sfx";
  return "text";
}
