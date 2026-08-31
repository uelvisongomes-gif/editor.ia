// Editing Presets — biblioteca visual de modelos de edição.
// Cada preset combina:
//   1. EditingStyleConfig (17 params que afetam o pipeline real)
//   2. Preview visual (video/gif/thumbnail em /assets/editing-presets/)
//   3. Bindings pra Style Engine (triggers → animations)
//
// Trocar preset TROCA o comportamento do editor de verdade — não é só
// mudança visual de card.
//
// Arquitetura permite crescer pra 20/50/100 estilos sem reconstruir a UI.

import { DEFAULT_BRAND } from "./styleEngine/styleSchema.js";

/**
 * @typedef {Object} EditingStyleConfig
 * Todos os 17 params que o pipeline consome.
 * @property {"very_slow"|"slow"|"medium"|"fast"|"very_fast"} cutPacing
 * @property {"none"|"conservative"|"moderate"|"aggressive"} silenceRemoval
 * @property {"none"|"subtle"|"moderate"|"heavy"} jumpCutIntensity
 * @property {number} zoomFrequency       - 0-1
 * @property {number} zoomIntensity       - 0-1 (scale delta)
 * @property {number} zoomDuration        - seg
 * @property {"none"|"minimal"|"clean"|"dynamic"|"impact"|"karaoke"} captionStyle
 * @property {"top"|"middle"|"bottom"} captionPosition
 * @property {"fade"|"pop"|"slide"|"typewriter"|"bounce"|"keyword_punch"} captionAnimation
 * @property {"hard"|"crossfade"|"whip"|"blur"|"flash"|"mixed"} transitionStyle
 * @property {number} transitionFrequency - 0-1
 * @property {"none"|"corporate"|"motivational"|"emotional"|"upbeat"|"tech"|"commercial"} musicStyle
 * @property {number} musicIntensity      - 0-1
 * @property {number} brollFrequency      - 0-1
 * @property {"none"|"subtle"|"moderate"|"heavy"} soundEffects
 * @property {number} hookEmphasis        - 0-1
 * @property {number} ctaEmphasis         - 0-1
 */

/**
 * @typedef {Object} PresetPreview
 * @property {string} videoUrl        - loop mp4/webm 9:16 (opcional — cai pro placeholder)
 * @property {string} thumbnailUrl    - poster estatico
 * @property {string} placeholderBg   - gradient CSS pra placeholder
 */

/**
 * @typedef {Object} EditingPreset
 * @property {string} id
 * @property {string} name
 * @property {string} shortName       - até 14 chars (cabe no card)
 * @property {string} category
 * @property {string} description     - 1-2 linhas
 * @property {string[]} tags
 * @property {EditingStyleConfig} config
 * @property {PresetPreview} preview
 * @property {import("./styleEngine/styleSchema.js").StyleConfig} styleConfig  - config avancada do Style Engine
 */

// ============================================================================
// 8 PRESETS OFICIAIS
// ============================================================================

const CREATOR_DYNAMIC = {
  id: "creator_dynamic", name: "Creator Dynamic", shortName: "Dynamic",
  category: "creator",
  description: "Ritmo moderno, punch-ins pontuais e legendas com destaque de palavras-chave.",
  tags: ["moderno", "punch-in", "keyword"],
  preview: {
    videoUrl: "/assets/editing-presets/creator_dynamic.mp4",
    thumbnailUrl: "/assets/editing-presets/creator_dynamic.jpg",
    placeholderBg: "linear-gradient(140deg, #FF6A2B 0%, #FF3EA5 100%)",
    mockStyle: "dynamic",
  },
  config: {
    cutPacing: "medium", silenceRemoval: "moderate", jumpCutIntensity: "subtle",
    zoomFrequency: 0.55, zoomIntensity: 0.6, zoomDuration: 0.9,
    captionStyle: "dynamic", captionPosition: "bottom", captionAnimation: "keyword_punch",
    transitionStyle: "crossfade", transitionFrequency: 0.4,
    musicStyle: "upbeat", musicIntensity: 0.55,
    brollFrequency: 0.5, soundEffects: "subtle",
    hookEmphasis: 0.75, ctaEmphasis: 0.8,
  },
  compositionBehavior: {
    full_speaker: 0.55,
    top_media_bottom_speaker: 0.55,
    picture_in_picture: 0.3,
    full_broll: 0.15,
    big_number_composed: 0.65,
    quote: 0.20,
  },
};

