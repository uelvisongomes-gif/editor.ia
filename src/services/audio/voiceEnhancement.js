// Voice Enhancement — cadeia adaptativa de tratamento de voz.
// A ordem/intensidade é decidida a partir do audioAnalyzer detailed.
//
// Cadeia canônica (aplicada só quando o diagnóstico pede):
//   1. Noise Gate      (se floor > -40 dBFS)
//   2. EQ Corretivo    (voz abafada / nasalidade / muddiness)
//   3. Compressor      (se voice.volumeVariance > 6 dB)
//   4. De-esser        (se sibilanceScore > 0.35)
//   5. Plosive Filter  (se plosiveCount > 3)
//   6. Limiter         (sempre, mas leve — segurança de peak)
//
// Este módulo gera:
//   - buildVoiceChain: cria a cadeia de AudioNodes real
//   - planVoiceEnhancement: decisões pra audioTimeline (Item 30)

import { makeDecision } from "./audioTimeline.js";

/**
 * Cria a cadeia de AudioNodes conectada em série. Devolve inputNode + outputNode.
 * Só instancia estágios que a análise recomenda.
 *
 * @param {AudioContext} audioCtx
 * @param {object} diagnostic  - audioAnalyzer.analyzeAudioDetailed()
 * @returns {{ input: AudioNode, output: AudioNode, stages: string[] }}
 */
export function buildVoiceChain(audioCtx, diagnostic = {}) {
  const stages = [];
  const noiseFloorDb = diagnostic?.noise?.floorDb ?? -60;
  const volVar = diagnostic?.voice?.volumeVariance ?? 0;
  const sibScore = diagnostic?.artifacts?.sibilanceScore ?? 0;
  const plosiveN = diagnostic?.artifacts?.plosiveCount ?? 0;

  const input = audioCtx.createGain();
  input.gain.value = 1.0;
  let current = input;

  // 1. Noise Gate (quando floor alto)
  if (noiseFloorDb > -40) {
    const gate = audioCtx.createDynamicsCompressor();
    gate.threshold.value = Math.max(-50, noiseFloorDb + 3);
    gate.knee.value = 0;
    gate.ratio.value = 12;
    gate.attack.value = 0.003;
    gate.release.value = 0.1;
    current.connect(gate);
    current = gate;
    stages.push("noise_gate");
  }

  // 2. EQ corretivo (BiquadFilter chain)
  // - High-pass 80Hz: tira rumble
  // - Peak +2dB em 3kHz: presença
  // - Low-shelf -2dB em 200Hz: reduz muddiness se voz abafada
  const hp = audioCtx.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 80;
  hp.Q.value = 0.7;
  current.connect(hp); current = hp; stages.push("eq_hp80");

  const presence = audioCtx.createBiquadFilter();
  presence.type = "peaking";
  presence.frequency.value = 3000;
  presence.Q.value = 1.0;
  presence.gain.value = 2.0;
  current.connect(presence); current = presence; stages.push("eq_presence");

  // Só corta muddiness se rms muito grave (proxy: reverbTail > 0.3 = ambiente barulhento)
  if ((diagnostic?.voice?.reverbTail ?? 0) > 0.3) {
    const mudCut = audioCtx.createBiquadFilter();
    mudCut.type = "peaking";
    mudCut.frequency.value = 250;
    mudCut.Q.value = 1.0;
    mudCut.gain.value = -2.5;
    current.connect(mudCut); current = mudCut; stages.push("eq_mud_cut");
  }

  // 3. Compressor
  if (volVar > 6) {
    const comp = audioCtx.createDynamicsCompressor();
    // Ratio moderado, threshold que segure só picos
    comp.threshold.value = -20;
    comp.knee.value = 6;
    comp.ratio.value = Math.min(4, 2 + volVar / 10);
    comp.attack.value = 0.005;
    comp.release.value = 0.15;
    current.connect(comp); current = comp; stages.push("compressor");
  }

  // 4. De-esser (dynamic notch em 6kHz quando sibilância alta)
  if (sibScore > 0.35) {
    // Split → high-pass 5.5kHz → compressor forte → subtrai do sinal
    // Aproximação: peaking filter negativo com Q alto
    const deEss = audioCtx.createBiquadFilter();
    deEss.type = "peaking";
    deEss.frequency.value = 6500;
    deEss.Q.value = 4.5;
    deEss.gain.value = -(2 + sibScore * 4); // -2 a -6 dB
    current.connect(deEss); current = deEss; stages.push("de_esser");
  }

  // 5. Plosive filter (high-pass steeper em 100Hz)
  if (plosiveN > 3) {
    const plos = audioCtx.createBiquadFilter();
    plos.type = "highpass";
    plos.frequency.value = 100;
    plos.Q.value = 1.2;
    current.connect(plos); current = plos; stages.push("plosive_filter");
  }

  // 6. Limiter (sempre — segurança)
  const limiter = audioCtx.createDynamicsCompressor();
  limiter.threshold.value = -1;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.001;
  limiter.release.value = 0.05;
  current.connect(limiter); current = limiter; stages.push("limiter");

  return { input, output: current, stages };
}

