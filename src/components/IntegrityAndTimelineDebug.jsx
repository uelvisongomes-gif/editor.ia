// Painel compacto: mostra summary da integrity (errors/warnings/infos)
// + botão pra copiar timeline técnica em texto pro clipboard.

import React, { useState } from "react";
import { reportToText } from "../services/editingDebugReport.js";

function fmtT(t) {
  if (!Number.isFinite(t)) return "??:??";
  const mm = Math.floor(t / 60);
  const ss = Math.floor(t - mm * 60);
  return `${mm}:${String(ss).padStart(2, "0")}`;
}

export function IntegrityAndTimelineDebug({ integrity, debugReport }) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  if (!integrity && !debugReport) return null;

  const s = integrity?.summary || { errors: 0, warnings: 0, infos: 0 };

  const copyText = async () => {
    if (!debugReport) return;
    try {
      await navigator.clipboard.writeText(reportToText(debugReport));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* ignore */ }
  };

  const copyJson = async () => {
    if (!debugReport) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(debugReport, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* ignore */ }
  };

  return (
    <div style={{ background: "#0F0F13", border: "1px solid #1F1F26" }} className="rounded-lg p-2.5 mt-2">
      <div className="flex items-center justify-between mb-1.5">
        <p style={{ color: "#9A9AA5" }} className="text-[10px] font-bold uppercase tracking-wide">
          Integridade da edição
        </p>
        <button
          onClick={() => setExpanded((v) => !v)}
          style={{ color: "#9A9AA5" }}
          className="text-[10px] hover:text-white"
        >
          {expanded ? "esconder" : "detalhes"}
        </button>
      </div>

      <div className="flex gap-2 text-[11px] tabular-nums">
        <span style={{ color: s.errors ? "#FF5C5C" : "#3F9E5B" }}>
          {s.errors} error{s.errors !== 1 ? "s" : ""}
        </span>
        <span style={{ color: s.warnings ? "#FFB020" : "#5C6068" }}>
          · {s.warnings} warning{s.warnings !== 1 ? "s" : ""}
        </span>
        <span style={{ color: "#5C6068" }}>
          · {s.infos} info{s.infos !== 1 ? "s" : ""}
        </span>
      </div>

      {expanded && integrity && (
        <div className="mt-2 space-y-1.5 max-h-64 overflow-y-auto text-[11px]">
          {integrity.errors.map((e, i) => (
            <div key={"e" + i} style={{ color: "#FF9C9C" }}>
              ✖ {fmtT(e.at)} · <span style={{ color: "#F5F5F7" }}>{e.message}</span>
              <span style={{ color: "#5C6068" }} className="ml-1">[{e.code}]</span>
            </div>
          ))}
          {integrity.warnings.map((w, i) => (
            <div key={"w" + i} style={{ color: "#FFB020" }}>
              ⚠ {fmtT(w.at)} · <span style={{ color: "#F5F5F7" }}>{w.message}</span>
              <span style={{ color: "#5C6068" }} className="ml-1">[{w.code}]</span>
            </div>
          ))}
          {integrity.infos.map((info, i) => (
            <div key={"i" + i} style={{ color: "#8AA0FF" }}>
              · {fmtT(info.at)} · <span style={{ color: "#9A9AA5" }}>{info.message}</span>
            </div>
          ))}
          {!integrity.errors.length && !integrity.warnings.length && !integrity.infos.length && (
            <div style={{ color: "#3F9E5B" }}>Nenhum problema detectado.</div>
          )}
        </div>
      )}

      {debugReport && (
        <div className="mt-2 flex gap-1.5">
          <button
            onClick={copyText}
            style={{ background: "#1B1B21", color: "#F5F5F7" }}
            className="flex-1 py-1 rounded text-[10px] font-semibold hover:brightness-125"
          >
            {copied ? "✓ copiado" : "Copiar timeline (texto)"}
          </button>
          <button
            onClick={copyJson}
            style={{ background: "#1B1B21", color: "#9A9AA5" }}
            className="flex-1 py-1 rounded text-[10px] hover:brightness-125"
          >
            JSON
          </button>
        </div>
      )}
    </div>
  );
}
