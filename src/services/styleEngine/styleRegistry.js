// Style Registry — Item 15 + 16 + 17 + 34 + 35.
// 10 base styles + variantes + custom user styles + favoritos.
// Cada style é objeto JSON validado por styleSchema.js.
//
// Custom styles ficam em localStorage. Presets vem daqui em código
// pra tree-shaking + reproducibilidade.

import { normalizeStyle, validateStyle } from "./styleSchema.js";

// ============================================================================
// 10 BASE STYLES
// ============================================================================

const NATURAL_CLEAN = {
  id: "natural_clean_01", version: "1.0.0", name: "Natural Clean", category: "natural",
  description: "Edição humana quase invisível. Menos é mais.",
  tags: ["clean", "minimal", "podcast-friendly"],
  pacing: { intensity: 0.2, cutPace: "slow", minPlaneSec: 4 },
  budget: { density: "low", cooldowns: { zoom: 8, text: 6, broll: 12, transition: 1.5, sfx: 6 } },
  triggers: {
    HOOK:            [{ animation: "caption_pop", params: { keywordHighlight: true }, priority: 0.9 }],
    IMPORTANT_POINT: [{ animation: "punch_in", params: { scale: 1.04, duration: 1.2 }, priority: 0.7, chance: 0.5 }],
    CTA:             [{ animation: "caption_pop", priority: 1.0 }],
  },
  brandKit: { primary: "#2A9D8F", secondary: "#264653", accent: "#E9C46A", fontHeading: "Inter Tight" },
};

const DYNAMIC_CREATOR = {
  id: "dynamic_creator_01", version: "1.0.0", name: "Dynamic Creator", category: "dynamic",
  description: "Creator moderno, ritmo médio-rápido, punch-ins pontuais.",
  pacing: { intensity: 0.6, cutPace: "medium", minPlaneSec: 1.8 },
  budget: { density: "medium", cooldowns: { zoom: 3.5, text: 3, broll: 5, transition: 0.4, sfx: 2 } },
  triggers: {
    HOOK:            [{ animation: "text_pop", priority: 0.95 }, { animation: "punch_in", params: { scale: 1.10 }, priority: 0.7 }],
    IMPORTANT_POINT: [{ animation: "punch_in", params: { scale: 1.08 } }],
    NUMBER:          [{ animation: "big_number" }],
    PRICE:           [{ animation: "big_number", params: { colorFrom: "#5DCAA5", colorTo: "#2A9D8F" } }],
    KEYWORD:         [{ animation: "caption_keyword_punch" }],
    CTA:             [{ animation: "text_pop", priority: 1.0 }],
    PROOF:           [{ animation: "broll_overlay", chance: 0.6 }],
    SURPRISE:        [{ animation: "emphasis_zoom" }],
    TOPIC_CHANGE:    [{ animation: "smooth_cut", chance: 0.5 }, { animation: "whip", chance: 0.3 }],
  },
  brandKit: { primary: "#FF6A2B", secondary: "#FF3EA5", accent: "#FFB020", fontHeading: "Archivo Black", fontBody: "Inter Tight" },
};

const VIRAL_FAST = {
  id: "viral_fast_01", version: "1.0.0", name: "Viral Fast", category: "viral",
  description: "Retenção alta. Hook forte, pattern interrupts, textos grandes.",
  pacing: { intensity: 0.9, cutPace: "very_fast", minPlaneSec: 1.2 },
  budget: { density: "medium_high", cooldowns: { zoom: 2.5, text: 1.8, broll: 3.5, transition: 0.3, sfx: 1.2 } },
  triggers: {
    HOOK:              [{ animation: "text_pop", priority: 1.0 }, { animation: "punch_in", params: { scale: 1.14 }, priority: 0.9 }],
    IMPORTANT_POINT:   [{ animation: "punch_in", params: { scale: 1.12 } }, { animation: "text_pop", chance: 0.5 }],
    NUMBER:            [{ animation: "big_number", params: { sizeVw: 14 } }],
    PRICE:             [{ animation: "big_number", params: { sizeVw: 12 } }],
    KEYWORD:           [{ animation: "caption_keyword_punch" }],
    CTA:               [{ animation: "text_pop", priority: 1.0 }, { animation: "punch_in", params: { scale: 1.10 } }],
    PROOF:             [{ animation: "broll_overlay" }],
    SURPRISE:          [{ animation: "emphasis_zoom", params: { scale: 1.16 } }, { animation: "whip", chance: 0.4 }],
    TOPIC_CHANGE:      [{ animation: "whip", chance: 0.6 }, { animation: "flash", chance: 0.3 }],
    PATTERN_INTERRUPT: [{ animation: "background_dim", chance: 0.5 }, { animation: "flash", chance: 0.4 }],
    BEFORE_AFTER:      [{ animation: "split_screen", priority: 0.9 }],
    QUESTION:          [{ animation: "text_pop", params: { colorFrom: "#FFB020" } }],
  },
  brandKit: { primary: "#FF6A2B", secondary: "#FF3EA5", accent: "#FFEB3B", fontHeading: "Archivo Black" },
};

