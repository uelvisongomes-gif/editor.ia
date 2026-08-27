// Stutter: repetição imediata de palavra idêntica ou de bigram/trigram.
// Ex: "eu eu vou", "na maioria na maioria das vezes".

import { normalize, CONNECTOR_BEFORE_STUTTER } from "./_shared.js";

export function detectWordRepeat({ words, norm } = {}) {
  const n = norm || (words || []).map((w) => normalize(w.word));
  const out = [];
  let i = 0;
  while (i < words.length - 1) {
    let j = i + 1;
    while (j < words.length && n[j] === n[i] && n[i]) j++;
    const repeats = j - i;
    if (repeats >= 2 && n[i].length > 0 && n[i].length <= 6) {
      // Estende PRA TRÁS se palavra anterior é conector aberto
      // ("porque falta, falta, falta")
      let startIdx = i;
      if (i > 0 && CONNECTOR_BEFORE_STUTTER.has(n[i - 1])) {
        const gapBefore = words[i].start - words[i - 1].end;
        if (gapBefore <= 0.5) startIdx = i - 1;
      }
      const start = words[startIdx].start;
      const end = words[j - 2].end; // penúltima; a última fica.
      if (end > start + 0.02) {
        out.push({
          start, end,
          confidence: 0.88,
          reason: "stutter",
          source: "speechError",
          detectedBy: "heuristic",
          text: words.slice(startIdx, j - 1).map((w) => w.word).join(" "),
        });
      }
      i = j - 1;
    } else {
      i += 1;
    }
  }
  return out;
}

export function detectBigramStutter({ words, norm } = {}) {
  const n = norm || (words || []).map((w) => normalize(w.word));
  const out = [];
  for (let ngram = 3; ngram >= 2; ngram--) {
    let i = 0;
    while (i <= words.length - ngram * 2) {
      let match = true;
      for (let k = 0; k < ngram; k++) {
        if (!n[i + k] || n[i + k] !== n[i + ngram + k]) { match = false; break; }
      }
      if (match) {
        const gap = words[i + ngram].start - words[i + ngram - 1].end;
        if (gap <= 0.5) {
          const start = words[i].start;
          let end = words[i + ngram - 1].end;
          // Se a palavra logo APÓS o segundo bigram for esticada, estende
          // o cut pra dentro dela até 1s (Whisper escondeu continuação da
          // 1a tentativa).
          const nextAfterBoth = words[i + ngram * 2];
          if (nextAfterBoth) {
            const nextDur = nextAfterBoth.end - nextAfterBoth.start;
            if (nextDur > 0.8) {
              end = nextAfterBoth.start + Math.min(1.0, nextDur * 0.6);
            }
          }
          if (end > start + 0.05) {
            out.push({
              start, end,
              confidence: 0.88,
              reason: "stutter",
              source: "speechError",
              detectedBy: "heuristic",
              text: words.slice(i, i + ngram).map((w) => w.word).join(" "),
            });
            i += ngram * 2 - 1;
            continue;
          }
        }
      }
      i += 1;
    }
  }
  return out;
}
