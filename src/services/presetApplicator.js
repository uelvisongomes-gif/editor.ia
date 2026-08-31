// Preset Applicator — traduz um EditingStyleConfig em overrides pros
// módulos existentes do pipeline (não substitui — enriquece).
//
// Isso garante que trocar preset MUDA de fato:
//   - silenceRemoval → threshold de silêncio
//   - jumpCutIntensity → agressividade dos cortes
//   - zoomFrequency → maxZoomsPerMin
//   - zoomIntensity → escala do zoom
//   - captionStyle/position/animation → captionStyle no App
//   - transitionStyle/frequency → transições
//   - musicStyle/intensity → volume da música
//   - brollFrequency → chance de B-roll
//   - soundEffects → density de SFX
//   - hookEmphasis/ctaEmphasis → ênfase nos triggers

/**
 * Aplica params do preset ao editingProfile (usado pelo pipeline).
 * @param {object} baseProfile
 * @param {object} presetConfig  - EditingStyleConfig
 * @returns {object}
 */
export function applyPresetToProfile(baseProfile, presetConfig) {
  if (!presetConfig) return baseProfile;
  const c = presetConfig;

  // Silence removal → ajusta threshold pra detectar mais/menos pausas
  const silenceMap = {
    none:         { detect: false, executeBoost: -0.3 },
    conservative: { detect: true,  executeBoost: -0.1, minSilenceDur: 1.5 },
    moderate:     { detect: true,  executeBoost: 0,    minSilenceDur: 0.9 },
    aggressive:   { detect: true,  executeBoost: 0.15, minSilenceDur: 0.5 },
  }[c.silenceRemoval] || {};

  // Jump cut intensity
  const jumpCutMap = {
    none:     { executeSilence: 0.95, executeFiller: 0.95 },  // não corta quase nada
    subtle:   { executeSilence: 0.85, executeFiller: 0.85 },
    moderate: { executeSilence: 0.75, executeFiller: 0.75 },
    heavy:    { executeSilence: 0.60, executeFiller: 0.60 },  // corta agressivo
  }[c.jumpCutIntensity] || {};

  return {
    ...baseProfile,
    _presetApplied: true,
    _presetConfig: c,
    // Silence
    ...(silenceMap.minSilenceDur != null && { minSilenceDur: silenceMap.minSilenceDur }),
    executeThreshold: Math.min(0.98, Math.max(0.5,
      (jumpCutMap.executeSilence ?? baseProfile.executeThreshold ?? 0.80) + (silenceMap.executeBoost || 0)
    )),
    // Zoom
    zoomsPerMin: Math.round((baseProfile.zoomsPerMin || 7) * (0.3 + c.zoomFrequency * 1.4)),
    zoomIntensityFactor: c.zoomIntensity,
    zoomDurationSec: c.zoomDuration,
    // Captions
    preferredCaptionPosition: c.captionPosition,
    preferredCaptionAnimation: c.captionAnimation,
    preferredCaptionStyle: c.captionStyle,
    captionsEnabled: c.captionStyle !== "none",
    // Transitions
    preferredTransition: c.transitionStyle,
    transitionsEnabled: c.transitionFrequency > 0,
    transitionFrequency: c.transitionFrequency,
    // Music
    musicEnabled: c.musicStyle !== "none",
    musicIntensity: c.musicIntensity,
    musicStylePreference: c.musicStyle,
    // B-roll
    brollFrequency: c.brollFrequency,
    brollEnabled: c.brollFrequency > 0.1,
    // Sound effects
    sfxDensity: c.soundEffects,
    // Emphases
    hookEmphasis: c.hookEmphasis,
    ctaEmphasis: c.ctaEmphasis,
  };
}

/**
 * Deriva parâmetros do App a partir do preset — o que o usuário veria
 * se abrisse os controles manuais (zoom ON/OFF, legenda ON/OFF, etc).
 */
export function derivePresetUIState(presetConfig) {
  if (!presetConfig) return {};
  return {
    zoomEnabled: presetConfig.zoomFrequency > 0.1,
    smartZoomEnabled: presetConfig.zoomFrequency > 0.2,
    autoCaptionsEnabled: presetConfig.captionStyle !== "none",
    captionPosition: presetConfig.captionPosition,
    transitionsEnabled: presetConfig.transitionFrequency > 0,
    musicVolume: presetConfig.musicIntensity * 0.5, // escala pra 0-0.5
  };
}
