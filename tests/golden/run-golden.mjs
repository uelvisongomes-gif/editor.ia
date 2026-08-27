#!/usr/bin/env node
// Golden test runner — roda o pipeline nas fixtures e mede TP/FP/FN.
// Sem chamada de rede: usa dados pré-gravados. Testa APENAS a lógica de
// detecção heurística determinística (o LLM é stubado com o que estiver
// no fixture, se houver).

import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { detectSpeechErrorsHeuristic } from "../../src/services/heuristicSpeechErrors.js";
import { collectCandidates, dedupCandidates } from "../../src/services/candidateAggregator.js";
import { decideAll, applySafetyValidators } from "../../src/services/decisionEngine.js";
import { getProfile } from "../../src/services/editingProfiles.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, "fixtures");
const TOLERANCE_SEC = 0.5;

function overlaps(a, b) {
  const startsInside = b.start >= a.startApprox - TOLERANCE_SEC && b.start <= a.endApprox + TOLERANCE_SEC;
  const endsInside = b.end >= a.startApprox - TOLERANCE_SEC && b.end <= a.endApprox + TOLERANCE_SEC;
  const containsWhole = b.start <= a.startApprox && b.end >= a.endApprox;
  const insideExpected = b.start >= a.startApprox && b.end <= a.endApprox;
  return startsInside || endsInside || containsWhole || insideExpected;
}

function runFixture(fx) {
  const profile = getProfile(fx.profile || "equilibrada");
  const words = fx.words || [];
  const waveform = fx.waveform || [];
  const semantic = fx.semantic || { sentences: [], repeatedGroups: [], offTopicIndexes: [], speechErrors: [] };
  const heuristicErrors = detectSpeechErrorsHeuristic(words, { waveform });
  const speechErrors = [...heuristicErrors, ...(semantic.speechErrors || [])];

  const rawCandidates = collectCandidates({ words, semantic, silences: [], speechErrors, profile });
  const problemCandidates = decideAll(rawCandidates, {
    profile,
    semanticSentences: semantic.sentences || [],
    protectedRanges: [],
    words,
  });

  // Constrói decisões finais em intervalos [start, end] → REMOVE|KEEP|REVIEW
  const detected = problemCandidates
    .filter((c) => ["remove", "trim", "review"].includes(c.finalAction))
    .map((c) => ({
      start: c.cutStart ?? c.start,
      end: c.cutEnd ?? c.end,
      action: c.finalAction === "review" ? "REVIEW" : "REMOVE",
      reason: c.primaryType,
    }));

  return { detected, candidates: problemCandidates.length };
}

function score(fx, detected) {
  let tp = 0, fp = 0, fn = 0;
  const details = [];
  for (const exp of fx.expected || []) {
    const overlapping = detected.filter((d) => overlaps(exp, d));
    if (exp.expected === "REMOVE") {
      const hit = overlapping.find((d) => d.action === "REMOVE" || d.action === "REVIEW");
      if (hit) {
        tp += 1;
        details.push(`  ✓ TP: expected REMOVE @${exp.startApprox}-${exp.endApprox} → got ${hit.action} @${hit.start.toFixed(2)}-${hit.end.toFixed(2)} (${hit.reason})`);
      } else {
        fn += 1;
        details.push(`  ✗ FN: expected REMOVE @${exp.startApprox}-${exp.endApprox} → NOT detected (${exp.reason})`);
      }
    } else if (exp.expected === "KEEP") {
      const bad = overlapping.filter((d) => d.action === "REMOVE");
      if (bad.length) {
        fp += bad.length;
        details.push(`  ✗ FP: expected KEEP @${exp.startApprox}-${exp.endApprox} → cortes: ${bad.map(b => `${b.reason}@${b.start.toFixed(2)}-${b.end.toFixed(2)}`).join(", ")}`);
      } else {
        details.push(`  ✓ KEEP: @${exp.startApprox}-${exp.endApprox} preserved`);
      }
    }
  }
  return { tp, fp, fn, details };
}

function main() {
  let files;
  try {
    files = readdirSync(FIXTURES_DIR).filter((f) => f.endsWith(".json"));
  } catch (err) {
    console.error(`Diretório de fixtures não existe: ${FIXTURES_DIR}`);
    console.error("Crie o diretório e adicione fixtures. Veja README.md.");
    process.exit(1);
  }

  if (!files.length) {
    console.log("Nenhuma fixture encontrada em", FIXTURES_DIR);
    console.log("Ver README.md pra formato.");
    process.exit(0);
  }

  let totalTP = 0, totalFP = 0, totalFN = 0;
  const results = [];
  for (const f of files) {
    const fx = JSON.parse(readFileSync(join(FIXTURES_DIR, f), "utf8"));
    console.log(`\n=== ${fx.name || f} ===`);
    console.log(fx.description || "");
    const { detected, candidates } = runFixture(fx);
    console.log(`  candidatos detectados: ${candidates}, executados: ${detected.length}`);
    const { tp, fp, fn, details } = score(fx, detected);
    details.forEach((d) => console.log(d));
    console.log(`  TP=${tp} FP=${fp} FN=${fn}`);
    totalTP += tp; totalFP += fp; totalFN += fn;
    results.push({ name: fx.name || f, tp, fp, fn });
  }

  const total = totalTP + totalFN;
  const match = total > 0 ? ((totalTP / total) * 100).toFixed(1) : "0";
  console.log("\n=========================");
  console.log(`RESUMO: TP=${totalTP} FP=${totalFP} FN=${totalFN}`);
  console.log(`Match: ${match}%`);
  console.log("=========================");
  if (totalFP > 0) {
    console.log("⚠️  FP > 0 — cortou fala boa. Investigar.");
    process.exit(2);
  }
  if (total > 0 && (totalTP / total) < 0.6) {
    console.log("⚠️  Match < 60% — deteccao fraca. Investigar.");
    process.exit(3);
  }
  console.log("✓ OK");
}

main();
