// Final QC Orchestrator — ponto de entrada da Fase 5.
// Roda TODOS os checkers em paralelo, monta o QCReport,
// aplica auto-fixes (max 3 iterações), garante safety guard.
//
// Fluxo (Item 1):
//   input(state) → run checkers → issues → autofix → recheck → repeat até
//   score estável ou 3 iterações → final report.

import { buildQCReport, computeFinalScore, computeDimensionScores, DEFAULT_THRESHOLDS } from "./qcReport.js";
import { applyAutoFixes } from "./autoFixEngine.js";
import { checkSpeechIntegrity } from "./checkers/speechIntegrityChecker.js";
import { checkCutQuality } from "./checkers/cutQualityChecker.js";
import { checkSemanticContinuity } from "./checkers/semanticContinuityChecker.js";
import { checkAudioVideoSync } from "./checkers/syncChecker.js";
import { checkDeadAir } from "./checkers/deadAirChecker.js";
import { checkNarrative } from "./checkers/narrativeChecker.js";
import { checkHook, checkCTA } from "./checkers/hookAndCtaChecker.js";
import { checkCaptions, checkCaptionPosition } from "./checkers/captionChecker.js";
import { checkFrames } from "./checkers/frameCheckers.js";
import { checkFace, checkProduct, checkZoomDensity, checkTransitions, checkVisualDensity } from "./checkers/visualCheckers.js";
import { checkBrollRelevance, checkBrollHallucination } from "./checkers/brollCheckers.js";
import { checkAudioFinal, checkAudioContinuity, checkMusicFinal, checkSfxFinal } from "./checkers/audioFinalChecker.js";
import { checkSafeArea, checkMediaIntegrity, checkResolution } from "./checkers/technicalCheckers.js";

const MAX_FIX_ITERATIONS = 3;

/**
 * @typedef {Object} QCState
 * @property {Array} segments
 * @property {Array} words
 * @property {AudioBuffer} audioBuffer
 * @property {Array} waveform
 * @property {object} narrative
 * @property {object} audioReport
 * @property {object} brollPlan
 * @property {object} graphicsPlan
 * @property {object} transitionPlan
 * @property {object} patternInterrupts
 * @property {object} productMoments
 * @property {Array} zoomEvents
 * @property {Array} captions
 * @property {string} captionPosition
 * @property {object} profile
 * @property {number} duration
 * @property {string} platformId
 * @property {Array} faceRegions
 * @property {HTMLVideoElement|null} videoEl
 * @property {string} resolution
 * @property {boolean} llmEnabled
 */

/**
 * @param {QCState} state
 * @param {object} [opts]
 * @param {AbortSignal} [opts.signal]
 * @param {Function} [opts.onStep]
 * @param {Function} [opts.onUsage]
 * @returns {Promise<{ report: object, finalState: object, iterations: number }>}
 */
export async function runFinalQC(state, { signal, onStep, onUsage, thresholds = DEFAULT_THRESHOLDS, autoFix = true } = {}) {
  let currentState = { ...state };
  let iteration = 0;
  let lastReport = null;
  let history = [];

  while (iteration < MAX_FIX_ITERATIONS) {
    if (signal?.aborted) break;
    onStep?.(`qc_iter_${iteration}`, `QC iteração ${iteration + 1}/${MAX_FIX_ITERATIONS}...`);

    // Roda checkers em paralelo (independentes)
    const issues = await runAllCheckers(currentState, { signal, onUsage });

    const report = buildQCReport(issues, { thresholds });
    lastReport = report;
    history.push({ iter: iteration, score: report.final_score, status: report.status, issueCount: issues.length });

    // Se PASS ou não permite auto-fix, sai
    if (!autoFix || report.status === "PASS") break;

    // Se não tem nada auto-fixable, sai
    if (report.counts.autoFixable === 0) break;

    // Tenta auto-fix
    const { newState, appliedIssues } = applyAutoFixes(report.issues, currentState);
    if (!appliedIssues.length) break;

    // Safety guard: valida se o score não regrediu > 5 pts
    const nextIssues = await runAllCheckers(newState, { signal, onUsage });
    const nextReport = buildQCReport(nextIssues, { thresholds });
    if (nextReport.final_score < report.final_score - 5) {
      // Reverter
      console.warn(`[finalQC] Auto-fix regrediu (${report.final_score} → ${nextReport.final_score}). Revertendo.`);
      history.push({ iter: iteration, reverted: true, reason: "score regressed" });
      break;
    }
    // Aceita
    currentState = newState;
    // Marca as fixed nas issues
    lastReport = nextReport;
    lastReport.issues = lastReport.issues.map((iss) => {
      const wasFixed = appliedIssues.some((a) => a.type === iss.type && Math.abs((a.start || 0) - (iss.start || 0)) < 0.1);
      return wasFixed ? { ...iss, fixed: true } : iss;
    });
    iteration++;
  }

  return {
    report: lastReport,
    finalState: currentState,
    iterations: iteration,
    history,
  };
}

async function runAllCheckers(state, { signal, onUsage } = {}) {
  const checks = [];

  // Bloco 2: Speech
  checks.push(safe(() => checkSpeechIntegrity(state)));
  checks.push(safe(() => checkCutQuality(state)));
  checks.push(safe(() => checkSemanticContinuity({ ...state, onUsage, signal })));
  checks.push(safe(() => checkAudioVideoSync(state)));
  checks.push(safe(() => checkDeadAir(state)));
  // Bloco 3: Narrative/Hook/CTA/Caption
  checks.push(safe(() => checkNarrative(state)));
  checks.push(safe(() => checkHook(state)));
  checks.push(safe(() => checkCTA(state)));
  checks.push(safe(() => checkCaptions(state)));
  checks.push(safe(() => checkCaptionPosition(state)));
  // Bloco 4: Visual
  if (state.videoEl) {
    checks.push(safe(() => checkFrames({ ...state, videoEl: state.videoEl, duration: state.duration })));
  }
  checks.push(safe(() => checkFace(state)));
  checks.push(safe(() => checkProduct(state)));
  checks.push(safe(() => checkZoomDensity(state)));
  checks.push(safe(() => checkTransitions(state)));
  checks.push(safe(() => checkVisualDensity(state)));
  // Bloco 5: Broll
  checks.push(safe(() => checkBrollRelevance(state)));
  checks.push(safe(() => checkBrollHallucination({ ...state, onUsage, signal })));
  // Bloco 6: Audio final
  checks.push(safe(() => checkAudioFinal(state)));
  checks.push(safe(() => checkAudioContinuity(state)));
  checks.push(safe(() => checkMusicFinal(state)));
  checks.push(safe(() => checkSfxFinal(state)));
  // Bloco 7: Technical
  checks.push(safe(() => checkSafeArea(state)));
  checks.push(safe(() => checkMediaIntegrity({ ...state, signal })));
  checks.push(safe(() => checkResolution(state)));

  const results = await Promise.all(checks);
  return results.flat().filter(Boolean);
}

async function safe(fn) {
  try {
    const r = await fn();
    return Array.isArray(r) ? r : [];
  } catch (err) {
    console.warn("[finalQC] checker falhou:", err.message);
    return [];
  }
}
