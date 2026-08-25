// Converts an EDL into segments the App.jsx Timeline understands.
// Timeline reads {id, start, end, deleted}; non-deleted = the compiled
// video. We carry every EDL metadata field forward so the review panel
// can still explain each decision.

let _segId = 1;
const nextId = () => "seg-" + _segId++;

/**
 * @param {import('./editDecisionList.js').EdlItem[]} edl
 */
export function compileTimeline(edl) {
  return edl.map((item) => ({
    id: nextId(),
    start: item.start,
    end: item.end,
    deleted: item.action === "remove" || item.action === "trim",
    action: item.action,
    reason: item.reason,
    confidence: item.confidence,
    narrativeRole: item.narrativeRole,
    text: item.text,
    source: item.source,
    edlId: item.id,
    contextSafe: item.contextSafe !== false,
    ...(item.contextGuardReason ? { contextGuardReason: item.contextGuardReason } : {}),
    ...(item.replacementNote ? { replacementNote: item.replacementNote } : {}),
    ...(item.safety ? { safety: item.safety } : {}),
  }));
}
