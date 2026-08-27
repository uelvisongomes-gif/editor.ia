// Editing Integrity Check — regras determinísticas que rodam depois do
// pipeline pra flagar problemas na edição sem bloquear preview.
//
// Não modifica nada. Retorna { warnings, errors, infos } que a UI usa
// pra exibir na aba "Integridade" do painel de diagnóstico.
//
// Regras:
//   1. Zoom sobreposto a outro zoom  (>0.3s overlap)   → ERROR
//   2. Zoom em segment deleted                          → ERROR
//   3. Zoom com duração < 1.5s (pulso curto)           → WARN
//   4. Gap > 15s sem cut nem zoom (buraco visual)       → WARN
//   5. Zoom scale fora de [1.05, 1.35]                  → INFO

const RULES = {
  overlapMinSec: 0.3,
  pulseThresholdSec: 1.5,
  visualGapMaxSec: 15.0,
  scaleMin: 1.05,
  scaleMax: 1.35,
};

/**
 * @param {object} args
 * @param {Array} args.segments        - segments compilados (com deleted flag)
 * @param {Array} args.zoomEvents      - zoomEvents
 * @param {number} args.duration       - duração do vídeo
 * @param {object} [args.rules]        - override das constantes
 * @returns {{warnings:Array, errors:Array, infos:Array, summary:{errors:number,warnings:number,infos:number}}}
 */
export function checkEditingIntegrity({ segments = [], zoomEvents = [], duration = 0, rules = {} } = {}) {
  const R = { ...RULES, ...rules };
  const errors = [];
  const warnings = [];
  const infos = [];

  const zooms = [...zoomEvents].sort((a, b) => a.start - b.start);

  // 1) zoom overlap
  for (let i = 0; i < zooms.length; i++) {
    for (let j = i + 1; j < zooms.length; j++) {
      const a = zooms[i], b = zooms[j];
      if (b.start >= a.end) break;
      const overlap = Math.min(a.end, b.end) - Math.max(a.start, b.start);
      if (overlap >= R.overlapMinSec) {
        errors.push({
          code: "zoom_overlap",
          message: `Zoom sobreposto (${overlap.toFixed(1)}s)`,
          at: b.start,
          refs: [a.id, b.id],
        });
      }
    }
  }

  // 2) zoom em segment deleted
  for (const z of zooms) {
    const seg = segments.find((s) => z.start >= s.start - 0.05 && z.start < s.end + 0.05);
    if (seg && (seg.deleted || seg.action === "trim")) {
      errors.push({
        code: "zoom_in_deleted",
        message: "Zoom cai em trecho removido",
        at: z.start,
        refs: [z.id],
      });
    }
  }

  // 3) pulso curto
  for (const z of zooms) {
    const dur = z.end - z.start;
    if (dur < R.pulseThresholdSec) {
      warnings.push({
        code: "zoom_pulse",
        message: `Zoom curto demais (${dur.toFixed(1)}s < ${R.pulseThresholdSec}s)`,
        at: z.start,
        refs: [z.id],
      });
    }
  }

  // 4) buraco visual sem cut nem zoom
  const activeSegs = segments.filter((s) => !s.deleted && s.action !== "review" && s.action !== "trim")
                             .sort((a, b) => a.start - b.start);
  if (activeSegs.length && zooms.length !== null) {
    const cutPoints = activeSegs.slice(1).map((s) => s.start);
    const zoomPoints = zooms.map((z) => z.start);
    const anchors = [
      activeSegs[0]?.start ?? 0,
      ...cutPoints,
      ...zoomPoints,
      activeSegs[activeSegs.length - 1]?.end ?? duration,
    ].sort((a, b) => a - b);
    for (let i = 0; i < anchors.length - 1; i++) {
      const gap = anchors[i + 1] - anchors[i];
      if (gap > R.visualGapMaxSec) {
        warnings.push({
          code: "visual_gap",
          message: `Gap de ${gap.toFixed(1)}s sem cut nem zoom`,
          at: anchors[i],
        });
      }
    }
  }

  // 5) scale fora da janela moderada
  for (const z of zooms) {
    if (z.mode !== "zoom_in") continue;
    if (z.scale < R.scaleMin || z.scale > R.scaleMax) {
      infos.push({
        code: "scale_out_of_range",
        message: `Zoom scale ${z.scale.toFixed(2)} fora de [${R.scaleMin}, ${R.scaleMax}]`,
        at: z.start,
        refs: [z.id],
      });
    }
  }

  return {
    errors,
    warnings,
    infos,
    summary: { errors: errors.length, warnings: warnings.length, infos: infos.length },
  };
}
