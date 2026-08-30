// Quality Scoring — score dimensional do vídeo final (Fase 5).
// Não é um número decorativo — é a média ponderada de 6 dimensões
// calculadas a partir dos artefatos reais do pipeline.
//
// Dimensões:
//   speech_cleanup   — quantos erros/pausas foram corrigidos vs originais
//   cut_quality      — cortes limpos (sem cut-mid-word, tighten aplicado)
//   join_quality     — seams fluidos (cutEdgeCleanup, sem repetição)
//   caption_quality  — chunks bem dimensionados (2-6 palavras, hard cap 2 linhas)
//   visual_rhythm    — density adequada ao modo, pattern interrupts saudáveis
//   overediting_penalty — se excedeu density target, penaliza

/**
 * @typedef {Object} DimensionalScore
 * @property {number} speech_cleanup     - 0-100
 * @property {number} cut_quality        - 0-100
 * @property {number} join_quality       - 0-100
 * @property {number} caption_quality    - 0-100
 * @property {number} visual_rhythm      - 0-100
 * @property {number} overediting_penalty - 0-100 (100 = zero excesso)
 * @property {number} final              - 0-100 média ponderada
 * @property {string} label              - "Excelente", "Bom", etc
 */

const WEIGHTS = {
  speech_cleanup:   0.20,
  cut_quality:      0.20,
  join_quality:     0.20,
  caption_quality:  0.15,
  visual_rhythm:    0.15,
  overediting_penalty: 0.10,
};

/**
 * @param {object} args
 * @param {object} args.integrity   - editingIntegrityCheck output
 * @param {Array} args.segments
 * @param {Array} args.problemCandidates
 * @param {Array} args.zoomEvents
 * @param {Array} args.captions
 * @param {object} args.visualTimeline
 * @param {object} args.profile
 * @param {number} args.duration
 * @returns {DimensionalScore}
 */
export function computeQualityScore({ integrity, segments = [], problemCandidates = [], zoomEvents = [], captions = [], visualTimeline, profile, duration = 60 } = {}) {
  const errors = integrity?.errors || [];
  const warnings = integrity?.warnings || [];

  // 1) speech_cleanup — % de candidatos que viraram REMOVE
  const totalDetected = problemCandidates.length || 1;
  const removed = problemCandidates.filter((c) => c.finalAction === "remove" || c.finalAction === "trim").length;
  const cleanupRate = removed / totalDetected;
  const speechScore = Math.min(100, Math.round(cleanupRate * 100 + 20));

  // 2) cut_quality — sem word-mid cuts, tighten aplicado
  const cutMidWordErrors = errors.filter((e) => e.code === "cut_mid_word").length;
  const cutQuality = Math.max(0, 100 - cutMidWordErrors * 25);

  // 3) join_quality — cutEdgeCleanup aplicado, sem seams ruins
  //    Aproximação: se todos os REMOVE ficaram com duração razoável.
  const cuts = segments.filter((s) => s.deleted);
  const shortCuts = cuts.filter((c) => (c.end - c.start) < 0.2).length;
  const joinScore = Math.max(0, 100 - shortCuts * 15);

  // 4) caption_quality — chunks dentro do range 2-7, no orphan
  const badCaptions = captions.filter((c) => (c.words?.length || 0) > 8 || (c.end - c.start) < 0.5).length;
  const captionScore = Math.max(0, 100 - badCaptions * 10);

  // 5) visual_rhythm — density vs target do perfil
  const durMin = Math.max(1, duration / 60);
  const zoomsPerMin = zoomEvents.length / durMin;
  const targetPerMin = { leve: 3, equilibrada: 7, agressiva: 10, profissional: 2, podcast: 0.5, tiktokshop: 8, tutorial: 5 }[profile?.id] || 7;
  const rhythmDelta = Math.abs(zoomsPerMin - targetPerMin);
  const rhythmScore = Math.max(0, 100 - rhythmDelta * 8);

  // 6) overediting_penalty — pulse warnings + gaps warnings
  const pulseWarns = warnings.filter((w) => w.code === "zoom_pulse").length;
  const gapWarns = warnings.filter((w) => w.code === "visual_gap").length;
  const overedit = Math.max(0, 100 - (pulseWarns * 8) - (gapWarns * 5));

  const dims = {
    speech_cleanup: speechScore,
    cut_quality: cutQuality,
    join_quality: joinScore,
    caption_quality: captionScore,
    visual_rhythm: rhythmScore,
    overediting_penalty: overedit,
  };

  const final = Math.round(
    Object.entries(dims).reduce((sum, [k, v]) => sum + v * WEIGHTS[k], 0)
  );

  const label = final >= 90 ? "Excelente"
              : final >= 75 ? "Bom"
              : final >= 60 ? "Razoável"
              : final >= 40 ? "Precisa ajustes"
              : "Ruim";

  return { ...dims, final, label };
}
