// Auto Fix Engine — Item 36, 37, 38.
// Aplica correções seguras a partir de QCIssues auto_fixable=true.
// Cada fix retorna { applied, patch } — o orquestrador usa o patch pra
// modificar o estado (segments/captions/brollPlan/audioTimeline/etc)
// e depois roda recheck.
//
// Max iterations (3) definido no orchestrator.
//
// SAFETY: se um fix piora o score, safetyGuard reverte.

const FIXERS = {
  // Speech
  cut_mid_phoneme: (issue, state) => {
    // Ajusta o cut point pelo suggestedShift
    const shift = issue.params.suggestedShift || 0.05;
    const cutT = issue.params.t;
    const dir = issue.params.direction;
    const segments = state.segments.map((s) => {
      if (dir === "exit" && Math.abs(s.end - cutT) < 0.02) {
        return { ...s, end: s.end + shift };
      }
      if (dir === "entry" && Math.abs(s.start - cutT) < 0.02) {
        return { ...s, start: Math.max(0, s.start + shift) };
      }
      return s;
    });
    return { patch: { segments } };
  },

  // Dead air — trim para 1s
  dead_air: (issue, state) => {
    // Insere um "corte" que remove parte do silêncio, mantendo 1s
    const targetKeep = 1.0;
    const total = issue.end - issue.start;
    const toRemove = Math.max(0, total - targetKeep);
    if (toRemove < 0.3) return { patch: null }; // não vale
    // Estende o segmento anterior menos que antes (remove do meio do silêncio)
    const newSegments = state.segments.map((s) => {
      if (Math.abs(s.end - issue.start) < 0.03) {
        return { ...s, end: s.end }; // mantém
      }
      if (Math.abs(s.start - issue.end) < 0.03) {
        return { ...s, start: s.start }; // mantém
      }
      return s;
    });
    // Adiciona segmento "deleted" no meio do silêncio
    const cutStart = issue.start + targetKeep / 2;
    const cutEnd = cutStart + toRemove;
    newSegments.push({ start: cutStart, end: cutEnd, deleted: true, action: "trim" });
    return { patch: { segments: newSegments.sort((a, b) => a.start - b.start) } };
  },

  // Caption too many words — divide chunk
  caption_too_many_words: (issue, state) => {
    if (!state.captions) return { patch: null };
    const captions = state.captions.map((c) => {
      if (Math.abs(c.start - issue.start) < 0.05 && Math.abs(c.end - issue.end) < 0.05) {
        const words = (c.words || (c.text || "").split(/\s+/).map((w, i) => ({ word: w, start: c.start + i * 0.1, end: c.start + (i + 1) * 0.1 }))).filter(Boolean);
        const half = Math.floor(words.length / 2);
        const left = words.slice(0, half);
        const right = words.slice(half);
        return [
          { ...c, words: left, text: left.map((w) => w.word || w).join(" "), end: left[left.length - 1].end || (c.start + (c.end - c.start) / 2) },
          { ...c, words: right, text: right.map((w) => w.word || w).join(" "), start: right[0].start || (c.start + (c.end - c.start) / 2) },
        ];
      }
      return [c];
    }).flat();
    return { patch: { captions } };
  },

  // Vertical caption layout — join
  caption_vertical_layout: (issue, state) => {
    if (!state.captions) return { patch: null };
    const captions = state.captions.map((c) => {
      if (Math.abs(c.start - issue.start) < 0.05) {
        return { ...c, text: (c.text || "").replace(/\n/g, " ") };
      }
      return c;
    });
    return { patch: { captions } };
  },

  // Caption too short — extend
  caption_too_short: (issue, state) => {
    if (!state.captions) return { patch: null };
    const captions = state.captions.map((c) => {
      if (Math.abs(c.start - issue.start) < 0.05) {
        return { ...c, end: c.start + 0.5 };
      }
      return c;
    });
    return { patch: { captions } };
  },

  // Broll hallucination — remove suggestion
  broll_hallucination_risk: (issue, state) => removeBrollAt(state, issue.start, issue.end),
  broll_hallucination_llm:  (issue, state) => removeBrollAt(state, issue.start, issue.end),
  broll_covers_product_demo: (issue, state) => removeBrollAt(state, issue.start, issue.end),
  broll_too_short: (issue, state) => extendBrollAt(state, issue.start, issue.end, issue.params.target || 2.0),
  broll_too_long: (issue, state) => capBrollAt(state, issue.start, issue.end, issue.params.target || 5.0),

  // Caption covers product — move to bottom
  caption_covers_product: (issue, state) => {
    if (!state.captions) return { patch: null };
    const captions = state.captions.map((c) => {
      if (c.start < issue.end && c.end > issue.start && c.position === "middle") {
        return { ...c, position: "bottom" };
      }
      return c;
    });
    return { patch: { captions } };
  },

  // Face cropped — flag reframe (não muda EDL, marca metadata)
  face_cropped: (issue, state) => ({ patch: { reframeHints: [...(state.reframeHints || []), { t: issue.start, action: "recenter" }] } }),
  face_zoom_extreme: (issue, state) => ({ patch: { zoomOverrides: [...(state.zoomOverrides || []), { t: issue.start, capScale: 1.3 }] } }),

  // Transition too long — cap duration
  transition_too_long: (issue, state) => {
    if (!state.transitionPlan?.transitions) return { patch: null };
    const transitions = state.transitionPlan.transitions.map((tr) => {
      if (Math.abs(tr.t - issue.start) < 0.1) return { ...tr, durationSec: issue.params.target || 0.4 };
      return tr;
    });
    return { patch: { transitionPlan: { ...state.transitionPlan, transitions } } };
  },

  // Audio-related — só marca; audio pipeline consome no export
  audio_clipping: (issue, state) => ({ patch: { audioFixesApplied: [...(state.audioFixesApplied || []), { type: "limiter", severity: issue.severity }] } }),
  electrical_hum: (issue, state) => ({ patch: { audioFixesApplied: [...(state.audioFixesApplied || []), { type: "notch", freq: issue.params.freq }] } }),
  hiss: (issue, state) => ({ patch: { audioFixesApplied: [...(state.audioFixesApplied || []), { type: "noise_reduction", intensity: issue.params.intensity }] } }),
  volume_inconsistent: (issue, state) => ({ patch: { audioFixesApplied: [...(state.audioFixesApplied || []), { type: "compressor" }] } }),
  audio_level_jump: (issue, state) => ({ patch: { audioFixesApplied: [...(state.audioFixesApplied || []), { type: "crossfade", t: issue.start }] } }),
  music_covering_speech: (issue, state) => ({ patch: { audioFixesApplied: [...(state.audioFixesApplied || []), { type: "deepen_duck" }] } }),
  sfx_over_speech: (issue, state) => ({ patch: { audioFixesApplied: [...(state.audioFixesApplied || []), { type: "lower_sfx", t: issue.start }] } }),

  // Visual jump — add transition
  visual_jump: (issue, state) => ({ patch: { visualJumpsHinted: [...(state.visualJumpsHinted || []), { t: issue.params.t, action: "add_dissolve" }] } }),

  // Zoom excessive/repetitive — mark
  zoom_excessive: (issue, state) => ({ patch: { zoomReduceRequested: true } }),
  zoom_repetitive: (issue, state) => ({ patch: { zoomVaryRequested: true } }),

  // Safe area
  caption_in_safe_area: (issue, state) => {
    if (!state.captions) return { patch: null };
    const captions = state.captions.map((c) => {
      if (c.start < issue.end && c.end > issue.start) {
        return { ...c, position: "middle" };
      }
      return c;
    });
    return { patch: { captions } };
  },
  overlay_in_safe_area: (issue, state) => ({ patch: { overlaySafeAreaAdjusted: true } }),

  // Hook slow start
  hook_slow_start: (issue, state) => {
    // Recorta início do primeiro segmento até 200ms antes da primeira palavra
    const firstWordStart = issue.params.firstWordStart;
    if (!Number.isFinite(firstWordStart)) return { patch: null };
    const segments = [...state.segments];
    if (segments[0]) {
      segments[0] = { ...segments[0], start: Math.max(0, firstWordStart - 0.2) };
    }
    return { patch: { segments } };
  },
};