/**
 * Gera lista de decisões (AudioDecision[]) pra audioTimeline a partir do diagnóstico.
 * Cobre toda a duração do áudio.
 *
 * @param {object} diagnostic
 * @param {number} duration
 * @returns {import("./audioTimeline.js").AudioDecision[]}
 */
export function planVoiceEnhancement(diagnostic, duration) {
  const dec = [];
  if (!diagnostic || !Number.isFinite(duration)) return dec;

  const noiseFloorDb = diagnostic.noise?.floorDb ?? -60;
  if (noiseFloorDb > -40) {
    dec.push(makeDecision({
      type: "noise_reduction",
      start: 0, end: duration,
      intensity: Math.min(1, (noiseFloorDb + 40) / 20),
      reason: `noise floor ${noiseFloorDb.toFixed(1)} dB`,
      confidence: 0.9,
      params: { thresholdDb: Math.max(-50, noiseFloorDb + 3) },
    }));
  }

  dec.push(makeDecision({
    type: "eq",
    start: 0, end: duration,
    intensity: 0.6,
    reason: "presença +2dB @ 3kHz, HP @ 80Hz",
    confidence: 1.0,
    params: { highPassHz: 80, presenceHz: 3000, presenceDb: 2 },
  }));

  const volVar = diagnostic.voice?.volumeVariance ?? 0;
  if (volVar > 6) {
    dec.push(makeDecision({
      type: "compressor",
      start: 0, end: duration,
      intensity: Math.min(1, volVar / 15),
      reason: `variação de volume ${volVar.toFixed(1)} dB`,
      confidence: 0.85,
      params: { thresholdDb: -20, ratio: Math.min(4, 2 + volVar / 10) },
    }));
  }

  const sibScore = diagnostic.artifacts?.sibilanceScore ?? 0;
  if (sibScore > 0.35) {
    dec.push(makeDecision({
      type: "de_esser",
      start: 0, end: duration,
      intensity: sibScore,
      reason: `sibilância ${Math.round(sibScore * 100)}%`,
      confidence: 0.8,
      params: { centerHz: 6500, reductionDb: -(2 + sibScore * 4) },
    }));
  }

  const plosiveN = diagnostic.artifacts?.plosiveCount ?? 0;
  if (plosiveN > 3) {
    dec.push(makeDecision({
      type: "plosive",
      start: 0, end: duration,
      intensity: Math.min(1, plosiveN / 15),
      reason: `${plosiveN} plosivas`,
      confidence: 0.75,
      params: { highPassHz: 100 },
    }));
  }

  const reverb = diagnostic.voice?.reverbTail ?? 0;
  if (reverb > 0.4) {
    dec.push(makeDecision({
      type: "dereverb",
      start: 0, end: duration,
      intensity: Math.min(0.7, reverb / 1.5), // nunca 100% — destruiria voz
      reason: `reverb tail ${reverb.toFixed(2)}s`,
      confidence: 0.6,
      params: { note: "cut mud 250Hz + noise gate" },
    }));
  }

  return dec;
}