const CLEAN_PRO = {
  id: "clean_pro", name: "Clean Pro", shortName: "Clean",
  category: "professional",
  description: "Edição elegante e discreta. Cortes naturais, zoom sutil, legenda clean.",
  tags: ["clean", "professional", "minimal"],
  preview: {
    videoUrl: "/assets/editing-presets/clean_pro.mp4",
    thumbnailUrl: "/assets/editing-presets/clean_pro.jpg",
    placeholderBg: "linear-gradient(140deg, #1E293B 0%, #475569 100%)",
  },
  config: {
    cutPacing: "slow", silenceRemoval: "conservative", jumpCutIntensity: "none",
    zoomFrequency: 0.15, zoomIntensity: 0.3, zoomDuration: 1.5,
    captionStyle: "clean", captionPosition: "bottom", captionAnimation: "fade",
    transitionStyle: "crossfade", transitionFrequency: 0.15,
    musicStyle: "corporate", musicIntensity: 0.3,
    brollFrequency: 0.2, soundEffects: "none",
    hookEmphasis: 0.4, ctaEmphasis: 0.5,
  },
  compositionBehavior: {
    full_speaker: 0.9,
    top_media_bottom_speaker: 0.15,
    picture_in_picture: 0.1,
    full_broll: 0.05,
    big_number_composed: 0.35,
    quote: 0.08,
  },
};

const VIRAL_FAST = {
  id: "viral_fast", name: "Viral Fast", shortName: "Viral",
  category: "viral",
  description: "Retenção máxima. Cortes rápidos, textos gigantes, zooms frequentes.",
  tags: ["viral", "high-energy", "hook"],
  preview: {
    videoUrl: "/assets/editing-presets/viral_fast.mp4",
    thumbnailUrl: "/assets/editing-presets/viral_fast.jpg",
    placeholderBg: "linear-gradient(140deg, #FF0050 0%, #FFEB3B 100%)",
  },
  config: {
    cutPacing: "very_fast", silenceRemoval: "aggressive", jumpCutIntensity: "heavy",
    zoomFrequency: 0.85, zoomIntensity: 0.9, zoomDuration: 0.6,
    captionStyle: "impact", captionPosition: "middle", captionAnimation: "pop",
    transitionStyle: "mixed", transitionFrequency: 0.65,
    musicStyle: "upbeat", musicIntensity: 0.75,
    brollFrequency: 0.7, soundEffects: "heavy",
    hookEmphasis: 1.0, ctaEmphasis: 1.0,
  },
  compositionBehavior: {
    full_speaker: 0.30,
    top_media_bottom_speaker: 0.75,
    picture_in_picture: 0.6,
    full_broll: 0.5,
    big_number_composed: 0.85,
    quote: 0.30,
  },
};

const STORYTELLING = {
  id: "storytelling", name: "Storytelling", shortName: "Story",
  category: "cinematic",
  description: "Emocional e cinematográfico. Zooms suaves, B-roll contextual, música pesada.",
  tags: ["emotional", "cinematic", "smooth"],
  preview: {
    videoUrl: "/assets/editing-presets/storytelling.mp4",
    thumbnailUrl: "/assets/editing-presets/storytelling.jpg",
    placeholderBg: "linear-gradient(140deg, #D4A373 0%, #264653 100%)",
  },
  config: {
    cutPacing: "slow", silenceRemoval: "conservative", jumpCutIntensity: "none",
    zoomFrequency: 0.35, zoomIntensity: 0.4, zoomDuration: 3.0,
    captionStyle: "minimal", captionPosition: "bottom", captionAnimation: "fade",
    transitionStyle: "crossfade", transitionFrequency: 0.5,
    musicStyle: "emotional", musicIntensity: 0.7,
    brollFrequency: 0.6, soundEffects: "subtle",
    hookEmphasis: 0.7, ctaEmphasis: 0.5,
  },
  compositionBehavior: {
    full_speaker: 0.55,
    top_media_bottom_speaker: 0.35,
    picture_in_picture: 0.15,
    full_broll: 0.55,
    big_number_composed: 0.20,
    quote: 0.55,
  },
};