function removeBrollAt(state, start, end) {
  if (!state.brollPlan?.suggestions) return { patch: null };
  const suggestions = state.brollPlan.suggestions.filter((s) => !(Math.abs(s.start - start) < 0.1 && Math.abs(s.end - end) < 0.5));
  return { patch: { brollPlan: { ...state.brollPlan, suggestions } } };
}
function extendBrollAt(state, start, end, targetDur) {
  if (!state.brollPlan?.suggestions) return { patch: null };
  const suggestions = state.brollPlan.suggestions.map((s) => {
    if (Math.abs(s.start - start) < 0.1) return { ...s, end: Math.max(s.end, s.start + targetDur) };
    return s;
  });
  return { patch: { brollPlan: { ...state.brollPlan, suggestions } } };
}
function capBrollAt(state, start, end, targetDur) {
  if (!state.brollPlan?.suggestions) return { patch: null };
  const suggestions = state.brollPlan.suggestions.map((s) => {
    if (Math.abs(s.start - start) < 0.1) return { ...s, end: s.start + targetDur };
    return s;
  });
  return { patch: { brollPlan: { ...state.brollPlan, suggestions } } };
}

/**
 * Aplica todos os fixes auto_fixable+seguros em ordem de severidade.
 * @returns {{ newState: object, appliedIssues: Array }}
 */
export function applyAutoFixes(issues = [], state = {}) {
  let newState = { ...state };
  const applied = [];
  const byRank = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };
  const eligible = issues
    .filter((i) => i.auto_fixable && !i.fixed)
    .sort((a, b) => (byRank[b.severity] || 0) - (byRank[a.severity] || 0));
  for (const iss of eligible) {
    const fn = FIXERS[iss.type];
    if (!fn) continue;
    try {
      const { patch } = fn(iss, newState);
      if (patch) {
        newState = { ...newState, ...patch };
        applied.push({ ...iss, fixed: true });
      }
    } catch (err) {
      console.warn(`[autoFix] "${iss.type}" falhou:`, err.message);
    }
  }
  return { newState, appliedIssues: applied };
}
