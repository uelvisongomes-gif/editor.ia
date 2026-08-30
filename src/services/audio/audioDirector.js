// Audio Director — orquestrador central da Fase 4. Roda TODA a análise +
// decisões de áudio/música em uma chamada única e devolve:
//   - audioDiagnostic   (analyzer detalhado)
//   - audioTimeline     (decisões tipadas)
//   - musicPlan         ({ needs, brief, matched })
//   - sfxPlan           (SFX decisions)
//   - audioQualityScore ({ score, dims, label })
//   - existingMusic     (se vídeo já tem música)
//
// Consumido pelo pipeline.js. UI mostra tudo em painel dedicado.
//
// Determinístico. Zero LLM.

import { analyzeAudioDetailed } from "./audioAnalyzer.js";
import { buildAudioTimeline, makeDecision } from "./audioTimeline.js";
import { planVoiceEnhancement } from "./voiceEnhancement.js";
import { detectClicksNearCuts, planCrossfadesFromClicks } from "./clickPopDetector.js";
import { planCutCrossfades } from "./cutCrossfade.js";
import { extractRoomToneSample, planRoomTonePatches } from "./roomTone.js";
import { estimateLoudness } from "./loudnessAnalyzer.js";
import { pickPreset, planLoudnessNormalization } from "./loudnessNormalizer.js";
import { detectExistingMusic } from "./musicDetection.js";
import { decideNeedsMusic } from "./musicDecisionEngine.js";
import { analyzeMusicStyle } from "./musicStyleAnalyzer.js";
import { estimateSpeechWpm, pickBpm } from "./bpmSelector.js";
import { buildMusicBrief } from "./musicBrief.js";
import { searchMusicForBrief } from "./musicProviderAdapter.js";
import { computeSmartDuckingEnvelope } from "./smartDucking.js";
import { planMusicTransitions } from "./musicTransitions.js";
import { planSoundDesign } from "./soundDesign.js";
import { computeAudioQualityScore } from "./audioQC.js";

/**
 * @param {object} args
 * @param {AudioBuffer} args.audioBuffer      - decoded do vídeo
 * @param {Array} args.waveform
 * @param {{ segments: Array }} args.speechActivity
 * @param {Array} args.words
 * @param {Array} args.segments               - EDL segments
 * @param {object} args.narrative
 * @param {string} args.topic
 * @param {object} args.profile
 * @param {number} args.duration
 * @param {object} args.brollPlan
 * @param {object} args.transitionPlan
 * @param {object} args.graphicsPlan
 * @param {object} args.patternInterrupts
 * @param {string} [args.platformId="instagram"]
 * @returns {Promise<object>}
 */
