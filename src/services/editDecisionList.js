import { evaluateContext } from "./contextGuard.js";
import { TECHNICAL_SOURCES } from "./editingProfiles.js";

// The EDL builder is where every analysis signal converges into concrete
// edit decisions. Downstream code only consumes the EDL, so we're deliberate
// about *why* each decision was made.
//
// Output: a strictly-ordered list of non-overlapping items covering
// [0, duration]. Every second of the original video is exactly one entry
// with action: keep | remove | trim | review.
//
// Three confidence bands drive the outcome (thresholds live on the profile):
//   >= executeThreshold  → remove/trim
//   >= reviewThreshold   → review (visible to user, NOT auto-cut)
//   <  reviewThreshold   → dropped (segment stays keep)
//
// Two rules override raw confidence:
//   - PROTECTED ROLES (hook / cta) keep everything BY DEFAULT, but a
//     high-confidence speech_error inside a protected sentence is still
//     removed surgically — we only cut the erroneous words, not the whole
//     sentence, so the CTA/hook keeps its shape.
//   - CONTEXT DEPENDENCY: if the next sentence dependsOnPrev, we refuse to
//     remove the previous one (would break the follow-up).
//
// After the walk, safety validators re-inspect the EDL and demote risky
// cuts (abrupt open/close, too many consecutive removes) back to review.

let _idCounter = 1;
const nextId = () => "edl-" + _idCounter++;

const EPSILON = 0.02;
const MIN_TRIM_DUR = 0.12;              // shorter than this = not worth a cut
const MAX_CONSECUTIVE_REMOVE_DUR = 12;  // block of cuts longer than this = risky
const MIN_OPENING_KEEP_DUR = 0.4;       // don't start the edited video mid-syllable
const MIN_CLOSING_KEEP_DUR = 0.4;

// Categories the LLM assigns to speech-level defects. These are the only
// intents allowed to cut *inside* a protected sentence — but only the
// erroneous slice, never the whole thing.
const SURGICAL_ERROR_REASONS = new Set([
  "stutter", "false_start", "abandoned_phrase", "self_correction", "filler",
]);

function mergeOverlapping(candidates) {
  if (!candidates.length) return [];
  const sorted = [...candidates].sort((a, b) => a.start - b.start);
  const merged = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const prev = merged[merged.length - 1];
    const cur = sorted[i];
    if (cur.start <= prev.end + EPSILON) {
      prev.end = Math.max(prev.end, cur.end);
      prev.confidence = Math.max(prev.confidence ?? 0.7, cur.confidence ?? 0.7);
      if (cur.reason && prev.reason !== cur.reason) prev.reason = prev.reason || cur.reason;
    } else {
      merged.push({ ...cur });
    }
  }
  return merged;
}

function bandForConfidence(confidence, source, profile) {
  const c = confidence ?? 0.7;
  const isTechnical = TECHNICAL_SOURCES.has(source);
  const executeAt = isTechnical
    ? profile.executeThreshold
    : (profile.executeThresholdSemantic ?? profile.executeThreshold);
  if (c >= executeAt) return "execute";
  if (c >= profile.reviewThreshold) return "review";
  return "drop";
}

/**
 * @param {object} args
 * @param {number} args.duration
 * @param {Array<{word:string,start:number,end:number}>} args.words
 * @param {{sentences:Array,repeatedGroups:Array,offTopicIndexes:number[],topic:string}} args.semantic
 * @param {Array<{start:number,end:number,confidence:number,reason:string}>} args.silences
 * @param {Array<{start:number,end:number,confidence:number,reason:string,text:string}>} args.speechErrors
 * @param {import('./editingProfiles.js').EDITING_PROFILES.equilibrada} args.profile
 * @returns {EdlItem[]}
 */
