// Trigger Engine — Item 8.
// Traduz análises (narrative + words + audioReport + productMoments +
// patternInterrupts) em Triggers semânticos que o EffectDecisionLayer
// consome pra escolher animações.
//
// IMPORTANTE (Item 9): Trigger define QUANDO. Style define COMO.

/**
 * @typedef {Object} Trigger
 * @property {string} type             - HOOK | QUESTION | ANSWER | KEYWORD | IMPORTANT_POINT | NUMBER | PRICE | BENEFIT | PROBLEM | SOLUTION | CTA | EMOTION | SURPRISE | TOPIC_CHANGE | PRODUCT | PRODUCT_DEMONSTRATION | BEFORE_AFTER | LIST_ITEM | STEP | QUOTE | WARNING | PROOF | RESULT | PATTERN_INTERRUPT | KEYWORD
 * @property {number} t                - segundo em que ocorre
 * @property {number} [tEnd]           - opcional
 * @property {number} confidence       - 0-1
 * @property {string} [text]           - trecho de fala
 * @property {any} [value]             - pra NUMBER/PRICE
 * @property {object} [meta]
 */

const NUMBER_REGEX = /\b(\d+([.,]\d+)?)\s?(mil|milhão|milhões|%|k|M|reais?|R\$)?\b/gi;
const PRICE_REGEX = /(R\$\s?\d+[.,]?\d*|\$\s?\d+[.,]?\d*|\d+\s?(reais|dólares))/gi;
const KEYWORD_HINTS = new Set([
  "importante", "atenção", "cuidado", "olha", "veja", "escuta",
  "principal", "segredo", "verdade", "grátis", "gratuito",
  "novo", "primeiro", "único", "melhor", "pior",
  "sempre", "nunca", "jamais",
]);
const QUESTION_HINTS = /\?|(como|por que|porque|será|será que|onde|quando|quem)\s/gi;

/**
 * @param {object} args
 * @param {object} args.narrative      - { timeline: [...], criticalSpans, weakSpots }
 * @param {Array} args.words
 * @param {object} [args.audioReport]
 * @param {object} [args.productMoments]
 * @param {object} [args.patternInterrupts]
 * @returns {Trigger[]}
 */
