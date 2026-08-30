// Smoke tests para Fases 5, 6, 7 — executáveis via `node --input-type=module`.
// Não é framework — validação rápida que os módulos carregam e produzem
// output plausível.

import { buildQCReport, computeStatus, DEFAULT_THRESHOLDS } from "../finalQC/qcReport.js";
import { makeIssue, SEVERITY } from "../finalQC/qcSeverity.js";
import { applyAutoFixes } from "../finalQC/autoFixEngine.js";
import { loadUserStyle, recordEvent, resetUserStyle, applyUserStyleToProfile, summarizeStyleForUI } from "../userStyleLearning.js";
import { discoverClips } from "../clips/clipDiscoveryEngine.js";
import { generateClipTitle } from "../clips/clipTitleGenerator.js";
import { buildClipEditState, computeStandaloneQuality } from "../clips/clipAutoEditor.js";
import { createClipQueue } from "../clips/clipJobQueue.js";

let passed = 0, failed = 0;
const results = [];

function test(name, fn) {
  try {
    const r = fn();
    if (r === false) throw new Error("assertion returned false");
    passed++;
    results.push({ name, status: "PASS" });
  } catch (err) {
    failed++;
    results.push({ name, status: "FAIL", error: err.message });
  }
}

// -------- FASE 5 --------
test("QC: buildQCReport com issues vazias → PASS", () => {
  const r = buildQCReport([]);
  return r.status === "PASS" && r.final_score >= 90;
});
test("QC: CRITICAL sempre resulta FAIL", () => {
  const iss = makeIssue({ type: "test", severity: SEVERITY.CRITICAL, checker: "test", description: "x" });
  const r = buildQCReport([iss]);
  return r.status === "FAIL";
});
test("QC: HIGHs em speech baixam pra REVIEW/FAIL", () => {
  // speech_integrity tem peso 0.20 — 3 HIGH = -45 pts → dim = 55
  // final ≈ 55*0.20 + 100*(0.80) = 91 (na borda PASS). Precisa mais HIGH.
  const iss = [];
  for (let i = 0; i < 6; i++) iss.push(makeIssue({ type: "x", severity: SEVERITY.HIGH, checker: "speechIntegrity", description: "x" }));
  const r = buildQCReport(iss);
  return r.status === "REVIEW" || r.status === "FAIL";
});
test("QC: computeStatus respeita thresholds custom", () => {
  return computeStatus(93, [], { pass: 95, review: 80 }) === "REVIEW";
});
test("Auto-fix: cut_mid_phoneme desloca segments", () => {
  const state = { segments: [{ start: 0, end: 5 }, { start: 5.05, end: 10 }] };
  const issues = [makeIssue({
    type: "cut_mid_phoneme", severity: SEVERITY.HIGH, auto_fixable: true,
    params: { t: 5, direction: "exit", suggestedShift: 0.08 }, checker: "speechIntegrity",
  })];
  const { newState, appliedIssues } = applyAutoFixes(issues, state);
  return appliedIssues.length === 1 && newState.segments[0].end > 5;
});

// -------- FASE 6 --------
test("UserStyle: reset limpa storage", () => {
  resetUserStyle("test-user");
  const s = loadUserStyle("test-user");
  return s.videosAnalyzed === 0 && s.events.length === 0;
});
test("UserStyle: 3+ eventos gera confidence MEDIUM", () => {
  resetUserStyle("test-user");
  const ls = { setItem: (k, v) => { globalThis._testStorage = globalThis._testStorage || {}; globalThis._testStorage[k] = v; }, getItem: (k) => (globalThis._testStorage || {})[k], removeItem: (k) => { delete (globalThis._testStorage || {})[k]; } };
  if (typeof localStorage === "undefined") globalThis.localStorage = ls;
  for (let i = 0; i < 5; i++) {
    recordEvent({ kind: "reject", target: "zoom", reason: "preference" }, "test-user");
  }
  const style = loadUserStyle("test-user");
  return style.dimensions.zoom_frequency.samples >= 5 && ["MEDIUM", "HIGH"].includes(style.dimensions.zoom_frequency.confidence);
});
test("UserStyle: applyUserStyleToProfile respeita LOW confidence", () => {
  resetUserStyle("fresh-user");
  const base = { executeThreshold: 0.8, zoomsPerMin: 7 };
  const modified = applyUserStyleToProfile(base);
  return !modified._userStyleApplied || modified.zoomsPerMin === 7; // não muda pra LOW
});

