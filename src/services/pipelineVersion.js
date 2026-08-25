// Version stamps that get saved on every project so we can compare quality
// between pipeline / prompt / model changes over time. Bump these when you
// materially change behavior — the number tells you which snapshots are
// comparable to which.

export const PIPELINE_VERSION = "2.0";

export const PROMPT_VERSIONS = {
  semantic: "v2",         // src/services/semanticAnalysis.js
  speechError: "v2",      // src/services/speechErrorDetection.js
  captions: "v1",         // legacy captions generator in App.jsx (not used by smart pipeline)
};

// The models we CALL, not the ones we're built against. If the endpoint
// swaps model, keep this in sync so old projects stay legible.
export const MODEL_VERSIONS = {
  transcription: "whisper-1",
  llm: "gpt-4o-mini",
};

// Central config for cost estimates — prices per 1M tokens (USD).
// Kept optional; when zero, the UI falls back to "cost: n/a".
export const PRICING_USD_PER_MILLION = {
  "gpt-4o-mini": { input: 0.15, output: 0.60 },
  "gpt-4o": { input: 2.50, output: 10.00 },
  // whisper-1 is billed per minute of audio, not per token — kept separate
  "whisper-1-per-minute-usd": 0.006,
};

export function stampsForProject() {
  return {
    pipelineVersion: PIPELINE_VERSION,
    promptVersions: { ...PROMPT_VERSIONS },
    modelVersions: { ...MODEL_VERSIONS },
    stampedAt: new Date().toISOString(),
  };
}