export async function runAudioDirector({
  audioBuffer, waveform, speechActivity, words, segments,
  narrative, topic, profile, duration,
  brollPlan, transitionPlan, graphicsPlan, patternInterrupts,
  platformId = "instagram",
} = {}) {
  const decisions = [];

  // === 1. DIAGNÓSTICO ===
  const diagnostic = audioBuffer
    ? analyzeAudioDetailed(audioBuffer, { speechActivity })
    : null;

  // === 2. VOICE ENHANCEMENT PLAN ===
  if (diagnostic) {
    decisions.push(...planVoiceEnhancement(diagnostic, duration));
  }

  // === 3. CLICK/POP → crossfade nos cortes ===
  const clickReport = audioBuffer
    ? detectClicksNearCuts(audioBuffer, segments)
    : { events: [], nearCutCount: 0 };
  decisions.push(...planCrossfadesFromClicks(clickReport.events));
  // Crossfade genérico em toda junção (curto, 12ms)
  decisions.push(...planCutCrossfades(segments, { fadeMs: 12 }));

  // === 4. ROOM TONE ===
  let roomToneRef = null;
  if (audioBuffer) {
    const ch = audioBuffer.getChannelData(0);
    roomToneRef = extractRoomToneSample(ch, audioBuffer.sampleRate, { speechActivity });
    decisions.push(...planRoomTonePatches(segments, roomToneRef));
  }

  // === 5. LOUDNESS NORMALIZATION ===
  const loudness = estimateLoudness(waveform);
  const preset = pickPreset(platformId);
  decisions.push(...planLoudnessNormalization({ loudness, preset, duration }));

  // === 6. MÚSICA EXISTENTE ===
  const existingMusic = audioBuffer
    ? detectExistingMusic(audioBuffer.getChannelData(0), audioBuffer.sampleRate, speechActivity, duration)
    : { hasMusic: false };

  // === 7. MUSIC DECISION ENGINE ===
  const musicDecision = decideNeedsMusic({ existingMusic, profile, duration, narrative });
  let musicBrief = null;
  let musicMatch = null;
  let musicEnvelope = [];

  if (musicDecision.answer === "yes") {
    // === 8. STYLE + BPM + BRIEF + MATCHER ===
    const style = analyzeMusicStyle({ topic, narrative, profile, duration });
    const wpm = estimateSpeechWpm(words, duration);
    const bpmSel = pickBpm({ speechWpm: wpm, profile, energy: style.energy });
    musicBrief = buildMusicBrief({ style, bpmSel, duration, narrative });

    const providerCascade = ["catalog"]; // generative só com API key
    musicMatch = await searchMusicForBrief(musicBrief, { providers: providerCascade });

    // Decisão de música (mesmo se não achou match, marca intenção)
    decisions.push(makeDecision({
      type: "music",
      start: 0, end: duration,
      intensity: 0.28, // volume base
      reason: musicMatch?.track
        ? `${musicMatch.track.title} · ${musicBrief.style} @ ${musicBrief.bpm} BPM`
        : `sem match — brief: ${musicBrief.style} @ ${musicBrief.bpm} BPM`,
      confidence: musicMatch?.track ? musicMatch.track.score : 0.5,
      params: {
        brief: musicBrief,
        matchedTrackId: musicMatch?.track?.id || null,
        speechDucking: true,
      },
    }));

    // === 9. SMART DUCKING ===
    musicEnvelope = computeSmartDuckingEnvelope({
      speechActivity, narrative, brollPlan, duration,
    });
    decisions.push(makeDecision({
      type: "ducking",
      start: 0, end: duration,
      intensity: 1,
      reason: "smart ducking (fala/CTA/critical/broll)",
      confidence: 1,
      params: { envelopePoints: musicEnvelope.length },
    }));

    // === 10. MUSIC TRANSITIONS ===
    decisions.push(...planMusicTransitions({ duration, brief: musicBrief, narrative }));
  }

  // === 11. SOUND DESIGN ===
  const sfxDecisions = planSoundDesign({
    profile, transitionPlan, graphicsPlan, patternInterrupts, narrative, duration,
  });
  decisions.push(...sfxDecisions);

  // === 12. TIMELINE FINAL ===
  const audioTimeline = buildAudioTimeline(decisions);

  // === 13. QC SCORE (do áudio ANTES de processar) ===
  const audioQuality = diagnostic
    ? computeAudioQualityScore(diagnostic)
    : { score: 0, label: "Sem dados", dims: {} };

  return {
    diagnostic,
    existingMusic,
    musicDecision,
    musicBrief,
    musicMatch,
    musicEnvelope,
    roomToneRef: roomToneRef ? { start: roomToneRef.start, end: roomToneRef.end } : null,
    clickReport,
    preset,
    audioTimeline,
    audioQuality,
    sfxPlan: { decisions: sfxDecisions, total: sfxDecisions.length },
    summary: {
      totalDecisions: audioTimeline.decisions.length,
      byType: audioTimeline.summary.byType,
      diagnosticScore: diagnostic?.overallQuality ?? 0,
      audioQcScore: audioQuality.score,
      musicDecision: musicDecision.answer,
      musicMatched: !!musicMatch?.track,
    },
  };
}
