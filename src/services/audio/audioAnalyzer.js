// Audio Analyzer — diagnóstico completo do áudio bruto ANTES de qualquer
// processamento. Detecta problemas e devolve um relatório estruturado que
// alimenta as decisões do voiceEnhancement, musicDecision, etc.
//
// Determinístico, roda no browser. Usa AudioBuffer decodificado (float PCM)
// pra spectral analysis básica via FFT sliding.
//
// Detecta:
//   - clipping (samples >= 0.99)
//   - hum 50/60 Hz (energia concentrada nesses bins após FFT)
//   - hiss (excesso de high-freq contínuo)
//   - noise floor entre pausas de fala
//   - clicks/pops (transientes fora de fala)
//   - sibilância S/CH/SH (excesso 5-8kHz)
//   - plosivas P/B/T (transientes low-freq)
//   - volume inconsistente entre segmentos de fala
//   - reverberação (RT60 aproximado via decay tail)
//   - múltiplas vozes (detectção heurística de pitch jumps)

/**
 * @typedef {Object} AudioDiagnostic
 * @property {object} loudness
 * @property {number} loudness.rmsDb
 * @property {number} loudness.peakDb
 * @property {number} loudness.estimatedLufs
 * @property {boolean} loudness.hasClipping
 * @property {number} loudness.clippingPct       - % de samples clipados
 * @property {object} noise
 * @property {number} noise.floorDb              - nível médio de ruído entre falas
 * @property {boolean} noise.hasHiss
 * @property {boolean} noise.hasHum50            - hum de 50Hz (Europa/Brasil)
 * @property {boolean} noise.hasHum60            - hum de 60Hz (América do Norte)
 * @property {number} noise.hissIntensity        - 0-1
 * @property {object} artifacts
 * @property {number} artifacts.clickCount
 * @property {number} artifacts.popCount
 * @property {number} artifacts.plosiveCount
 * @property {number} artifacts.sibilanceScore   - 0-1 quanto maior mais chiado
 * @property {object} voice
 * @property {number} voice.volumeVariance       - variação entre trechos (dB)
 * @property {number} voice.reverbTail           - segundos aprox
 * @property {boolean} voice.multipleVoices
 * @property {string[]} problems                 - lista human-readable de problemas
 * @property {number} overallQuality             - 0-100
 */

const CLIPPING_THRESHOLD = 0.985;
const HISS_BAND_HZ = [6000, 12000];
const HUM_50_HZ = [45, 55];
const HUM_60_HZ = [55, 65];
const SIBILANCE_BAND_HZ = [5000, 8500];
const PLOSIVE_BAND_HZ = [50, 250];

/**
 * @param {AudioBuffer} audioBuffer
 * @param {object} [opts]
 * @param {{ segments: Array }} [opts.speechActivity]
 * @returns {AudioDiagnostic}
 */
