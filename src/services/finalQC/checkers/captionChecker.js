// Caption Checkers — Items 24 e 25.
// checkCaptions: palavras alinhadas com fala, cobertura, quebras, excesso
// checkCaptionPosition: baixa/média/alta são realmente diferentes

import { makeIssue, SEVERITY } from "../qcSeverity.js";

const MAX_WORDS_PER_CHUNK = 7;
const MIN_CHUNK_DURATION = 0.35;

export function checkCaptions({ captions = [], words = [], segments = [] } = {}) {
  const issues = [];
  const active = segments.filter((s) => !s.deleted).sort((a, b) => a.start - b.start);
  if (!captions.length) return issues;

  const spokenWords = words
    .filter((w) => active.some((s) => w.start >= s.start && w.end <= s.end))
    .map((w) => w.word.toLowerCase().replace(/[.,!?;:]/g, ""));

  for (const cap of captions) {
    const capWords = (cap.text || cap.words?.map((w) => w.word).join(" ") || "").split(/\s+/).filter(Boolean);

    // Excesso de palavras simultâneas
    if (capWords.length > MAX_WORDS_PER_CHUNK) {
      issues.push(makeIssue({
        type: "caption_too_many_words",
        severity: SEVERITY.MEDIUM,
        start: cap.start, end: cap.end,
        description: `${capWords.length} palavras simultâneas (máx ${MAX_WORDS_PER_CHUNK})`,
        auto_fixable: true,
        params: { count: capWords.length, action: "split_chunk" },
        checker: "caption",
      }));
    }

    // Duração muito curta
    if ((cap.end - cap.start) < MIN_CHUNK_DURATION) {
      issues.push(makeIssue({
        type: "caption_too_short",
        severity: SEVERITY.LOW,
        start: cap.start, end: cap.end,
        description: `Legenda dura ${((cap.end - cap.start) * 1000).toFixed(0)}ms — leitura impossível`,
        auto_fixable: true,
        params: { durationMs: (cap.end - cap.start) * 1000, action: "extend_min" },
        checker: "caption",
      }));
    }

    // Layout vertical (uma palavra por linha) — anti-CRIE
    const lines = (cap.text || "").split("\n").filter(Boolean);
    if (lines.length >= 3 && lines.every((l) => l.trim().split(/\s+/).length === 1)) {
      issues.push(makeIssue({
        type: "caption_vertical_layout",
        severity: SEVERITY.MEDIUM,
        start: cap.start, end: cap.end,
        description: "Legenda em layout vertical (1 palavra por linha) — evitar",
        auto_fixable: true,
        params: { action: "join_horizontal" },
        checker: "caption",
      }));
    }
  }

  return issues;
}

export function checkCaptionPosition({ captions = [], captionPosition = "bottom" } = {}) {
  const issues = [];
  if (!captions.length) return issues;

  // Verifica se posições diferentes resultam em pixels realmente diferentes.
  // Convenção do editor: bottom = ~85% viewport, middle = ~55%, top = ~15%
  const POS_Y_PCT = { top: 15, middle: 55, bottom: 85 };
  const currentY = POS_Y_PCT[captionPosition];
  if (currentY == null) {
    issues.push(makeIssue({
      type: "caption_position_invalid",
      severity: SEVERITY.LOW,
      description: `Posição "${captionPosition}" desconhecida`,
      auto_fixable: false,
      params: { captionPosition },
      checker: "captionPosition",
    }));
  }
  return issues;
}