const STORYTELLING_CINEMATIC = {
  id: "storytelling_cinematic_01", version: "1.0.0", name: "Storytelling Cinematic", category: "storytelling",
  description: "Emocional, cortes respirados, B-roll contextual, música emocional.",
  pacing: { intensity: 0.35, cutPace: "slow", minPlaneSec: 5 },
  budget: { density: "low", cooldowns: { zoom: 6, text: 8, broll: 6, transition: 1.2, sfx: 5 } },
  triggers: {
    HOOK:            [{ animation: "smooth_zoom_in", params: { scale: 1.06, duration: 3 } }],
    IMPORTANT_POINT: [{ animation: "smooth_zoom_in", params: { scale: 1.04 } }, { animation: "background_blur", chance: 0.3 }],
    EMOTION:         [{ animation: "smooth_zoom_in", params: { scale: 1.08, duration: 4 }, priority: 0.9 }],
    PROOF:           [{ animation: "broll_overlay", params: { opacity: 0.9 } }],
    SURPRISE:        [{ animation: "smooth_zoom_out", params: { scale: 0.94 } }],
    QUOTE:           [{ animation: "quote_card" }],
    CTA:             [{ animation: "text_slide", priority: 0.9 }],
  },
  brandKit: { primary: "#D4A373", secondary: "#264653", accent: "#E9C46A", fontHeading: "Playfair Display", fontBody: "Inter Tight" },
};

const PODCAST_CLIPS = {
  id: "podcast_clips_01", version: "1.0.0", name: "Podcast Clips", category: "podcast",
  description: "Active speaker, auto reframe, punch-in pontual.",
  pacing: { intensity: 0.3, cutPace: "medium", minPlaneSec: 3 },
  budget: { density: "low", cooldowns: { zoom: 5, text: 4, broll: 10, transition: 1, sfx: 6 } },
  triggers: {
    HOOK:            [{ animation: "text_pop" }, { animation: "punch_in", params: { scale: 1.06 } }],
    IMPORTANT_POINT: [{ animation: "punch_in", params: { scale: 1.05 } }],
    QUOTE:           [{ animation: "quote_card" }],
    NUMBER:          [{ animation: "big_number", params: { sizeVw: 8 } }],
    TOPIC_CHANGE:    [{ animation: "auto_reframe" }, { animation: "smooth_cut" }],
    KEYWORD:         [{ animation: "caption_keyword_punch" }],
    CTA:             [{ animation: "text_pop" }],
  },
  brandKit: { primary: "#7C3AED", secondary: "#312E81", accent: "#FBBF24", fontHeading: "Inter Tight" },
};

const TUTORIAL_PRO = {
  id: "tutorial_pro_01", version: "1.0.0", name: "Tutorial Pro", category: "tutorial",
  description: "Passos, números, setas, destaques, zoom em demonstrações.",
  pacing: { intensity: 0.5, cutPace: "medium", minPlaneSec: 2.5 },
  budget: { density: "medium", cooldowns: { zoom: 3, text: 2.5, broll: 4, transition: 0.5, sfx: 2 } },
  triggers: {
    HOOK:                 [{ animation: "text_pop" }],
    STEP:                 [{ animation: "counter", priority: 0.95 }, { animation: "text_pop", params: { position: "top" } }],
    IMPORTANT_POINT:      [{ animation: "punch_in", params: { scale: 1.08 } }, { animation: "callout", chance: 0.4 }],
    NUMBER:               [{ animation: "big_number", params: { sizeVw: 9 } }],
    KEYWORD:              [{ animation: "caption_keyword_punch" }, { animation: "underline", chance: 0.5 }],
    PROOF:                [{ animation: "screenshot" }, { animation: "arrow", chance: 0.4 }],
    RESULT:               [{ animation: "checklist", chance: 0.5 }],
    PRODUCT_DEMONSTRATION:[{ animation: "punch_in", params: { scale: 1.12 } }, { animation: "circle_highlight" }],
    CTA:                  [{ animation: "text_pop", priority: 1.0 }],
  },
  brandKit: { primary: "#2563EB", secondary: "#1E293B", accent: "#F59E0B", fontHeading: "Inter Tight" },
};

