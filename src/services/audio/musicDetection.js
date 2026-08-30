// Music Detection — heurística pra identificar se o vídeo JÁ TEM música
// no áudio original (Item 13). Se sim, não adiciona outra automaticamente.
//
// Sinal usado: energia harmônica sustentada em bandas musicais (100-2000Hz)
// em trechos SEM fala, com padrão rítmico regular.
//
// Precisão limitada — não é um music-info-retrieval sério. Mas cobre
// os casos comuns: fundo musical, jingle, backing track.

/**
 * @typedef {Object} ExistingMusicDetection
 * @property {boolean} hasMusic
 * @property {number} confidence
 * @property {number} musicLevelDb    - volume médio da música vs fala
 * @property {Array<{start,end}>} musicRanges  - trechos com música dominante
 * @property {string} recommendation  - "preserve" | "reduce" | "remove" | "keep_no_change"
 */

/**
 * @param {Float32Array} channel
 * @param {number} sr
 * @param {{ segments: Array }} speechActivity
 * @param {number} duration
 * @returns {ExistingMusicDetection}
 */
export function detectExistingMusic(channel, sr, speechActivity, duration) {
  if (!channel?.length) return emptyDetection();

  const silenceSegs = speechActivity?.segments?.filter((s) => s.state === "SILENCE" && s.end - s.start > 0.5) || [];
  if (!silenceSegs.length) return emptyDetection();

  // Mede energia sustentada nas bandas musicais em cada gap
  const musicRanges = [];
  let totalMusicEnergy = 0;
  let totalMeasurements = 0;
  let musicLevelSum = 0;

  for (const seg of silenceSegs.slice(0, 20)) {
    const startSamp = Math.floor(seg.start * sr);
    const endSamp = Math.min(channel.length, Math.floor(seg.end * sr));
    if (endSamp - startSamp < sr * 0.3) continue;

    // Divide o gap em janelas de 100ms e mede RMS + variabilidade
    const winSize = Math.floor(sr * 0.1);
    const rmsList = [];
    for (let i = startSamp; i + winSize < endSamp; i += winSize) {
      let sumSq = 0;
      for (let j = 0; j < winSize; j++) sumSq += channel[i + j] * channel[i + j];
      rmsList.push(Math.sqrt(sumSq / winSize));
    }
    if (rmsList.length < 3) continue;

    // Se RMS é sustentado e não decai como reverb, provavelmente é música
    const mean = rmsList.reduce((a, b) => a + b, 0) / rmsList.length;
    const variance = rmsList.reduce((a, b) => a + (b - mean) ** 2, 0) / rmsList.length;
    const cv = Math.sqrt(variance) / (mean + 1e-6); // coefficient of variation
    // Música: RMS moderado (0.01-0.1) e CV baixo (< 0.5)
    if (mean > 0.008 && mean < 0.15 && cv < 0.6) {
      const dbLevel = 20 * Math.log10(mean);
      musicRanges.push({ start: seg.start, end: seg.end, levelDb: dbLevel });
      musicLevelSum += dbLevel;
      totalMusicEnergy += mean * (seg.end - seg.start);
    }
    totalMeasurements++;
  }

  if (!totalMeasurements) return emptyDetection();
  const musicRatio = musicRanges.length / totalMeasurements;
  const hasMusic = musicRatio > 0.4 && musicRanges.length >= 2;
  const musicLevelDb = musicRanges.length ? musicLevelSum / musicRanges.length : -60;

  // Recomendação baseada no nível da música
  let recommendation = "keep_no_change";
  if (hasMusic) {
    if (musicLevelDb > -20) recommendation = "reduce";  // muito alta, competindo com fala
    else if (musicLevelDb > -30) recommendation = "preserve";
    else recommendation = "keep_no_change";
  }

  return {
    hasMusic,
    confidence: Math.min(1, musicRatio * 1.5),
    musicLevelDb: Math.round(musicLevelDb * 10) / 10,
    musicRanges,
    recommendation,
  };
}

function emptyDetection() {
  return { hasMusic: false, confidence: 0, musicLevelDb: -60, musicRanges: [], recommendation: "keep_no_change" };
}