export function buildEDL({ duration, words, semantic, silences, speechErrors, profile }) {
  const intents = [];

  // 1) Silences (always considered — respects speech).
  if (silences?.length) {
    for (const s of silences) {
      intents.push({
        start: s.start, end: s.end,
        source: "silence",
        reason: s.reason || "long_pause",
        confidence: s.confidence ?? 0.75,
        text: "",
        canOverrideProtection: false, // never remove a "dramatic pause" inside a hook
      });
    }
  }

  // 2) Speech errors — surgical: allowed to cut INSIDE a protected sentence.
  if (profile.removeSpeechErrors && speechErrors?.length) {
    for (const e of speechErrors) {
      intents.push({
        start: e.start, end: e.end,
        source: "speechError",
        reason: e.reason || "filler",
        confidence: e.confidence ?? 0.75,
        text: e.text || "",
        replacementNote: e.replacementNote,
        canOverrideProtection: SURGICAL_ERROR_REASONS.has(e.reason || "filler"),
      });
    }
  }

  // 3) Repeated ideas — remove worse takes, keep bestIndex.
  if (profile.removeRepeats && semantic?.repeatedGroups?.length) {
    const byIndex = new Map(semantic.sentences.map((s) => [s.index, s]));
    for (const group of semantic.repeatedGroups) {
      const best = group.bestIndex;
      for (const idx of group.indexes) {
        if (idx === best) continue;
        const s = byIndex.get(idx);
        if (!s) continue;
        const next = byIndex.get(idx + 1);
        if (next && next.dependsOnPrev && next.index !== best) continue;
        intents.push({
          start: s.start, end: s.end,
          source: "semantic",
          reason: "repeated_idea",
          confidence: 0.75,
          text: s.text,
          canOverrideProtection: false,
          // Guard uses this to test whether the versions are complementary
          // (widely different lengths) vs truly substitutable.
          repeatedGroupBestIndex: best,
        });
      }
    }
  }

  // 4) Off-topic — conservative: never breaks a dependency.
  if (profile.removeOffTopic && semantic?.offTopicIndexes?.length) {
    const byIndex = new Map(semantic.sentences.map((s) => [s.index, s]));
    for (const idx of semantic.offTopicIndexes) {
      const s = byIndex.get(idx);
      if (!s) continue;
      const next = byIndex.get(idx + 1);
      if (next && next.dependsOnPrev) continue;
      intents.push({
        start: s.start, end: s.end,
        source: "narrative",
        reason: "off_topic",
        confidence: 0.7,
        text: s.text,
        canOverrideProtection: false,
      });
    }
  }

  // 5) Sentence-level LLM advice.
  if (semantic?.sentences?.length) {
    const byIndex = new Map(semantic.sentences.map((s) => [s.index, s]));
    for (const s of semantic.sentences) {
      if (s.keepAdvice === "consider_remove") {
        const next = byIndex.get(s.index + 1);
        if (next && next.dependsOnPrev) continue;
        intents.push({
          start: s.start, end: s.end,
          source: "semantic",
          reason: "low_value",
          confidence: 0.6,
          text: s.text,
          canOverrideProtection: false,
        });
      } else if (s.keepAdvice === "trim" && profile.trimLowImportance) {
        intents.push({
          start: s.start, end: s.end,
          source: "semantic",
          reason: "trim_low_importance",
          confidence: 0.55,
          text: s.text,
          trimOnly: true,
          canOverrideProtection: false,
        });
      }
    }
  }

  // Protected ranges (hook / cta / conclusion, per profile).
  const protectedRanges = [];
  if (semantic?.sentences?.length) {
    for (const s of semantic.sentences) {
      if (profile.preserveRoles.includes(s.role)) {
        protectedRanges.push([s.start, s.end]);
      }
    }
  }
  const isInsideProtected = (start, end) =>
    protectedRanges.some(([a, b]) => start >= a - EPSILON && end <= b + EPSILON);

  // 6) Apply protection + confidence bands + contextGuard for semantic cuts.
  const semanticSentences = semantic?.sentences || [];
  const decided = [];
  for (const r of intents) {
    const insideProtected = isInsideProtected(r.start, r.end);
    if (insideProtected && !r.canOverrideProtection) continue; // hard block

    const band = bandForConfidence(r.confidence, r.source, profile);
    if (band === "drop") continue;
    if (r.end - r.start < MIN_TRIM_DUR) continue;

    let action = band === "execute"
      ? (r.trimOnly ? "trim" : "remove")
      : "review";
    let contextSafe = true;
    let contextGuardReason = null;
    let safety = null;

    // Duration cap — cortes muito longos são desproporcionalmente arriscados
    // (mesmo com alta confiança) porque removem contexto real que a IA
    // pode não ter percebido. Acima do cap por tipo, força review.
    const isTechnical = TECHNICAL_SOURCES.has(r.source);
    const durCap = isTechnical
      ? (profile.maxTechnicalCutDur ?? Infinity)
      : (profile.maxSemanticCutDur ?? Infinity);
    if ((r.end - r.start) > durCap) {
      if (action === "remove" || action === "trim") action = "review";
      safety = "cut_too_long";
    }

    // Semantic cuts must pass the context guard. Technical cuts skip it.
    if (!isTechnical) {
      const guard = evaluateContext({ candidate: r, sentences: semanticSentences });
      contextSafe = guard.ok;
      contextGuardReason = guard.ok ? null : guard.reason;
      if (!guard.ok) {
        action = "review";
      }
    }

    decided.push({ ...r, action, contextSafe, contextGuardReason, ...(safety ? { safety } : {}) });
  }

  const mergedIntents = mergeOverlapping(decided);

  // 7) Walk the timeline emitting keep/remove/trim/review back-to-back.
  const sortedNarrative = semantic?.sentences ? [...semantic.sentences].sort((a, b) => a.start - b.start) : [];
  const roleAt = (t) => {
    const s = sortedNarrative.find((s) => t >= s.start - EPSILON && t < s.end + EPSILON);
    return s ? s.role : null;
  };
  const textInRange = (start, end) => {
    if (!words?.length) return "";
    return words.filter((w) => w.start >= start - EPSILON && w.end <= end + EPSILON)
      .map((w) => w.word).join(" ").trim();
  };

  const items = [];
  let cursor = 0;
  const removalSorted = [...mergedIntents].sort((a, b) => a.start - b.start);
  for (const r of removalSorted) {
    if (r.start > cursor + EPSILON) {
      items.push({
        id: nextId(),
        start: cursor,
        end: r.start,
        action: "keep",
        reason: "content",
        confidence: 1,
        narrativeRole: roleAt((cursor + r.start) / 2),
        text: textInRange(cursor, r.start),
        source: "keep",
      });
    }
    items.push({
      id: nextId(),
      start: Math.max(cursor, r.start),
      end: r.end,
      action: r.action,
      reason: r.reason,
      confidence: r.confidence ?? 0.7,
      narrativeRole: roleAt((r.start + r.end) / 2),
      text: r.text || textInRange(r.start, r.end),
      source: r.source,
      contextSafe: r.contextSafe !== false, // undefined for technical cuts = safe
      ...(r.contextGuardReason ? { contextGuardReason: r.contextGuardReason } : {}),
      ...(r.safety ? { safety: r.safety } : {}),
      ...(r.replacementNote ? { replacementNote: r.replacementNote } : {}),
    });
    cursor = r.end;
  }
  if (cursor < duration - EPSILON) {
    items.push({
      id: nextId(),
      start: cursor,
      end: duration,
      action: "keep",
      reason: "content",
      confidence: 1,
      narrativeRole: roleAt((cursor + duration) / 2),
      text: textInRange(cursor, duration),
      source: "keep",
    });
  }

  const compact = collapseTinyKeeps(items);

  // 8) Safety validators — downgrade risky cuts to review.
  return applySafetyValidators(compact, { duration });
}

