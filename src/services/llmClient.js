// Thin wrapper around the /api/ai-text endpoint. Kept small on purpose so the
// serverless endpoint (or the model itself) can be swapped without touching
// the analysis modules that call it.

export async function callLLM({ prompt, maxTokens = 2000, signal } = {}) {
  const resp = await fetch("/api/ai-text", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, maxTokens }),
    signal,
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(data?.error || `LLM request failed (${resp.status})`);
  }
  return data.text || "";
}

// LLMs happily wrap JSON in ```json fences, add prose, or output smart quotes.
// This is intentionally forgiving — we'd rather recover than error the pipeline.
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
    // last-resort: strip trailing commas
    try {
      return JSON.parse(clean.replace(/,\s*([\]}])/g, "$1"));
    } catch (err) {
      return null;
    }
  }
}
