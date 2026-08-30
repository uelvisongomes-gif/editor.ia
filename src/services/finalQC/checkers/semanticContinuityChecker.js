// Semantic Continuity Checker — Item 5 da spec.
// Usa LLM opcional (llmEnabled). Fallback heurístico se desligado.
//
// Envia o texto FINAL (após cortes) pra IA e pergunta:
//   "Há frase incompleta, pronome sem referência, resposta órfã, CTA sem preparo?"
//
// Retorna issues com severity baseada no que o LLM apontou.

import { makeIssue, SEVERITY } from "../qcSeverity.js";

/**
 * @param {object} args
 * @param {Array} args.segments
 * @param {Array} args.words
 * @param {boolean} [args.llmEnabled=true]
 * @param {Function} [args.onUsage]
 * @param {AbortSignal} [args.signal]
 * @returns {Promise<import("../qcReport.js").QCIssue[]>}
 */
export async function checkSemanticContinuity({ segments = [], words = [], llmEnabled = true, onUsage, signal } = {}) {
  const active = segments.filter((s) => !s.deleted).sort((a, b) => a.start - b.start);
  if (active.length < 2) return [];

  // Reconstrói o texto final palavra por palavra apenas nos trechos ativos
  const finalText = words
    .filter((w) => active.some((s) => w.start >= s.start && w.end <= s.end))
    .map((w) => w.word)
    .join(" ");

  if (finalText.length < 20) return [];

  if (!llmEnabled) {
    return heuristicCheck(finalText, active, words);
  }

  try {
    return await llmCheck(finalText, active, words, { onUsage, signal });
  } catch (err) {
    console.warn("[semanticContinuityChecker] LLM falhou, usando heurística:", err.message);
    return heuristicCheck(finalText, active, words);
  }
}

function heuristicCheck(text, active, words) {
  const issues = [];
  // Heurística: procura frases começando com "mas/porque/então" sozinhas
  const sentences = text.split(/[.!?]+/).map((s) => s.trim()).filter(Boolean);
  for (const s of sentences) {
    const first = s.split(/\s+/)[0]?.toLowerCase();
    if (first && ["mas", "porque", "então", "entao", "porém", "porem"].includes(first)) {
      issues.push(makeIssue({
        type: "orphan_sentence_start",
        severity: SEVERITY.MEDIUM,
        description: `Frase começa com "${first}" — provável quebra de contexto`,
        auto_fixable: false,
        params: { sentence: s.slice(0, 80) },
        checker: "semanticContinuity",
      }));
    }
  }
  return issues;
}

async function llmCheck(text, active, words, { onUsage, signal }) {
  const prompt = `Analise a coerência deste texto (transcript de vídeo após cortes automáticos).
Detecte APENAS problemas graves de continuidade semântica introduzidos pelos cortes:
- frases incompletas
- pronomes sem antecedente
- respostas sem pergunta
- CTA sem preparação
- referências sem contexto

Retorne JSON puro no formato:
{"issues":[{"severity":"medium|high","excerpt":"trecho literal","reason":"por quê"}]}

Se não há problemas graves, retorne {"issues":[]}. Não invente problemas.

TEXTO:
"""${text.slice(0, 3000)}"""`;

  const resp = await fetch("/api/semantic-check", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, maxTokens: 400 }),
    signal,
  });
  if (!resp.ok) throw new Error(`semantic-check ${resp.status}`);
  const data = await resp.json();
  if (data.usage && onUsage) onUsage({ endpoint: "semantic-check", ...data.usage });

  let parsed;
  try { parsed = JSON.parse(data.content); } catch { parsed = { issues: [] }; }
  const raw = Array.isArray(parsed.issues) ? parsed.issues : [];

  return raw.map((it) => {
    // Tenta achar timestamp do excerpt na palavra
    const t = findExcerptTimestamp(it.excerpt, words);
    return makeIssue({
      type: "semantic_broken",
      severity: it.severity === "high" ? SEVERITY.HIGH : SEVERITY.MEDIUM,
      start: t ? t.start : null,
      end: t ? t.end : null,
      description: it.reason || "Continuidade semântica quebrada",
      auto_fixable: false,
      params: { excerpt: it.excerpt },
      checker: "semanticContinuity",
    });
  });
}

function findExcerptTimestamp(excerpt, words) {
  if (!excerpt || !words?.length) return null;
  const first = excerpt.trim().split(/\s+/)[0]?.toLowerCase();
  if (!first) return null;
  const match = words.find((w) => w.word.toLowerCase().includes(first));
  if (!match) return null;
  return { start: match.start, end: match.end + 1 };
}
