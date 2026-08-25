// Aggregates every AI call the pipeline made for a single project.
// The pipeline pushes entries via addUsageEntry(log, entry); the UI reads
// summarizeUsage(log) to render a debug panel. Cost is derived from
// pipelineVersion pricing tables — never hardcoded in individual services.

import { PRICING_USD_PER_MILLION } from "./pipelineVersion.js";

export function createUsageLog() {
  return { entries: [] };
}

/**
 * @param {ReturnType<createUsageLog>} log
 * @param {{operation:string, model?:string, inputTokens?:number|null,
 *          outputTokens?:number|null, totalTokens?:number|null,
 *          latencyMs?:number, audioDurationSec?:number|null,
 *          audioBytes?:number|null}} entry
 */
export function addUsageEntry(log, entry) {
  if (!log || !entry) return;
  log.entries.push({
    ...entry,
    timestamp: new Date().toISOString(),
  });
}

function estimateEntryCostUSD(entry) {
  if (!entry) return 0;
  if (entry.model === "whisper-1") {
    const secs = entry.audioDurationSec ?? 0;
    const perMin = PRICING_USD_PER_MILLION["whisper-1-per-minute-usd"] || 0;
    return (secs / 60) * perMin;
  }
  const priceTable = PRICING_USD_PER_MILLION[entry.model];
  if (!priceTable || typeof priceTable !== "object") return 0;
  const inMillion = (entry.inputTokens ?? 0) / 1e6;
  const outMillion = (entry.outputTokens ?? 0) / 1e6;
  return inMillion * priceTable.input + outMillion * priceTable.output;
}

export function summarizeUsage(log) {
  const entries = log?.entries || [];
  const totals = {
    calls: entries.length,
    byOperation: {},
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    latencyMs: 0,
    audioMinutes: 0,
    estimatedCostUSD: 0,
  };
  for (const e of entries) {
    if (!totals.byOperation[e.operation]) totals.byOperation[e.operation] = { calls: 0, inputTokens: 0, outputTokens: 0, latencyMs: 0 };
    const bucket = totals.byOperation[e.operation];
    bucket.calls += 1;
    bucket.inputTokens += e.inputTokens || 0;
    bucket.outputTokens += e.outputTokens || 0;
    bucket.latencyMs += e.latencyMs || 0;
    totals.inputTokens += e.inputTokens || 0;
    totals.outputTokens += e.outputTokens || 0;
    totals.totalTokens += e.totalTokens || ((e.inputTokens || 0) + (e.outputTokens || 0));
    totals.latencyMs += e.latencyMs || 0;
    totals.audioMinutes += (e.audioDurationSec || 0) / 60;
    totals.estimatedCostUSD += estimateEntryCostUSD(e);
  }
  return totals;
}
