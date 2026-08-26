// Thin wrapper around the /api/ai-text endpoint. Kept small on purpose so
// the serverless endpoint (or the model itself) can be swapped without
// touching the analysis modules.
//
// Every call takes an optional `signal` (AbortController) and an optional
// `onUsage(entry)` callback. The endpoint returns { text, usage }; we
// forward usage to the caller so the pipeline can log real cost.

import { getAccessToken } from "./auth/authProvider.js";

export async function callLLM({ prompt, maxTokens = 2000, signal, onUsage, operation = "llm" } = {}) {
  const token = await getAccessToken();
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const resp = await fetch("/api/ai-text", {
    method: "POST",
    headers,
    body: JSON.stringify({ prompt, maxTokens }),
    signal,
  });
  if (resp.status === 401) throw new Error("Você precisa entrar para usar a IA.");
  if (resp.status === 429) {
    const data = await resp.json().catch(() => ({}));
    throw new Error(data?.error || "Quota mensal do seu plano esgotada.");
  }
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(data?.error || `LLM request failed (${resp.status})`);
  }
  if (data.usage && typeof onUsage === "function") {
    try {
      onUsage({ operation, ...data.usage });
    } catch (err) {
      // Telemetry must never break the pipeline.
      console.warn("onUsage callback failed:", err);
    }
  }
  return data.text || "";
}

// LLMs happily wrap JSON in ```json fences, add prose, or output smart
// quotes. Intentionally forgiving — recover instead of erroring the pipeline.
export function extractJSON(text) {
  if (!text) return null;
  let clean = text.trim();
  clean = clean.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const firstBrace = clean.search(/[[{]/);
  if (firstBrace > 0) clean = clean.slice(firstBrace);
  const lastBrace = Math.max(clean.lastIndexOf("]"), clean.lastIndexOf("}"));
  if (lastBrace >= 0 && lastBrace < clean.length - 1) clean = clean.slice(0, lastBrace + 1);
  try {
    return JSON.parse(clean);
  } catch (_) {
    try {
      return JSON.parse(clean.replace(/,\s*([\]}])/g, "$1"));
    } catch (err) {
      return null;
    }
  }
}
