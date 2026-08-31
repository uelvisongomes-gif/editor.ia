// Animation Registry — Item 5.
// Índice único de todas as animações. Cada animação é uma função pura
// (ctx, params) → TimelineEvent.
//
// Uma implementação = todos os estilos que a usam apenas variam params.

import { jitter } from "./seedRandom.js";

/**
 * @typedef {Object} AnimationContext
 * @property {number} t             - tempo em segundos
 * @property {number} [tEnd]        - opcional
 * @property {object} [brandKit]
 * @property {object} [trigger]     - o Trigger que ativou
 * @property {Function} [rng]       - seed RNG
 */

/**
 * @typedef {Object} TimelineEvent
 * @property {string} id            - único
 * @property {string} category      - "zoom" | "text" | "caption" | "graphic" | "media" | "transition" | "sfx" | "camera" | "special"
 * @property {string} animation
 * @property {number} start
 * @property {number} end
 * @property {object} params        - params para o renderer
 * @property {string} trigger       - trigger que gerou
 * @property {string} styleId
 * @property {number} confidence
 * @property {string} reason
 */

let _eventCounter = 0;
function nextId() { return `fx_${++_eventCounter}_${Date.now().toString(36)}`; }

function mkEvent(base) {
  return {
    id: nextId(),
    ...base,
  };
}

// ========================================================================
// ZOOM
// ========================================================================
export function punch_in(ctx, params = {}) {
  const dur = params.duration ?? jitter(ctx.rng || Math.random, 0.7, 1.0);
  const scale = params.scale ?? 1.08;
  return mkEvent({
    category: "zoom", animation: "punch_in",
    start: ctx.t, end: ctx.t + dur,
    params: { scale, ease: params.ease || "easeOutCubic" },
    trigger: ctx.trigger?.type, styleId: ctx.styleId,
    confidence: ctx.trigger?.confidence || 0.8,
    reason: params.reason || `${ctx.trigger?.type || "manual"} → punch_in`,
  });
}

export function punch_out(ctx, params = {}) {
  const dur = params.duration ?? 0.6;
  return mkEvent({
    category: "zoom", animation: "punch_out",
    start: ctx.t, end: ctx.t + dur,
    params: { scale: params.scale ?? 0.94, ease: params.ease || "easeOutQuad" },
    trigger: ctx.trigger?.type, styleId: ctx.styleId,
    confidence: ctx.trigger?.confidence || 0.7,
    reason: params.reason || "punch_out",
  });
}

export function smooth_zoom_in(ctx, params = {}) {
  return mkEvent({
    category: "zoom", animation: "smooth_zoom_in",
    start: ctx.t, end: ctx.t + (params.duration ?? 2.5),
    params: { scale: params.scale ?? 1.05, ease: "easeInOutSine" },
    trigger: ctx.trigger?.type, styleId: ctx.styleId,
    confidence: ctx.trigger?.confidence || 0.6,
    reason: params.reason || "smooth zoom",
  });
}

export function smooth_zoom_out(ctx, params = {}) {
  return mkEvent({
    category: "zoom", animation: "smooth_zoom_out",
    start: ctx.t, end: ctx.t + (params.duration ?? 2.5),
    params: { scale: params.scale ?? 0.97, ease: "easeInOutSine" },
    trigger: ctx.trigger?.type, styleId: ctx.styleId,
    confidence: ctx.trigger?.confidence || 0.6,
    reason: params.reason || "smooth zoom out",
  });
}

export function emphasis_zoom(ctx, params = {}) {
  return mkEvent({
    category: "zoom", animation: "emphasis_zoom",
    start: ctx.t, end: ctx.t + (params.duration ?? 1.4),
    params: { scale: params.scale ?? 1.14, ease: "easeOutQuint" },
    trigger: ctx.trigger?.type, styleId: ctx.styleId,
    confidence: ctx.trigger?.confidence || 0.85,
    reason: params.reason || "emphasis",
  });
}

