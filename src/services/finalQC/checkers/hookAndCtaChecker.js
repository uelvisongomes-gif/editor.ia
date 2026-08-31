// Hook & CTA Checkers — Items 7 e 8.
// Reavaliam primeiros 3s e todos os CTAs no output final.

import { makeIssue, SEVERITY } from "../qcSeverity.js";

const HOOK_WINDOW_SEC = 3.0;

export function checkHook({ narrative, segments = [], words = [] } = {}) {
  const active = segments.filter((s) => !s.deleted).sort((a, b) => a.start - b.start);
  if (!active.length) return [];
  const issues = [];

  const firstSeg = active[0];
  const hook = narrative?.timeline?.find((n) => n.role === "hook");

  // 1. Demora pra começar (silêncio inicial). Só considera "demorado" acima
  // de 2.5s — pausas curtas (respiração, cenário, olhar) são legítimas e o
  // usuário geralmente prefere preservar. NÃO é auto_fixable — vira sugestão.
  const firstWord = words.find((w) => w.start >= firstSeg.start && w.start < firstSeg.start + HOOK_WINDOW_SEC);
  const delayAtStart = firstWord ? firstWord.start - firstSeg.start : 0;
  if (delayAtStart > 2.5) {
    issues.push(makeIssue({
      type: "hook_slow_start",
      severity: SEVERITY.MEDIUM,
      start: firstSeg.start,
      end: firstSeg.start + delayAtStart,
      description: `Início com ${delayAtStart.toFixed(1)}s de silêncio (revisar manualmente)`,
      auto_fixable: false,
      params: { firstWordStart: firstWord?.start, action: "review_manually" },
      checker: "hook",
    }));
  }

  // 2. Hook foi removido?
  if (hook) {
    const survived = active.some((s) => hook.start >= s.start && hook.end <= s.end);
    if (!survived) {
      issues.push(makeIssue({
        type: "hook_removed",
        severity: SEVERITY.CRITICAL,
        start: hook.start,
        end: hook.end,
        description: "Gancho detectado foi removido pelos cortes",
        auto_fixable: false,
        params: { hookText: hook.text?.slice(0, 80) },
        checker: "hook",
      }));
    }
  }

  return issues;
}

export function checkCTA({ narrative, segments = [], words = [], audioReport } = {}) {
  const active = segments.filter((s) => !s.deleted).sort((a, b) => a.start - b.start);
  const issues = [];
  const ctas = narrative?.timeline?.filter((n) => n.role === "cta") || [];
  if (!ctas.length) return [];

  for (const cta of ctas) {
    const survived = active.some((s) => cta.start >= s.start && cta.end <= s.end);
    if (!survived) {
      issues.push(makeIssue({
        type: "cta_removed",
        severity: SEVERITY.CRITICAL,
        start: cta.start,
        end: cta.end,
        description: "CTA removido pelos cortes",
        auto_fixable: false,
        params: { text: cta.text?.slice(0, 100) },
        checker: "cta",
      }));
      continue;
    }
    // CTA muito próximo do final (< 1s de sobra)?
    const outputEnd = active[active.length - 1].end;
    if (cta.end > outputEnd - 0.5) {
      issues.push(makeIssue({
        type: "cta_cut_early",
        severity: SEVERITY.HIGH,
        start: cta.start,
        end: outputEnd,
        description: "CTA muito perto do fim — pode ter sido cortado",
        auto_fixable: false,
        params: { ctaEnd: cta.end, videoEnd: outputEnd },
        checker: "cta",
      }));
    }
    // Verifica se a fala do CTA está completa (todas as palavras)
    const ctaWords = words.filter((w) => w.start >= cta.start - 0.05 && w.end <= cta.end + 0.05);
    const allSurvived = ctaWords.every((w) => active.some((s) => w.start >= s.start && w.end <= s.end));
    if (ctaWords.length && !allSurvived) {
      issues.push(makeIssue({
        type: "cta_partial",
        severity: SEVERITY.HIGH,
        start: cta.start,
        end: cta.end,
        description: "CTA parcialmente cortado — parte da fala perdida",
        auto_fixable: false,
        params: { totalWords: ctaWords.length },
        checker: "cta",
      }));
    }
  }
  return issues;
}