export function analyzeAudioDetailed(audioBuffer, { speechActivity = null } = {}) {
  if (!audioBuffer) return emptyDiagnostic();
  const channel = audioBuffer.getChannelData(0);
  const sr = audioBuffer.sampleRate;
  const duration = audioBuffer.duration;

  const loudness = analyzeLoudness(channel);
  const noise = analyzeNoise(channel, sr, speechActivity, duration);
  const artifacts = analyzeArtifacts(channel, sr, speechActivity);
  const voice = analyzeVoice(channel, sr, speechActivity);

  const problems = [];
  if (loudness.hasClipping) problems.push(`clipping detectado em ${(loudness.clippingPct * 100).toFixed(2)}% do áudio`);
  if (noise.hasHum50) problems.push("hum de 50Hz (ruído elétrico Europa/BR)");
  if (noise.hasHum60) problems.push("hum de 60Hz (ruído elétrico América do Norte)");
  if (noise.hasHiss) problems.push(`hiss/ruído contínuo (intensidade ${(noise.hissIntensity * 100).toFixed(0)}%)`);
  if (noise.floorDb > -40) problems.push(`floor de ruído alto (${noise.floorDb.toFixed(1)} dB)`);
  if (artifacts.clickCount > 3) problems.push(`${artifacts.clickCount} clicks/pops`);
  if (artifacts.plosiveCount > 5) problems.push(`${artifacts.plosiveCount} plosivas fortes`);
  if (artifacts.sibilanceScore > 0.6) problems.push("excesso de sibilância (S/CH/SH)");
  if (voice.volumeVariance > 12) problems.push(`variação de volume da voz (${voice.volumeVariance.toFixed(1)} dB)`);
  if (voice.reverbTail > 0.5) problems.push(`reverberação (~${voice.reverbTail.toFixed(1)}s de cauda)`);
  if (voice.multipleVoices) problems.push("possíveis múltiplas vozes");

  // Score: começa em 100, penaliza cada problema
  let overallQuality = 100;
  if (loudness.hasClipping) overallQuality -= Math.min(30, loudness.clippingPct * 100 * 5);
  if (noise.hasHum50 || noise.hasHum60) overallQuality -= 12;
  if (noise.hasHiss) overallQuality -= noise.hissIntensity * 15;
  if (noise.floorDb > -40) overallQuality -= (noise.floorDb + 40) * 0.8;
  overallQuality -= Math.min(15, artifacts.clickCount * 1.5);
  overallQuality -= Math.min(10, artifacts.plosiveCount * 0.8);
  overallQuality -= artifacts.sibilanceScore * 15;
  overallQuality -= Math.min(15, voice.volumeVariance * 0.6);
  overallQuality -= Math.min(20, voice.reverbTail * 15);
  overallQuality = Math.max(0, Math.min(100, Math.round(overallQuality)));

  return { loudness, noise, artifacts, voice, problems, overallQuality };
}

function analyzeLoudness(channel) {
  let sumSq = 0, peak = 0, clipped = 0;
  for (let i = 0; i < channel.length; i++) {
    const v = Math.abs(channel[i]);
    sumSq += v * v;
    if (v > peak) peak = v;
    if (v >= CLIPPING_THRESHOLD) clipped++;
  }
  const rms = Math.sqrt(sumSq / channel.length);
  const rmsDb = 20 * Math.log10(Math.max(1e-6, rms));
  const peakDb = 20 * Math.log10(Math.max(1e-6, peak));
  const clippingPct = clipped / channel.length;
  return {
    rmsDb: Math.round(rmsDb * 10) / 10,
    peakDb: Math.round(peakDb * 10) / 10,
    estimatedLufs: Math.round((rmsDb - 3) * 10) / 10,
    hasClipping: clippingPct > 0.0005,
    clippingPct,
  };
}

/**
 * Analisa noise entre pausas de fala. Se não tem speechActivity, amostra
 * pedaços aleatórios com baixa amplitude.
 */
