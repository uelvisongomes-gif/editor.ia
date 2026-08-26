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
import { detectSpeechErrors } from "./speechErrorDetection.js";
import { detectSpeechErrorsHeuristic } from "./heuristicSpeechErrors.js";
import { analyzeSemantics } from "./semanticAnalysis.js";
import { buildNarrativeMap } from "./narrativeAnalysis.js";
import { buildEDL } from "./editDecisionList.js";
import { compileTimeline } from "./timelineCompilation.js";
import { getProfile } from "./editingProfiles.js";

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

  throwIfAborted(signal);
  step("semantics");
  const semantic = await analyzeSemantics(words, { signal, onUsage });

  step("narrative");
  const narrative = buildNarrativeMap(semantic);

  step("silences");
  const silences = detectSilences(waveform, words, profile);

  throwIfAborted(signal);
  step("errors");
  // Detecção dupla: heurística determinística SEMPRE + LLM em paralelo.
  // A heurística garante que gagueira/muletas/reinícios óbvios sejam pegos
  // mesmo quando o LLM devolve vazio. O merger da EDL dedupa por overlap.
  const heuristicErrors = detectSpeechErrorsHeuristic(words);
  console.log("[pipeline] heuristic speechErrors:", heuristicErrors.length, heuristicErrors);
  let llmErrors = [];
  try {
    llmErrors = await detectSpeechErrors(words, { signal, onUsage });
    console.log("[pipeline] LLM speechErrors:", llmErrors.length, llmErrors);
  } catch (err) {
    if (err?.name === "AbortError") throw err;
    console.warn("[pipeline] Speech error LLM failed, continuing with heuristic only:", err);
  }
  const speechErrors = [...heuristicErrors, ...llmErrors];
  console.log("[pipeline] total speechErrors merged:", speechErrors.length);
  console.log("[pipeline] semantic result:", {
    topic: semantic.topic,
    sentences: semantic.sentences.length,
    repeatedGroups: semantic.repeatedGroups.length,
    offTopicIndexes: semantic.offTopicIndexes.length,
  });

  throwIfAborted(signal);
  step("edl");
  const edl = buildEDL({ duration, words, semantic, silences, speechErrors, profile });

  step("compile");
  const segments = compileTimeline(edl);

  return { words, waveform, semantic, narrative, edl, segments, profile };
}

export { STEPS as PIPELINE_STEPS };
