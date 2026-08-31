// Composition Registry — define COMO A TELA É COMPOSTA em cada momento.
// Cada composição = um layout de retângulos (em % do viewport 9:16) + regras
// de quais elementos podem ocupar cada slot.
//
// Isso é o que faz a EDIÇÃO REALMENTE DIFERENTE — muda o layout, não só cor.
//
// 12 composições:
//   6 com renderer real (full_speaker, top_media_bottom_speaker,
//   picture_in_picture, full_broll, big_number_composed, quote)
//   6 stubs prontos pra próxima iteração (speaker_side_media, screenshot_focus,
//   product_focus, big_text, before_after, multi_media)

/**
 * @typedef {Object} SlotRect
 * @property {number} x       - 0-1 (fração do viewport)
 * @property {number} y       - 0-1
 * @property {number} w       - 0-1
 * @property {number} h       - 0-1
 * @property {string} anchor  - "speaker" | "media" | "text" | "number" | "quote" | "product" | "screenshot"
 */

/**
 * @typedef {Object} CompositionDef
 * @property {string} id
 * @property {string} name
 * @property {string} description
 * @property {SlotRect[]} slots       - retângulos disponíveis
 * @property {string[]} requires      - "media" | "number" | "text" | "product" | "screenshot"
 * @property {string[]} allowsOverlay - "caption" | "keyword" | "badge"
 * @property {boolean} implemented    - se o App.jsx sabe renderizar
 * @property {number} minDurationSec  - duração mínima
 * @property {number} maxDurationSec  - duração máxima
 */

// ============================================================================
// 6 COMPOSIÇÕES COM RENDERER REAL
// ============================================================================

export const FULL_SPEAKER = {
  id: "full_speaker",
  name: "Full Speaker",
  description: "Pessoa ocupa a tela inteira. Legendas embaixo, pouca decoração.",
  slots: [
    { x: 0, y: 0, w: 1, h: 1, anchor: "speaker" },
  ],
  requires: [],
  allowsOverlay: ["caption", "keyword", "badge"],
  implemented: true,
  minDurationSec: 1.5, maxDurationSec: 999,
};

export const TOP_MEDIA_BOTTOM_SPEAKER = {
  id: "top_media_bottom_speaker",
  name: "Top B-roll + Bottom Speaker",
  description: "B-roll/imagem/screenshot no topo, speaker embaixo mostrando o rosto.",
  slots: [
    { x: 0, y: 0,    w: 1, h: 0.5, anchor: "media" },
    { x: 0, y: 0.5,  w: 1, h: 0.5, anchor: "speaker" },
  ],
  requires: ["media"],
  allowsOverlay: ["caption"],
  implemented: true,
  minDurationSec: 2.0, maxDurationSec: 8,
};

export const PICTURE_IN_PICTURE = {
  id: "picture_in_picture",
  name: "Picture in Picture",
  description: "Speaker grande, mídia em janela menor no canto.",
  slots: [
    { x: 0,    y: 0,    w: 1,    h: 1,    anchor: "speaker" },
    { x: 0.55, y: 0.05, w: 0.4,  h: 0.28, anchor: "media" },
  ],
  requires: ["media"],
  allowsOverlay: ["caption", "keyword"],
  implemented: true,
  minDurationSec: 1.5, maxDurationSec: 6,
};

export const FULL_BROLL = {
  id: "full_broll",
  name: "Full B-roll",
  description: "B-roll ocupa a tela inteira, áudio original continua.",
  slots: [
    { x: 0, y: 0, w: 1, h: 1, anchor: "media" },
  ],
  requires: ["media"],
  allowsOverlay: ["caption"],
  implemented: true,
  minDurationSec: 1.5, maxDurationSec: 5,
};

export const BIG_NUMBER_COMPOSED = {
  id: "big_number_composed",
  name: "Big Number",
  description: "Número/dado grande no topo, speaker embaixo mostrando reação.",
  slots: [
    { x: 0, y: 0,    w: 1, h: 0.55, anchor: "number" },
    { x: 0, y: 0.55, w: 1, h: 0.45, anchor: "speaker" },
  ],
  requires: ["number"],
  allowsOverlay: ["caption"],
  implemented: true,
  minDurationSec: 1.2, maxDurationSec: 3.5,
};

export const QUOTE_COMPOSITION = {
  id: "quote",
  name: "Quote / Frase forte",
  description: "Frase em card centralizado, speaker desfocado atrás.",
  slots: [
    { x: 0, y: 0, w: 1, h: 1, anchor: "speaker" },
    { x: 0.08, y: 0.32, w: 0.84, h: 0.36, anchor: "quote" },
  ],
  requires: ["text"],
  allowsOverlay: [],
  implemented: true,
  minDurationSec: 2.0, maxDurationSec: 5,
};

