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

// -------- STYLE ENGINE --------
import { listStyles, getStyleById, BASE_STYLE_IDS } from "../styleEngine/styleRegistry.js";
import { extractTriggers } from "../styleEngine/triggerEngine.js";
import { runAnimation, listAnimations, animationExists } from "../styleEngine/animationRegistry.js";
import { resolveConflicts } from "../styleEngine/conflictResolver.js";
import { applyDensityBudget, applyCooldowns } from "../styleEngine/visualDensityBudget.js";
import { runStyleEngine } from "../styleEngine/styleEngine.js";
import { createSeededRng } from "../styleEngine/seedRandom.js";

test("StyleRegistry: 11 base styles carregam", () => {
  const styles = listStyles();
  return styles.length >= 11 && BASE_STYLE_IDS.every((id) => getStyleById(id));
});
test("StyleRegistry: REFERENCE_DYNAMIC_01 herda de dynamic_creator_01", () => {
  const ref = getStyleById("reference_dynamic_01");
  return ref && ref.triggers?.HOOK?.length > 0 && ref.brandKit?.primary != null;
});
test("AnimationRegistry: 40+ animações disponíveis", () => {
  return listAnimations().length >= 40 && animationExists("punch_in") && animationExists("big_number");
});
test("AnimationRegistry: fallback pra hard_cut se animação não existe", () => {
  const evt = runAnimation("nonexistent_xyz", { t: 5, styleId: "test" });
  return evt && evt.animation === "hard_cut";
});
test("TriggerEngine: extrai HOOK/CTA/NUMBER/PROBLEM", () => {
  const narrative = { timeline: [
    { start: 0, end: 5, role: "hook", importance: "high", confidence: 90, text: "olha o segredo" },
    { start: 10, end: 15, role: "problem", importance: "medium", confidence: 75, text: "o problema é" },
    { start: 20, end: 25, role: "cta", importance: "high", confidence: 85, text: "comenta aqui" },
  ]};
  const words = [{ start: 12, end: 13, word: "97%" }];
  const t = extractTriggers({ narrative, words });
  const types = new Set(t.map((x) => x.type));
  return types.has("HOOK") && types.has("CTA") && types.has("PROBLEM") && types.has("NUMBER");
});
test("ConflictResolver: mesma categoria vira exclusive", () => {
  const events = [
    { id: "a", category: "zoom", start: 5, end: 6, confidence: 0.9 },
    { id: "b", category: "zoom", start: 5.02, end: 6, confidence: 0.5 },
  ];
  const { kept, dropped } = resolveConflicts(events);
  return kept.length === 1 && dropped.length === 1 && kept[0].id === "a";
});
test("VisualDensityBudget: excesso vira dropped", () => {
  const events = Array.from({ length: 20 }, (_, i) => ({
    id: `e${i}`, category: "zoom", start: i * 0.3, end: i * 0.3 + 0.5, confidence: 0.5,
  }));
  const { kept, dropped } = applyDensityBudget(events, { density: "low", duration: 10 });
  return kept.length < events.length && dropped.length > 0;
});
test("Cooldowns: respeitados por categoria", () => {
  const events = [
    { id: "a", category: "zoom", start: 0, end: 1, confidence: 0.9 },
    { id: "b", category: "zoom", start: 1.2, end: 2, confidence: 0.9 },
    { id: "c", category: "zoom", start: 5, end: 6, confidence: 0.9 },
  ];
  const { kept } = applyCooldowns(events, { zoom: 3 });
  return kept.length === 2 && kept.some((k) => k.id === "a") && kept.some((k) => k.id === "c");
});
test("SeedRandom: mesmo seed produz mesma sequência", () => {
  const r1 = createSeededRng("proj-1");
  const r2 = createSeededRng("proj-1");
  return r1() === r2() && r1() === r2();
});
test("SeedRandom: seeds diferentes produzem sequências diferentes", () => {
  const r1 = createSeededRng("proj-1");
  const r2 = createSeededRng("proj-2");
  return r1() !== r2();
});
test("StyleEngine: end-to-end com Viral Fast produz eventos", () => {
  const analysis = {
    narrative: { timeline: [
      { start: 0, end: 3, role: "hook", importance: "high", confidence: 90, text: "veja isto" },
      { start: 5, end: 10, role: "problem", importance: "medium", confidence: 75, text: "o problema" },
      { start: 12, end: 18, role: "proof", importance: "critical", confidence: 92, text: "temos 500 alunos" },
      { start: 20, end: 25, role: "cta", importance: "high", confidence: 88, text: "clica no link" },
    ]},
    words: [{ start: 13, end: 14, word: "500" }],
    productMoments: { moments: [] },
    patternInterrupts: { interrupts: [] },
  };
  const result = runStyleEngine({ styleId: "viral_fast_01", analysis, duration: 30, seed: "test" });
  return result.events.length > 0 && result.summary.finalEventCount > 0;
});
test("StyleEngine: mesmo seed dá resultado idêntico", () => {
  const analysis = {
    narrative: { timeline: [
      { start: 0, end: 3, role: "hook", importance: "high", confidence: 90, text: "veja" },
      { start: 5, end: 10, role: "proof", importance: "high", confidence: 85, text: "temos 100 clientes" },
    ]},
    words: [{ start: 6, end: 7, word: "100" }],
  };
  const r1 = runStyleEngine({ styleId: "dynamic_creator_01", analysis, duration: 15, seed: "same" });
  const r2 = runStyleEngine({ styleId: "dynamic_creator_01", analysis, duration: 15, seed: "same" });
  return r1.events.length === r2.events.length && r1.events.every((e, i) => e.animation === r2.events[i].animation);
});
test("StyleEngine: estilos diferentes = outputs diferentes (teste 29)", () => {
  const analysis = {
    narrative: { timeline: [
      { start: 0, end: 3, role: "hook", importance: "high", confidence: 90, text: "vamos ver" },
      { start: 5, end: 10, role: "problem", importance: "high", confidence: 85, text: "o problema é" },
      { start: 12, end: 18, role: "proof", importance: "critical", confidence: 92, text: "97 por cento" },
      { start: 20, end: 25, role: "cta", importance: "high", confidence: 88, text: "compra agora" },
    ]},
    words: [{ start: 13, end: 14, word: "97" }],
  };
  const natural = runStyleEngine({ styleId: "natural_clean_01", analysis, duration: 30, seed: "test" });
  const viral = runStyleEngine({ styleId: "viral_fast_01", analysis, duration: 30, seed: "test" });
  // Viral deve gerar mais eventos que natural
  return viral.events.length > natural.events.length;
});
import { bridgeStyleEventsToApp, chooseVisualSource } from "../styleEngine/styleEventsBridge.js";

