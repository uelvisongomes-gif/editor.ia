// End-to-end orchestrator: raw video → EDL → timeline segments.
// Thin on purpose. Each step is its own module so implementations can be
// swapped without rewriting orchestration.
//
// Progress: onStep(stepId, label) drives the UI progress bar.
// Cancellation: signal is threaded to every network call.
// Cost: onUsage is called by every module that talks to the model; the
//       aggregator (usageLog) turns those into a per-project summary.

import { transcribe } from "./transcription.js";
import { analyzeWaveform } from "./audioAnalysis.js";
import { detectSilences } from "./silenceDetection.js";
import { detectSpeechErrorsHeuristic } from "./heuristicSpeechErrors.js";
import { buildSpeechActivity } from "./speechActivity.js";
import { analyzeSemantics } from "./semanticAnalysis.js";
import { buildNarrativeMap } from "./narrativeAnalysis.js";
import { buildEDL } from "./editDecisionList.js";
import { compileTimeline } from "./timelineCompilation.js";
import { getProfile } from "./editingProfiles.js";
import { computeZoomEvents } from "./smartZoom.js";
import { checkEditingIntegrity } from "./editingIntegrityCheck.js";
import { buildDebugReport } from "./editingDebugReport.js";
import { snapAllCutsToWordBoundaries } from "./wordBoundarySafety.js";
import { cleanupCutEdges } from "./cutEdgeCleanup.js";
import { buildVisualPlan } from "./visualDirector.js";

const STEPS = {
  transcribe: "Transcrevendo o áudio...",
  waveform: "Analisando o áudio...",
  semantics: "Compreendendo o conteúdo...",
  narrative: "Mapeando a narrativa...",
  silences: "Detectando silêncios úteis...",
  errors: "Detectando erros de fala...",
  edl: "Decidindo cortes...",
  compile: "Compilando linha do tempo...",
};

const throwIfAborted = (signal) => {
  if (signal?.aborted) throw new DOMException("Cancelado pelo usuário", "AbortError");
};

/**
 * @param {object} args
 * @param {string} args.videoUrl
 * @param {number} args.duration
 * @param {string} [args.profileId]
 * @param {(stepId:string, label:string)=>void} [args.onStep]
 * @param {{ words?:Array, waveform?:Array }} [args.reuse]
 * @param {AbortSignal} [args.signal]
 * @param {(entry:{operation:string,model?:string,inputTokens?:number|null,outputTokens?:number|null,totalTokens?:number|null,latencyMs?:number,audioDurationSec?:number|null,audioBytes?:number|null})=>void} [args.onUsage]
 */