function collapseTinyKeeps(items) {
  const result = [];
  for (const item of items) {
    const prev = result[result.length - 1];
    const isTiny = item.action === "keep" && item.end - item.start < 0.15 && !item.text;
    if (isTiny && prev && (prev.action === "remove" || prev.action === "trim")) {
      prev.end = item.end;
      continue;
    }
    result.push(item);
  }
  return result;
}

// Second pass — flags things that are individually confident but collectively
// risky. We NEVER change duration coverage here, only actions.
function applySafetyValidators(items, { duration }) {
  if (!items.length) return items;

  // Rule A: don't open the edited video with a removal (creates a jarring
  // cold start). If the very first item is remove/trim, promote to review.
  if (items[0].action !== "keep") {
    items[0] = { ...items[0], action: "review", safety: "abrupt_open" };
  } else if (items[0].end - items[0].start < MIN_OPENING_KEEP_DUR && items[1]?.action !== "keep") {
    items[1] = { ...items[1], action: "review", safety: "abrupt_open" };
  }

  // Rule B: same for the tail — protect a real ending.
  const last = items[items.length - 1];
  if (last.action !== "keep") {
    items[items.length - 1] = { ...last, action: "review", safety: "abrupt_close" };
  } else if (last.end - last.start < MIN_CLOSING_KEEP_DUR && items.length >= 2 && items[items.length - 2].action !== "keep") {
    const idx = items.length - 2;
    items[idx] = { ...items[idx], action: "review", safety: "abrupt_close" };
  }

  // Rule C: a long streak of consecutive removes = big jump. Split the pain
  // by demoting the last item in the streak to review so the user checks it.
  let streakDur = 0;
  let streakStart = -1;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (it.action === "remove" || it.action === "trim") {
      if (streakStart === -1) streakStart = i;
      streakDur += it.end - it.start;
      if (streakDur > MAX_CONSECUTIVE_REMOVE_DUR) {
        items[i] = { ...it, action: "review", safety: "long_removal_streak" };
        streakDur = 0;
        streakStart = -1;
      }
    } else {
      streakDur = 0;
      streakStart = -1;
    }
  }

  return items;
}