test("Bridge: converte zoom+text+media em shapes do App", () => {
  const events = [
    { id: "1", category: "zoom", animation: "punch_in", start: 5, end: 6, params: { scale: 1.12 }, confidence: 0.9, reason: "" },
    { id: "2", category: "text", animation: "big_number", start: 8, end: 10, params: { text: "97%", sizeVw: 12 }, confidence: 0.9, reason: "" },
    { id: "3", category: "media", animation: "broll_overlay", start: 12, end: 15, params: { query: "escritorio", opacity: 0.9, mode: "pip" }, confidence: 0.8, reason: "" },
  ];
  const b = bridgeStyleEventsToApp(events);
  return b.zoomEvents.length === 1 && b.zoomEvents[0].level === "high"
    && b.overlays.length === 1 && b.overlays[0].kind === "big_number" && b.overlays[0].sizeVw === 12
    && b.brollSuggestions.length === 1 && b.brollSuggestions[0].mode === "pip";
});
test("Bridge: chooseVisualSource cai pro pipeline se sem styleResult", () => {
  const src = chooseVisualSource({
    styleResult: null, brollPlan: { suggestions: [{ id: "a", start: 0, end: 3 }] },
    graphicsPlan: { overlays: [{ id: "b", start: 0, end: 3 }] }, zoomEvents: [{ id: "z", start: 0, end: 1 }],
  });
  return src.source === "pipeline" && src.zoomEvents.length === 1 && src.overlays.length === 1 && src.brollSuggestions.length === 1;
});
test("Bridge: chooseVisualSource usa styleResult quando presente", () => {
  const src = chooseVisualSource({
    styleResult: { events: [{ id: "1", category: "zoom", animation: "punch_in", start: 5, end: 6, params: { scale: 1.08 }, confidence: 0.9 }] },
    brollPlan: { suggestions: [{ id: "a", start: 0, end: 3 }] },
    graphicsPlan: { overlays: [{ id: "b", start: 0, end: 3 }] },
    zoomEvents: [{ id: "z", start: 0, end: 1 }],
  });
  return src.source === "style_engine" && src.zoomEvents.length === 1 && src.zoomEvents[0].source === "style_engine";
});

test("StyleEngine: sem NUMBER trigger não emite big_number (teste 31)", () => {
  const analysis = {
    narrative: { timeline: [{ start: 0, end: 5, role: "hook", importance: "high", confidence: 90, text: "olá" }]},
    words: [], productMoments: { moments: [] },
  };
  const result = runStyleEngine({ styleId: "viral_fast_01", analysis, duration: 10, seed: "test" });
  return !result.events.some((e) => e.animation === "big_number");
});

// Report
const report = {
  passed, failed, total: passed + failed,
  results,
};
console.log(JSON.stringify(report, null, 2));
if (failed > 0) process.exit(1);
