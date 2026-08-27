// False Start / Abandoned Phrase / Restart:
//   - Marcadores explícitos ("não pera", "peraí")
//   - Conector aberto + pausa/hesitação + reset ("porque quando... então")
//   - Duas sentenças consecutivas com o mesmo começo

import {
  normalize, FILLER_WORDS, STANDALONE_HESITATIONS,
  HANGING_CONNECTORS, RESET_WORDS, RESTART_MARKERS, endsSentenceHard,
} from "./_shared.js";

export function detectRestartMarkers({ words, norm } = {}) {
  const n = norm || (words || []).map((w) => normalize(w.word));
  const out = [];
  for (let i = 0; i <= words.length - 1; i++) {
    for (const marker of RESTART_MARKERS) {
      if (i + marker.length > words.length) continue;
      let match = true;
      for (let k = 0; k < marker.length; k++) {
        if (n[i + k] !== marker[k]) { match = false; break; }
      }
      if (!match) continue;
      let sentStart = 0;
      for (let k = i - 1; k >= Math.max(0, i - 40); k--) {
        const raw = words[k]?.word || "";
        if (/[.!?]$/.test(raw)) { sentStart = k + 1; break; }
      }
      const startTime = words[sentStart].start;
      const endTime = words[i + marker.length - 1].end;
      const wordCount = (i + marker.length) - sentStart;
      if (wordCount <= 20 && endTime > startTime + 0.05) {
        out.push({
          start: startTime,
          end: endTime,
          confidence: 0.85,
          reason: "abandoned_phrase",
          source: "speechError",
          detectedBy: "heuristic",
          text: words.slice(sentStart, i + marker.length).map((w) => w.word).join(" "),
        });
      }
      break;
    }
  }
  return out;
}

export function detectHangingConnectorAbandon({ words, norm } = {}) {
  const n = norm || (words || []).map((w) => normalize(w.word));
  const out = [];
  for (let i = 1; i < words.length - 1; i++) {
    if (!HANGING_CONNECTORS.has(n[i])) continue;
    let j = i + 1;
    let foundReset = -1;
    let sawSignificantGap = false;
    while (j < words.length && (words[j].start - words[i].end) < 6.0) {
      const gapFromPrev = j > i + 1 ? (words[j].start - words[j - 1].end) : (words[j].start - words[i].end);
      const durOfPrev = j > 0 ? (words[j - 1].end - words[j - 1].start) : 0;
      const prevHasEllipsis = j > 0 && /\.{2,}$/.test(words[j - 1].word || "");
      if (gapFromPrev >= 0.6 || durOfPrev >= 1.2 || prevHasEllipsis) sawSignificantGap = true;
      if (RESET_WORDS.has(n[j]) && sawSignificantGap) { foundReset = j; break; }
      if (endsSentenceHard(words[j].word)) break;
      j++;
    }
    if (foundReset > i + 1) {
      let startIdx = i;
      while (startIdx > 0 && (FILLER_WORDS.has(n[startIdx - 1]) || n[startIdx - 1].length <= 1)) {
        startIdx -= 1;
      }
      const start = words[startIdx].start;
      const end = words[foundReset].start - 0.05;
      const span = end - start;
      if (span >= 1.0 && span <= 8.0) {
        out.push({
          start, end,
          confidence: 0.88,
          reason: "abandoned_phrase",
          source: "speechError",
          detectedBy: "heuristic",
          text: words.slice(startIdx, foundReset).map((w) => w.word).join(" "),
        });
      }
    }
  }
  return out;
}

export function detectSentenceHeadRepeat({ words, norm } = {}) {
  const n = norm || (words || []).map((w) => normalize(w.word));
  const out = [];
  const sentences = [];
  let cur = [], curStart = 0;
  for (let i = 0; i < words.length; i++) {
    if (cur.length === 0) curStart = i;
    cur.push(i);
    const raw = words[i].word || "";
    if (/[.!?]$/.test(raw) || i === words.length - 1) {
      sentences.push({ startIdx: curStart, endIdx: i });
      cur = [];
    }
  }
  const isSkippableHead = (w) => STANDALONE_HESITATIONS.has(w);
  const headOf = (startIdx, endIdx) => {
    let idx = startIdx;
    while (idx <= endIdx && isSkippableHead(n[idx])) idx += 1;
    return idx;
  };
  for (let s = 0; s < sentences.length - 1; s++) {
    const a = sentences[s], b = sentences[s + 1];
    const aLen = a.endIdx - a.startIdx + 1;
    const bLen = b.endIdx - b.startIdx + 1;
    if (aLen > 15 || bLen > 15) continue;
    const gap = words[b.startIdx].start - words[a.endIdx].end;
    if (gap > 3.0) continue;
    const aHead = headOf(a.startIdx, a.endIdx);
    const bHead = headOf(b.startIdx, b.endIdx);
    if (aHead > a.endIdx - 1 || bHead > b.endIdx - 1) continue;
    const sameHead2 = n[aHead] === n[bHead] && n[aHead + 1] === n[bHead + 1];
    if (!sameHead2) continue;
    const sameHead3 = (aHead + 2 <= a.endIdx) && (bHead + 2 <= b.endIdx) &&
                      n[aHead + 2] === n[bHead + 2];
    const conf = sameHead3 ? 0.88 : s === 0 ? 0.82 : 0.75;
    out.push({
      start: words[a.startIdx].start,
      end: words[a.endIdx].end,
      confidence: conf,
      reason: "false_start",
      source: "speechError",
      detectedBy: "heuristic",
      text: words.slice(a.startIdx, a.endIdx + 1).map((w) => w.word).join(" "),
    });
    s += 1;
  }
  return out;
}
