// Audio QC — Quality Control PÓS-processamento (Item 33).
// Reanalisa o áudio depois do voice enhancement e detecta se ficou pior
// que o original. Se sim, dispara fallback.
//
// Chamado após aplicar toda a cadeia de tratamento (voiceEnhancement + noise +
// ducking) mas antes de considerar o export "pronto".

/**
 * @typedef {Object} QCFinding
 * @property {"clipping"|"distortion"|"metallic_voice"|"cut_word"|"music_too_loud"|"noise_residual"|"volume_delta"|"click_residual"} kind
 * @property {number} severity   - 0-1
 * @property {string} message
 * @property {number} [t]        - timestamp opcional
 */

/**
 * Compara diagnóstico ANTES e DEPOIS do processamento.
 * Retorna problemas que APARECERAM ou pioraram.
 *
 * @param {object} before  - audioAnalyzer.analyzeAudioDetailed(originalBuffer)
 * @param {object} after   - audioAnalyzer.analyzeAudioDetailed(processedBuffer)
 * @returns {{ findings: QCFinding[], regressed: boolean, delta: number }}
 */
export function compareAudioQuality(before, after) {
  const findings = [];
  if (!before || !after) {
    return { findings: [{ kind: "distortion", severity: 0, message: "sem dados de comparação" }], regressed: false, delta: 0 };
  }

  // 1. Clipping novo
  if (!before.loudness.hasClipping && after.loudness.hasClipping) {
    findings.push({
      kind: "clipping",
      severity: Math.min(1, after.loudness.clippingPct * 100),
      message: `clipping introduzido pelo processamento (${(after.loudness.clippingPct * 100).toFixed(2)}%)`,
    });
  } else if (after.loudness.clippingPct > before.loudness.clippingPct * 1.5 && before.loudness.clippingPct > 0) {
    findings.push({
      kind: "clipping",
      severity: 0.6,
      message: `clipping piorou (de ${(before.loudness.clippingPct * 100).toFixed(2)}% pra ${(after.loudness.clippingPct * 100).toFixed(2)}%)`,
    });
  }

  // 2. Voz metálica: overallQuality caiu > 10 pontos + sibilância aumentou
  const qualityDrop = before.overallQuality - after.overallQuality;
  if (qualityDrop > 10 && after.artifacts.sibilanceScore > before.artifacts.sibilanceScore + 0.15) {
    findings.push({
      kind: "metallic_voice",
      severity: Math.min(1, qualityDrop / 30),
      message: `voz ficou metálica (qualidade caiu ${qualityDrop} pts, sibilância +${Math.round((after.artifacts.sibilanceScore - before.artifacts.sibilanceScore) * 100)}%)`,
    });
  }

  // 3. Volume dramático: LUFS afastou-se do target -14 mais que antes
  const beforeDelta = Math.abs(before.loudness.estimatedLufs - (-14));
  const afterDelta = Math.abs(after.loudness.estimatedLufs - (-14));
  if (afterDelta > beforeDelta + 3) {
    findings.push({
      kind: "volume_delta",
      severity: 0.5,
      message: `LUFS ficou mais longe do alvo (-14): ${after.loudness.estimatedLufs.toFixed(1)}`,
    });
  }

  // 4. Ruído residual — noise floor não deve ter piorado
  if (after.noise.floorDb > before.noise.floorDb + 4) {
    findings.push({
      kind: "noise_residual",
      severity: 0.7,
      message: `noise floor piorou: ${before.noise.floorDb.toFixed(1)} → ${after.noise.floorDb.toFixed(1)}`,
    });
  }

  // 5. Distorção detectada por artifact spike
  const artifactBefore = before.artifacts.clickCount + before.artifacts.popCount;
  const artifactAfter = after.artifacts.clickCount + after.artifacts.popCount;
  if (artifactAfter > artifactBefore + 5) {
    findings.push({
      kind: "click_residual",
      severity: 0.5,
      message: `clicks/pops introduzidos (${artifactBefore} → ${artifactAfter})`,
    });
  }

  const delta = after.overallQuality - before.overallQuality;
  const regressed = delta < -8 || findings.some((f) => f.severity > 0.6);

  return { findings, regressed, delta };
}

/**
 * Score de qualidade só de áudio (dimensão dedicada).
 * Usa audioAnalyzer diagnostic.
 * @returns {{ score: number, label: string, dims: object }}
 */
export function computeAudioQualityScore(diagnostic) {
  if (!diagnostic) return { score: 0, label: "Sem dados", dims: {} };

  // Inteligibilidade: baseia-se em noise floor + sibilância
  const intelligibility = Math.max(0, 100 - Math.max(0, diagnostic.noise.floorDb + 40) * 2 - diagnostic.artifacts.sibilanceScore * 30);
  // Ruído: hum + hiss + floor
  const noiseScore = Math.max(0, 100
    - (diagnostic.noise.hasHum50 ? 10 : 0)
    - (diagnostic.noise.hasHum60 ? 10 : 0)
    - diagnostic.noise.hissIntensity * 25
    - Math.max(0, diagnostic.noise.floorDb + 45) * 1.2);
  // Volume: distância pra -14 LUFS
  const lufsDelta = Math.abs(diagnostic.loudness.estimatedLufs - (-14));
  const volumeScore = Math.max(0, 100 - lufsDelta * 4);
  // Clipping: penaliza direto
  const clipScore = diagnostic.loudness.hasClipping ? Math.max(0, 100 - diagnostic.loudness.clippingPct * 500) : 100;
  // Consistência: variação de volume da voz
  const consistencyScore = Math.max(0, 100 - diagnostic.voice.volumeVariance * 5);
  // Naturalidade: reverb + múltiplas vozes
  const naturalScore = Math.max(0, 100 - diagnostic.voice.reverbTail * 30 - (diagnostic.voice.multipleVoices ? 10 : 0));

  const dims = {
    intelligibility: Math.round(intelligibility),
    noise: Math.round(noiseScore),
    volume: Math.round(volumeScore),
    clipping: Math.round(clipScore),
    consistency: Math.round(consistencyScore),
    naturalness: Math.round(naturalScore),
  };

  const score = Math.round(
    dims.intelligibility * 0.30 +
    dims.noise * 0.20 +
    dims.volume * 0.15 +
    dims.clipping * 0.15 +
    dims.consistency * 0.10 +
    dims.naturalness * 0.10
  );

  const label = score >= 90 ? "Excelente"
              : score >= 75 ? "Bom"
              : score >= 60 ? "Razoável"
              : score >= 40 ? "Precisa ajustes"
              : "Ruim";

  return { score, label, dims };
}
