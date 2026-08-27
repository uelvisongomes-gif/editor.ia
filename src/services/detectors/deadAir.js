// Dead Air: gaps entre palavras + silêncio real ESCONDIDO dentro de
// palavras esticadas (artefato do Whisper).

// Regras:
//   gap < 1.5s   → PAUSA NATURAL entre frases. Não candidata.
//   1.5-3s      → REVIEW (usuário decide se corta)
//   >= 3s        → REMOVE (dead air óbvio)
// Isso preserva pausas dramáticas de 1-2s que dão ritmo ao vídeo.
const NATURAL_PAUSE_LIMIT = 1.5;
const DEAD_AIR_LIMIT = 3.0;
const GAP_EDGE_MARGIN = 0.15;

const HIDDEN_SILENCE_LEVEL = 0.025;
const HIDDEN_SILENCE_MIN_DUR = 0.5;
const HIDDEN_SILENCE_MIN_WORD_DUR = 1.5;

export function detectGapSilence({ words } = {}) {
  if (!words?.length) return [];
  const out = [];
  for (let i = 0; i < words.length - 1; i++) {
    const w = words[i];
    const nx = words[i + 1];
    const gap = nx.start - w.end;
    if (gap < NATURAL_PAUSE_LIMIT) continue;
    const cutStart = w.end + GAP_EDGE_MARGIN;
    const cutEnd = nx.start - GAP_EDGE_MARGIN;
    if (cutEnd - cutStart < 0.3) continue;
    // Dead air (>=3s) = alta confiança → REMOVE
    // Pausa longa (1.5-3s) = média confiança → REVIEW
    const conf = gap >= DEAD_AIR_LIMIT ? 0.90 : 0.70;
    out.push({
      start: cutStart,
      end: cutEnd,
      confidence: conf,
      reason: "silence",
      source: "speechError",
      detectedBy: "heuristic",
      text: `(pausa entre palavras — ${gap.toFixed(1)}s)`,
    });
  }
  return out;
}

export function detectHiddenSilence({ words, waveform } = {}) {
  if (!words?.length || !waveform?.length) return [];
  const out = [];
  for (const w of words) {
    const dur = w.end - w.start;
    if (dur < HIDDEN_SILENCE_MIN_WORD_DUR) continue;
    let runStart = null;
    let best = { start: 0, end: 0, dur: 0 };
    for (const b of waveform) {
      if (b.end <= w.start) continue;
      if (b.start >= w.end) break;
      const bStart = Math.max(b.start, w.start);
      if (b.level < HIDDEN_SILENCE_LEVEL) {
        if (runStart == null) runStart = bStart;
      } else {
        if (runStart != null) {
          const runDur = bStart - runStart;
          if (runDur > best.dur) best = { start: runStart, end: bStart, dur: runDur };
          runStart = null;
        }
      }
    }
    if (runStart != null) {
      const runEnd = w.end;
      const runDur = runEnd - runStart;
      if (runDur > best.dur) best = { start: runStart, end: runEnd, dur: runDur };
    }
    if (best.dur >= HIDDEN_SILENCE_MIN_DUR) {
      out.push({
        start: best.start,
        end: best.end,
        confidence: 0.88,
        reason: "silence",
        source: "speechError",
        detectedBy: "heuristic",
        text: `(silêncio de ${best.dur.toFixed(1)}s escondido dentro da palavra "${w.word}")`,
      });
    }
  }
  return out;
}

export function detectSoundWithoutWord({ words, waveform } = {}) {
  if (!waveform?.length) return [];
  // Threshold reduzido — "EEE" fraco que o Whisper dropa tem
  // energia baixa mas presente. 0.02 pega mais casos reais.
  const SOUND_LEVEL = 0.02;
  const MIN_HESIT_DUR = 0.3;
  const wordCovers = (t) => words?.some((w) => t >= w.start - 0.05 && t < w.end + 0.05);
  const out = [];
  let winStart = null;
  let winTotal = 0;
  for (let bi = 0; bi < waveform.length; bi++) {
    const b = waveform[bi];
    const hasSound = b.level >= SOUND_LEVEL;
    const covered = wordCovers((b.start + b.end) / 2);
    if (hasSound && !covered) {
      if (winStart == null) winStart = b.start;
      winTotal += (b.end - b.start);
    } else {
      if (winStart != null && winTotal >= MIN_HESIT_DUR) {
        const winEnd = b.start;
        const conf = winStart < 2 ? 0.9 : 0.78;
        out.push({
          start: winStart,
          end: winEnd,
          confidence: conf,
          reason: "filler",
          source: "speechError",
          detectedBy: "heuristic",
          text: winStart < 2 ? "(hesitação inicial)" : "(som sem palavra)",
        });
      }
      winStart = null;
      winTotal = 0;
    }
  }
  if (winStart != null && winTotal >= MIN_HESIT_DUR) {
    out.push({
      start: winStart,
      end: waveform[waveform.length - 1].end,
      confidence: 0.78,
      reason: "filler",
      source: "speechError",
      detectedBy: "heuristic",
      text: "(som sem palavra)",
    });
  }
  return out;
}
