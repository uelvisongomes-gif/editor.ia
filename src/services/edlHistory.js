// A tiny, framework-agnostic history stack for the segments/EDL state.
// Every mutation that touches decisions goes through push(newState, label);
// undo() / redo() return the state to apply.
//
// We also emit a "feedback entry" every time the user overrides an AI
// decision. Those entries are the seed for future prompt/threshold tuning
// (we don't ship a learner today, but we're already collecting the data).

const MAX_HISTORY = 100;

export function createHistory(initialState) {
  return {
    past: [],
    present: cloneState(initialState),
    future: [],
    feedback: [],
    version: 0,
  };
}

function cloneState(state) {
  return state ? state.map((s) => ({ ...s })) : [];
}

/**
 * Push a new state onto the history and record what changed for feedback.
 *
 * @param {*} history
 * @param {*} newState
 * @param {{label:string, changedSegmentId?:string, aiDecision?:string, userDecision?:string, reason?:string, confidence?:number, text?:string}} [meta]
 */
export function pushState(history, newState, meta = {}) {
  const past = [...history.past, history.present];
  const trimmedPast = past.length > MAX_HISTORY ? past.slice(-MAX_HISTORY) : past;
  const feedback = [...history.feedback];
  if (meta.aiDecision && meta.userDecision && meta.aiDecision !== meta.userDecision) {
    feedback.push({
      timestamp: new Date().toISOString(),
      label: meta.label || "unknown",
      changedSegmentId: meta.changedSegmentId || null,
      aiDecision: meta.aiDecision,
      userDecision: meta.userDecision,
      reason: meta.reason || null,
      confidence: meta.confidence ?? null,
      text: meta.text || null,
    });
  }
  return {
    past: trimmedPast,
    present: cloneState(newState),
    future: [],
    feedback,
    version: history.version + 1,
  };
}

export function undo(history) {
  if (!history.past.length) return history;
  const previous = history.past[history.past.length - 1];
  const past = history.past.slice(0, -1);
  return {
    past,
    present: cloneState(previous),
    future: [history.present, ...history.future],
    feedback: history.feedback,
    version: history.version + 1,
  };
}

export function redo(history) {
  if (!history.future.length) return history;
  const next = history.future[0];
  const future = history.future.slice(1);
  return {
    past: [...history.past, history.present],
    present: cloneState(next),
    future,
    feedback: history.feedback,
    version: history.version + 1,
  };
}

export function canUndo(history) {
  return history.past.length > 0;
}

export function canRedo(history) {
  return history.future.length > 0;
}
