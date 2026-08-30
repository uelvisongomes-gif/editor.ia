// Room Tone — quando um corte cria silêncio digital > 0.4s entre falas,
// insere ambiente extraído de gaps naturais do próprio vídeo.
// Item 11 da spec.
//
// Pipeline:
//   1) extractRoomToneSample: pega o trecho mais silencioso do áudio (500ms)
//   2) planRoomTonePatches: identifica silêncios criados pelos cortes que
//      precisam de room tone e emite decisões

import { makeDecision } from "./audioTimeline.js";

const SILENCE_TRIGGER_SEC = 0.4;
const SAMPLE_DURATION_SEC = 0.5;

/**
 * Encontra o trecho de menor amplitude do áudio original — bom candidato
 * a room tone (som ambiente sem fala/eventos).
 *
 * @param {Float32Array} channel
 * @param {number} sr
 * @param {object} [opts]
 * @param {{ segments: Array }} [opts.speechActivity]
 * @returns {{ start: number, end: number, sample: Float32Array | null }}
 */
export function extractRoomToneSample(channel, sr, { speechActivity } = {}) {
  const winSize = Math.floor(sr * SAMPLE_DURATION_SEC);
  if (channel.length < winSize) return { start: 0, end: 0, sample: null };

  let bestStart = -1;
  let bestRms = Infinity;
  const isSilence = (t) => {
    if (!speechActivity?.segments) return true;
    return speechActivity.segments.some((s) => s.state === "SILENCE" && t >= s.start && t + SAMPLE_DURATION_SEC < s.end);
  };
  const step = Math.floor(sr * 0.25);
  for (let i = 0; i + winSize < channel.length; i += step) {
    const t = i / sr;
    if (!isSilence(t)) continue;
    let sumSq = 0;
    for (let j = 0; j < winSize; j++) sumSq += channel[i + j] * channel[i + j];
    const rms = Math.sqrt(sumSq / winSize);
    if (rms > 0 && rms < bestRms) {
      bestRms = rms;
      bestStart = i;
    }
  }
  if (bestStart < 0) {
    // Fallback: pega os primeiros 500ms
    return { start: 0, end: SAMPLE_DURATION_SEC, sample: channel.slice(0, winSize) };
  }
  return {
    start: bestStart / sr,
    end: (bestStart + winSize) / sr,
    sample: channel.slice(bestStart, bestStart + winSize),
  };
}

/**
 * Emite decisões de room_tone para preencher silêncios pós-corte.
 *
 * @param {Array} segments
 * @param {object} roomToneRef  - {start, end} do sample
 * @returns {import("./audioTimeline.js").AudioDecision[]}
 */
export function planRoomTonePatches(segments = [], roomToneRef = null) {
  if (!roomToneRef?.sample) return [];
  const active = segments.filter((s) => !s.deleted).sort((a, b) => a.start - b.start);
  const decisions = [];
  for (let i = 1; i < active.length; i++) {
    const prev = active[i - 1];
    const cur = active[i];
    const gapFromDeleted = cur.start - prev.end;
    // Só se o corte foi grande (=> silêncio abrupto no output)
    if (gapFromDeleted < SILENCE_TRIGGER_SEC) continue;
    decisions.push(makeDecision({
      type: "room_tone",
      start: prev.end,
      end: cur.start,
      intensity: 0.4, // sutil — só evita "silêncio digital"
      reason: `preencher gap ${gapFromDeleted.toFixed(2)}s pós-corte`,
      confidence: 0.85,
      params: {
        sampleStart: roomToneRef.start,
        sampleEnd: roomToneRef.end,
        loopMode: "crossfade",
      },
    }));
  }
  return decisions;
}
