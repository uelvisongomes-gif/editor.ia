// Editing Preset Variants — expande os 8 base presets em variantes numeradas
// (Creator Dynamic 01/02, Viral Fast 01/02/03, etc). Cada variante herda o
// base config mas altera pequenas coisas pra dar identidade própria.
//
// Isso permite crescer pra 20/50/100 estilos sem reconstruir a UI.

import { EDITING_PRESETS as BASE_PRESETS, presetToStyleConfig } from "./editingPresets.js";

// Ajustes que cada variante aplica sobre o base config
const VARIANT_DELTAS = {
  creator_dynamic: [
    { suffix: "01", nameSuffix: "01", deltas: {} }, // canonical
    { suffix: "02", nameSuffix: "02", deltas: {
      config: { zoomFrequency: 0.7, captionAnimation: "pop", brollFrequency: 0.6 },
      compositionBehavior: { top_media_bottom_speaker: 0.65, picture_in_picture: 0.45 },
      description: "Punch-ins mais frequentes e mais imagens de apoio no topo.",
    }},
  ],
  clean_pro: [
    { suffix: "01", nameSuffix: "01", deltas: {} },
    { suffix: "02", nameSuffix: "02", deltas: {
      config: { zoomFrequency: 0.25, transitionFrequency: 0.25, captionAnimation: "slide" },
      description: "Um pouco mais de movimento, mantendo elegância.",
    }},
  ],
  viral_fast: [
    { suffix: "01", nameSuffix: "01", deltas: {} },
    { suffix: "02", nameSuffix: "02", deltas: {
      config: { hookEmphasis: 1.0, brollFrequency: 0.85, captionAnimation: "bounce" },
      compositionBehavior: { full_broll: 0.7, big_number_composed: 0.95 },
      description: "Foco em big numbers e full B-roll agressivo.",
    }},
    { suffix: "03", nameSuffix: "03", deltas: {
      config: { cutPacing: "very_fast", zoomFrequency: 1.0, transitionFrequency: 0.85, soundEffects: "heavy" },
      compositionBehavior: { picture_in_picture: 0.8, quote: 0.35 },
      description: "Ritmo máximo, PIP frequente e transições marcadas.",
    }},
  ],
  storytelling: [
    { suffix: "01", nameSuffix: "01", deltas: {} },
    { suffix: "02", nameSuffix: "02", deltas: {
      config: { zoomFrequency: 0.45, brollFrequency: 0.75, musicIntensity: 0.8 },
      compositionBehavior: { full_broll: 0.7, quote: 0.7 },
      description: "Mais B-roll cinematográfico e quotes.",
    }},
  ],
  tiktok_shop: [
    { suffix: "01", nameSuffix: "01", deltas: {} },
    { suffix: "02", nameSuffix: "02", deltas: {
      config: { hookEmphasis: 1.0, brollFrequency: 0.55, jumpCutIntensity: "heavy" },
      compositionBehavior: { top_media_bottom_speaker: 0.85, big_number_composed: 0.85 },
      description: "Ritmo mais agressivo com foco em preço e benefício.",
    }},
  ],
  podcast_clips: [
    { suffix: "01", nameSuffix: "01", deltas: {} },
  ],
  tutorial_pro: [
    { suffix: "01", nameSuffix: "01", deltas: {} },
  ],
  ugc_ads: [
    { suffix: "01", nameSuffix: "01", deltas: {} },
  ],
};

function deepMerge(base, over) {
  if (over == null || typeof over !== "object") return over ?? base;
  if (Array.isArray(over)) return over;
  const out = { ...(base || {}) };
  for (const [k, v] of Object.entries(over)) out[k] = deepMerge(base?.[k], v);
  return out;
}

/**
 * Gera todas variantes dos presets.
 */
function buildVariants() {
  const variants = [];
  for (const base of BASE_PRESETS) {
    const list = VARIANT_DELTAS[base.id] || [{ suffix: "01", nameSuffix: "01", deltas: {} }];
    for (const v of list) {
      const id = `${base.id}_${v.suffix}`;
      const name = `${base.name} ${v.nameSuffix}`;
      const merged = deepMerge(base, v.deltas || {});
      const previewFileBase = id;
      variants.push({
        ...merged,
        id, name,
        preview: {
          ...merged.preview,
          videoUrl: `/assets/editing-presets/${previewFileBase}.mp4`,
          posterImage: `/assets/editing-presets/${previewFileBase}.jpg`,
          previewDuration: 6,
        },
        description: v.deltas?.description || merged.description,
        baseId: base.id,
        variantIndex: parseInt(v.suffix, 10),
      });
    }
  }
  return variants;
}

export const PRESET_VARIANTS = buildVariants();

export function getVariant(id) {
  return PRESET_VARIANTS.find((v) => v.id === id) || null;
}

export function listVariants({ category, baseId, tag } = {}) {
  let arr = PRESET_VARIANTS;
  if (category) arr = arr.filter((v) => v.category === category);
  if (baseId) arr = arr.filter((v) => v.baseId === baseId);
  if (tag) arr = arr.filter((v) => (v.tags || []).includes(tag));
  return arr;
}

export function listCategories() {
  const cats = new Set(PRESET_VARIANTS.map((v) => v.category));
  return Array.from(cats);
}

/**
 * Preset resolver — aceita id de variante OU id do base preset.
 */
export function resolvePresetOrVariant(id) {
  const asVariant = getVariant(id);
  if (asVariant) return asVariant;
  // Fallback: id base — retorna primeira variante
  const firstVar = PRESET_VARIANTS.find((v) => v.baseId === id);
  return firstVar || null;
}

/**
 * Reexport pra manter compat com quem já importa presetToStyleConfig
 */
export { presetToStyleConfig };

/**
 * Nome legível da categoria pra UI.
 */
export const CATEGORY_LABEL = {
  creator: "Dinâmicos",
  professional: "Clean",
  viral: "Virais",
  cinematic: "Storytelling",
  commerce: "TikTok Shop",
  podcast: "Podcast",
  education: "Tutorial",
  advertising: "UGC Ads",
};
