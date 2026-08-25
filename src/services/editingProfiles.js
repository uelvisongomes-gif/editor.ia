// Editing intensity profiles. Same shape for all three so the pipeline just
// switches on `profile.id`. `equilibrada` is the default per spec.
//
// Fields:
//   silenceThreshold   — amplitude below which a bucket counts as silent
//   minSilenceDur      — pauses shorter than this stay in
//   removeSpeechErrors — cut stutters/false starts/filler chains
//   removeRepeats      — remove worse takes when the LLM groups repeated ideas
//   removeOffTopic     — cut sentences classified as off_topic
//   trimLowImportance  — mark low-importance development sentences as "trim"
//   reviewThreshold    — confidence below this becomes action=review (asks user)
//   preserveRoles      — never auto-remove sentences with these narrative roles

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
    reviewThreshold: 0.6,
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
    reviewThreshold: 0.5,
    preserveRoles: ["hook", "cta"],
  },
};

export const DEFAULT_PROFILE_ID = "equilibrada";

export function getProfile(id) {
  return EDITING_PROFILES[id] || EDITING_PROFILES[DEFAULT_PROFILE_ID];
}
