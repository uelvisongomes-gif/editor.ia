// Dead Air Checker — Item 31.
// Depois de toda a edição, procura pausas > 2s dentro do output final.
// Ignora pausas expressivas (marcadas em narrative.timeline como 'aside'
// ou dentro de weakSpots).

import { makeIssue, SEVERITY } from "../qcSeverity.js";

const DEAD_AIR_THRESHOLD_SEC = 2.0;

export function checkDeadAir({ segments = [], words = [], narrative } = {}) {
  const active = segments.filter((s) => !s.deleted).sort((a, b) => a.start - b.start);
  const issues = [];
  const protectedPause = (t) => {
    const timeline = narrative?.timeline || [];
    return timeline.some((n) => (n.role === "aside" || n.weakness) && t >= n.start && t < n.end);
  };

  // Analisa gaps entre palavras DENTRO de segmentos ativos
  const activeWords = words
    .filter((w) => active.some((s) => w.start >= s.start && w.end <= s.end))
    .sort((a, b) => a.start - b.start);

  for (let i = 1; i < activeWords.length; i++) {
    const gap = activeWords[i].start - activeWords[i - 1].end;
    if (gap >= DEAD_AIR_THRESHOLD_SEC && !protectedPause(activeWords[i - 1].end + gap / 2)) {
      issues.push(makeIssue({
        type: "dead_air",
        severity: gap > 3.5 ? SEVERITY.HIGH : SEVERITY.MEDIUM,
        start: activeWords[i - 1].end,
        end: activeWords[i].start,
        description: `Silêncio de ${gap.toFixed(1)}s no output final`,
        auto_fixable: true,
        params: { durationSec: gap, action: "trim_to_1s" },
        checker: "deadAir",
      }));
    }
  }
  return issues;
}