// Portuguese labels for the UI. Codes never appear directly to users.
export const REASON_LABELS = {
  long_pause: "Pausa longa",
  filler: "Muleta / hesitação",
  stutter: "Gagueira / repetição",
  false_start: "Frase reiniciada",
  abandoned_phrase: "Frase abandonada",
  self_correction: "Autocorreção",
  repeated_idea: "Ideia repetida",
  off_topic: "Fora do assunto",
  low_value: "Pouco relevante",
  trim_low_importance: "Encurtar",
  content: "Conteúdo mantido",
  manual: "Ajuste manual",
};

export const SAFETY_LABELS = {
  abrupt_open: "Poderia deixar o começo abrupto",
  abrupt_close: "Poderia deixar o final abrupto",
  long_removal_streak: "Muitos cortes seguidos",
  cut_too_long: "Corte longo demais — revise antes de aplicar",
};

// Context Guard reasons — mapeadas para explicar por que um corte semântico
// foi bloqueado ou demovido para review.
export const CONTEXT_GUARD_LABELS = {
  next_segment_depends_on_removed_context: "Próxima fala depende deste trecho",
  next_segment_has_unresolved_reference: "Próxima fala começa com referência (ex: \"isso\", \"então\")",
  previous_segment_expects_continuation: "Fala anterior fica incompleta sem este trecho",
  role_protected: "Trecho protegido (hook/CTA)",
  repetition_versions_look_complementary: "Repetição aparente pode ser complemento, não redundância",
};

export function labelContextGuard(code) {
  return CONTEXT_GUARD_LABELS[code] || code;
}

export function labelReason(code) {
  return REASON_LABELS[code] || code;
}

export function labelSafety(code) {
  return SAFETY_LABELS[code] || null;
}
