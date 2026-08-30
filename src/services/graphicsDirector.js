// Graphics Director — emite recomendações de OVERLAYS VISUAIS:
//   - text_overlay (Item 11): números destacados, valores, benefícios
//   - big_number (Item 14): número/porcentagem gigante em tela
//   - callout (Item 13): seta/círculo/underline apontando pra algo
//   - checklist (Item 13): lista de bullets
//
// Complementa a legenda — texto de apoio NÃO duplica caption, destaca
// dados que a fala menciona rápido.
//
// Determinístico, zero LLM. Consome words + narrative.timeline.

import { keywordBoost } from "./captionLayoutEngine.js";

/**
 * @typedef {Object} GraphicOverlay
 * @property {"text_overlay"|"big_number"|"callout"|"checklist"} kind
 * @property {number} start
 * @property {number} end
 * @property {string} text
 * @property {number} confidence
 * @property {string} reason
 * @property {object} [style]
 */

const NUMBER_RE = /^\d+([.,]\d+)?%?$/;
const CURRENCY_RE = /^(R\$|\$|€)\s*\d+([.,]\d+)?$/;

/**
 * Detecta se uma palavra é um NÚMERO grande merecedor de big-number overlay.
 */
function isBigNumber(word) {
  const clean = String(word || "").replace(/[.,;:!?]/g, "").trim();
  if (NUMBER_RE.test(clean)) {
    const n = parseFloat(clean.replace(/%/g, "").replace(",", "."));
    // Números "impactantes": porcentagens, > 100, valores
    if (/%$/.test(clean)) return true;
    if (n >= 100 || n <= 5) return true; // ex: "3 dicas", "97% falham"
    return false;
  }
  if (CURRENCY_RE.test(clean.replace(/\s+/g, ""))) return true;
  return false;
}

/**
 * Extrai frase de contexto (2-3 palavras) que acompanha o número.
 * Ex: "97% ABANDONAM" — pega "ABANDONAM" da próxima palavra.
 */
function contextAround(words, idx) {
  const next = words[idx + 1];
  if (next && next.word) {
    const w = String(next.word).replace(/[.,;:!?]/g, "").trim();
    if (w.length >= 3 && w.length <= 12) return w.toUpperCase();
  }
  return null;
}

/**
 * @param {object} args
 * @param {Array} args.words                 - word timestamps
 * @param {{ timeline: Array }} args.narrative
 * @param {Array} args.segments
 * @param {object} args.profile
 * @returns {{ overlays: GraphicOverlay[], summary: object }}
 */
export function buildGraphicsPlan({ words = [], narrative, segments = [], profile = {} } = {}) {
  const overlays = [];
  const activeSegs = segments.filter((s) => !s.deleted && s.action !== "review" && s.action !== "trim");
  const inActive = (t) => activeSegs.some((s) => t >= s.start - 0.05 && t < s.end + 0.05);

  // 1) BIG NUMBERS — detectar números impactantes no áudio
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (!inActive(w.start)) continue;
    if (!isBigNumber(w.word)) continue;
    const ctx = contextAround(words, i);
    const durSec = Math.min(2.5, Math.max(1.2, w.end - w.start + 1.0));
    overlays.push({
      kind: "big_number",
      start: w.start,
      end: w.start + durSec,
      text: String(w.word).replace(/[.,;:!?]/g, "").trim() + (ctx ? `\n${ctx}` : ""),
      confidence: 0.90,
      reason: "número impactante mencionado",
      style: { size: "xxl", color: "gradient" },
    });
  }

  // 2) TEXT OVERLAY — palavras de alto boost (CTA/benefício/CAPS/contraste)
  //    quando aparecem em role de alta importância.
  const timeline = narrative?.timeline || [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (!inActive(w.start)) continue;
    if (isBigNumber(w.word)) continue; // já virou big_number
    const boost = keywordBoost(w.word);
    if (!boost || boost < 0.80) continue;
    // Precisa estar em sentence de alta importância
    const inRole = timeline.find((s) => w.start >= s.start && w.start < s.end);
    if (!inRole || (inRole.importance !== "critical" && inRole.importance !== "high")) continue;
    const dur = 1.5;
    overlays.push({
      kind: "text_overlay",
      start: w.start,
      end: w.start + dur,
      text: String(w.word).replace(/[.,;:!?]/g, "").toUpperCase().trim(),
      confidence: Math.round(boost * 100) / 100,
      reason: "palavra-chave de impacto",
      style: { size: "l", color: "accent" },
    });
  }

  // Dedup — se 2 overlays no mesmo start±0.3s, mantém o de maior conf
  overlays.sort((a, b) => a.start - b.start);
  const dedup = [];
  for (const o of overlays) {
    const prev = dedup[dedup.length - 1];
    if (prev && Math.abs(prev.start - o.start) < 0.3) {
      if (o.confidence > prev.confidence) dedup[dedup.length - 1] = o;
      continue;
    }
    dedup.push(o);
  }

  return {
    overlays: dedup,
    summary: {
      totalCandidates: overlays.length,
      emitted: dedup.length,
      big_numbers: dedup.filter((o) => o.kind === "big_number").length,
      text_overlays: dedup.filter((o) => o.kind === "text_overlay").length,
    },
  };
}