const TIKTOK_SHOP = {
  id: "tiktok_shop_01", version: "1.0.0", name: "TikTok Shop", category: "tiktokshop",
  description: "Produto prioritário, preço, oferta, prova, CTA forte.",
  pacing: { intensity: 0.75, cutPace: "fast", minPlaneSec: 1.5 },
  budget: { density: "medium_high", cooldowns: { zoom: 2.5, text: 1.8, broll: 4, transition: 0.4, sfx: 1.5 } },
  triggers: {
    HOOK:                 [{ animation: "text_pop", priority: 1.0 }],
    PRODUCT:              [{ animation: "product_track", priority: 1.0 }, { animation: "punch_in", params: { scale: 1.10 } }],
    PRODUCT_DEMONSTRATION:[{ animation: "punch_in", params: { scale: 1.14 } }, { animation: "circle_highlight" }],
    PRICE:                [{ animation: "big_number", params: { sizeVw: 14, colorFrom: "#22C55E", colorTo: "#059669" }, priority: 1.0 }, { animation: "badge", params: { text: "OFERTA" } }],
    PROBLEM:              [{ animation: "text_pop", params: { colorFrom: "#EF4444" } }],
    SOLUTION:             [{ animation: "text_pop", params: { colorFrom: "#22C55E" } }],
    PROOF:                [{ animation: "checklist" }, { animation: "screenshot", chance: 0.5 }],
    RESULT:               [{ animation: "big_number", chance: 0.6 }],
    BEFORE_AFTER:         [{ animation: "split_screen", priority: 0.95 }],
    CTA:                  [{ animation: "text_pop", priority: 1.0 }, { animation: "badge", params: { text: "COMPRAR" } }],
  },
  brandKit: { primary: "#FF0050", secondary: "#00F2EA", accent: "#FFEB3B", fontHeading: "Archivo Black" },
};

const UGC_ADS = {
  id: "ugc_ads_01", version: "1.0.0", name: "UGC Ads", category: "ugc",
  description: "HOOK → PROBLEMA → SOLUÇÃO → PROVA → CTA.",
  pacing: { intensity: 0.8, cutPace: "fast", minPlaneSec: 1.3 },
  budget: { density: "medium_high", cooldowns: { zoom: 2.5, text: 1.8, broll: 3.5, transition: 0.35, sfx: 1.2 } },
  triggers: {
    HOOK:            [{ animation: "text_pop", priority: 1.0 }, { animation: "punch_in", params: { scale: 1.12 } }],
    PROBLEM:         [{ animation: "text_pop", params: { colorFrom: "#EF4444", colorTo: "#DC2626" } }, { animation: "background_dim", chance: 0.4 }],
    SOLUTION:        [{ animation: "text_pop", params: { colorFrom: "#22C55E", colorTo: "#059669" } }, { animation: "flash", chance: 0.3 }],
    PROOF:           [{ animation: "broll_overlay" }, { animation: "big_number", chance: 0.5 }],
    RESULT:          [{ animation: "big_number", params: { sizeVw: 13 } }],
    BEFORE_AFTER:    [{ animation: "split_screen", priority: 0.95 }],
    CTA:             [{ animation: "text_pop", priority: 1.0 }, { animation: "badge", params: { text: "COMPRAR AGORA" } }],
    IMPORTANT_POINT: [{ animation: "punch_in", params: { scale: 1.10 } }],
  },
  brandKit: { primary: "#FF6A2B", secondary: "#FF3EA5", accent: "#FFEB3B", fontHeading: "Archivo Black" },
};

const BUSINESS_AUTHORITY = {
  id: "business_authority_01", version: "1.0.0", name: "Business Authority", category: "business",
  description: "Clean, sofisticado, dados, gráficos, movimentos discretos.",
  pacing: { intensity: 0.35, cutPace: "medium", minPlaneSec: 3.5 },
  budget: { density: "low", cooldowns: { zoom: 6, text: 5, broll: 8, transition: 1, sfx: 5 } },
  triggers: {
    HOOK:            [{ animation: "text_slide", priority: 0.9 }],
    IMPORTANT_POINT: [{ animation: "punch_in", params: { scale: 1.05 } }, { animation: "text_slide", chance: 0.5 }],
    NUMBER:          [{ animation: "big_number", params: { sizeVw: 8, colorFrom: "#1E40AF", colorTo: "#3B82F6" }, priority: 0.95 }],
    PRICE:           [{ animation: "big_number", params: { sizeVw: 8 } }],
    PROOF:           [{ animation: "screenshot" }, { animation: "underline" }],
    QUOTE:           [{ animation: "quote_card" }],
    RESULT:          [{ animation: "big_number", chance: 0.6 }],
    CTA:             [{ animation: "text_slide", priority: 1.0 }],
  },
  brandKit: { primary: "#1E40AF", secondary: "#0F172A", accent: "#F59E0B", fontHeading: "Inter Tight" },
};

