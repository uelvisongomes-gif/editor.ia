// B-roll Checkers — Items 21, 22.
// checkBrollRelevance: mídia relevante ao que está sendo falado
// checkBrollHallucination: bloqueia B-roll sobre entidades nomeadas
//                         (pessoa/empresa/produto/lugar específico)

import { makeIssue, SEVERITY } from "../qcSeverity.js";

/** Item 21 — heurístico */
export function checkBrollRelevance({ brollPlan, narrative } = {}) {
  const issues = [];
  const suggestions = brollPlan?.suggestions || [];
  if (!suggestions.length) return issues;
  const timeline = narrative?.timeline || [];

  const seen = new Set();
  for (const s of suggestions) {
    // Duração inadequada?
    const dur = s.end - s.start;
    if (dur < 1.5) {
      issues.push(makeIssue({
        type: "broll_too_short",
        severity: SEVERITY.LOW,
        start: s.start, end: s.end,
        description: `B-roll dura ${dur.toFixed(2)}s — curto pra registrar visualmente`,
        auto_fixable: true,
        params: { action: "extend_min", target: 2.0 },
        checker: "broll",
      }));
    } else if (dur > 6) {
      issues.push(makeIssue({
        type: "broll_too_long",
        severity: SEVERITY.LOW,
        start: s.start, end: s.end,
        description: `B-roll dura ${dur.toFixed(2)}s — cobre demais o rosto`,
        auto_fixable: true,
        params: { action: "cap_max", target: 5.0 },
        checker: "broll",
      }));
    }

    // Query repetida
    const key = s.query?.toLowerCase();
    if (key && seen.has(key)) {
      issues.push(makeIssue({
        type: "broll_repeated_query",
        severity: SEVERITY.LOW,
        start: s.start, end: s.end,
        description: `B-roll com query "${s.query}" repetida`,
        auto_fixable: false,
        params: { query: s.query },
        checker: "broll",
      }));
    }
    if (key) seen.add(key);

    // Sem mídia real anexada (matched)
    if (!s.media?.length) {
      issues.push(makeIssue({
        type: "broll_no_media",
        severity: SEVERITY.LOW,
        start: s.start, end: s.end,
        description: `B-roll sugerido sem mídia real (provider não retornou)`,
        auto_fixable: false,
        params: { query: s.query },
        checker: "broll",
      }));
    }
  }
  return issues;
}

/** Item 22 — LLM-backed hallucination protection */
export async function checkBrollHallucination({ brollPlan, narrative, words = [], llmEnabled = true, onUsage, signal } = {}) {
  const issues = [];
  const suggestions = brollPlan?.suggestions || [];
  if (!suggestions.length) return issues;

  // Junta o texto falado durante cada B-roll pra analisar
  const enrichedSuggestions = suggestions.map((s) => {
    const spokenDuring = words
      .filter((w) => w.start >= s.start && w.end <= s.end + 0.5)
      .map((w) => w.word)
      .join(" ");
    return { ...s, spokenText: spokenDuring };
  });

  // Heurística sempre roda (rápida)
  for (const s of enrichedSuggestions) {
    const heuristicHits = detectNamedEntitiesHeuristic(s.spokenText);
    if (heuristicHits.length) {
      issues.push(makeIssue({
        type: "broll_hallucination_risk",
        severity: SEVERITY.HIGH,
        start: s.start, end: s.end,
        description: `B-roll genérico sobre "${s.query}" enquanto fala menciona: ${heuristicHits.slice(0, 3).join(", ")}`,
        auto_fixable: true,
        params: { entities: heuristicHits, action: "remove_broll", spokenText: s.spokenText.slice(0, 120) },
        checker: "brollHallucination",
      }));
    }
  }

  // LLM opcional pra casos complexos (só analisa se muitas sugestões)
  if (llmEnabled && enrichedSuggestions.length >= 2) {
    try {
      const llmIssues = await llmHallucinationCheck(enrichedSuggestions, { onUsage, signal });
      // Dedupe com heurísticas já emitidas (mesmo start)
      for (const li of llmIssues) {
        if (!issues.some((i) => Math.abs((i.start || 0) - (li.start || 0)) < 0.5 && i.checker === li.checker)) {
          issues.push(li);
        }
      }
    } catch (err) {
      console.warn("[brollHallucination] LLM falhou:", err.message);
    }
  }

  return issues;
}

// Regex-based: nomes próprios (palavras capitalizadas isoladas), R$, %, datas, marcas conhecidas
const KNOWN_BRANDS = /\b(google|apple|microsoft|amazon|meta|facebook|instagram|tiktok|youtube|whatsapp|netflix|spotify|itaú|itau|bradesco|nubank|caixa|santander|banco do brasil|shopee|magalu|mercado livre|iphone|samsung)\b/gi;
function detectNamedEntitiesHeuristic(text) {
  if (!text) return [];
  const found = new Set();
  // Marcas conhecidas
  const brands = text.match(KNOWN_BRANDS) || [];
  brands.forEach((b) => found.add(b));
  // Valores monetários
  if (/R\$\s?\d/.test(text)) found.add("valor monetário");
  // Percentuais
  if (/\d+\s?%/.test(text)) found.add("percentual factual");
  // Anos específicos
  if (/\b(19|20)\d{2}\b/.test(text)) found.add("ano específico");
  // Nomes próprios: palavras capitalizadas isoladas que não são início de frase
  const properNames = (text.match(/(?<=[.!?]\s|^)([A-ZÀ-Ú][a-zà-ú]+)/g) || []).filter((n) => n.length > 2);
  properNames.forEach((n) => found.add(n));
  return Array.from(found);
}

async function llmHallucinationCheck(suggestions, { onUsage, signal }) {
  const payload = suggestions.map((s, i) => ({
    idx: i, query: s.query, spoken: s.spokenText.slice(0, 200), start: s.start, end: s.end,
  }));

  const prompt = `Você é um QC de B-roll. Para cada sugestão abaixo, decida se mostrar mídia genérica sobre "query" é enganoso considerando o que a pessoa fala.

REGRA: Se a fala menciona pessoa específica, empresa real, produto real, lugar específico, dado factual (valor, %, data, quantidade), documento — mostrar B-roll genérico É enganoso.

RETORNE JSON: {"blocked":[{"idx":N,"reason":"..."}]}
Só liste os enganosos. Se todos ok: {"blocked":[]}. Não invente.

SUGESTÕES:
${JSON.stringify(payload, null, 2)}`;

  const resp = await fetch("/api/semantic-check", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, maxTokens: 500 }),
    signal,
  });
  if (!resp.ok) throw new Error(`semantic-check ${resp.status}`);
  const data = await resp.json();
  if (data.usage && onUsage) onUsage({ endpoint: "semantic-check", ...data.usage });

  let parsed;
  try { parsed = JSON.parse(data.content); } catch { parsed = { blocked: [] }; }
  const blocked = Array.isArray(parsed.blocked) ? parsed.blocked : [];
  return blocked.map((b) => {
    const s = suggestions[b.idx];
    if (!s) return null;
    return makeIssue({
      type: "broll_hallucination_llm",
      severity: SEVERITY.HIGH,
      start: s.start, end: s.end,
      description: `LLM bloqueou: ${b.reason || "conteúdo específico não deve receber B-roll genérico"}`,
      auto_fixable: true,
      params: { query: s.query, action: "remove_broll", llmReason: b.reason },
      checker: "brollHallucination",
    });
  }).filter(Boolean);
}
