// QC Report — consolida Issues + calcula PASS/REVIEW/FAIL + monta relatório
// no formato do Item 39 da Fase 5.
//
// Thresholds default (Item 35):
//   90-100 = PASS
//   75-89  = REVIEW
//   0-74   = FAIL
//   QUALQUER CRITICAL = FAIL independente da média

import { SEVERITY, severityRank } from "./qcSeverity.js";

export const QC_STATUS = { PASS: "PASS", REVIEW: "REVIEW", FAIL: "FAIL" };

export const DEFAULT_THRESHOLDS = {
  pass: 90,
  review: 75,
};

/**
 * @typedef {Object} QCIssue
 * @property {string} type
 * @property {"info"|"low"|"medium"|"high"|"critical"} severity
 * @property {number|null} start
 * @property {number|null} end
 * @property {string} description
 * @property {boolean} auto_fixable
 * @property {object} params
 * @property {string} checker
 * @property {boolean} fixed
 */

/**
 * @typedef {Object} QCDimensionScores
 * @property {number} speech_integrity
 * @property {number} cuts
 * @property {number} narrative
 * @property {number} audio
 * @property {number} visual
 * @property {number} captions
 * @property {number} broll
 * @property {number} music
 * @property {number} technical
 */

const DIMENSION_WEIGHTS = {
  speech_integrity: 0.20,
  cuts:             0.15,
  narrative:        0.10,
  audio:            0.15,
  visual:           0.10,
  captions:         0.08,
  broll:            0.10,
  music:            0.05,
  technical:        0.07,
};

/**
 * Calcula scores por dimensão a partir das issues.
 * Cada checker é mapeado a uma dimensão.
 */
const CHECKER_TO_DIM = {
  speechIntegrity:    "speech_integrity",
  cutQuality:         "cuts",
  semanticContinuity: "narrative",
  narrative:          "narrative",
  hook:               "narrative",
  cta:                "narrative",
  sync:               "audio",
  audioFinal:         "audio",
  audioContinuity:    "audio",
  music:              "music",
  sfx:                "music",
  caption:            "captions",
  captionPosition:    "captions",
  textOverlay:        "captions",
  face:               "visual",
  product:            "visual",
  blackFrame:         "visual",
  freezeFrame:        "visual",
  duplicateFrame:     "visual",
  visualContinuity:   "visual",
  visualDensity:      "visual",
  zoom:               "visual",
  reframe:            "visual",
  transition:         "visual",
  broll:              "broll",
  brollHallucination: "broll",
  safeArea:           "technical",
  mediaIntegrity:     "technical",
  resolution:         "technical",
  deadAir:            "audio",
};

const SEVERITY_PENALTY = {
  info: 0, low: 2, medium: 6, high: 15, critical: 40,
};

/**
 * Agrupa issues por dimensão e calcula score (100 - soma penalidades, floor 0).
 */
export function computeDimensionScores(issues = []) {
  const dims = Object.fromEntries(Object.keys(DIMENSION_WEIGHTS).map((k) => [k, 100]));
  for (const iss of issues) {
    const dim = CHECKER_TO_DIM[iss.checker] || "technical";
    const penalty = SEVERITY_PENALTY[iss.severity] || 0;
    dims[dim] = Math.max(0, dims[dim] - penalty);
  }
  return dims;
}

/**
 * Média ponderada dos scores dimensionais.
 */
export function computeFinalScore(dims) {
  let total = 0;
  for (const [k, w] of Object.entries(DIMENSION_WEIGHTS)) {
    total += (dims[k] ?? 100) * w;
  }
  return Math.round(total);
}

/**
 * Retorna PASS/REVIEW/FAIL segundo score + regra CRITICAL.
 */
export function computeStatus(score, issues, thresholds = DEFAULT_THRESHOLDS) {
  const hasCritical = issues.some((i) => i.severity === SEVERITY.CRITICAL && !i.fixed);
  if (hasCritical) return QC_STATUS.FAIL;
  if (score >= thresholds.pass) return QC_STATUS.PASS;
  if (score >= thresholds.review) return QC_STATUS.REVIEW;
  return QC_STATUS.FAIL;
}

/**
 * Monta o QC Report completo (formato Item 39).
 * @param {QCIssue[]} issues
 * @param {object} [opts]
 * @returns {object}
 */
export function buildQCReport(issues = [], opts = {}) {
  const dims = computeDimensionScores(issues);
  const finalScore = computeFinalScore(dims);
  const status = computeStatus(finalScore, issues, opts.thresholds);
  const counts = {
    critical: issues.filter((i) => i.severity === SEVERITY.CRITICAL).length,
    high:     issues.filter((i) => i.severity === SEVERITY.HIGH).length,
    medium:   issues.filter((i) => i.severity === SEVERITY.MEDIUM).length,
    low:      issues.filter((i) => i.severity === SEVERITY.LOW).length,
    info:     issues.filter((i) => i.severity === SEVERITY.INFO).length,
    total:    issues.length,
    autoFixable: issues.filter((i) => i.auto_fixable && !i.fixed).length,
    fixed:    issues.filter((i) => i.fixed).length,
  };
  const sortedIssues = [...issues].sort((a, b) => severityRank(b.severity) - severityRank(a.severity) || (a.start ?? 0) - (b.start ?? 0));
  return {
    final_score: finalScore,
    status,
    dimensions: dims,
    critical: counts.critical,
    high: counts.high,
    medium: counts.medium,
    low: counts.low,
    info: counts.info,
    issues: sortedIssues,
    counts,
    generatedAt: new Date().toISOString(),
  };
}
