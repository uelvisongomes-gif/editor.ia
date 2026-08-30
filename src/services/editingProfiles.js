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
    // SmartZoom — alvo por 30s. Leve = 1-2 zooms curtos e leves.
    zoomTargetPer30s: 1.5,
    zoomMaxEvents: 6,
    zoomMinGapSec: 10,
    zoomFadeSec: 0.15,
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
    // Alvo 3-4 zooms / 30s no equilibrada.
    zoomTargetPer30s: 3.5,
    zoomMaxEvents: 14,
    zoomMinGapSec: 6,
    zoomFadeSec: 0.15,
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
    executeThresholdSemantic: 0.82,
    reviewThreshold: 0.55,
    detectionThreshold: 0.40,
    maxTechnicalCutDur: 8.0,
    maxSemanticCutDur: 12.0,
    preserveRoles: ["hook", "cta"],
    zoomTargetPer30s: 5,
    zoomMaxEvents: 20,
    zoomMinGapSec: 4,
    zoomFadeSec: 0.12,
  },
  // ============================================================
  // 4 NOVOS MODOS DA FASE 3 (Item 19)
  // ============================================================
  profissional: {
    id: "profissional",
    label: "Profissional",
    description: "Visual limpo, transições suaves. Ideal p/ empresas, LinkedIn, treinamentos.",
    silenceThreshold: 0.020,
    minSilenceDur: 0.9,
    removeSpeechErrors: true,
    removeRepeats: true,
    removeOffTopic: true,
    trimLowImportance: false,
    executeThreshold: 0.85,                // conservador — sem cortes agressivos
    executeThresholdSemantic: 0.92,
    reviewThreshold: 0.65,
    detectionThreshold: 0.45,
    maxTechnicalCutDur: 4.0,
    maxSemanticCutDur: 6.0,
    preserveRoles: ["hook", "cta", "conclusion", "solution"],
    zoomTargetPer30s: 1.0,                 // pouco zoom, elegante
    zoomMaxEvents: 4,
    zoomMinGapSec: 12,
    zoomFadeSec: 0.20,                     // fades mais longos
  },
  podcast: {
    id: "podcast",
    label: "Podcast",
    description: "Prioridade absoluta pra fala. Corta erros/pausas, quase nenhum efeito.",
    silenceThreshold: 0.025,
    minSilenceDur: 0.6,
    removeSpeechErrors: true,
    removeRepeats: true,
    removeOffTopic: false,                 // podcast pode ter tangentes válidas
    trimLowImportance: false,
    executeThreshold: 0.78,
    executeThresholdSemantic: 0.90,        // semântico stricter — não corta ideias
    reviewThreshold: 0.60,
    detectionThreshold: 0.45,
    maxTechnicalCutDur: 3.0,
    maxSemanticCutDur: 5.0,
    preserveRoles: ["hook", "problem", "solution", "cta", "conclusion", "context"],
    zoomTargetPer30s: 0.3,                 // quase zero — foco na fala
    zoomMaxEvents: 2,
    zoomMinGapSec: 20,
    zoomFadeSec: 0.25,
  },
  tiktokshop: {
    id: "tiktokshop",
    label: "TikTok Shop",
    description: "Produto + benefício + preço + CTA. Nunca corta demonstração.",
    silenceThreshold: 0.025,
    minSilenceDur: 0.5,
    removeSpeechErrors: true,
    removeRepeats: true,
    removeOffTopic: true,
    trimLowImportance: true,
    executeThreshold: 0.75,
    executeThresholdSemantic: 0.85,
    reviewThreshold: 0.58,
    detectionThreshold: 0.42,
    maxTechnicalCutDur: 6.0,
    maxSemanticCutDur: 8.0,
    // Preserva TUDO relacionado a produto/venda
    preserveRoles: ["hook", "cta", "point", "proof", "solution", "problem"],
    zoomTargetPer30s: 4,                   // zoom no produto/preço
    zoomMaxEvents: 18,
    zoomMinGapSec: 5,
    zoomFadeSec: 0.12,
  },
  tutorial: {
    id: "tutorial",
    label: "Tutorial",
    description: "Clareza + etapas + demonstrações. Preserva sequência e explicações.",
    silenceThreshold: 0.022,
    minSilenceDur: 0.8,
    removeSpeechErrors: true,
    removeRepeats: true,
    removeOffTopic: true,
    trimLowImportance: false,              // tutorial precisa das explicações
    executeThreshold: 0.82,
    executeThresholdSemantic: 0.90,
    reviewThreshold: 0.62,
    detectionThreshold: 0.45,
    maxTechnicalCutDur: 4.0,
    maxSemanticCutDur: 6.0,
    preserveRoles: ["hook", "context", "problem", "solution", "point", "proof", "conclusion"],
    zoomTargetPer30s: 2.5,                 // zoom em detalhes demonstrados
    zoomMaxEvents: 10,
    zoomMinGapSec: 7,
    zoomFadeSec: 0.18,
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
