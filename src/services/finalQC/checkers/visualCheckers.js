// Visual Checkers — Items 17, 18, 19, 20, 29, 30.
// Face QC, Product QC, Zoom density, Reframe, Transition, Visual density.

import { makeIssue, SEVERITY } from "../qcSeverity.js";

export function checkFace({ faceRegions = [], segments = [], captions = [] } = {}) {
  const issues = [];
  const active = segments.filter((s) => !s.deleted);
  if (!faceRegions?.length) return issues;
  const inActive = (t) => active.some((s) => t >= s.start && t < s.end);
  // Face fora do frame ou muito perto da borda
  for (const region of faceRegions) {
    if (!inActive(region.t)) continue;
    for (const f of region.faces || []) {
      const x = f.x, y = f.y, w = f.w, h = f.h;
      // Se centro da face fora do frame (< 0 ou > 1)
      if (x < 0.05 || x > 0.95 || y < 0.05 || y > 0.95) {
        issues.push(makeIssue({
          type: "face_cropped",
          severity: SEVERITY.HIGH,
          start: region.t, end: region.t + 0.5,
          description: `Rosto quase fora do frame em ${region.t.toFixed(2)}s (x=${x.toFixed(2)}, y=${y.toFixed(2)})`,
          auto_fixable: true,
          params: { faceBox: f, action: "reframe" },
          checker: "face",
        }));
      }
      // Face muito grande (> 60% da altura) = zoom excessivo
      if (h > 0.6) {
        issues.push(makeIssue({
          type: "face_zoom_extreme",
          severity: SEVERITY.MEDIUM,
          start: region.t, end: region.t + 0.3,
          description: `Rosto ocupa ${(h * 100).toFixed(0)}% da altura — zoom excessivo`,
          auto_fixable: true,
          params: { faceBox: f, action: "reduce_zoom" },
          checker: "face",
        }));
      }
    }
  }
  return issues;
}

export function checkProduct({ productMoments, captions = [], graphicsPlan, brollPlan, segments = [] } = {}) {
  const issues = [];
  const moments = productMoments?.moments || [];
  if (!moments.length) return issues;
  const active = segments.filter((s) => !s.deleted);

  for (const m of moments) {
    // Produto foi removido pelos cortes?
    const survived = active.some((s) => m.start >= s.start && m.end <= s.end);
    if (!survived) {
      issues.push(makeIssue({
        type: "product_removed",
        severity: SEVERITY.CRITICAL,
        start: m.start, end: m.end,
        description: "Momento de produto removido pelos cortes",
        auto_fixable: false,
        params: { productMoment: m },
        checker: "product",
      }));
      continue;
    }
    // Legenda cobrindo produto? (heurística: se caption ativa nesse tempo E position === "middle" ou "top")
    const activeCaps = captions.filter((c) => c.start < m.end && c.end > m.start);
    if (activeCaps.length && activeCaps.some((c) => c.position === "middle")) {
      issues.push(makeIssue({
        type: "caption_covers_product",
        severity: SEVERITY.HIGH,
        start: m.start, end: m.end,
        description: "Legenda em posição média cobrindo produto",
        auto_fixable: true,
        params: { action: "move_caption_bottom" },
        checker: "product",
      }));
    }
    // B-roll cobrindo demonstração de produto?
    const activeBroll = (brollPlan?.suggestions || []).filter((b) => b.start < m.end && b.end > m.start);
    if (activeBroll.length && m.kind === "demonstration") {
      issues.push(makeIssue({
        type: "broll_covers_product_demo",
        severity: SEVERITY.HIGH,
        start: m.start, end: m.end,
        description: "B-roll ativo durante demonstração do produto",
        auto_fixable: true,
        params: { action: "remove_broll_here" },
        checker: "product",
      }));
    }
  }
  return issues;
}

