// Cut Quality Checker — Item 4 da spec.
// Emite audio_safe / semantic_safe / visual_safe / cut_quality_score
// pra cada corte na EDL final.

import { makeIssue, SEVERITY } from "../qcSeverity.js";

/**
 * @param {object} args
 * @param {Array} args.segments
 * @param {Array} args.words
 * @param {AudioBuffer} args.audioBuffer
 * @param {object} args.narrative
 * @returns {import("../qcReport.js").QCIssue[]}
 */
export function checkCutQuality({ segments = [], words = [], audioBuffer, narrative } = {}) {
  const active = segments.filter((s) => !s.deleted).sort((a, b) => a.start - b.start);
  const issues = [];
  const timeline = narrative?.timeline || [];

  for (let i = 1; i < active.length; i++) {
    const prev = active[i - 1];
    const cur = active[i];
    // audio_safe já é coberto pelo speechIntegrityChecker
    // aqui foca em: semantic_safe (frase continua?) + visual_safe (jump agressivo?)

    // semantic_safe: a palavra imediatamente antes é conector/preposição?
    const lastWord = words.filter((w) => w.end <= prev.end + 0.02).slice(-1)[0];
    const nextWord = words.filter((w) => w.start >= cur.start - 0.02)[0];
    if (lastWord && isDanglingConnector(lastWord.word)) {
      issues.push(makeIssue({
        type: "dangling_connector",
        severity: SEVERITY.HIGH,
        start: Math.max(0, prev.end - 0.3),
        end: prev.end,
        description: `Corte deixa "${lastWord.word}" órfão (conector sem complemento)`,
        auto_fixable: false,
        params: { word: lastWord.word, t: prev.end },
        checker: "cutQuality",
      }));
    }
    if (nextWord && isOrphanResponse(nextWord.word)) {
      issues.push(makeIssue({
        type: "orphan_response",
        severity: SEVERITY.MEDIUM,
        start: cur.start,
        end: cur.start + 0.3,
        description: `Fala começa em "${nextWord.word}" — resposta sem contexto`,
        auto_fixable: false,
        params: { word: nextWord.word, t: cur.start },
        checker: "cutQuality",
      }));
    }

    // visual_safe: se o corte fica DENTRO de um span crítico, HIGH
    const cutT = prev.end;
    const inCritical = timeline.some((n) => n.importance === "critical" && cutT > n.start + 0.1 && cutT < n.end - 0.1);
    if (inCritical) {
      issues.push(makeIssue({
        type: "cut_in_critical",
        severity: SEVERITY.HIGH,
        start: cutT - 0.15,
        end: cutT + 0.15,
        description: "Corte dentro de trecho crítico da narrativa",
        auto_fixable: false,
        params: { t: cutT },
        checker: "cutQuality",
      }));
    }
  }
  return issues;
}

const DANGLING = new Set([
  "e", "ou", "mas", "porém", "porem", "porque", "que", "do", "da", "de",
  "o", "a", "no", "na", "para", "pra", "por", "com", "sem", "então", "entao",
  "muito", "bem", "só", "so", "vai", "vou", "quer", "queria",
]);
function isDanglingConnector(word) {
  return DANGLING.has((word || "").toLowerCase().replace(/[.,!?;:]/g, ""));
}

const ORPHAN_RESPONSE = new Set([
  "sim", "não", "nao", "exatamente", "isso", "aí", "ai", "então", "entao",
]);
function isOrphanResponse(word) {
  return ORPHAN_RESPONSE.has((word || "").toLowerCase().replace(/[.,!?;:]/g, ""));
}
