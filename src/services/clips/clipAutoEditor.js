// Clip Auto Editor — Item 7.13. Reutiliza pipeline existente (Fases 1-5)
// pra editar um clip específico.
//
// IMPORTANTE (Item 7.29): reaproveita words/waveform/audioBuffer/narrative
// da análise do vídeo original. Não roda Whisper de novo — apenas filtra
// os artefatos pro range do clip.

/**
 * @param {object} args
 * @param {import("./clipDiscoveryEngine.js").ClipCandidate} args.clip
 * @param {object} args.sourceAnalysis  - resultado completo do pipeline no vídeo original
 * @returns {object} clipState — pronto pra renderVideo com esta janela de tempo
 */
export function buildClipEditState({ clip, sourceAnalysis } = {}) {
  if (!clip || !sourceAnalysis) return null;
  const { words, waveform, narrative, brollPlan, graphicsPlan, transitionPlan, patternInterrupts, productMoments, zoomEvents, audioReport } = sourceAnalysis;

  const inRange = (t) => t >= clip.start && t <= clip.end;
  const withinT = (item, keyStart = "start", keyEnd = "end") => (item[keyStart] >= clip.start && item[keyEnd] <= clip.end + 0.5);

  const clipWords = (words || []).filter((w) => inRange(w.start));
  const clipWaveform = (waveform || []).filter((b) => b.start >= clip.start && b.end <= clip.end);

  const clipTimeline = (narrative?.timeline || []).filter((n) => withinT(n));
  const clipBrollSugg = (brollPlan?.suggestions || []).filter((b) => withinT(b));
  const clipOverlays  = (graphicsPlan?.overlays || []).filter((o) => withinT(o));
  const clipTransitions = (transitionPlan?.transitions || []).filter((t) => t.t >= clip.start && t.t <= clip.end);
  const clipPatterns  = (patternInterrupts?.interrupts || []).filter((p) => p.atSec >= clip.start && p.atSec <= clip.end);
  const clipProducts  = (productMoments?.moments || []).filter((m) => withinT(m));
  const clipZooms     = (zoomEvents || []).filter((z) => z.start >= clip.start && z.end <= clip.end);

  // Rebase: substrai clip.start pra timeline começar em 0
  const rebase = (arr, ks = ["start", "end"]) => arr.map((item) => {
    const out = { ...item };
    for (const k of ks) if (item[k] != null) out[k] = item[k] - clip.start;
    return out;
  });

  // Segments iniciais: 1 único segmento cobrindo todo o clip (a IA pode refinar depois)
  const segments = [{
    id: "clip-seg-0",
    start: 0,
    end: clip.end - clip.start,
    deleted: false,
    action: "keep",
  }];

  return {
    // Timeline rebased pra iniciar em 0
    words: rebase(clipWords, ["start", "end"]),
    waveform: rebase(clipWaveform, ["start", "end"]),
    narrative: {
      ...(narrative || {}),
      timeline: rebase(clipTimeline, ["start", "end"]),
    },
    brollPlan: { ...brollPlan, suggestions: rebase(clipBrollSugg, ["start", "end"]) },
    graphicsPlan: { ...graphicsPlan, overlays: rebase(clipOverlays, ["start", "end"]) },
    transitionPlan: { ...transitionPlan, transitions: clipTransitions.map((t) => ({ ...t, t: t.t - clip.start })) },
    patternInterrupts: { ...patternInterrupts, interrupts: clipPatterns.map((p) => ({ ...p, atSec: p.atSec - clip.start })) },
    productMoments: { ...productMoments, moments: rebase(clipProducts, ["start", "end"]) },
    zoomEvents: rebase(clipZooms, ["start", "end"]),
    segments,
    audioReport, // metadata áudio original ainda vale
    duration: clip.end - clip.start,
    sourceStart: clip.start,
    sourceEnd: clip.end,
    clipMeta: clip,
  };
}

/**
 * Standalone check (Item 7.31) — score de o quão bem o clip funciona sozinho.
 * Se muito baixo, não recomendar publicação automática.
 */
export function computeStandaloneQuality({ clip, clipState }) {
  const timeline = clipState?.narrative?.timeline || [];
  let score = 60;
  const first = timeline[0]?.role;
  const last = timeline[timeline.length - 1]?.role;
  if (["hook", "turn", "point", "problem"].includes(first)) score += 10;
  else if (["development", "context"].includes(first)) score -= 15;
  if (["proof", "solution", "cta", "conclusion", "point"].includes(last)) score += 15;
  else if (["off_topic", "aside"].includes(last)) score -= 20;
  // Penaliza clip < 15s ou > 75s
  const dur = clip.end - clip.start;
  if (dur < 15) score -= 20;
  else if (dur > 75) score -= 8;
  return Math.max(0, Math.min(100, score));
}