const HIGH_ENERGY = {
  id: "high_energy_01", version: "1.0.0", name: "High Energy", category: "high_energy",
  description: "Motion, inserts, zooms, textos, SFX, pattern interrupts.",
  pacing: { intensity: 1.0, cutPace: "very_fast", minPlaneSec: 0.9 },
  budget: { density: "high", cooldowns: { zoom: 1.8, text: 1.2, broll: 2.5, transition: 0.25, sfx: 0.9 } },
  triggers: {
    HOOK:              [{ animation: "text_pop", priority: 1.0 }, { animation: "punch_in", params: { scale: 1.16 } }, { animation: "flash" }],
    IMPORTANT_POINT:   [{ animation: "punch_in", params: { scale: 1.12 } }, { animation: "text_pop", chance: 0.6 }],
    NUMBER:            [{ animation: "big_number", params: { sizeVw: 16 } }, { animation: "flash", chance: 0.4 }],
    KEYWORD:           [{ animation: "caption_keyword_punch" }],
    CTA:               [{ animation: "text_pop", priority: 1.0 }, { animation: "background_dim", chance: 0.5 }],
    SURPRISE:          [{ animation: "emphasis_zoom", params: { scale: 1.18 } }, { animation: "flash" }, { animation: "whip", chance: 0.5 }],
    TOPIC_CHANGE:      [{ animation: "whip", priority: 0.8 }, { animation: "flash", chance: 0.5 }],
    PATTERN_INTERRUPT: [{ animation: "flash" }, { animation: "background_dim" }, { animation: "freeze_frame", chance: 0.3 }],
    BEFORE_AFTER:      [{ animation: "split_screen" }],
    PROOF:             [{ animation: "broll_overlay" }, { animation: "big_number", chance: 0.5 }],
  },
  brandKit: { primary: "#FF0050", secondary: "#00F2EA", accent: "#FFEB3B", fontHeading: "Archivo Black" },
};

// REFERENCE_DYNAMIC_01 — Item 43. Derivado de padrões de edição viral moderna
// (Alex Hormozi, MrBeast, Iman Gadzhi style). Sem copiar vídeo específico.
const REFERENCE_DYNAMIC_01 = {
  id: "reference_dynamic_01", version: "1.0.0", name: "Reference Dynamic 01",
  category: "dynamic",
  extends: "dynamic_creator_01",
  description: "Preset experimental derivado de referência de edição dinâmica moderna.",
  tags: ["reference", "experimental"],
  pacing: { intensity: 0.72, cutPace: "fast", minPlaneSec: 1.5 },
  budget: { density: "medium_high", cooldowns: { zoom: 3, text: 2.2, broll: 4.5, transition: 0.4, sfx: 1.5 } },
  triggers: {
    HOOK:              [{ animation: "text_pop", priority: 1.0 }, { animation: "punch_in", params: { scale: 1.11 } }],
    IMPORTANT_POINT:   [{ animation: "punch_in", params: { scale: 1.09 } }, { animation: "caption_keyword_punch", chance: 0.7 }],
    NUMBER:            [{ animation: "big_number", params: { sizeVw: 12 } }, { animation: "punch_in", params: { scale: 1.10 }, chance: 0.5 }],
    KEYWORD:           [{ animation: "caption_keyword_punch" }, { animation: "underline", chance: 0.35 }],
    CTA:               [{ animation: "text_pop", priority: 1.0 }, { animation: "punch_in", params: { scale: 1.08 } }],
    PROOF:             [{ animation: "broll_overlay" }, { animation: "screenshot", chance: 0.4 }],
    SURPRISE:          [{ animation: "emphasis_zoom", params: { scale: 1.13 } }, { animation: "whip", chance: 0.4 }],
    TOPIC_CHANGE:      [{ animation: "whip", chance: 0.55 }, { animation: "smooth_cut", chance: 0.45 }],
    QUESTION:          [{ animation: "text_pop", params: { colorFrom: "#FFB020" } }],
    RESULT:            [{ animation: "big_number", chance: 0.7 }],
    LIST_ITEM:         [{ animation: "counter" }, { animation: "text_pop", params: { position: "top" } }],
    STEP:              [{ animation: "counter" }],
    PATTERN_INTERRUPT: [{ animation: "flash", chance: 0.4 }, { animation: "background_dim", chance: 0.4 }],
  },
  brandKit: { primary: "#FF6A2B", secondary: "#FF3EA5", accent: "#FFEB3B", fontHeading: "Archivo Black", fontBody: "Inter Tight" },
};