export async function runEditingPipeline({ videoUrl, duration, profileId, onStep, reuse = {}, signal, onUsage }) {
  const profile = getProfile(profileId);
  const step = (id) => onStep && onStep(id, STEPS[id]);

  let words = reuse.words;
  if (!words) {
    throwIfAborted(signal);
    step("transcribe");
    words = await transcribe(videoUrl, { signal, onUsage });
  }
  console.log("[pipeline] Whisper devolveu", words.length, "palavras. Primeiras 60:");
  console.log("[pipeline] transcript (primeiros 30s):",
    words.filter((w) => w.start <= 30).map((w) => w.word).join(" "));
  // Palavra a palavra com timestamp — pra ver EXATAMENTE onde o
  // Whisper colocou cada palavra e detectar erros que passam.
  console.log("[pipeline] palavras timestamped:",
    words.map((w) => `[${w.start.toFixed(2)}]${w.word}`).join(" "));

  let waveform = reuse.waveform;
  if (!waveform) {
    throwIfAborted(signal);
    step("waveform");
    waveform = await analyzeWaveform(videoUrl, duration);
  }

  // Camada VAD deterministica: combina words + waveform em uma
  // classificacao unificada (SPEECH/NO_SPEECH/UNCERTAIN) por slot.
  // Detectores futuros podem consumir esta camada em vez de reimplementar
  // a fusao de fontes. Por ora e exposta no resultado pra inspecao.
  const speechActivity = buildSpeechActivity({ words, waveform, duration });

  throwIfAborted(signal);
  step("semantics");
  const semantic = await analyzeSemantics(words, { signal, onUsage });

  step("narrative");
  const narrative = buildNarrativeMap(semantic);

  step("silences");
  const silences = detectSilences(waveform, words, profile);

  throwIfAborted(signal);
  step("errors");
  // Só heurística determinística. Speech errors do LLM foram desligados
  // porque em teste real geravam MUITOS cortes desnecessários e
  // poluíam a timeline. Heurística cobre: pre-roll, silêncios longos,
  // "quer dizer" autocorreção, stutters, palavras esticadas.
  const speechErrors = detectSpeechErrorsHeuristic(words, { waveform });
  console.log("[pipeline] speechErrors (heuristic only):", speechErrors.length);
  console.log("[pipeline] semantic result:", {
    topic: semantic.topic,
    sentences: semantic.sentences.length,
    repeatedGroups: semantic.repeatedGroups.length,
    offTopicIndexes: semantic.offTopicIndexes.length,
  });

  throwIfAborted(signal);
  step("edl");
  const { edl, problemCandidates } = buildEDL({ duration, words, semantic, silences, speechErrors, profile });
  console.log("[pipeline] problemCandidates:", problemCandidates.length, problemCandidates);

  // Word-boundary safety net: garante que NENHUM corte cai no meio de
  // palavra/fonema. Ajusta start/end pra bordas seguras (fim de palavra
  // anterior / início de próxima). Cortes 100% dentro de palavra são
  // cancelados.
  const cutsBefore = edl.filter((e) => e.action === "remove" || e.action === "trim");
  const { cuts: cutsSafe, adjustments, cancelled } = snapAllCutsToWordBoundaries(cutsBefore, words);
  console.log(`[pipeline] word-boundary safety: ${adjustments} ajustes, ${cancelled} cancelados`);
  // Re-monta a EDL substituindo os cortes ajustados.
  const cutMap = new Map(cutsSafe.map((c) => [c.__origIndex ?? c.id ?? `${c.start}-${c.end}`, c]));
  const edlSafe = edl.map((e) => {
    if (e.action !== "remove" && e.action !== "trim") return e;
    // acha equivalente por id/originalStart
    const match = cutsSafe.find((c) =>
      (c.id && e.id && c.id === e.id) ||
      Math.abs((c.safety?.originalStart ?? c.start) - e.start) < 0.01
    );
    return match ? { ...e, start: match.start, end: match.end, safety: match.safety } : e;
  }).filter((e) => e.action !== "remove" || (e.end - e.start > 0.05)); // remove cortes anulados

  // Cut edge cleanup: se palavra imediatamente antes de um corte é
  // igual à palavra imediatamente depois, estende o corte pra trás
  // pra engolir a repetição no seam (ex: "porque falta [ideia stretched
  // cortada] falta jeito" → "porque [falta ideia falta cortado] jeito").
  const { edl: edlCleaned, extensions } = cleanupCutEdges(edlSafe, words);
  if (extensions > 0) console.log(`[pipeline] cut edge cleanup: ${extensions} cortes estendidos por repetição de palavra`);

  step("compile");
  const segments = compileTimeline(edlCleaned);

  // Visual Director — decisão central visual (recomendações, não executa).
  // Fica ANTES do smartZoom pra que o zoom possa consumir sugestões
  // no futuro; por ora smartZoom continua com sua própria heurística.
  const visualPlan = buildVisualPlan({
    narrative,
    segments,
    zoomEvents: [],       // ainda não computados nesse ponto
    captionEvents: [],
    profile,
  });
  console.log(`[pipeline] visualPlan: ${visualPlan.summary.decisionsEmitted}/${visualPlan.summary.totalItemsAnalyzed} decisões (modo ${visualPlan.summary.mode})`);

  // SmartZoom — derivado da análise já feita. Sem chamada LLM extra.
  const zoomEvents = computeZoomEvents({ semantic, segments, profile });
  console.log("[pipeline] zoomEvents:", zoomEvents.length, zoomEvents);

  // Integrity check + debug report (determinístico, zero LLM).
  // Passa `words` pra habilitar regra 0 (corte no meio de palavra).
  const integrity = checkEditingIntegrity({ segments, zoomEvents, duration, words });
  const debugReport = buildDebugReport({ segments, zoomEvents, integrity, duration });
  if (integrity.summary.errors) {
    console.warn("[pipeline] integrity errors:", integrity.errors);
  }
  console.log("[pipeline] integrity summary:", integrity.summary);

  return {
    words, waveform, speechActivity, semantic, narrative, edl, segments, profile,
    problemCandidates, zoomEvents, integrity, debugReport, visualPlan,
  };
}

export { STEPS as PIPELINE_STEPS };
