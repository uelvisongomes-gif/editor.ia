// Visual Timeline — log unificado de TODOS os eventos visuais em ordem
// cronológica. Consome cuts (segments), zoomEvents, captionEvents,
// broll (futuro), text overlays (futuro).
//
// Usado por:
//   - visualDirector (density check)
//   - QC visual (editingIntegrityCheck)
//   - UI (aba "Análise da IA")
//   - Debug report

/**
 * @typedef {Object} VisualEvent
 * @property {string} kind - "cut" | "zoom_in" | "zoom_out" | "caption" | "broll" | "text_overlay"
 * @property {number} start
 * @property {number} end
 * @property {string} [text]
 * @property {number} [confidence]
 * @property {string} [reason]
 * @property {any} [meta]
 */

/**
 * Constrói timeline unificado + resumo por tipo.
 */
export function buildVisualTimeline({ segments = [], zoomEvents = [], captionEvents = [], brollEvents = [], textOverlays = [] } = {}) {
  const events = [];

  for (const seg of segments) {
    if (seg.deleted) {
      events.push({
        kind: "cut",
        start: seg.start,
        end: seg.end,
        confidence: seg.confidence ?? null,
        reason: seg.reason || "cut",
        text: seg.text || "",
      });
    }
  }
  for (const z of zoomEvents) {
    events.push({
      kind: z.mode === "zoom_out" ? "zoom_out" : "zoom_in",
      start: z.start,
      end: z.end,
      confidence: z.confidence ?? null,
      reason: z.reason || "zoom",
      text: z.text || "",
      meta: { level: z.level, scale: z.scale, isTransition: !!z.isTransition },
    });
  }
  for (const c of captionEvents) {
    events.push({
      kind: "caption",
      start: c.start,
      end: c.end,
      text: c.text || "",
      meta: { words: c.words?.length, hasEmphasis: !!c.emphasisWordIdx },
    });
  }
  for (const b of brollEvents) {
    events.push({
      kind: "broll",
      start: b.start,
      end: b.end,
      text: b.query || "",
      confidence: b.confidence ?? null,
      reason: b.reason || "broll",
    });
  }
  for (const t of textOverlays) {
    events.push({
      kind: "text_overlay",
      start: t.start,
      end: t.end,
      text: t.text || "",
      meta: { style: t.style },
    });
  }

  events.sort((a, b) => a.start - b.start);

  // Contagem por tipo pra summary/density
  const counts = events.reduce((acc, e) => {
    acc[e.kind] = (acc[e.kind] || 0) + 1;
    return acc;
  }, {});

  return {
    events,
    counts,
    total: events.length,
  };
}

/**
 * Retorna densidade de eventos por janela deslizante (por minuto).
 * Útil pra QC saber se região tem excesso de estímulos.
 */
export function densityWindow(timeline, windowSec = 60) {
  const windows = [];
  const events = timeline.events;
  if (!events.length) return windows;
  const totalDur = events[events.length - 1].end;
  for (let t = 0; t < totalDur; t += windowSec / 2) {
    const from = t;
    const to = t + windowSec;
    const inWin = events.filter((e) => e.start >= from && e.start < to);
    windows.push({
      from, to,
      total: inWin.length,
      byKind: inWin.reduce((acc, e) => {
        acc[e.kind] = (acc[e.kind] || 0) + 1;
        return acc;
      }, {}),
    });
  }
  return windows;
}
