// Final QC Modal — Item 40. Interface simples pré-export.
// PASS = exporta direto (não abre)
// REVIEW/FAIL = mostra modal com issues

import React from "react";
import { SEVERITY_COLOR, SEVERITY_LABEL_PTBR } from "../services/finalQC/qcSeverity.js";

const DIMENSION_LABEL = {
  speech_integrity: "Fala",
  cuts: "Cortes",
  narrative: "Narrativa",
  audio: "Áudio",
  visual: "Imagem",
  captions: "Legendas",
  broll: "B-roll",
  music: "Música",
  technical: "Formato",
};

const STATUS_STYLE = {
  PASS:   { color: "#5DCAA5", label: "Vídeo pronto para exportação" },
  REVIEW: { color: "#FFB020", label: "Encontramos pontos para revisar" },
  FAIL:   { color: "#FF3E3E", label: "Erro crítico — recomendado revisar" },
};

export function FinalQCModal({ report, iterations, onExport, onCancel, onReview, debugMode = false }) {
  if (!report) return null;
  const status = STATUS_STYLE[report.status] || STATUS_STYLE.REVIEW;
  const nonInfoIssues = report.issues.filter((i) => i.severity !== "info");
  const hasCritical = report.critical > 0;

  return (
    <div
      style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
      className="fixed inset-0 z-[10000] flex items-center justify-center p-4"
      onClick={onCancel}
    >
      <div
        style={{ background: "#12081C", border: "1px solid #2A1A3E", maxWidth: 480, width: "100%" }}
        className="rounded-2xl p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <div className="text-xs uppercase tracking-wide" style={{ color: "#7060A0" }}>
            Análise final
          </div>
          <div className="text-xs" style={{ color: "#7060A0" }}>
            {iterations > 0 ? `${iterations} correção${iterations > 1 ? "ões" : ""} aplicada${iterations > 1 ? "s" : ""}` : ""}
          </div>
        </div>

        <div className="flex items-baseline gap-3 mb-3">
          <div
            style={{
              background: "linear-gradient(92deg,#FF6A2B 0%,#FF3EA5 100%)",
              WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
              fontFamily: "'Archivo Black',sans-serif", fontSize: 44, lineHeight: 1,
            }}
          >
            {report.final_score}
          </div>
          <div style={{ color: "#F5EFFF" }} className="text-sm font-semibold">
            /100
          </div>
        </div>

        <div style={{ color: status.color }} className="text-sm font-bold mb-3">
          ● {status.label}
        </div>

        {/* Dimensional scores */}
        <div className="grid grid-cols-2 gap-1 mb-3 text-[11px]">
          {Object.entries(report.dimensions).map(([k, v]) => (
            <div key={k} className="flex items-center justify-between" style={{ color: "#A090B8" }}>
              <span>{DIMENSION_LABEL[k] || k}</span>
              <b style={{ color: v >= 90 ? "#5DCAA5" : v >= 70 ? "#FFB020" : "#FF6A2B" }}>{v}</b>
            </div>
          ))}
        </div>

        {/* Contagem por severidade */}
        {nonInfoIssues.length > 0 && (
          <div className="flex gap-2 mb-3 text-[10px]">
            {report.critical > 0 && <Chip color={SEVERITY_COLOR.critical} label={`${report.critical} crítico${report.critical > 1 ? "s" : ""}`} />}
            {report.high > 0 && <Chip color={SEVERITY_COLOR.high} label={`${report.high} alta`} />}
            {report.medium > 0 && <Chip color={SEVERITY_COLOR.medium} label={`${report.medium} média`} />}
            {report.low > 0 && <Chip color={SEVERITY_COLOR.low} label={`${report.low} baixa`} />}
          </div>
        )}

        {/* Top 3 issues */}
        {nonInfoIssues.length > 0 && (
          <div style={{ background: "#1A0F28", border: "1px solid #2A1A3E" }} className="rounded p-2 mb-3 max-h-40 overflow-y-auto">
            {nonInfoIssues.slice(0, debugMode ? 30 : 5).map((iss, i) => (
              <div key={i} className="flex items-start gap-2 mb-1.5">
                <span
                  className="text-[9px] uppercase font-bold px-1 py-0.5 rounded"
                  style={{ background: SEVERITY_COLOR[iss.severity], color: "#000", minWidth: 42, textAlign: "center" }}
                >
                  {SEVERITY_LABEL_PTBR[iss.severity]}
                </span>
                <div className="flex-1 min-w-0">
                  <div style={{ color: "#F5EFFF" }} className="text-[11px] leading-tight">
                    {iss.description}
                    {iss.fixed && <span style={{ color: "#5DCAA5" }} className="ml-1 text-[10px]">✓ corrigido</span>}
                  </div>
                  {debugMode && (
                    <div style={{ color: "#7060A0" }} className="text-[9px] mt-0.5">
                      [{iss.checker}] {iss.type} · {iss.start != null ? `${iss.start.toFixed(2)}s` : "—"}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {!debugMode && nonInfoIssues.length > 5 && (
              <div style={{ color: "#7060A0" }} className="text-[10px] italic">
                + {nonInfoIssues.length - 5} outros itens
              </div>
            )}
          </div>
        )}

        <div className="flex gap-2 mt-3">
          <button
            onClick={onCancel}
            className="flex-1 py-2 rounded-lg text-xs font-semibold"
            style={{ background: "#1A0F28", color: "#A090B8", border: "1px solid #2A1A3E" }}
          >
            Cancelar
          </button>
          {onReview && (
            <button
              onClick={onReview}
              className="flex-1 py-2 rounded-lg text-xs font-semibold"
              style={{ background: "#2A1A3E", color: "#F5EFFF" }}
            >
              Revisar
            </button>
          )}
          <button
            onClick={onExport}
            className="flex-1 py-2 rounded-lg text-xs font-bold disabled:opacity-60"
            style={{
              background: hasCritical
                ? "linear-gradient(92deg,#7A2020,#8A2A50)"
                : "linear-gradient(92deg,#FF6A2B 0%,#FF3EA5 100%)",
              color: "#1A0A02",
            }}
          >
            {hasCritical ? "Exportar mesmo assim" : "Exportar"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Chip({ color, label }) {
  return (
    <span style={{ background: color, color: "#000", padding: "2px 6px", borderRadius: 3, fontWeight: 700 }}>
      {label}
    </span>
  );
}