export function checkZoomDensity({ zoomEvents = [], duration = 60, profile } = {}) {
  const issues = [];
  const durMin = Math.max(0.1, duration / 60);
  const perMin = zoomEvents.length / durMin;
  const targetMax = { natural: 5, equilibrada: 10, agressiva: 15, viral: 20, tiktokshop: 12, profissional: 3, podcast: 1, tutorial: 6 }[profile?.id] || 10;
  if (perMin > targetMax * 1.3) {
    issues.push(makeIssue({
      type: "zoom_excessive",
      severity: SEVERITY.MEDIUM,
      description: `${perMin.toFixed(1)} zooms/min excede ${targetMax} do modo ${profile?.id || "default"}`,
      auto_fixable: true,
      params: { perMin, targetMax, action: "reduce_zoom_count" },
      checker: "zoom",
    }));
  }
  // Zoom repetitivo (mesma escala 3+ vezes seguidas)
  let sameLevelStreak = 0;
  for (let i = 1; i < zoomEvents.length; i++) {
    if (zoomEvents[i].level === zoomEvents[i - 1].level) sameLevelStreak++;
    else sameLevelStreak = 0;
    if (sameLevelStreak >= 3) {
      issues.push(makeIssue({
        type: "zoom_repetitive",
        severity: SEVERITY.LOW,
        start: zoomEvents[i - 3].start,
        end: zoomEvents[i].end,
        description: "Zoom repetindo mesma escala 3+ vezes seguidas",
        auto_fixable: true,
        params: { level: zoomEvents[i].level, action: "vary_scale" },
        checker: "zoom",
      }));
      sameLevelStreak = 0;
    }
  }
  return issues;
}

export function checkTransitions({ transitionPlan, segments = [] } = {}) {
  const issues = [];
  const transitions = transitionPlan?.transitions || [];
  const cuts = segments.filter((s) => !s.deleted).length - 1;
  if (transitions.length > cuts + 1) {
    issues.push(makeIssue({
      type: "transitions_excessive",
      severity: SEVERITY.LOW,
      description: `${transitions.length} transições pra ${cuts} cortes`,
      auto_fixable: false,
      params: { count: transitions.length },
      checker: "transition",
    }));
  }
  for (const tr of transitions) {
    if (tr.durationSec > 1.2) {
      issues.push(makeIssue({
        type: "transition_too_long",
        severity: SEVERITY.LOW,
        start: tr.t, end: tr.t + tr.durationSec,
        description: `Transição de ${tr.durationSec.toFixed(2)}s — longa demais`,
        auto_fixable: true,
        params: { action: "cap_duration", target: 0.4 },
        checker: "transition",
      }));
    }
  }
  return issues;
}

export function checkVisualDensity({ zoomEvents = [], brollPlan, graphicsPlan, patternInterrupts, transitionPlan, duration = 60, profile } = {}) {
  const issues = [];
  const durMin = Math.max(0.1, duration / 60);
  const density = {
    zoom: zoomEvents.length,
    broll: brollPlan?.suggestions?.length || 0,
    text: graphicsPlan?.overlays?.length || 0,
    pattern: patternInterrupts?.interrupts?.length || 0,
    transitions: transitionPlan?.transitions?.length || 0,
  };
  const totalEvents = Object.values(density).reduce((a, b) => a + b, 0);
  const perMin = totalEvents / durMin;

  const maxPerMin = { viral: 40, dinamico: 25, tiktokshop: 30, tutorial: 15, natural: 12, equilibrada: 20, profissional: 10, podcast: 5 }[profile?.id] || 20;
  if (perMin > maxPerMin) {
    issues.push(makeIssue({
      type: "visual_overload",
      severity: SEVERITY.MEDIUM,
      description: `${perMin.toFixed(1)} eventos/min supera ${maxPerMin} do modo ${profile?.id}`,
      auto_fixable: true,
      params: { density, perMin, maxPerMin, action: "simplify" },
      checker: "visualDensity",
    }));
  }
  return issues;
}
