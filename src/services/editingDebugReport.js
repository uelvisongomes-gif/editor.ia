// Editing Debug Report — gera timeline técnica em TEXTO (pra copiar) e
// JSON (pra comparação automática entre versões).
//
// Não modifica nada. Reutiliza segments + zoomEvents + narrative + integrity.

/**
 * Formata segundos como MM:SS.mmm
 */
function fmt(t) {
  if (!Number.isFinite(t)) return "??:??.???";
  const mm = Math.floor(t / 60);
  const ss = t - mm * 60;
  return `${String(mm).padStart(2, "0")}:${ss.toFixed(2).padStart(5, "0")}`;
}

const LEVEL_LABEL = {
  light: "SUAVE",
  medium: "MODERADO",
  strong: "FORTE",
  out: "ZOOM_OUT",
};

/**
 * Gera o JSON estruturado (source of truth) — o texto é derivado dele.
 * @param {object} args
 * @param {Array} args.segments
 * @param {Array} args.zoomEvents
 * @param {object} [args.integrity]
 * @param {number} args.duration
 * @returns {{events:Array, meta:{duration:number, cuts:number, zooms:number}}}
 */
export function buildDebugReport({ segments = [], zoomEvents = [], integrity, duration = 0 } = {}) {
  const events = [];

  const activeSegs = segments.filter((s) => !s.deleted && s.action !== "review" && s.action !== "trim")
                             .sort((a, b) => a.start - b.start);
  const removedSegs = segments.filter((s) => s.deleted).sort((a, b) => a.start - b.start);

  // CUTS: junções entre segments ativos consecutivos.
  for (let i = 0; i < removedSegs.length; i++) {
    const r = removedSegs[i];
    events.push({
      kind: "CUT",
      t: r.start,
      end: r.end,
      duration: r.end - r.start,
      reason: r.reason || r.removalReason || "removed",
      confidence: typeof r.confidence === "number" ? r.confidence : null,
    });
  }

  // ZOOMS
  for (const z of zoomEvents) {
    events.push({
      kind: "ZOOM",
      t: z.start,
      end: z.end,
      duration: z.end - z.start,
      mode: z.mode || "zoom_in",
      level: z.level || "light",
      scale: z.scale,
      trigger: z.reason || (z.isTransition ? "after_cut" : "semantic"),
      text: z.text || "",
      confidence: z.confidence ?? null,
      fadeIn: z.fadeIn ?? null,
      fadeOut: z.fadeOut ?? null,
      sentenceIndex: z.sentenceIndex ?? null,
    });
  }

  events.sort((a, b) => a.t - b.t);

  return {
    events,
    meta: {
      duration,
      cuts: events.filter((e) => e.kind === "CUT").length,
      zooms: events.filter((e) => e.kind === "ZOOM").length,
      activeDuration: activeSegs.reduce((a, s) => a + (s.end - s.start), 0),
    },
    integrity: integrity || null,
  };
}

/**
 * Formata como texto pra copiar. Exemplo:
 *
 *   00:03.20 ✂ CUT      silence          conf=0.90
 *   00:03.20–00:06.10 🔍 ZOOM   moderado 1.20  after_cut       "…quando cristo veio…"
 */
export function reportToText(report) {
  const lines = [];
  const { meta, events, integrity } = report;
  lines.push(`# Timeline técnica — duração ${meta.duration.toFixed(1)}s (ativa ${meta.activeDuration.toFixed(1)}s)`);
  lines.push(`# ${meta.cuts} cortes · ${meta.zooms} zooms`);
  if (integrity) {
    lines.push(`# Integridade: ${integrity.summary.errors} errors · ${integrity.summary.warnings} warnings · ${integrity.summary.infos} infos`);
  }
  lines.push("");

  for (const ev of events) {
    if (ev.kind === "CUT") {
      const conf = ev.confidence != null ? ` conf=${ev.confidence.toFixed(2)}` : "";
      lines.push(`${fmt(ev.t)}  CUT       ${(ev.reason || "").padEnd(18)}${conf}   (${ev.duration.toFixed(2)}s removidos)`);
    } else if (ev.kind === "ZOOM") {
      const level = LEVEL_LABEL[ev.level] || ev.level;
      const scale = `x${ev.scale.toFixed(2)}`;
      const trig = ev.trigger || "-";
      const text = ev.text ? ` "${ev.text.slice(0, 60)}${ev.text.length > 60 ? "…" : ""}"` : "";
      const fade = ev.fadeOut != null ? ` fadeOut=${ev.fadeOut.toFixed(2)}s` : "";
      lines.push(`${fmt(ev.t)}–${fmt(ev.end)}  ZOOM  ${level.padEnd(9)} ${scale}  ${trig.padEnd(20)}${fade}${text}`);
    }
  }

  if (integrity) {
    if (integrity.errors.length) {
      lines.push("");
      lines.push("# Errors:");
      for (const e of integrity.errors) lines.push(`  ✖ ${fmt(e.at)} [${e.code}] ${e.message}`);
    }
    if (integrity.warnings.length) {
      lines.push("");
      lines.push("# Warnings:");
      for (const w of integrity.warnings) lines.push(`  ⚠ ${fmt(w.at)} [${w.code}] ${w.message}`);
    }
    if (integrity.infos.length) {
      lines.push("");
      lines.push("# Infos:");
      for (const i of integrity.infos) lines.push(`  · ${fmt(i.at)} [${i.code}] ${i.message}`);
    }
  }

  return lines.join("\n");
}