const TIKTOK_SHOP = {
  id: "tiktok_shop", name: "TikTok Shop", shortName: "Shop",
  category: "commerce",
  description: "Produto em destaque, benefícios, prova, CTA forte pra converter.",
  tags: ["produto", "conversao", "commerce"],
  preview: {
    videoUrl: "/assets/editing-presets/tiktok_shop.mp4",
    thumbnailUrl: "/assets/editing-presets/tiktok_shop.jpg",
    placeholderBg: "linear-gradient(140deg, #FF0050 0%, #00F2EA 100%)",
  },
  config: {
    cutPacing: "fast", silenceRemoval: "moderate", jumpCutIntensity: "moderate",
    zoomFrequency: 0.7, zoomIntensity: 0.75, zoomDuration: 0.8,
    captionStyle: "impact", captionPosition: "bottom", captionAnimation: "pop",
    transitionStyle: "whip", transitionFrequency: 0.5,
    musicStyle: "commercial", musicIntensity: 0.6,
    brollFrequency: 0.4, soundEffects: "moderate",
    hookEmphasis: 0.9, ctaEmphasis: 1.0,
  },
  compositionBehavior: {
    full_speaker: 0.35,
    top_media_bottom_speaker: 0.7,
    picture_in_picture: 0.35,
    full_broll: 0.3,
    big_number_composed: 0.7,
    quote: 0.15,
  },
};

const PODCAST_CLIPS = {
  id: "podcast_clips", name: "Podcast Clips", shortName: "Podcast",
  category: "podcast",
  description: "Active speaker, reframe automático, poucos efeitos, foco na fala.",
  tags: ["podcast", "reframe", "active-speaker"],
  preview: {
    videoUrl: "/assets/editing-presets/podcast_clips.mp4",
    thumbnailUrl: "/assets/editing-presets/podcast_clips.jpg",
    placeholderBg: "linear-gradient(140deg, #7C3AED 0%, #312E81 100%)",
  },
  config: {
    cutPacing: "medium", silenceRemoval: "conservative", jumpCutIntensity: "subtle",
    zoomFrequency: 0.25, zoomIntensity: 0.4, zoomDuration: 1.2,
    captionStyle: "clean", captionPosition: "bottom", captionAnimation: "fade",
    transitionStyle: "hard", transitionFrequency: 0.2,
    musicStyle: "none", musicIntensity: 0,
    brollFrequency: 0.1, soundEffects: "none",
    hookEmphasis: 0.65, ctaEmphasis: 0.55,
  },
  compositionBehavior: {
    full_speaker: 0.85,
    top_media_bottom_speaker: 0.10,
    picture_in_picture: 0.15,
    full_broll: 0.05,
    big_number_composed: 0.30,
    quote: 0.25,
  },
};

const TUTORIAL_PRO = {
  id: "tutorial_pro", name: "Tutorial Pro", shortName: "Tutorial",
  category: "education",
  description: "Passos numerados, zoom em demonstrações, screenshots, clareza acima de velocidade.",
  tags: ["tutorial", "steps", "clear"],
  preview: {
    videoUrl: "/assets/editing-presets/tutorial_pro.mp4",
    thumbnailUrl: "/assets/editing-presets/tutorial_pro.jpg",
    placeholderBg: "linear-gradient(140deg, #2563EB 0%, #1E293B 100%)",
  },
  config: {
    cutPacing: "medium", silenceRemoval: "moderate", jumpCutIntensity: "subtle",
    zoomFrequency: 0.5, zoomIntensity: 0.7, zoomDuration: 1.5,
    captionStyle: "dynamic", captionPosition: "top", captionAnimation: "slide",
    transitionStyle: "crossfade", transitionFrequency: 0.3,
    musicStyle: "corporate", musicIntensity: 0.35,
    brollFrequency: 0.5, soundEffects: "subtle",
    hookEmphasis: 0.6, ctaEmphasis: 0.7,
  },
  compositionBehavior: {
    full_speaker: 0.5,
    top_media_bottom_speaker: 0.55,
    picture_in_picture: 0.35,
    full_broll: 0.45, // screenshots contam como full_broll aqui
    big_number_composed: 0.55,
    quote: 0.10,
  },
};

