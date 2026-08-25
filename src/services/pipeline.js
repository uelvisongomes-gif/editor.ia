// End-to-end orchestrator: raw video → EDL → timeline segments.
// Deliberately thin. Each step is a call into a dedicated module so we can
// swap implementations (a different transcriber, a different LLM, a different
// scoring rule) without rewriting the orchestrator.
//
// Progress is reported through `onStep(stepId, label)` so the UI can render
// a progress bar without needing to know pipeline internals.

import { transcribe } from "./transcription.js";
import { analyzeWaveform } from "./audioAnalysis.js";
import { detectSilences } from "./silenceDetection.js";
import { detectSpeechErrors } from "./speechErrorDetection.js";
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

/**
 * @param {object} args
 * @param {string} args.videoUrl
 * @param {number} args.duration
 * @param {string} [args.profileId]
 * @param {(stepId:string, label:string)=>void} [args.onStep]
 * @param {{ words?:Array, waveform?:Array }} [args.reuse]
 */
export async function runEditingPipeline({ videoUrl, duration, profileId, onStep, reuse = {} }) {
  const profile = getProfile(profileId);
  const step = (id) => onStep && onStep(id, STEPS[id]);

  let words = reuse.words;
  if (!words) {
    step("transcribe");
    words = await transcribe(videoUrl);
  }

  let waveform = reuse.waveform;
  if (!waveform) {
    step("waveform");
    waveform = await analyzeWaveform(videoUrl, duration);
  }

  step("semantics");
  const semantic = await analyzeSemantics(words);

  step("narrative");
  const narrative = buildNarrativeMap(semantic);

  step("silences");
  const silences = detectSilences(waveform, words, profile);

  step("errors");
  let speechErrors = [];
  try {
    speechErrors = await detectSpeechErrors(words);
  } catch (err) {
    // Non-fatal — the pipeline still delivers value without this signal.
    console.warn("Speech error detection failed, continuing:", err);
  }

  step("edl");
  const edl = buildEDL({ duration, words, semantic, silences, speechErrors, profile });

  step("compile");
  const segments = compileTimeline(edl);

  return { words, waveform, semantic, narrative, edl, segments, profile };
}

export { STEPS as PIPELINE_STEPS };