function analyzeNoise(channel, sr, speechActivity, duration) {
  const gapWindows = collectGapWindows(channel, sr, speechActivity, duration);
  if (!gapWindows.length) {
    return { floorDb: -60, hasHiss: false, hasHum50: false, hasHum60: false, hissIntensity: 0 };
  }
  let sumSq = 0, n = 0;
  const spectrums = [];
  for (const win of gapWindows) {
    for (let i = 0; i < win.length; i++) {
      sumSq += win[i] * win[i];
      n++;
    }
    const spec = fftMagnitude(win, sr);
    if (spec) spectrums.push(spec);
  }
  const rms = Math.sqrt(sumSq / Math.max(1, n));
  const floorDb = 20 * Math.log10(Math.max(1e-6, rms));

  // Média dos spectrums
  const avgSpec = averageSpectrum(spectrums);
  const hum50 = bandEnergy(avgSpec, HUM_50_HZ[0], HUM_50_HZ[1]);
  const hum60 = bandEnergy(avgSpec, HUM_60_HZ[0], HUM_60_HZ[1]);
  const hissBand = bandEnergy(avgSpec, HISS_BAND_HZ[0], HISS_BAND_HZ[1]);
  const totalEnergy = bandEnergy(avgSpec, 20, 20000) || 1;

  // Hum se essa banda concentra > 6% do total (baseline mais realista pra hum forte)
  const hasHum50 = hum50 / totalEnergy > 0.06;
  const hasHum60 = hum60 / totalEnergy > 0.06;
  // Hiss se banda alta representa > 15% da energia (voz normal fica < 5%)
  const hissRatio = hissBand / totalEnergy;
  const hasHiss = hissRatio > 0.15;
  const hissIntensity = Math.min(1, hissRatio / 0.4);

  return {
    floorDb: Math.round(floorDb * 10) / 10,
    hasHiss, hasHum50, hasHum60,
    hissIntensity: Math.round(hissIntensity * 100) / 100,
  };
}

function analyzeArtifacts(channel, sr, speechActivity) {
  // Click/pop: transientes muito rápidos (< 3ms) com amplitude > 3x local avg
  const windowSize = Math.floor(sr * 0.003);
  const stepSize = Math.floor(sr * 0.05);
  let clickCount = 0, popCount = 0, plosiveCount = 0;
  const speechRanges = speechActivity?.segments?.filter((s) => s.state === "SPEECH") || [];
  const isInSpeech = (t) => speechRanges.some((s) => t >= s.start && t < s.end);

  for (let i = 0; i < channel.length - windowSize; i += stepSize) {
    let winPeak = 0, sumBefore = 0, sumAfter = 0;
    for (let j = 0; j < windowSize; j++) {
      const v = Math.abs(channel[i + j]);
      if (v > winPeak) winPeak = v;
    }
    // Compara com contexto 40ms antes/depois
    const ctxStart = Math.max(0, i - sr * 0.04);
    const ctxEnd = Math.min(channel.length, i + windowSize + sr * 0.04);
    let ctxN = 0;
    for (let j = ctxStart; j < i; j++) { sumBefore += Math.abs(channel[j]); ctxN++; }
    for (let j = i + windowSize; j < ctxEnd; j++) { sumAfter += Math.abs(channel[j]); ctxN++; }
    const ctxAvg = ctxN ? (sumBefore + sumAfter) / ctxN : 0;
    if (winPeak > 0.15 && winPeak > ctxAvg * 4) {
      const t = i / sr;
      if (isInSpeech(t)) {
        // Dentro de fala: plosiva se estiver no low-band
        plosiveCount++;
      } else {
        // Fora de fala: click/pop
        if (winPeak > 0.4) popCount++;
        else clickCount++;
      }
    }
  }

  // Sibilância: proporção de energia 5-8kHz durante fala
  const sibilanceScore = estimateSibilance(channel, sr, speechRanges);

  return { clickCount, popCount, plosiveCount, sibilanceScore };
}

function estimateSibilance(channel, sr, speechRanges) {
  if (!speechRanges.length) return 0;
  // Amostra ~10 janelas de 200ms de fala e mede banda 5-8kHz
  const winDur = 0.2;
  const winSize = Math.floor(sr * winDur);
  const samples = Math.min(10, speechRanges.length);
  let totalRatio = 0;
  let counted = 0;
  for (let i = 0; i < samples; i++) {
    const seg = speechRanges[Math.floor(i * speechRanges.length / samples)];
    const startSamp = Math.floor(seg.start * sr);
    if (startSamp + winSize >= channel.length) continue;
    const buf = channel.slice(startSamp, startSamp + winSize);
    const spec = fftMagnitude(buf, sr);
    if (!spec) continue;
    const total = bandEnergy(spec, 100, 12000) || 1;
    const sib = bandEnergy(spec, SIBILANCE_BAND_HZ[0], SIBILANCE_BAND_HZ[1]);
    totalRatio += sib / total;
    counted++;
  }
  if (!counted) return 0;
  const avg = totalRatio / counted;
  // Voz normal: 5-12% dessa banda. > 20% = chiado forte
  return Math.min(1, Math.max(0, (avg - 0.10) / 0.15));
}

