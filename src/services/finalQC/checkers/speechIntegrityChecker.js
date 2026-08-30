// Speech Integrity Checker — Item 3 da spec.
// Prioridade absoluta. Reanalisa ±500ms de áudio real em cada cut point.
// Detecta palavra/fonema truncado que passou pelas Fases 1-2.

import { makeIssue, SEVERITY } from "../qcSeverity.js";

const WINDOW_MS = 500;
const PHONEME_ENERGY_THRESHOLD = 0.015;
const DECAY_RATIO_SUSPICIOUS = 0.5; // se sinal ainda tá em 50% no exato cut → truncado

/**
 * @param {object} args
 * @param {AudioBuffer} args.audioBuffer
 * @param {Array} args.segments
 * @param {Array} args.words
 * @returns {import("../qcReport.js").QCIssue[]}
 */
export function checkSpeechIntegrity({ audioBuffer, segments = [], words = [] } = {}) {
  if (!audioBuffer || !segments.length) return [];
  const channel = audioBuffer.getChannelData(0);
  const sr = audioBuffer.sampleRate;
  const winSamples = Math.floor(sr * WINDOW_MS / 1000);

  const active = segments.filter((s) => !s.deleted).sort((a, b) => a.start - b.start);
  const issues = [];

  for (let i = 1; i < active.length; i++) {
    const prev = active[i - 1];
    const cur = active[i];
    // Ponto de corte no source (prev.end saindo, cur.start entrando)
    const outT = prev.end;
    const inT = cur.start;

    // 1. Analisa "saindo" — 500ms antes de prev.end no source
    const outIssue = analyzeExit(channel, sr, outT, winSamples, words);
    if (outIssue) issues.push({ ...outIssue, start: Math.max(0, outT - WINDOW_MS / 1000 / 2), end: outT });

    // 2. Analisa "entrando" — 500ms depois de cur.start no source
    const inIssue = analyzeEntry(channel, sr, inT, winSamples, words);
    if (inIssue) issues.push({ ...inIssue, start: inT, end: inT + WINDOW_MS / 1000 / 2 });
  }
  return issues;
}

function analyzeExit(channel, sr, t, winSamples, words) {
  // Se o corte tá a MENOS de 30ms do fim de uma palavra e ainda há energia > threshold,
  // suspeita de truncamento
  const cutIdx = Math.floor(t * sr);
  if (cutIdx < 32 || cutIdx > channel.length) return null;

  // Energia nos últimos 30ms
  const tail30 = channel.slice(Math.max(0, cutIdx - Math.floor(sr * 0.03)), cutIdx);
  const rmsTail = rms(tail30);

  // Energia nos 100ms anteriores (baseline)
  const ref100 = channel.slice(Math.max(0, cutIdx - Math.floor(sr * 0.13)), Math.max(0, cutIdx - Math.floor(sr * 0.03)));
  const rmsRef = rms(ref100);

  if (rmsTail > PHONEME_ENERGY_THRESHOLD && rmsRef > 0 && rmsTail / rmsRef > DECAY_RATIO_SUSPICIOUS) {
    const nearWord = findClosestWord(words, t);
    return makeIssue({
      type: "cut_mid_phoneme",
      severity: SEVERITY.CRITICAL,
      description: `Corte suspeito no meio de fonema (energia ${(rmsTail).toFixed(3)} vs ref ${(rmsRef).toFixed(3)}${nearWord ? `, palavra "${nearWord.word}"` : ""})`,
      auto_fixable: true,
      params: { t, direction: "exit", suggestedShift: 0.08 },
      checker: "speechIntegrity",
    });
  }
  return null;
}

function analyzeEntry(channel, sr, t, winSamples, words) {
  const cutIdx = Math.floor(t * sr);
  if (cutIdx < 0 || cutIdx + Math.floor(sr * 0.13) > channel.length) return null;
  // Energia nos primeiros 30ms
  const head30 = channel.slice(cutIdx, cutIdx + Math.floor(sr * 0.03));
  const rmsHead = rms(head30);
  // Referência: 100ms depois
  const ref100 = channel.slice(cutIdx + Math.floor(sr * 0.03), cutIdx + Math.floor(sr * 0.13));
  const rmsRef = rms(ref100);
  if (rmsHead > PHONEME_ENERGY_THRESHOLD && rmsRef > 0 && rmsHead / rmsRef > DECAY_RATIO_SUSPICIOUS) {
    const nearWord = findClosestWord(words, t);
    return makeIssue({
      type: "cut_mid_phoneme",
      severity: SEVERITY.HIGH,
      description: `Início de corte pega meio-fonema (energia ${(rmsHead).toFixed(3)}${nearWord ? `, palavra "${nearWord.word}"` : ""})`,
      auto_fixable: true,
      params: { t, direction: "entry", suggestedShift: -0.05 },
      checker: "speechIntegrity",
    });
  }
  return null;
}

function rms(arr) {
  if (!arr?.length) return 0;
  let sum = 0;
  for (let i = 0; i < arr.length; i++) sum += arr[i] * arr[i];
  return Math.sqrt(sum / arr.length);
}

function findClosestWord(words, t) {
  if (!words?.length) return null;
  let best = words[0], bestD = Infinity;
  for (const w of words) {
    const d = Math.min(Math.abs(w.start - t), Math.abs(w.end - t));
    if (d < bestD) { best = w; bestD = d; }
  }
  return bestD < 0.15 ? best : null;
}
