// Audio Final Checkers — Items 9, 10, 27, 28.
// Consomem audioReport da Fase 4 e transformam em QC issues tipadas.

import { makeIssue, SEVERITY } from "../qcSeverity.js";

/** Item 9 — usa diagnostic + audioQuality do Fase 4 */
export function checkAudioFinal({ audioReport } = {}) {
  const issues = [];
  const diag = audioReport?.diagnostic;
  if (!diag) return issues;

  if (diag.loudness.hasClipping) {
    issues.push(makeIssue({
      type: "audio_clipping",
      severity: diag.loudness.clippingPct > 0.005 ? SEVERITY.CRITICAL : SEVERITY.HIGH,
      description: `Clipping em ${(diag.loudness.clippingPct * 100).toFixed(2)}% do áudio`,
      auto_fixable: true,
      params: { pct: diag.loudness.clippingPct, action: "apply_limiter" },
      checker: "audioFinal",
    }));
  }
  if (diag.noise.hasHum50 || diag.noise.hasHum60) {
    issues.push(makeIssue({
      type: "electrical_hum",
      severity: SEVERITY.MEDIUM,
      description: `Ruído elétrico ${diag.noise.hasHum50 ? "50Hz" : "60Hz"} detectado`,
      auto_fixable: true,
      params: { freq: diag.noise.hasHum50 ? 50 : 60, action: "notch_filter" },
      checker: "audioFinal",
    }));
  }
  if (diag.noise.hasHiss) {
    issues.push(makeIssue({
      type: "hiss",
      severity: diag.noise.hissIntensity > 0.6 ? SEVERITY.MEDIUM : SEVERITY.LOW,
      description: `Hiss detectado (intensidade ${(diag.noise.hissIntensity * 100).toFixed(0)}%)`,
      auto_fixable: true,
      params: { intensity: diag.noise.hissIntensity, action: "noise_reduction" },
      checker: "audioFinal",
    }));
  }
  if (diag.voice.volumeVariance > 10) {
    issues.push(makeIssue({
      type: "volume_inconsistent",
      severity: SEVERITY.MEDIUM,
      description: `Volume da voz varia ${diag.voice.volumeVariance.toFixed(1)} dB entre trechos`,
      auto_fixable: true,
      params: { variance: diag.voice.volumeVariance, action: "compressor" },
      checker: "audioFinal",
    }));
  }
  return issues;
}

/** Item 10 — audio continuity map baseado em waveform */
export function checkAudioContinuity({ waveform = [], segments = [] } = {}) {
  const issues = [];
  const active = segments.filter((s) => !s.deleted).sort((a, b) => a.start - b.start);
  if (active.length < 2 || !waveform.length) return issues;

  const levelAt = (t) => {
    const b = waveform.find((wb) => t >= wb.start && t < wb.end);
    return b?.level ?? 0;
  };

  for (let i = 1; i < active.length; i++) {
    const outT = active[i - 1].end;
    const inT = active[i].start;
    const before = levelAt(outT - 0.05);
    const after = levelAt(inT + 0.05);
    const beforeDb = before > 0 ? 20 * Math.log10(before) : -60;
    const afterDb = after > 0 ? 20 * Math.log10(after) : -60;
    const delta = Math.abs(afterDb - beforeDb);
    if (delta > 15) {
      issues.push(makeIssue({
        type: "audio_level_jump",
        severity: delta > 25 ? SEVERITY.HIGH : SEVERITY.MEDIUM,
        start: outT - 0.05, end: inT + 0.05,
        description: `Salto de volume ${delta.toFixed(1)} dB no corte ${outT.toFixed(2)}s`,
        auto_fixable: true,
        params: { deltaDb: delta, action: "crossfade_or_gain" },
        checker: "audioContinuity",
      }));
    }
  }
  return issues;
}

/** Item 27 — music: volume vs fala, começo/fim */
export function checkMusicFinal({ audioReport, narrative } = {}) {
  const issues = [];
  const decision = audioReport?.musicDecision;
  const brief = audioReport?.musicBrief;
  const envelope = audioReport?.musicEnvelope || [];
  if (decision?.answer !== "yes") return issues;

  // Se música não está sendo abaixada durante fala (ducking > 0.5 em pontos de speech)
  if (envelope.length && brief) {
    const highDurantSpeech = envelope.filter((e) => e.reason === "duck_speech" && e.musicGain > 0.5);
    if (highDurantSpeech.length > envelope.length * 0.1) {
      issues.push(makeIssue({
        type: "music_covering_speech",
        severity: SEVERITY.HIGH,
        description: `Ducking insuficiente — música alta em ${highDurantSpeech.length} pontos de fala`,
        auto_fixable: true,
        params: { action: "reduce_music_or_deepen_duck" },
        checker: "music",
      }));
    }
  }
  return issues;
}

/** Item 28 — SFX volume/sobreposição */
export function checkSfxFinal({ audioReport, words = [] } = {}) {
  const issues = [];
  const sfx = audioReport?.sfxPlan?.decisions || [];
  if (!sfx.length) return issues;

  // SFX exatamente em cima de palavra falada
  for (const s of sfx) {
    const overlappingWord = words.find((w) => w.start < s.end && w.end > s.start);
    if (overlappingWord) {
      const params = s.params || {};
      if ((params.volumeDb ?? -20) > -14) {
        issues.push(makeIssue({
          type: "sfx_over_speech",
          severity: SEVERITY.MEDIUM,
          start: s.start, end: s.end,
          description: `SFX "${params.sfxId}" sobre palavra "${overlappingWord.word}"`,
          auto_fixable: true,
          params: { action: "lower_sfx_or_shift" },
          checker: "sfx",
        }));
      }
    }
  }
  return issues;
}
