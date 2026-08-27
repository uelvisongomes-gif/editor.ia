// Reference Profile — perfil de ESTILO extraído de um vídeo já editado
// profissionalmente. Serve pra calibrar como o CRIE Editor deve se
// comportar num vídeo bruto do usuário, imitando o RITMO/PADRÃO do
// vídeo referência (não copiando cortes literais).
//
// CONTRATO: um referenceProfile é um objeto com métricas normalizadas
// (por minuto, ou distribuições). Nunca com timestamps absolutos.
// Isso torna o profile REUTILIZÁVEL entre vídeos de duração diferente.
//
// COMO EXTRAIR (fora do editor):
//   1. Roda script separado com ffmpeg + PySceneDetect + face-detection
//      no MP4 do vídeo referência.
//   2. Script gera JSON no formato do schema abaixo.
//   3. Usuário sobe esse JSON como "estilo de referência" no editor.
//   4. Editor usa o profile pra calibrar cutDensityGuard, smartZoom,
//      caption position, etc.

/**
 * Schema oficial do reference profile.
 * @typedef {Object} ReferenceProfile
 * @property {string} name                       - identificador humano
 * @property {number} sourceDurationSec          - duração do vídeo original
 * @property {CutProfile} cuts
 * @property {ZoomProfile} zooms
 * @property {CaptionProfile} captions
 * @property {VisualChangeProfile} visual
 * @property {PacingProfile} pacing
 */

/**
 * @typedef {Object} CutProfile
 * @property {number} perMinute              - média de cortes/min
 * @property {number} averageDurationSec     - duração média entre cortes
 * @property {number} shortestCutSec         - menor jump cut
 * @property {number} longestCutSec          - maior jump cut
 * @property {Object} distribution           - { microcut, short, medium, long } %
 */

/**
 * @typedef {Object} ZoomProfile
 * @property {number} perMinute              - eventos de zoom por min
 * @property {number} averageDurationSec     - duração média do zoom (in→hold→out)
 * @property {number} averageIntensity       - scale médio (1.0-2.0)
 * @property {Object} distribution           - { light, medium, strong } %
 * @property {"progressive"|"instant"} easing - tipo predominante
 */

/**
 * @typedef {Object} CaptionProfile
 * @property {"top"|"middle-bottom"|"bottom"|"above-subject"|"auto"} preferredPosition
 * @property {number} averageWordsPerCue     - typical chunk size
 * @property {number} averageDurationSec     - typical cue duration
 * @property {boolean} usesHighlight         - word-level emphasis?
 * @property {string} preferredStyleId       - one of CAPTION_STYLES ids
 */

/**
 * @typedef {Object} VisualChangeProfile
 * @property {number} changesPerMinute       - inclui zoom, corte, caption emphasis
 * @property {number} averageIntervalSec     - média entre estímulos visuais
 * @property {number} maxDeadIntervalSec     - maior interval sem mudança
 */

/**
 * @typedef {Object} PacingProfile
 * @property {number} averageWordsPerMinute  - taxa de fala mantida
 * @property {number} averageSentenceDurationSec
 * @property {"hookHeavy"|"balanced"|"conclusionHeavy"} shape - onde tem mais ênfase
 */

/**
 * Profile default — usado quando nenhum reference profile foi carregado.
 * Baseado em comportamento típico de conteúdo social educativo de 1-5min.
 */
export const DEFAULT_PROFILE = {
  name: "default-balanced",
  sourceDurationSec: 180,
  cuts: {
    perMinute: 8,
    averageDurationSec: 7.5,
    shortestCutSec: 0.3,
    longestCutSec: 3.5,
    distribution: { microcut: 5, short: 45, medium: 40, long: 10 },
  },
  zooms: {
    perMinute: 3,
    averageDurationSec: 4,
    averageIntensity: 1.25,
    distribution: { light: 40, medium: 45, strong: 15 },
    easing: "progressive",
  },
  captions: {
    preferredPosition: "middle-bottom",
    averageWordsPerCue: 6,
    averageDurationSec: 1.8,
    usesHighlight: true,
    preferredStyleId: "bold",
  },
  visual: {
    changesPerMinute: 15,
    averageIntervalSec: 4,
    maxDeadIntervalSec: 8,
  },
  pacing: {
    averageWordsPerMinute: 160,
    averageSentenceDurationSec: 5,
    shape: "balanced",
  },
};

/**
 * Valida um profile carregado do disco (ou upload). Faz merge com
 * DEFAULT_PROFILE pra preencher campos ausentes.
 */
export function loadProfile(raw) {
  if (!raw || typeof raw !== "object") return DEFAULT_PROFILE;
  return {
    name: raw.name || "unknown",
    sourceDurationSec: raw.sourceDurationSec || 180,
    cuts: { ...DEFAULT_PROFILE.cuts, ...(raw.cuts || {}) },
    zooms: { ...DEFAULT_PROFILE.zooms, ...(raw.zooms || {}) },
    captions: { ...DEFAULT_PROFILE.captions, ...(raw.captions || {}) },
    visual: { ...DEFAULT_PROFILE.visual, ...(raw.visual || {}) },
    pacing: { ...DEFAULT_PROFILE.pacing, ...(raw.pacing || {}) },
  };
}

/**
 * Compara duas edições e devolve métricas de similaridade. Usada pra
 * medir se o CRIE Editor está reproduzindo o padrão do reference.
 *
 * @param {ReferenceProfile} reference
 * @param {Object} produced - saída do pipeline (cuts, zooms, captions...)
 * @returns {Object} deltas normalizados
 */
export function compareToReference(reference, produced) {
  const referenceCutsPerMin = reference.cuts.perMinute;
  const producedCutsPerMin = (produced.cutCount / (produced.durationMin || 1));
  return {
    cutsDelta: producedCutsPerMin - referenceCutsPerMin,
    cutsRatio: producedCutsPerMin / (referenceCutsPerMin || 1),
    zoomsDelta: (produced.zoomCount / (produced.durationMin || 1)) - reference.zooms.perMinute,
    withinAcceptableRange: Math.abs(producedCutsPerMin - referenceCutsPerMin) <= 3,
  };
}
