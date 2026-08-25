// Editing intensity profiles. Every threshold that steers a cut lives here —
// nothing hard-coded downstream. Three confidence bands drive the outcome:
//
//   confidence >= executeThreshold  → REMOVE (or TRIM) — the pipeline acts
//   reviewThreshold ≤ confidence <  → REVIEW — surfaced to the user, not cut
//   confidence < reviewThreshold    → dropped (segment stays as KEEP)
//
// Silence numbers are amplitude/duration thresholds fed to the waveform
// detector; the semantic flags gate which classes of remove-intents the EDL
// builder will even consider.

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
    executeThreshold: 0.85,
    reviewThreshold: 0.65,
    preserveRoles: ["hook", "conclusion", "cta"],
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
    executeThreshold: 0.80,
    reviewThreshold: 0.60,
    preserveRoles: ["hook", "cta"],
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
    executeThreshold: 0.72,
    reviewThreshold: 0.55,
    preserveRoles: ["hook", "cta"],
  },
};

export const DEFAULT_PROFILE_ID = "equilibrada";

export function getProfile(id) {
  return EDITING_PROFILES[id] || EDITING_PROFILES[DEFAULT_PROFILE_ID];
}