export function extractTriggers({
  narrative, words = [], audioReport, productMoments, patternInterrupts,
} = {}) {
  const triggers = [];
  const timeline = narrative?.timeline || [];

  // 1) Traduz roles narrativos em triggers
  for (const item of timeline) {
    const conf = (item.confidence ?? 70) / 100;
    switch (item.role) {
      case "hook":
        triggers.push({ type: "HOOK", t: item.start, tEnd: item.end, confidence: conf, text: item.text, meta: { importance: item.importance } });
        break;
      case "cta":
        triggers.push({ type: "CTA", t: item.start, tEnd: item.end, confidence: conf, text: item.text });
        break;
      case "problem":
        triggers.push({ type: "PROBLEM", t: item.start, tEnd: item.end, confidence: conf, text: item.text });
        break;
      case "solution":
        triggers.push({ type: "SOLUTION", t: item.start, tEnd: item.end, confidence: conf, text: item.text });
        break;
      case "proof":
        triggers.push({ type: "PROOF", t: item.start, tEnd: item.end, confidence: conf, text: item.text });
        triggers.push({ type: "RESULT", t: item.start, tEnd: item.end, confidence: conf * 0.9, text: item.text });
        break;
      case "turn":
        triggers.push({ type: "SURPRISE", t: item.start, tEnd: item.end, confidence: conf, text: item.text });
        triggers.push({ type: "TOPIC_CHANGE", t: item.start, tEnd: item.end, confidence: conf * 0.9 });
        break;
      case "point":
        if (item.importance === "critical" || item.importance === "high") {
          triggers.push({ type: "IMPORTANT_POINT", t: item.start, tEnd: item.end, confidence: conf, text: item.text });
        }
        break;
    }

    // Emoção
    if (item.importance === "critical") {
      triggers.push({ type: "EMOTION", t: item.start, tEnd: item.end, confidence: conf * 0.7, text: item.text });
    }
  }

  // 2) Numbers, prices, keywords a partir dos words
  const wordsText = words.map((w) => ({ text: w.word, t: w.start, tEnd: w.end }));
  // Reconstitui frases pra regex
  let currentSentence = [];
  let sentStart = 0;
  for (let i = 0; i < wordsText.length; i++) {
    const w = wordsText[i];
    if (!currentSentence.length) sentStart = w.t;
    currentSentence.push(w);
    if (/[.!?]$/.test(w.text) || i === wordsText.length - 1) {
      const sentText = currentSentence.map((x) => x.text).join(" ");
      const sentEnd = currentSentence[currentSentence.length - 1].tEnd;
      // NUMBER
      let m;
      NUMBER_REGEX.lastIndex = 0;
      while ((m = NUMBER_REGEX.exec(sentText))) {
        const value = m[0].trim();
        // Encontra timestamp da palavra que contém o número
        const wordMatch = currentSentence.find((cw) => cw.text.includes(m[1]));
        const t = wordMatch?.t ?? sentStart;
        triggers.push({ type: "NUMBER", t, tEnd: t + 1.5, confidence: 0.85, value, text: value, meta: { sentence: sentText } });
      }
      // PRICE
      PRICE_REGEX.lastIndex = 0;
      while ((m = PRICE_REGEX.exec(sentText))) {
        triggers.push({ type: "PRICE", t: sentStart, tEnd: sentEnd, confidence: 0.9, value: m[0], text: m[0] });
      }
      // KEYWORD
      const lc = sentText.toLowerCase();
      for (const kw of KEYWORD_HINTS) {
        if (lc.includes(kw)) {
          const kwWord = currentSentence.find((cw) => cw.text.toLowerCase().includes(kw));
          const t = kwWord?.t ?? sentStart;
          triggers.push({ type: "KEYWORD", t, tEnd: t + 1.2, confidence: 0.75, text: kw });
        }
      }
      // QUESTION
      if (QUESTION_HINTS.test(sentText)) {
        triggers.push({ type: "QUESTION", t: sentStart, tEnd: sentEnd, confidence: 0.7, text: sentText.slice(0, 80) });
      }
      currentSentence = [];
    }
  }

  // 3) Product moments
  for (const pm of productMoments?.moments || []) {
    triggers.push({ type: "PRODUCT", t: pm.start, tEnd: pm.end, confidence: 0.85, text: pm.text || "" });
    if (pm.kind === "demonstration") {
      triggers.push({ type: "PRODUCT_DEMONSTRATION", t: pm.start, tEnd: pm.end, confidence: 0.9, text: pm.text || "" });
    }
  }

  // 4) Pattern interrupts
  for (const pi of patternInterrupts?.interrupts || []) {
    const t = pi.atSec ?? pi.t ?? pi.start;
    triggers.push({ type: "PATTERN_INTERRUPT", t, confidence: 0.7, text: pi.reason || "" });
  }

  // 5) BEFORE_AFTER: heurística — timeline com turn seguido de proof
  for (let i = 0; i < timeline.length - 1; i++) {
    if (timeline[i].role === "turn" && ["proof", "solution"].includes(timeline[i + 1].role)) {
      triggers.push({ type: "BEFORE_AFTER", t: timeline[i].start, tEnd: timeline[i + 1].end, confidence: 0.75 });
    }
  }

  // 6) LIST_ITEM / STEP a partir de "primeiro", "segundo", "1)", etc
  const stepRegex = /\b(primeiro|segundo|terceiro|quarto|quinto|passo\s?\d+|\d+\.\s|\d+\)\s)/gi;
  for (const w of words) {
    if (stepRegex.test(w.word)) {
      triggers.push({ type: "STEP", t: w.start, tEnd: w.end + 1, confidence: 0.7, text: w.word });
    }
  }

  // Ordena por tempo
  triggers.sort((a, b) => a.t - b.t);
  return triggers;
}

export function groupTriggersByTime(triggers, windowSec = 0.5) {
  const groups = [];
  for (const t of triggers) {
    const last = groups[groups.length - 1];
    if (last && t.t - last.t < windowSec) {
      last.triggers.push(t);
    } else {
      groups.push({ t: t.t, triggers: [t] });
    }
  }
  return groups;
}
