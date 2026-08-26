// Editing intensity profiles. Every threshold that steers a cut lives here.
// Three confidence bands drive the outcome:
//
//   confidence >= executeThreshold  → REMOVE (or TRIM) — pipeline acts
//   reviewThreshold ≤ confidence <  → REVIEW — surfaced to the user, not cut
//   confidence < reviewThreshold    → dropped (segment stays as KEEP)
//
// Fase 2.1: SEMANTIC cuts (repeated_idea, off_topic, low_value) are held
// to a SEPARATE, stricter threshold than technical cuts (long_pause,
// stutter, filler, false_start, abandoned_phrase, self_correction). And
// every semantic cut has to pass contextGuard on top of the confidence
// check. The user's mandate: prefer keeping a few unnecessary seconds
// over an unsafe cut.

export const EDITING_PROFILES = {
  leve: {
    id: "leve",
    label: "Leve",
    description: "Remove só silêncios longos e erros de fala evidentes.",
    silenceThreshold: 0.015,
    minSilenceDur: 1.2,
    removeSpeechErrors: true,
    removeRepeats: false,
    removeOffTopic: false,
    trimLowImportance: false,
    executeThreshold: 0.85,                // technical cuts
    executeThresholdSemantic: 0.92,        // semantic cuts (stricter)
    reviewThreshold: 0.65,
    detectionThreshold: 0.45,
    // Duration caps: acima destas durações a IA nunca corta automaticamente,
    // mesmo com alta confiança — vira REVIEW. Cortes longos são
    // desproporcionalmente arriscados (removem contexto real).
    maxTechnicalCutDur: 4.0,
    maxSemanticCutDur: 6.0,
    preserveRoles: ["hook", "conclusion", "cta"],
    // SmartZoom — quantos eventos, gap mínimo e escala. Leve = poucos zooms.
    zoomMaxEvents: 3,
    zoomMinGapSec: 12,
    zoomScale: 1.05,
    zoomHoldSec: 1.6,
    zoomFadeSec: 0.35,
  },
  equilibrada: {
    id: "equilibrada",
    label: "Equilibrada",
    description: "Remove erros, silêncios, repetições claras e trechos fora do assunto.",
    silenceThreshold: 0.022,
    minSilenceDur: 0.7,
    removeSpeechErrors: true,
    removeRepeats: true,
    removeOffTopic: true,
    trimLowImportance: false,
    executeThreshold: 0.80,                // technical cuts
    executeThresholdSemantic: 0.88,        // semantic cuts (raised from 0.80)
    reviewThreshold: 0.60,
    detectionThreshold: 0.45,
    maxTechnicalCutDur: 5.0,
    maxSemanticCutDur: 8.0,
    preserveRoles: ["hook", "cta"],
    zoomMaxEvents: 6,
    zoomMinGapSec: 8,
    zoomScale: 1.07,
    zoomHoldSec: 1.8,
    zoomFadeSec: 0.35,
  },
  agressiva: {
    id: "agressiva",
    label: "Agressiva",
    description: "Transforma vídeos longos em versões enxutas e dinâmicas.",
    silenceThreshold: 0.03,
    minSilenceDur: 0.4,
    removeSpeechErrors: true,
    removeRepeats: true,
    removeOffTopic: true,
    trimLowImportance: true,
    executeThreshold: 0.72,                // technical cuts
    executeThresholdSemantic: 0.82,        // semantic cuts (raised from 0.72)
    reviewThreshold: 0.55,
    detectionThreshold: 0.40,
    maxTechnicalCutDur: 8.0,
    maxSemanticCutDur: 12.0,
    preserveRoles: ["hook", "cta"],
    zoomMaxEvents: 10,
    zoomMinGapSec: 5,
    zoomScale: 1.09,
    zoomHoldSec: 1.7,
    zoomFadeSec: 0.30,
  },
};

export const DEFAULT_PROFILE_ID = "equilibrada";

export function getProfile(id) {
  return EDITING_PROFILES[id] || EDITING_PROFILES[DEFAULT_PROFILE_ID];
}

// Which sources are considered "technical" — bypass contextGuard and use
// the plain executeThreshold. Everything else is treated as semantic and
// pays the semantic threshold + contextGuard check.
export const TECHNICAL_SOURCES = new Set(["silence", "speechError"]);