// ========================================================================
// TEXT
// ========================================================================
export function text_pop(ctx, params = {}) {
  const text = params.text || ctx.trigger?.text || "";
  return mkEvent({
    category: "text", animation: "text_pop",
    start: ctx.t, end: ctx.t + (params.duration ?? 2.4),
    params: {
      text, position: params.position || "top",
      colorFrom: params.colorFrom || ctx.brandKit?.primary,
      colorTo: params.colorTo || ctx.brandKit?.secondary,
      font: params.font || ctx.brandKit?.fontHeading,
      scaleFrom: 0.7, scaleTo: 1.0, ease: "easeOutBack",
    },
    trigger: ctx.trigger?.type, styleId: ctx.styleId,
    confidence: ctx.trigger?.confidence || 0.8,
    reason: params.reason || `text pop: ${text.slice(0, 30)}`,
  });
}

export function text_slide(ctx, params = {}) {
  return mkEvent({
    category: "text", animation: "text_slide",
    start: ctx.t, end: ctx.t + (params.duration ?? 2.2),
    params: {
      text: params.text || ctx.trigger?.text || "",
      direction: params.direction || "left",
      colorFrom: params.colorFrom || ctx.brandKit?.primary,
      colorTo: params.colorTo || ctx.brandKit?.secondary,
    },
    trigger: ctx.trigger?.type, styleId: ctx.styleId,
    confidence: 0.7, reason: "text slide",
  });
}

export function text_typewriter(ctx, params = {}) {
  const text = params.text || ctx.trigger?.text || "";
  return mkEvent({
    category: "text", animation: "text_typewriter",
    start: ctx.t, end: ctx.t + (params.duration ?? Math.max(1.5, text.length * 0.05)),
    params: { text, charDelay: 0.05, font: ctx.brandKit?.fontHeading },
    trigger: ctx.trigger?.type, styleId: ctx.styleId,
    confidence: 0.75, reason: "typewriter",
  });
}

export function big_number(ctx, params = {}) {
  const number = params.number ?? ctx.trigger?.value ?? "";
  return mkEvent({
    category: "text", animation: "big_number",
    start: ctx.t, end: ctx.t + (params.duration ?? 2.6),
    params: {
      text: String(number),
      font: params.font || ctx.brandKit?.fontHeading || "Archivo Black",
      sizeVw: params.sizeVw ?? 10,
      colorFrom: params.colorFrom || ctx.brandKit?.primary,
      colorTo: params.colorTo || ctx.brandKit?.secondary,
      position: "18%",
    },
    trigger: ctx.trigger?.type, styleId: ctx.styleId,
    confidence: ctx.trigger?.confidence || 0.9,
    reason: `big number: ${number}`,
  });
}

export function quote_card(ctx, params = {}) {
  return mkEvent({
    category: "text", animation: "quote_card",
    start: ctx.t, end: ctx.t + (params.duration ?? 3.5),
    params: {
      text: params.text || ctx.trigger?.text || "",
      background: params.background || "#0F0621",
      textColor: "#F5EFFF",
      accent: ctx.brandKit?.accent,
    },
    trigger: ctx.trigger?.type, styleId: ctx.styleId,
    confidence: 0.8, reason: "quote",
  });
}

