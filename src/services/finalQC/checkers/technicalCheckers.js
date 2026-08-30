// Technical Checkers — Items 26, 32, 33.
// Safe Area, Media Integrity, Resolution.

import { makeIssue, SEVERITY } from "../qcSeverity.js";

// Safe areas em % de altura da tela (elementos importantes NÃO devem
// ficar nestas zonas — cobertas por UI da plataforma)
const SAFE_AREAS = {
  tiktok:   { topPct: 0,  bottomPct: 22, sidePct: 8  }, // legenda + botões laterais
  reels:    { topPct: 0,  bottomPct: 18, sidePct: 5  },
  shorts:   { topPct: 5,  bottomPct: 15, sidePct: 5  },
  feed:     { topPct: 0,  bottomPct: 8,  sidePct: 0  },
  youtube:  { topPct: 0,  bottomPct: 5,  sidePct: 0  },
};

export function checkSafeArea({ captions = [], graphicsPlan, platformId = "tiktok" } = {}) {
  const issues = [];
  const safe = SAFE_AREAS[platformId] || SAFE_AREAS.tiktok;
  const CAPTION_POS_PCT = { top: 15, middle: 55, bottom: 85 };
  for (const cap of captions) {
    const y = CAPTION_POS_PCT[cap.position || "bottom"] || 85;
    if (y > 100 - safe.bottomPct) {
      issues.push(makeIssue({
        type: "caption_in_safe_area",
        severity: SEVERITY.MEDIUM,
        start: cap.start, end: cap.end,
        description: `Legenda em ${y}% pode ficar coberta por UI ${platformId} (safe = <${100 - safe.bottomPct}%)`,
        auto_fixable: true,
        params: { platformId, action: "move_up", targetY: 100 - safe.bottomPct - 5 },
        checker: "safeArea",
      }));
    }
  }
  // Overlays (big_number/text_overlay) também devem respeitar safe area
  for (const ov of graphicsPlan?.overlays || []) {
    const y = ov.kind === "big_number" ? 18 : 28; // conforme App.jsx
    if (y > 100 - safe.bottomPct || y < safe.topPct) {
      issues.push(makeIssue({
        type: "overlay_in_safe_area",
        severity: SEVERITY.LOW,
        start: ov.start, end: ov.end,
        description: `Overlay "${ov.kind}" em ${y}% da tela pode ficar coberto`,
        auto_fixable: true,
        params: { platformId, action: "move_center" },
        checker: "safeArea",
      }));
    }
  }
  return issues;
}

export async function checkMediaIntegrity({ brollPlan, musicUrl, signal } = {}) {
  const issues = [];
  const suggestions = brollPlan?.suggestions || [];
  const mediaUrls = new Set();
  for (const s of suggestions) {
    for (const m of s.media || []) if (m.url) mediaUrls.add(m.url);
  }
  if (musicUrl) mediaUrls.add(musicUrl);
  if (!mediaUrls.size) return issues;

  // Testa max 10 URLs por HEAD (evita explodir latência)
  const toTest = Array.from(mediaUrls).slice(0, 10);
  const results = await Promise.all(toTest.map(async (url) => {
    try {
      const r = await fetch(url, { method: "HEAD", signal });
      return { url, ok: r.ok, status: r.status };
    } catch (err) {
      return { url, ok: false, status: 0, error: err.message };
    }
  }));
  for (const r of results.filter((x) => !x.ok)) {
    issues.push(makeIssue({
      type: "media_broken",
      severity: SEVERITY.HIGH,
      description: `Mídia inacessível (${r.status}): ${r.url.slice(0, 80)}...`,
      auto_fixable: false,
      params: { url: r.url, status: r.status },
      checker: "mediaIntegrity",
    }));
  }
  return issues;
}

export function checkResolution({ resolution = "1080p", platformId = "tiktok" } = {}) {
  const issues = [];
  // Recomendações mínimas por plataforma
  const MIN = { tiktok: 720, reels: 720, shorts: 720, feed: 720, youtube: 1080 };
  const resHeight = { "720p": 720, "1080p": 1080, "4K": 2160 }[resolution] || 720;
  const min = MIN[platformId] || 720;
  if (resHeight < min) {
    issues.push(makeIssue({
      type: "resolution_below_recommended",
      severity: SEVERITY.LOW,
      description: `Resolução ${resolution} abaixo do recomendado (${min}p) para ${platformId}`,
      auto_fixable: false,
      params: { platformId, current: resHeight, min },
      checker: "resolution",
    }));
  }
  return issues;
}
