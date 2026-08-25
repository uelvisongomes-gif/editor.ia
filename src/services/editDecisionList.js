// The EDL builder is where all the analysis signals converge and turn into
// concrete decisions. This is the module with the most rules — everything
// downstream just consumes the EDL, which is why the module is deliberately
// verbose about *why* each decision was made.
//
// The output is a strictly-ordered list of non-overlapping items covering
// [0, duration]. Every second of the original video is accounted for as
// exactly one entry with an action: keep | remove | trim | review.

/**
 * @typedef {{start:number,end:number,confidence?:number,reason?:string}} Candidate
 * @typedef {{
 *   id:string,
 *   start:number,
 *   end:number,
 *   action:'keep'|'remove'|'trim'|'review',
 *   reason:string,
 *   confidence:number,
 *   narrativeRole:string|null,
 *   text:string,
 *   source:string
 * }} EdlItem
 */

let _idCounter = 1;
const nextId = () => "edl-" + _idCounter++;

const EPSILON = 0.02;

// Merge overlapping candidates from the same source, keeping the highest confidence.
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

// Turns a set of remove-intents into a sorted set of atomic cut points on the
// timeline. The output lets us walk through [0, duration] and know exactly
// which side each cut falls on.
function collectCutPoints(duration, removalIntents) {
  const points = new Set([0, duration]);
  for (const r of removalIntents) {
    points.add(Math.max(0, Math.min(duration, r.start)));
    points.add(Math.max(0, Math.min(duration, r.end)));
  }
  return [...points].sort((a, b) => a - b);
}

/**
 * Build the EDL from all analysis signals.
 *
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
  const removalIntents = [];

  // 1) Silences — always considered when the profile allows.
  if (silences?.length) {
    for (const s of silences) {
      removalIntents.push({
        start: s.start, end: s.end,
        source: "silence",
        reason: s.reason || "long_pause",
        confidence: s.confidence ?? 0.75,
        text: "",
      });
    }
  }

  // 2) Speech errors — stutters, false starts, filler chains.
  if (profile.removeSpeechErrors && speechErrors?.length) {
    for (const e of speechErrors) {
      removalIntents.push({
        start: e.start, end: e.end,
        source: "speechError",
        reason: e.reason || "filler",
        confidence: e.confidence ?? 0.75,
        text: e.text || "",
      });
    }
  }

  // 3) Repeated ideas — remove all sentences in the group EXCEPT the "best" one.
  if (profile.removeRepeats && semantic?.repeatedGroups?.length) {
    const byIndex = new Map(semantic.sentences.map((s) => [s.index, s]));
    for (const group of semantic.repeatedGroups) {
      const best = group.bestIndex;
      for (const idx of group.indexes) {
        if (idx === best) continue;
        const s = byIndex.get(idx);
        if (!s) continue;
        // Never remove an anchor that a following kept sentence depends on.
        const next = byIndex.get(idx + 1);
        if (next && next.dependsOnPrev && next.index !== best) continue;
        removalIntents.push({
          start: s.start, end: s.end,
          source: "semantic",
          reason: "repeated_idea",
          confidence: 0.75,
          text: s.text,
        });
      }
    }
  }

  // 4) Off-topic sentences.
  if (profile.removeOffTopic && semantic?.offTopicIndexes?.length) {
    const byIndex = new Map(semantic.sentences.map((s) => [s.index, s]));
    for (const idx of semantic.offTopicIndexes) {
      const s = byIndex.get(idx);
      if (!s) continue;
      const next = byIndex.get(idx + 1);
      if (next && next.dependsOnPrev) continue; // would break the following sentence
      removalIntents.push({
        start: s.start, end: s.end,
        source: "narrative",
        reason: "off_topic",
        confidence: 0.7,
        text: s.text,
      });
    }
  }

  // 5) Sentences the LLM itself flagged as consider_remove.
  if (semantic?.sentences?.length) {
    const byIndex = new Map(semantic.sentences.map((s) => [s.index, s]));
    for (const s of semantic.sentences) {
      if (s.keepAdvice === "consider_remove") {
        const next = byIndex.get(s.index + 1);
        if (next && next.dependsOnPrev) continue;
        removalIntents.push({
          start: s.start, end: s.end,
          source: "semantic",
          reason: "low_value",
          confidence: 0.6,
          text: s.text,
        });
      } else if (s.keepAdvice === "trim" && profile.trimLowImportance) {
        removalIntents.push({
          start: s.start, end: s.end,
          source: "semantic",
          reason: "trim_low_importance",
          confidence: 0.55,
          text: s.text,
          trimOnly: true,
        });
      }
    }
  }

  // 6) HARD PROTECTION: never remove sentences whose role is in preserveRoles.
  const protectedRanges = [];
  if (semantic?.sentences?.length) {
    for (const s of semantic.sentences) {
      if (profile.preserveRoles.includes(s.role)) {
        protectedRanges.push([s.start, s.end]);
      }
    }
  }
  const isProtected = (t) => protectedRanges.some(([a, b]) => t >= a - EPSILON && t <= b + EPSILON);

  // 7) Downgrade low-confidence removals into "review" so nothing risky gets
  //    silently cut. The user sees it in the EDL panel and decides.
  //    Also drop any intent that falls entirely inside a protected range.
  const filteredIntents = removalIntents.filter((r) => {
    const midpoint = (r.start + r.end) / 2;
    if (isProtected(midpoint)) return false;
    return true;
  }).map((r) => {
    if ((r.confidence ?? 0.7) < profile.reviewThreshold) {
      return { ...r, action: "review" };
    }
    return { ...r, action: r.trimOnly ? "trim" : "remove" };
  });

  const merged = mergeOverlapping(filteredIntents);

  // 8) Walk the timeline, emitting keep/remove/trim/review items back-to-back.
  const items = [];
  const sortedNarrative = semantic?.sentences ? [...semantic.sentences].sort((a, b) => a.start - b.start) : [];
  const roleAt = (t) => {
    const s = sortedNarrative.find((s) => t >= s.start - EPSILON && t < s.end + EPSILON);
    return s ? s.role : null;
  };
  const textInRange = (start, end) => {
    if (!words?.length) return "";
    const segWords = words.filter((w) => w.start >= start - EPSILON && w.end <= end + EPSILON);
    return segWords.map((w) => w.word).join(" ").trim();
  };

  let cursor = 0;
  const removalSorted = [...merged].sort((a, b) => a.start - b.start);
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

  // 9) Collapse tiny keep slivers created by adjacent removals (< 0.15s of
  //    speech is just a syllable — leaving it in causes a click, not content).
  return collapseTinyKeeps(items);
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

// Human-readable Portuguese for each reason code — used by the EdlReview UI.
export const REASON_LABELS = {
  long_pause: "Pausa longa",
  filler: "Muleta / hesitação",
  stutter: "Gagueira / repetição",
  false_start: "Começo falso",
  abandoned_phrase: "Frase abandonada",
  repeated_idea: "Ideia repetida",
  off_topic: "Fora do assunto",
  low_value: "Trecho pouco relevante",
  trim_low_importance: "Encurtar (baixa importância)",
  content: "Conteúdo mantido",
  manual: "Ajuste manual",
};

export function labelReason(code) {
  return REASON_LABELS[code] || code;
}
