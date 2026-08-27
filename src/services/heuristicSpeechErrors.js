// Agregador dos detectores heurísticos determinísticos. Cada detector
// vive em seu próprio arquivo em ./detectors/ — este módulo só orquestra.
// Mantém a API antiga (`detectSpeechErrorsHeuristic`) pra o pipeline não
// precisar mudar.

import { normalize } from "./detectors/_shared.js";
import { detectPreRoll } from "./detectors/preRoll.js";
import { detectGapSilence, detectHiddenSilence, detectSoundWithoutWord } from "./detectors/deadAir.js";
import { detectWordRepeat, detectBigramStutter } from "./detectors/stutter.js";
import { detectFillerChain, detectElongatedHesitation, detectStandaloneHesitation } from "./detectors/filler.js";
import { detectRestartMarkers, detectHangingConnectorAbandon, detectSentenceHeadRepeat } from "./detectors/falseStart.js";
import { detectLowClarity } from "./detectors/lowClarity.js";
import { detectStretchedWord } from "./detectors/stretchedWord.js";

/**
 * @param {Array<{word:string,start:number,end:number}>} words
 * @param {{waveform?: Array<{start:number,end:number,level:number}>}} [opts]
 * @returns {Array<{start:number,end:number,confidence:number,reason:string,source:'speechError',text:string}>}
 */
export function detectSpeechErrorsHeuristic(words, { waveform } = {}) {
  if (!words?.length) return [];
  const norm = words.map((w) => normalize(w.word));
  const ctx = { words, norm, waveform };
  return [
    ...detectPreRoll(ctx),
    ...detectGapSilence(ctx),
    ...detectSoundWithoutWord(ctx),
    ...detectWordRepeat(ctx),
    ...detectBigramStutter(ctx),
    ...detectFillerChain(ctx),
    ...detectRestartMarkers(ctx),
    ...detectElongatedHesitation(ctx),
    ...detectHangingConnectorAbandon(ctx),
    ...detectStandaloneHesitation(ctx),
    ...detectHiddenSilence(ctx),
    ...detectSentenceHeadRepeat(ctx),
    ...detectLowClarity(ctx),
    ...detectStretchedWord(ctx),
  ];
}
