// Converts an EDL into segments the existing App.jsx Timeline understands.
// The Timeline reads `{id, start, end, deleted}` and treats non-deleted
// segments as the compiled video. We keep the EDL metadata on the segment
// so the UI can still show the reason / narrative role per segment.

let _segId = 1;
const nextId = () => "seg-" + _segId++;

/**
 * @param {import('./editDecisionList.js').EdlItem[]} edl
 * @returns {Array<{id:string,start:number,end:number,deleted:boolean,action:string,reason:string,confidence:number,narrativeRole:string|null,text:string,source:string}>}
 */
export function compileTimeline(edl) {
  return edl.map((item) => ({
    id: nextId(),
    start: item.start,
    end: item.end,
    // "review" leaves the trecho in the video until the user confirms — the
    // panel is the one that surfaces the pending decision.
    deleted: item.action === "remove" || item.action === "trim",
    action: item.action,
    reason: item.reason,
    confidence: item.confidence,
    narrativeRole: item.narrativeRole,
    text: item.text,
    source: item.source,
    edlId: item.id,
  }));
}