const UGC_ADS = {
  id: "ugc_ads", name: "UGC Ads", shortName: "UGC",
  category: "advertising",
  description: "Hook → Problema → Solução → Prova → CTA. Ritmo alto e conversão.",
  tags: ["ads", "conversion", "framework"],
  preview: {
    videoUrl: "/assets/editing-presets/ugc_ads.mp4",
    thumbnailUrl: "/assets/editing-presets/ugc_ads.jpg",
    placeholderBg: "linear-gradient(140deg, #FF6A2B 0%, #FFEB3B 100%)",
  },
  config: {
    cutPacing: "fast", silenceRemoval: "aggressive", jumpCutIntensity: "moderate",
    zoomFrequency: 0.7, zoomIntensity: 0.75, zoomDuration: 0.7,
    captionStyle: "impact", captionPosition: "middle", captionAnimation: "pop",
    transitionStyle: "whip", transitionFrequency: 0.55,
    musicStyle: "motivational", musicIntensity: 0.7,
    brollFrequency: 0.6, soundEffects: "heavy",
    hookEmphasis: 1.0, ctaEmphasis: 1.0,
  },
  compositionBehavior: {
    full_speaker: 0.35,
    top_media_bottom_speaker: 0.70,
    picture_in_picture: 0.45,
    full_broll: 0.55,
    big_number_composed: 0.75,
    quote: 0.15,
  },
};

export const EDITING_PRESETS = [
  CREATOR_DYNAMIC, CLEAN_PRO, VIRAL_FAST, STORYTELLING,
  TIKTOK_SHOP, PODCAST_CLIPS, TUTORIAL_PRO, UGC_ADS,
];

export const DEFAULT_PRESET_ID = "creator_dynamic";

export function getPreset(id) {
  return EDITING_PRESETS.find((p) => p.id === id) || null;
}

export function listPresets({ category, tag } = {}) {
  let arr = EDITING_PRESETS;
  if (category) arr = arr.filter((p) => p.category === category);
  if (tag) arr = arr.filter((p) => (p.tags || []).includes(tag));
  return arr;
}

// ============================================================================
// BRIDGE: EditingStyleConfig → StyleConfig (Style Engine formal)
// ============================================================================
// Converte os 17 params humanos em bindings de Trigger→Animation.
// Isso garante que a UI simples de preset alimenta o motor complexo.

const PACE_TO_MIN_PLANE = { very_slow: 6, slow: 4, medium: 2, fast: 1.4, very_fast: 1.0 };
const DENSITY_BY_PACE  = { very_slow: "low", slow: "low", medium: "medium", fast: "medium_high", very_fast: "high" };
const CAPTION_ANIM_MAP = {
  fade: "caption_fade", pop: "caption_pop", slide: "caption_slide",
  typewriter: "caption_word_focus", bounce: "caption_bounce", keyword_punch: "caption_keyword_punch",
};
const TRANSITION_ANIM_MAP = {
  hard: "hard_cut", crossfade: "smooth_cut", whip: "whip", blur: "blur", flash: "flash",
  mixed: "smooth_cut", // mixed: aleatoria com seed
};
const MUSIC_MOOD_MAP = {
  none: null, corporate: "calm", motivational: "motivational",
  emotional: "emotional", upbeat: "upbeat", tech: "future", commercial: "upbeat",
};

/**
 * Converte um EditingPreset em StyleConfig do Style Engine.
 */