// -------- FASE 7 --------
test("Clip Discovery: retorna vazio se sem narrative", () => {
  const { candidates } = discoverClips({ narrative: null, duration: 60 });
  return Array.isArray(candidates) && candidates.length === 0;
});
test("Clip Discovery: descobre candidatos numa timeline sintética", () => {
  const narrative = {
    timeline: [
      { start: 0, end: 8, role: "hook", importance: "high", confidence: 85, text: "Você não vai acreditar nisso" },
      { start: 8, end: 20, role: "context", importance: "medium", confidence: 70, text: "Ano passado..." },
      { start: 20, end: 35, role: "problem", importance: "high", confidence: 80, text: "O maior erro que fiz foi" },
      { start: 35, end: 50, role: "solution", importance: "critical", confidence: 90, text: "A solução foi simples" },
      { start: 50, end: 60, role: "cta", importance: "high", confidence: 85, text: "Comenta aqui embaixo" },
    ],
  };
  const { candidates } = discoverClips({ narrative, duration: 60, words: [], mode: "general", maxCandidates: 5 });
  return candidates.length > 0 && candidates[0].score > 0;
});
test("Clip Title: gera título e hookText", () => {
  const clip = { hook: "Este é o segredo dos vídeos virais", payoff: "vira em 3 dias", momentType: "INSIGHT", start: 0, end: 30 };
  const meta = generateClipTitle(clip);
  return meta.title.length > 0 && meta.hookText.length > 0 && Array.isArray(meta.hashtags);
});
test("Clip Auto Editor: buildClipEditState rebase timeline", () => {
  const source = {
    words: [{ start: 15, end: 16, word: "olá" }, { start: 25, end: 26, word: "mundo" }],
    waveform: [{ start: 15, end: 16, level: 0.5 }],
    narrative: { timeline: [{ start: 15, end: 30, role: "hook" }] },
    brollPlan: { suggestions: [] },
    graphicsPlan: { overlays: [] },
    transitionPlan: { transitions: [] },
    patternInterrupts: { interrupts: [] },
    productMoments: { moments: [] },
    zoomEvents: [],
  };
  const clip = { start: 15, end: 30 };
  const state = buildClipEditState({ clip, sourceAnalysis: source });
  return state.words[0].start === 0 && state.narrative.timeline[0].start === 0 && state.duration === 15;
});
test("Standalone Quality: score razoável pra clip com hook+payoff", () => {
  const clip = { start: 0, end: 30 };
  const clipState = {
    narrative: { timeline: [
      { role: "hook" },
      { role: "development" },
      { role: "proof" },
    ]},
  };
  const s = computeStandaloneQuality({ clip, clipState });
  return s >= 70;
});
test("Clip Queue: enqueue e state transitions", async () => {
  const events = [];
  const q = createClipQueue({
    onProgress: (jobs) => events.push(JSON.parse(JSON.stringify(jobs))),
    processorFn: async (clip, progress) => {
      progress(50);
      await new Promise((r) => setTimeout(r, 20));
      progress(100);
      return { ok: true };
    },
  });
  q.enqueue({ id: "clip-1" });
  q.enqueue({ id: "clip-2" });
  q.start();
  await new Promise((r) => setTimeout(r, 200));
  const snap = q.getSnapshot();
  return snap.every((j) => j.status === "completed") && snap.length === 2;
});

// Report
const report = {
  passed, failed, total: passed + failed,
  results,
};
console.log(JSON.stringify(report, null, 2));
if (failed > 0) process.exit(1);