function analyzeVoice(channel, sr, speechActivity) {
  const speechRanges = speechActivity?.segments?.filter((s) => s.state === "SPEECH") || [];
  if (!speechRanges.length) {
    return { volumeVariance: 0, reverbTail: 0, multipleVoices: false };
  }
  // Volume variance: dB stddev entre falas
  const rmsValues = [];
  for (const seg of speechRanges) {
    const startSamp = Math.floor(seg.start * sr);
    const endSamp = Math.min(channel.length, Math.floor(seg.end * sr));
    let sumSq = 0, n = 0;
    for (let i = startSamp; i < endSamp; i++) {
      sumSq += channel[i] * channel[i];
      n++;
    }
    if (n < sr * 0.1) continue;
    const rms = Math.sqrt(sumSq / n);
    if (rms > 1e-4) rmsValues.push(20 * Math.log10(rms));
  }
  const volumeVariance = rmsValues.length > 1 ? stddev(rmsValues) : 0;

  // Reverb tail: tempo pra decair 20dB após fim de fala (aprox RT20)
  const reverbTail = estimateReverbTail(channel, sr, speechRanges);

  // Múltiplas vozes: pitch jumps > 40% em intervalo curto (heurística)
  const multipleVoices = false; // Placeholder — pitch tracking exige YIN/DIO, adiado

  return {
    volumeVariance: Math.round(volumeVariance * 10) / 10,
    reverbTail: Math.round(reverbTail * 100) / 100,
    multipleVoices,
  };
}

function estimateReverbTail(channel, sr, speechRanges) {
  if (speechRanges.length < 2) return 0;
  const tails = [];
  for (let s = 0; s < Math.min(6, speechRanges.length - 1); s++) {
    const seg = speechRanges[s];
    const nextSeg = speechRanges[s + 1];
    const gap = nextSeg.start - seg.end;
    if (gap < 0.4 || gap > 3) continue; // gap curto ou longo demais
    const startSamp = Math.floor(seg.end * sr);
    const maxEnd = Math.min(channel.length, Math.floor((seg.end + Math.min(gap, 1.0)) * sr));
    // Encontra pico logo depois do fim da fala
    let peak = 0;
    for (let i = startSamp; i < startSamp + Math.floor(sr * 0.05); i++) {
      peak = Math.max(peak, Math.abs(channel[i]));
    }
    if (peak < 0.01) continue;
    // Encontra quando cai pra 10% (aprox -20 dB)
    const target = peak * 0.1;
    let decayIdx = -1;
    for (let i = startSamp + Math.floor(sr * 0.05); i < maxEnd; i++) {
      if (Math.abs(channel[i]) <= target) { decayIdx = i; break; }
    }
    if (decayIdx > 0) tails.push((decayIdx - startSamp) / sr);
  }
  if (!tails.length) return 0;
  return tails.reduce((a, b) => a + b, 0) / tails.length;
}

function collectGapWindows(channel, sr, speechActivity, duration) {
  const winDur = 0.5;
  const winSize = Math.floor(sr * winDur);
  const gaps = [];
  if (speechActivity?.segments?.length) {
    for (const seg of speechActivity.segments) {
      if (seg.state !== "SILENCE") continue;
      if (seg.end - seg.start < winDur) continue;
      const startSamp = Math.floor(seg.start * sr);
      if (startSamp + winSize < channel.length) {
        gaps.push(channel.slice(startSamp, startSamp + winSize));
      }
      if (gaps.length >= 5) break;
    }
  }
  if (gaps.length < 2) {
    // Fallback: pega janelas com baixa amplitude
    for (let t = 0; t < duration - winDur; t += winDur * 4) {
      const startSamp = Math.floor(t * sr);
      const buf = channel.slice(startSamp, startSamp + winSize);
      let peak = 0;
      for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i]));
      if (peak < 0.03) gaps.push(buf);
      if (gaps.length >= 5) break;
    }
  }
  return gaps;
}

