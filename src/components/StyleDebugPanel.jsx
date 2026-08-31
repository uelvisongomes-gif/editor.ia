// Style Debug Panel — Item 38 e 41.
// Mostra por evento: animation, momento, trigger, style, confidence, motivo.
// Ativado só em dev mode.

import React, { useState } from "react";

const CAT_COLOR = {
  zoom: "#FF6A2B", text: "#FF3EA5", caption: "#5DCAA5", transition: "#78BAFF",
  graphic: "#FFB020", media: "#8B5CF6", camera: "#00F2EA", special: "#7060A0", sfx: "#EF4444",
};

export function StyleDebugPanel({ styleResult, open, onToggle }) {
  const [filter, setFilter] = useState("all");
  if (!styleResult) return null;
  const { summary, events, triggers, dropped } = styleResult;
  const filtered = filter === "all" ? events : events.filter((e) => e.category === filter);
  const categories = ["all", ...Object.keys(summary?.byCategory || {})];

  return (
    <div style={{ background: "#0A0410", border: "1px solid #2A1A3E" }} className="rounded-lg p-2 mt-2 text-[10px]">
      <div className="flex items-center justify-between mb-1">
        <div style={{ color: "#F5EFFF" }} className="font-bold">
          Style Debug · <span style={{ color: "#FF6A2B" }}>{summary?.styleName}</span> v{summary?.version}
        </div>
        <button onClick={onToggle} style={{ color: "#7060A0" }}>{open ? "▼" : "▶"}</button>
      </div>
      <div style={{ color: "#7060A0" }} className="grid grid-cols-4 gap-1 mb-1">
        <span>Triggers: <b style={{ color: "#F5EFFF" }}>{summary?.triggerCount}</b></span>
        <span>Raw: <b style={{ color: "#F5EFFF" }}>{summary?.rawEventCount}</b></span>
        <span>Final: <b style={{ color: "#5DCAA5" }}>{summary?.finalEventCount}</b></span>
        <span>Dropped: <b style={{ color: "#FF6A2B" }}>{dropped?.totalDropped}</b></span>
      </div>
      {open && (
        <>
          <div className="flex flex-wrap gap-1 mb-1">
            {categories.map((c) => (
              <button key={c} onClick={() => setFilter(c)}
                style={{
                  background: filter === c ? (CAT_COLOR[c] || "#7060A0") : "transparent",
                  color: filter === c ? "#000" : (CAT_COLOR[c] || "#7060A0"),
                  border: `1px solid ${CAT_COLOR[c] || "#7060A0"}`,
                  padding: "1px 4px", borderRadius: 3, fontSize: 9,
                }}>
                {c}{c !== "all" && summary.byCategory?.[c] ? ` (${summary.byCategory[c]})` : ""}
              </button>
            ))}
          </div>
          <div className="max-h-48 overflow-y-auto space-y-0.5">
            {filtered.map((e) => (
              <div key={e.id} className="flex items-start gap-1" style={{ color: "#A090B8" }}>
                <span style={{ background: CAT_COLOR[e.category], color: "#000", padding: "0 3px", borderRadius: 2, fontWeight: 700, minWidth: 42, textAlign: "center" }}>
                  {e.animation}
                </span>
                <span style={{ color: "#F5EFFF", minWidth: 40 }}>{e.start.toFixed(2)}s</span>
                <span style={{ color: "#FF6A2B", minWidth: 60 }}>{e.trigger}</span>
                <span style={{ color: "#7060A0", minWidth: 30 }}>{Math.round(e.confidence * 100)}%</span>
                <span className="truncate">{e.reason}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
