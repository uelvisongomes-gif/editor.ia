// Noise Reduction — noise gate simples (via WebAudio ChannelSplitter +
// GainNode com threshold). Não é RNNoise ainda — heurística de threshold
// que corta trechos abaixo de um nível.
//
// Arquitetura pronta pra plugar RNNoise WASM (~200KB) via processor
// custom depois. Interface pública fica igual.

/**
 * @param {AudioContext} audioCtx
 * @param {number} [thresholdDb=-40]  - nível abaixo do qual é ruído
 * @param {number} [ratio=8]          - compressão do que ficar acima
 * @returns {AudioNode} chain ready-to-connect
 */
export function buildNoiseGate(audioCtx, thresholdDb = -40, ratio = 8) {
  // Simples: DynamicsCompressorNode com threshold alto pra funcionar como
  // gate quando combinado com knee=0.
  const compressor = audioCtx.createDynamicsCompressor();
  compressor.threshold.value = thresholdDb;
  compressor.knee.value = 0;
  compressor.ratio.value = ratio;
  compressor.attack.value = 0.003;  // fast attack — mata pops
  compressor.release.value = 0.15;
  return compressor;
}

/**
 * Determina se noise reduction deve ser aplicado com base na análise do
 * waveform (se floor de ruído é alto, vale ativar).
 */
export function shouldApplyNoiseReduction(waveform, floorThreshold = 0.015) {
  if (!waveform?.length) return false;
  // Pega o mínimo dos buckets não-silenciosos
  const sorted = waveform.map((b) => b.level).filter((l) => l > 0).sort((a, b) => a - b);
  if (!sorted.length) return false;
  // Percentil 10 (aproxima "floor" de ruído entre falas)
  const p10 = sorted[Math.floor(sorted.length * 0.10)];
  return p10 > floorThreshold;
}