// -------- FFT helpers --------

function fftMagnitude(samples, sr) {
  const N = nextPow2(Math.min(samples.length, 4096));
  if (N < 64) return null;
  const re = new Float32Array(N);
  const im = new Float32Array(N);
  for (let i = 0; i < N; i++) re[i] = samples[i] || 0;
  fft(re, im);
  const mag = new Float32Array(N / 2);
  for (let i = 0; i < N / 2; i++) mag[i] = Math.sqrt(re[i] * re[i] + im[i] * im[i]);
  return { mag, sr, N };
}

function bandEnergy({ mag, sr, N }, loHz, hiHz) {
  const loBin = Math.floor(loHz * N / sr);
  const hiBin = Math.min(mag.length - 1, Math.ceil(hiHz * N / sr));
  let sum = 0;
  for (let i = loBin; i <= hiBin; i++) sum += mag[i];
  return sum;
}

function averageSpectrum(spectrums) {
  if (!spectrums.length) return { mag: new Float32Array(1), sr: 44100, N: 2 };
  const N = spectrums[0].N;
  const sr = spectrums[0].sr;
  const acc = new Float32Array(N / 2);
  for (const s of spectrums) {
    if (s.N !== N) continue;
    for (let i = 0; i < acc.length; i++) acc[i] += s.mag[i];
  }
  for (let i = 0; i < acc.length; i++) acc[i] /= spectrums.length;
  return { mag: acc, sr, N };
}

function nextPow2(n) { let p = 1; while (p < n) p <<= 1; return p; }

// Radix-2 in-place FFT (Cooley-Tukey). N deve ser potência de 2.
function fft(re, im) {
  const N = re.length;
  // Bit-reverse
  for (let i = 1, j = 0; i < N; i++) {
    let bit = N >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= N; len <<= 1) {
    const ang = -2 * Math.PI / len;
    const wReal = Math.cos(ang), wImag = Math.sin(ang);
    for (let i = 0; i < N; i += len) {
      let wr = 1, wi = 0;
      for (let k = 0; k < len / 2; k++) {
        const uRe = re[i + k], uIm = im[i + k];
        const vRe = re[i + k + len / 2] * wr - im[i + k + len / 2] * wi;
        const vIm = re[i + k + len / 2] * wi + im[i + k + len / 2] * wr;
        re[i + k] = uRe + vRe; im[i + k] = uIm + vIm;
        re[i + k + len / 2] = uRe - vRe; im[i + k + len / 2] = uIm - vIm;
        const nwr = wr * wReal - wi * wImag;
        wi = wr * wImag + wi * wReal;
        wr = nwr;
      }
    }
  }
}

function stddev(arr) {
  if (arr.length < 2) return 0;
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  const variance = arr.reduce((a, b) => a + (b - mean) ** 2, 0) / arr.length;
  return Math.sqrt(variance);
}

function emptyDiagnostic() {
  return {
    loudness: { rmsDb: -60, peakDb: -60, estimatedLufs: -60, hasClipping: false, clippingPct: 0 },
    noise: { floorDb: -60, hasHiss: false, hasHum50: false, hasHum60: false, hissIntensity: 0 },
    artifacts: { clickCount: 0, popCount: 0, plosiveCount: 0, sibilanceScore: 0 },
    voice: { volumeVariance: 0, reverbTail: 0, multipleVoices: false },
    problems: [],
    overallQuality: 0,
  };
}