export function presetToStyleConfig(preset) {
  if (!preset) return null;
  const c = preset.config;
  const captionAnim = CAPTION_ANIM_MAP[c.captionAnimation] || "caption_pop";
  const transAnim = TRANSITION_ANIM_MAP[c.transitionStyle] || "smooth_cut";
  const brandKit = { ...DEFAULT_BRAND };
  // Deriva brandKit do gradient do preview (pri = primeiro hex, sec = último hex)
  const hexMatches = preset.preview?.placeholderBg?.match(/#[0-9A-Fa-f]{6}/g);
  if (hexMatches?.length >= 2) {
    brandKit.primary = hexMatches[0];
    brandKit.secondary = hexMatches[1];
  }

  // Cooldowns invertem com frequência
  const zoomCd = Math.max(1, 6 - c.zoomFrequency * 5);
  const textCd = Math.max(0.8, 5 - c.hookEmphasis * 3);
  const brollCd = Math.max(2, 10 - c.brollFrequency * 8);
  const transCd = Math.max(0.2, 1.5 - c.transitionFrequency * 1);

  return {
    id: `preset_${preset.id}`, version: "2.0.0",
    name: preset.name, category: preset.category,
    pacing: {
      intensity: (c.zoomFrequency + c.brollFrequency + c.transitionFrequency) / 3,
      cutPace: c.cutPacing,
      minPlaneSec: PACE_TO_MIN_PLANE[c.cutPacing] ?? 2,
    },
    budget: {
      density: DENSITY_BY_PACE[c.cutPacing] ?? "medium",
      cooldowns: { zoom: zoomCd, text: textCd, broll: brollCd, transition: transCd, sfx: c.soundEffects === "none" ? 999 : 2 },
    },
    triggers: {
      HOOK: [
        { animation: captionAnim, priority: c.hookEmphasis, params: { position: c.captionPosition } },
        ...(c.hookEmphasis >= 0.7 ? [{ animation: "text_pop", priority: c.hookEmphasis }] : []),
        ...(c.hookEmphasis >= 0.8 ? [{ animation: "punch_in", params: { scale: 1 + c.zoomIntensity * 0.1 } }] : []),
      ],
      IMPORTANT_POINT: [
        ...(c.zoomFrequency >= 0.4 ? [{ animation: "punch_in", params: { scale: 1 + c.zoomIntensity * 0.08, duration: c.zoomDuration }, chance: c.zoomFrequency }] : []),
        ...(c.hookEmphasis >= 0.6 ? [{ animation: captionAnim, chance: 0.6, params: { position: c.captionPosition } }] : []),
      ],
      NUMBER: [
        { animation: "big_number", params: { sizeVw: 8 + c.hookEmphasis * 8 } },
      ],
      PRICE: [
        { animation: "big_number", params: { sizeVw: 10 + c.ctaEmphasis * 6 } },
        ...(c.ctaEmphasis >= 0.8 ? [{ animation: "badge", params: { text: "OFERTA" } }] : []),
      ],
      KEYWORD: [
        ...(c.captionStyle !== "none" ? [{ animation: captionAnim, chance: 0.6, params: { keywordHighlight: true } }] : []),
      ],
      CTA: [
        { animation: captionAnim, priority: c.ctaEmphasis, params: { position: c.captionPosition } },
        ...(c.ctaEmphasis >= 0.8 ? [{ animation: "text_pop", priority: c.ctaEmphasis }] : []),
        ...(c.ctaEmphasis >= 0.9 ? [{ animation: "badge", params: { text: "AGORA" } }] : []),
      ],
      PROOF: [
        ...(c.brollFrequency >= 0.3 ? [{ animation: "broll_overlay", chance: c.brollFrequency }] : []),
      ],
      PRODUCT: [
        ...(c.zoomFrequency >= 0.5 ? [{ animation: "punch_in", params: { scale: 1 + c.zoomIntensity * 0.1 } }] : []),
      ],
      PRODUCT_DEMONSTRATION: [
        { animation: "punch_in", params: { scale: 1 + c.zoomIntensity * 0.14 }, priority: 0.95 },
        ...(c.hookEmphasis >= 0.7 ? [{ animation: "circle_highlight" }] : []),
      ],
      SURPRISE: [
        { animation: "emphasis_zoom", params: { scale: 1 + c.zoomIntensity * 0.12 } },
        ...(c.transitionFrequency >= 0.5 ? [{ animation: "whip", chance: 0.4 }] : []),
      ],
      TOPIC_CHANGE: [
        { animation: transAnim, chance: 0.5 },
      ],
      QUESTION: [
        ...(c.hookEmphasis >= 0.6 ? [{ animation: "text_pop", params: { colorFrom: "#FFB020" } }] : []),
      ],
      STEP: [
        ...(preset.category === "education" ? [{ animation: "counter" }] : []),
      ],
      RESULT: [
        ...(c.brollFrequency >= 0.4 ? [{ animation: "big_number", chance: 0.5 }] : []),
      ],
      BEFORE_AFTER: [
        { animation: "split_screen", priority: 0.9 },
      ],
      PATTERN_INTERRUPT: [
        ...(c.soundEffects === "heavy" ? [{ animation: "flash", chance: 0.4 }] : []),
        ...(c.soundEffects !== "none" ? [{ animation: "background_dim", chance: 0.4 }] : []),
      ],
    },
    brandKit,
  };
}

export function listPresetsWithStyleConfig() {
  return EDITING_PRESETS.map((p) => ({ ...p, styleConfig: presetToStyleConfig(p) }));
}