// ========================================================================
// CAPTIONS
// ========================================================================
export function caption_pop(ctx, params = {}) {
  return mkEvent({
    category: "caption", animation: "caption_pop",
    start: ctx.t, end: ctx.tEnd ?? ctx.t + (params.duration ?? 2.0),
    params: {
      maxWords: params.maxWords ?? 5, position: params.position || "bottom",
      keywordHighlight: params.keywordHighlight ?? true,
      highlightColor: params.highlightColor || ctx.brandKit?.primary,
      font: params.font || ctx.brandKit?.fontBody,
      scale: params.scale ?? 1.0,
    },
    trigger: ctx.trigger?.type, styleId: ctx.styleId,
    confidence: 0.85, reason: "caption pop",
  });
}
export const caption_fade  = (ctx, p = {}) => ({ ...caption_pop(ctx, { ...p, style: "fade" }), animation: "caption_fade" });
export const caption_slide = (ctx, p = {}) => ({ ...caption_pop(ctx, { ...p, style: "slide" }), animation: "caption_slide" });
export const caption_scale = (ctx, p = {}) => ({ ...caption_pop(ctx, { ...p, style: "scale" }), animation: "caption_scale" });
export const caption_bounce= (ctx, p = {}) => ({ ...caption_pop(ctx, { ...p, style: "bounce" }), animation: "caption_bounce" });
export const caption_word_focus = (ctx, p = {}) => ({ ...caption_pop(ctx, { ...p, style: "word_focus" }), animation: "caption_word_focus" });
export const caption_keyword_punch = (ctx, p = {}) => ({ ...caption_pop(ctx, { ...p, keywordHighlight: true, style: "keyword_punch" }), animation: "caption_keyword_punch" });

// ========================================================================
// TRANSITIONS
// ========================================================================
export function hard_cut(ctx, params = {}) {
  return mkEvent({
    category: "transition", animation: "hard_cut",
    start: ctx.t, end: ctx.t + 0.001,
    params: {},
    trigger: ctx.trigger?.type, styleId: ctx.styleId,
    confidence: 1.0, reason: "hard cut",
  });
}
export function smooth_cut(ctx, params = {}) {
  return mkEvent({
    category: "transition", animation: "smooth_cut",
    start: ctx.t, end: ctx.t + (params.duration ?? 0.12),
    params: { crossfadeMs: 120 },
    trigger: ctx.trigger?.type, styleId: ctx.styleId,
    confidence: 0.95, reason: "smooth cut",
  });
}
export function whip(ctx, params = {}) {
  return mkEvent({
    category: "transition", animation: "whip",
    start: ctx.t, end: ctx.t + (params.duration ?? 0.28),
    params: { direction: params.direction || "left", blur: 40 },
    trigger: ctx.trigger?.type, styleId: ctx.styleId,
    confidence: 0.8, reason: "whip transition",
  });
}
export const blur     = (ctx, p = {}) => ({ ...smooth_cut(ctx, { duration: 0.3, ...p }), animation: "blur",     params: { blurAmount: 12 } });
export const flash    = (ctx, p = {}) => ({ ...smooth_cut(ctx, { duration: 0.15, ...p }), animation: "flash",    params: { color: "#FFFFFF" } });
export const push     = (ctx, p = {}) => ({ ...whip(ctx, p), animation: "push",     params: { direction: p.direction || "right" } });
export const slide    = (ctx, p = {}) => ({ ...whip(ctx, { duration: 0.4, ...p }), animation: "slide",    params: { direction: p.direction || "up" } });
export const mask_transition = (ctx, p = {}) => ({ ...smooth_cut(ctx, { duration: 0.5, ...p }), animation: "mask_transition", params: { mask: p.mask || "circle" } });