const ALL_STYLES = [
  NATURAL_CLEAN, DYNAMIC_CREATOR, VIRAL_FAST, STORYTELLING_CINEMATIC,
  PODCAST_CLIPS, TUTORIAL_PRO, TIKTOK_SHOP, UGC_ADS,
  BUSINESS_AUTHORITY, HIGH_ENERGY, REFERENCE_DYNAMIC_01,
];

const STORAGE_KEY_CUSTOM = "editoria.styles.custom.v1";
const STORAGE_KEY_FAVORITES = "editoria.styles.favorites.v1";
const STORAGE_KEY_RECENT = "editoria.styles.recent.v1";

let _stylesById = null;

function getStylesMap() {
  if (_stylesById) return _stylesById;
  _stylesById = {};
  for (const s of ALL_STYLES) _stylesById[s.id] = s;
  // Custom
  try {
    const raw = localStorage.getItem(STORAGE_KEY_CUSTOM);
    if (raw) {
      const custom = JSON.parse(raw);
      for (const s of custom) _stylesById[s.id] = s;
    }
  } catch {}
  return _stylesById;
}

export function listStyles({ category } = {}) {
  const map = getStylesMap();
  let arr = Object.values(map);
  if (category) arr = arr.filter((s) => s.category === category);
  return arr.map((s) => normalizeStyle(s, (id) => getStylesMap()[id]));
}

export function getStyleById(id) {
  const raw = getStylesMap()[id];
  if (!raw) return null;
  const normalized = normalizeStyle(raw, (id2) => getStylesMap()[id2]);
  const v = validateStyle(normalized);
  if (!v.ok) console.warn(`[styleRegistry] "${id}" invalid:`, v.errors);
  return normalized;
}

export function listCategories() {
  const map = getStylesMap();
  const cats = new Set(Object.values(map).map((s) => s.category));
  return Array.from(cats);
}

// ============================================================================
// CUSTOM STYLES (Item 19, 35)
// ============================================================================
export function saveCustomStyle(style) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_CUSTOM);
    const arr = raw ? JSON.parse(raw) : [];
    const idx = arr.findIndex((s) => s.id === style.id);
    if (idx >= 0) arr[idx] = style; else arr.push(style);
    localStorage.setItem(STORAGE_KEY_CUSTOM, JSON.stringify(arr));
    _stylesById = null; // invalida cache
    return true;
  } catch { return false; }
}

export function deleteCustomStyle(id) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_CUSTOM);
    if (!raw) return false;
    const arr = JSON.parse(raw).filter((s) => s.id !== id);
    localStorage.setItem(STORAGE_KEY_CUSTOM, JSON.stringify(arr));
    _stylesById = null;
    return true;
  } catch { return false; }
}

// ============================================================================
// FAVORITES (Item 34)
// ============================================================================
export function loadFavorites() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_FAVORITES);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}
export function toggleFavorite(styleId) {
  const favs = loadFavorites();
  const idx = favs.indexOf(styleId);
  if (idx >= 0) favs.splice(idx, 1); else favs.push(styleId);
  try { localStorage.setItem(STORAGE_KEY_FAVORITES, JSON.stringify(favs)); } catch {}
  return favs;
}

// ============================================================================
// RECENT
// ============================================================================
export function markRecent(styleId) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_RECENT);
    let arr = raw ? JSON.parse(raw) : [];
    arr = [styleId, ...arr.filter((x) => x !== styleId)].slice(0, 6);
    localStorage.setItem(STORAGE_KEY_RECENT, JSON.stringify(arr));
  } catch {}
}
export function loadRecent() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_RECENT);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

// ============================================================================
// EXPORT ARQUITETURA FUTURA
// ============================================================================
export function exportStyleAsJson(id) {
  const s = getStyleById(id);
  return s ? JSON.stringify(s, null, 2) : null;
}
export function importStyleFromJson(jsonStr) {
  const parsed = JSON.parse(jsonStr);
  const v = validateStyle(parsed);
  if (!v.ok) throw new Error(`invalid: ${v.errors.join(",")}`);
  saveCustomStyle(parsed);
  return parsed;
}

export const BASE_STYLE_IDS = ALL_STYLES.map((s) => s.id);
