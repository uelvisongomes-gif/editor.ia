// BPM Selector — deriva BPM alvo a partir do ritmo da fala + modo.
// Item 16 da spec.
//
// Sinal de fala usado: palavras por minuto (WPM) do transcrição word-timestamped.

export function estimateSpeechWpm(words = [], duration = 60) {
  if (!words.length || duration <= 0) return 120;
  return Math.round((words.length / duration) * 60);
}

/**
 * @param {object} args
 * @param {number} args.speechWpm
 * @param {object} args.profile
 * @param {string} args.energy   - "low" | "medium" | "high"
 * @returns {{ bpm: number, range: [number, number], rationale: string }}
 */
export function pickBpm({ speechWpm = 120, profile, energy = "medium" } = {}) {
  const modeId = profile?.id;

  const modeRange = {
    natural:     [70, 95],
    equilibrada: [85, 105],
    profissional: [70, 95],
    podcast:     [65, 85],
    tutorial:    [80, 100],
    dinamico:    [95, 115],
    viral:       [110, 135],
    tiktokshop:  [100, 125],
  }[modeId] || [90, 110];

  const energyMult = energy === "high" ? 1.10 : energy === "low" ? 0.90 : 1.0;

  // WPM > 160 = fala rápida → BPM sobe. WPM < 100 = fala calma → BPM desce.
  const speedShift = (speechWpm - 130) * 0.15;
  const rawBpm = ((modeRange[0] + modeRange[1]) / 2) * energyMult + speedShift;
  const bpm = Math.round(Math.max(60, Math.min(160, rawBpm)));

  return {
    bpm,
    range: modeRange,
    rationale: `WPM=${speechWpm}, modo=${modeId || "default"}, energy=${energy}`,
  };
}