// ========================================================================
// GRAPHICS
// ========================================================================
export function underline(ctx, params = {}) {
  return mkEvent({
    category: "graphic", animation: "underline",
    start: ctx.t, end: ctx.t + (params.duration ?? 1.5),
    params: { text: params.text || ctx.trigger?.text || "", color: ctx.brandKit?.primary },
    trigger: ctx.trigger?.type, styleId: ctx.styleId,
    confidence: 0.7, reason: "underline",
  });
}
export function circle_highlight(ctx, params = {}) {
  return mkEvent({
    category: "graphic", animation: "circle_highlight",
    start: ctx.t, end: ctx.t + (params.duration ?? 1.8),
    params: { x: params.x || 0.5, y: params.y || 0.5, radius: params.radius || 0.15, color: ctx.brandKit?.primary, strokeWidth: 3 },
    trigger: ctx.trigger?.type, styleId: ctx.styleId,
    confidence: 0.7, reason: "circle",
  });
}
export function arrow(ctx, params = {}) {
  return mkEvent({
    category: "graphic", animation: "arrow",
    start: ctx.t, end: ctx.t + (params.duration ?? 1.8),
    params: { from: params.from || [0.1, 0.5], to: params.to || [0.5, 0.5], color: ctx.brandKit?.primary },
    trigger: ctx.trigger?.type, styleId: ctx.styleId,
    confidence: 0.65, reason: "arrow",
  });
}
export function callout(ctx, params = {}) {
  return mkEvent({
    category: "graphic", animation: "callout",
    start: ctx.t, end: ctx.t + (params.duration ?? 2.2),
    params: { text: params.text || "", anchor: params.anchor || [0.5, 0.3], background: ctx.brandKit?.primary },
    trigger: ctx.trigger?.type, styleId: ctx.styleId,
    confidence: 0.7, reason: "callout",
  });
}
export const box     = (ctx, p = {}) => ({ ...callout(ctx, { ...p }), animation: "box",     params: { ...p, shape: "box" } });
export const counter = (ctx, p = {}) => ({ ...big_number(ctx, { number: `#${(p.n||1)}`, ...p }), animation: "counter" });
export const checklist = (ctx, p = {}) => ({ ...callout(ctx, { ...p }), animation: "checklist", params: { items: p.items || [], done: p.done || [] } });
export const progress = (ctx, p = {}) => ({ ...callout(ctx, { ...p }), animation: "progress", params: { value: p.value ?? 0.5 } });
export const badge = (ctx, p = {}) => ({ ...callout(ctx, { ...p }), animation: "badge", params: { text: p.text || "NOVO", color: ctx.brandKit?.accent } });

// ========================================================================
// MEDIA
// ========================================================================
export function broll_overlay(ctx, params = {}) {
  return mkEvent({
    category: "media", animation: "broll_overlay",
    start: ctx.t, end: ctx.t + (params.duration ?? 3.0),
    params: {
      opacity: params.opacity ?? 0.85,
      mode: params.mode || "fullscreen",
      mediaUrl: params.mediaUrl || null,
      query: params.query || ctx.trigger?.text || "",
    },
    trigger: ctx.trigger?.type, styleId: ctx.styleId,
    confidence: ctx.trigger?.confidence || 0.75,
    reason: `B-roll: ${params.query || ctx.trigger?.text || ""}`,
  });
}
export const image_popup = (ctx, p = {}) => ({ ...broll_overlay(ctx, p), animation: "image_popup", params: { ...p, mode: "popup" } });
export const image_slide = (ctx, p = {}) => ({ ...broll_overlay(ctx, p), animation: "image_slide", params: { ...p, mode: "slide" } });
export const image_scale = (ctx, p = {}) => ({ ...broll_overlay(ctx, p), animation: "image_scale", params: { ...p, mode: "scale" } });
export const screenshot  = (ctx, p = {}) => ({ ...broll_overlay(ctx, p), animation: "screenshot", params: { ...p, mode: "screenshot" } });
export const split_screen = (ctx, p = {}) => ({ ...broll_overlay(ctx, p), animation: "split_screen", params: { ...p, mode: "split" } });
export const picture_in_picture = (ctx, p = {}) => ({ ...broll_overlay(ctx, p), animation: "picture_in_picture", params: { ...p, mode: "pip", opacity: 1 } });

