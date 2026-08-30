// Loudness Analyzer — estima LUFS/dBFS do áudio via waveform amostrada.
// Não é EBU R128 exato (que exige K-weighting) — é aproximação RMS que
// serve pra tomar decisões automáticas de gain (Item 4.2).

/**
 * @param {Array<{start,end,level}>} waveform
 * @returns {{ rmsDb: number, peakDb: number, targetLufs: number, gainDb: number, needsAdjust: boolean }}
 */
export function estimateLoudness(waveform, targetLufs = -14) {
  if (!waveform?.length) return { rmsDb: -60, peakDb: -60, targetLufs, gainDb: 0, needsAdjust: false };
  let sumSq = 0;
  let peak = 0;
  let n = 0;
  for (const b of waveform) {
    const l = b.level ?? 0;
    if (l <= 0) continue;
    sumSq += l * l;
    if (l > peak) peak = l;
    n += 1;
  }
  if (!n) return { rmsDb: -60, peakDb: -60, targetLufs, gainDb: 0, needsAdjust: false };
  const rms = Math.sqrt(sumSq / n);
  const rmsDb = 20 * Math.log10(rms);
  const peakDb = 20 * Math.log10(peak);
  // Assume LUFS ~= RMS_dB - 3 (aproximação grosseira, sem K-weighting)
  const estimatedLufs = rmsDb - 3;
  const gainDb = targetLufs - estimatedLufs;
  // Só sugere ajuste se diferença > 3 dB
  const needsAdjust = Math.abs(gainDb) > 3;
  return { rmsDb, peakDb, targetLufs, estimatedLufs, gainDb, needsAdjust };
}

/**
 * Converte dB pra multiplicador de gain (fator linear).
 * gain(0 dB) = 1.0, gain(-6 dB) = 0.5, gain(+6 dB) = 2.0
 */
export function dbToGain(db) {
  return Math.pow(10, db / 20);
}