// ============================================================================
// 6 COMPOSIÇÕES STUB (próxima iteração)
// ============================================================================

export const SPEAKER_SIDE_MEDIA = {
  id: "speaker_side_media",
  name: "Speaker + Side Media",
  description: "Speaker em um lado, mídia do outro (horizontal ou split vertical).",
  slots: [
    { x: 0,   y: 0, w: 0.5, h: 1, anchor: "speaker" },
    { x: 0.5, y: 0, w: 0.5, h: 1, anchor: "media" },
  ],
  requires: ["media"],
  allowsOverlay: ["caption"],
  implemented: false,
  minDurationSec: 2, maxDurationSec: 5,
};

export const SCREENSHOT_FOCUS = {
  id: "screenshot_focus",
  name: "Screenshot Focus",
  description: "Screenshot ocupa quase toda tela com zoom/pan; speaker pequeno.",
  slots: [
    { x: 0, y: 0, w: 1, h: 1, anchor: "screenshot" },
    { x: 0.7, y: 0.75, w: 0.28, h: 0.22, anchor: "speaker" },
  ],
  requires: ["screenshot"],
  allowsOverlay: ["caption"],
  implemented: false,
  minDurationSec: 2, maxDurationSec: 6,
};

export const PRODUCT_FOCUS = {
  id: "product_focus",
  name: "Product Focus",
  description: "Produto ampliado + preço/benefício em callout.",
  slots: [
    { x: 0.1, y: 0.15, w: 0.8, h: 0.55, anchor: "product" },
    { x: 0,   y: 0.7,  w: 1,   h: 0.3,  anchor: "speaker" },
  ],
  requires: ["product"],
  allowsOverlay: ["caption", "badge"],
  implemented: false,
  minDurationSec: 2, maxDurationSec: 6,
};

export const BIG_TEXT = {
  id: "big_text",
  name: "Big Text",
  description: "Texto grande dominante — quote, alerta, virada narrativa.",
  slots: [
    { x: 0, y: 0, w: 1, h: 1, anchor: "text" },
  ],
  requires: ["text"],
  allowsOverlay: [],
  implemented: false,
  minDurationSec: 1.5, maxDurationSec: 3,
};

export const BEFORE_AFTER = {
  id: "before_after",
  name: "Before / After",
  description: "Split vertical (top:ANTES / bottom:DEPOIS) ou transição wipe.",
  slots: [
    { x: 0, y: 0,   w: 1, h: 0.5, anchor: "media" },
    { x: 0, y: 0.5, w: 1, h: 0.5, anchor: "media" },
  ],
  requires: ["media"],
  allowsOverlay: ["caption"],
  implemented: false,
  minDurationSec: 2, maxDurationSec: 5,
};

export const MULTI_MEDIA = {
  id: "multi_media",
  name: "Multi Media",
  description: "Speaker + mídia + texto curto simultâneos, controlado por density budget.",
  slots: [
    { x: 0,    y: 0,    w: 0.55, h: 0.5, anchor: "media" },
    { x: 0.55, y: 0,    w: 0.45, h: 0.5, anchor: "text" },
    { x: 0,    y: 0.5,  w: 1,    h: 0.5, anchor: "speaker" },
  ],
  requires: ["media"],
  allowsOverlay: ["caption"],
  implemented: false,
  minDurationSec: 2, maxDurationSec: 5,
};

// ============================================================================
// REGISTRY
// ============================================================================

export const COMPOSITIONS = {
  full_speaker: FULL_SPEAKER,
  top_media_bottom_speaker: TOP_MEDIA_BOTTOM_SPEAKER,
  picture_in_picture: PICTURE_IN_PICTURE,
  full_broll: FULL_BROLL,
  big_number_composed: BIG_NUMBER_COMPOSED,
  quote: QUOTE_COMPOSITION,
  speaker_side_media: SPEAKER_SIDE_MEDIA,
  screenshot_focus: SCREENSHOT_FOCUS,
  product_focus: PRODUCT_FOCUS,
  big_text: BIG_TEXT,
  before_after: BEFORE_AFTER,
  multi_media: MULTI_MEDIA,
};

export function getComposition(id) {
  return COMPOSITIONS[id] || FULL_SPEAKER;
}
export function listCompositions({ implementedOnly = false } = {}) {
  const all = Object.values(COMPOSITIONS);
  return implementedOnly ? all.filter((c) => c.implemented) : all;
}
export function compositionSupportsMedia(id, hasMedia, hasNumber, hasText) {
  const c = getComposition(id);
  for (const req of c.requires) {
    if (req === "media" && !hasMedia) return false;
    if (req === "number" && !hasNumber) return false;
    if (req === "text" && !hasText) return false;
  }
  return true;
}