// ========================================================================
// CAMERA
// ========================================================================
export function auto_reframe(ctx, params = {}) {
  return mkEvent({
    category: "camera", animation: "auto_reframe",
    start: ctx.t, end: ctx.t + (params.duration ?? 1.5),
    params: { target: params.target || "face", smoothMs: 400 },
    trigger: ctx.trigger?.type, styleId: ctx.styleId,
    confidence: 0.75, reason: "auto reframe",
  });
}
export const face_track = (ctx, p = {}) => ({ ...auto_reframe(ctx, p), animation: "face_track", params: { target: "face" } });
export const product_track = (ctx, p = {}) => ({ ...auto_reframe(ctx, p), animation: "product_track", params: { target: "product" } });
export const horizontal_shift = (ctx, p = {}) => ({ ...auto_reframe(ctx, p), animation: "horizontal_shift", params: { axis: "x", delta: p.delta || 0.1 } });
export const vertical_shift = (ctx, p = {}) => ({ ...auto_reframe(ctx, p), animation: "vertical_shift", params: { axis: "y", delta: p.delta || 0.05 } });

// ========================================================================
// SPECIAL
// ========================================================================
export function freeze_frame(ctx, params = {}) {
  return mkEvent({
    category: "special", animation: "freeze_frame",
    start: ctx.t, end: ctx.t + (params.duration ?? 1.0),
    params: {},
    trigger: ctx.trigger?.type, styleId: ctx.styleId,
    confidence: 0.8, reason: "freeze",
  });
}
export function background_blur(ctx, params = {}) {
  return mkEvent({
    category: "special", animation: "background_blur",
    start: ctx.t, end: ctx.t + (params.duration ?? 2.0),
    params: { amount: params.amount ?? 8 },
    trigger: ctx.trigger?.type, styleId: ctx.styleId,
    confidence: 0.7, reason: "bg blur",
  });
}
export function background_dim(ctx, params = {}) {
  return mkEvent({
    category: "special", animation: "background_dim",
    start: ctx.t, end: ctx.t + (params.duration ?? 2.0),
    params: { alpha: params.alpha ?? 0.4 },
    trigger: ctx.trigger?.type, styleId: ctx.styleId,
    confidence: 0.7, reason: "bg dim",
  });
}
export function focus_subject(ctx, params = {}) {
  return mkEvent({
    category: "special", animation: "focus_subject",
    start: ctx.t, end: ctx.t + (params.duration ?? 1.5),
    params: {},
    trigger: ctx.trigger?.type, styleId: ctx.styleId,
    confidence: 0.75, reason: "focus subject",
  });
}

// ========================================================================
// REGISTRY MAP
// ========================================================================
export const ANIMATIONS = {
  // Zoom
  punch_in, punch_out, smooth_zoom_in, smooth_zoom_out, emphasis_zoom,
  // Text
  text_pop, text_slide, text_typewriter, big_number, quote_card,
  // Captions
  caption_pop, caption_fade, caption_slide, caption_scale, caption_bounce, caption_word_focus, caption_keyword_punch,
  // Transitions
  hard_cut, smooth_cut, whip, blur, flash, push, slide, mask_transition,
  // Graphics
  underline, circle_highlight, arrow, callout, box, counter, checklist, progress, badge,
  // Media
  broll_overlay, image_popup, image_slide, image_scale, screenshot, split_screen, picture_in_picture,
  // Camera
  auto_reframe, face_track, product_track, horizontal_shift, vertical_shift,
  // Special
  freeze_frame, background_blur, background_dim, focus_subject,
};

/**
 * Executa uma animation por nome, com fallback (Item 37).
 */
export function runAnimation(name, ctx, params = {}, fallbackName = "hard_cut") {
  const fn = ANIMATIONS[name] || ANIMATIONS[fallbackName];
  if (!fn) return null;
  try {
    return fn(ctx, params);
  } catch (err) {
    console.warn(`[animationRegistry] "${name}" falhou, usando fallback "${fallbackName}":`, err.message);
    return ANIMATIONS[fallbackName]?.(ctx, params) || null;
  }
}

export function listAnimations() {
  return Object.keys(ANIMATIONS);
}

export function animationExists(name) {
  return name in ANIMATIONS;
}
