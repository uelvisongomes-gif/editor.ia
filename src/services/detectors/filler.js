// Filler: cadeias de muletas + hesitações elongadas + palavras
// standalone tipo "Bom" isolado.

import { normalize, FILLER_WORDS, STANDALONE_HESITATIONS, ELONG_FILLERS } from "./_shared.js";

export function detectFillerChain({ words, norm } = {}) {
  const n = norm || (words || []).map((w) => normalize(w.word));
  const out = [];
  let i = 0;
  while (i < words.length) {
    if (FILLER_WORDS.has(n[i])) {
      let count = 1;
      let lastFillerIdx = i;
      let j = i + 1;
      while (j < words.length && words[j].start - words[i].start < 5.0) {
        if (FILLER_WORDS.has(n[j])) {
          count += 1;
          lastFillerIdx = j;
        }
        j += 1;
      }
      if (count >= 3) {
        const start = words[i].start;
        const end = words[lastFillerIdx].end;
        // 4+ fillers = quase certeza de trecho abandonado
        const conf = count >= 4 ? 0.86 : 0.72;
        out.push({
          start, end,
          confidence: conf,
          reason: "filler",
          source: "speechError",
          detectedBy: "heuristic",
          text: words.slice(i, lastFillerIdx + 1).map((w) => w.word).join(" "),
        });
        i = lastFillerIdx + 1;
        continue;
      }
    }
    i += 1;
  }
  return out;
}

export function detectElongatedHesitation({ words, norm } = {}) {
  const n = norm || (words || []).map((w) => normalize(w.word));
  const hasElongatedLetters = (raw) => /([aeiouâéíóúãhm])\1{2,}/i.test((raw || "").toLowerCase());
  const out = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (w.start > 5) break;
    const raw = (w.word || "").toLowerCase().replace(/[.,!?;:"'()]/g, "").trim();
    const dur = w.end - w.start;
    const isFiller = ELONG_FILLERS.has(raw) || FILLER_WORDS.has(raw) || raw.length <= 3;
    const isLong = dur >= 0.45;
    const hasElong = hasElongatedLetters(w.word);
    if ((isFiller && isLong) || hasElong) {
      const next = words[i + 1];
      const gapAfter = next ? next.start - w.end : Infinity;
      if (hasElong || gapAfter >= 0.3) {
        out.push({
          start: w.start,
          end: w.end,
          confidence: hasElong ? 0.92 : 0.85,
          reason: "filler",
          source: "speechError",
          detectedBy: "heuristic",
          text: w.word,
        });
      }
    }
  }
  return out;
}

export function detectStandaloneHesitation({ words, norm } = {}) {
  const n = norm || (words || []).map((w) => normalize(w.word));
  const out = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (!STANDALONE_HESITATIONS.has(n[i])) continue;
    const prev = words[i - 1];
    const next = words[i + 1];
    const gapBefore = prev ? w.start - prev.end : (w.start >= 0.5 ? Infinity : 0);
    const gapAfter = next ? next.start - w.end : Infinity;
    const isolatedBefore = gapBefore >= 0.8;
    const isolatedAfter = gapAfter >= 0.8;
    if (!(isolatedBefore || isolatedAfter)) continue;
    if (gapAfter < 0.4) continue;
    const conf = isolatedBefore && isolatedAfter ? 0.85 : 0.75;
    out.push({
      start: w.start,
      end: w.end,
      confidence: conf,
      reason: "filler",
      source: "speechError",
      detectedBy: "heuristic",
      text: w.word,
    });
  }
  return out;
}
