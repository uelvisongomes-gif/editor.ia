// Audio/Video Sync Checker — Item 12.
// Compara timestamps de palavras (word transcription) com timestamps de
// segmentos da EDL. Se word.start cai dentro de gap deletado ou > 40ms
// fora de segmento ativo → possível dessync.

import { makeIssue, SEVERITY } from "../qcSeverity.js";

const SYNC_TOLERANCE_MS = 40;

export function checkAudioVideoSync({ words = [], segments = [] } = {}) {
  const active = segments.filter((s) => !s.deleted).sort((a, b) => a.start - b.start);
  if (!words.length || !active.length) return [];
  const issues = [];
  let outOfSyncCount = 0;
  for (const w of words) {
    const inActive = active.some((s) => w.start >= s.start - SYNC_TOLERANCE_MS / 1000 && w.end <= s.end + SYNC_TOLERANCE_MS / 1000);
    if (!inActive) outOfSyncCount++;
  }
  const ratio = outOfSyncCount / words.length;
  if (ratio > 0.02) {
    issues.push(makeIssue({
      type: "sync_drift",
      severity: ratio > 0.10 ? SEVERITY.CRITICAL : ratio > 0.05 ? SEVERITY.HIGH : SEVERITY.MEDIUM,
      description: `${outOfSyncCount}/${words.length} palavras fora dos segmentos ativos (${(ratio * 100).toFixed(1)}%)`,
      auto_fixable: false,
      params: { ratio, count: outOfSyncCount },
      checker: "sync",
    }));
  }
  return issues;
}
