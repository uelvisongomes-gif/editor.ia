// Clip Collection UI — Item 7.26. Interface pra ver e gerar clips descobertos.

import React, { useMemo, useState } from "react";
import { generateClipTitle } from "../services/clips/clipTitleGenerator.js";

function fmtT(t) {
  if (!Number.isFinite(t)) return "0:00";
  const mm = Math.floor(t / 60);
  const ss = Math.floor(t - mm * 60);
  return `${mm}:${String(ss).padStart(2, "0")}`;
}

const MOMENT_LABEL = {
  INSIGHT: "Insight", STORY: "História", TUTORIAL: "Tutorial", OPINION: "Opinião",
  CONTROVERSY: "Polêmica", SURPRISE: "Surpresa", RESULT: "Resultado",
  BEFORE_AFTER: "Antes/Depois", PRODUCT: "Produto", DEMONSTRATION: "Demonstração",
  FAQ: "FAQ", TIP: "Dica", WARNING: "Aviso", MISTAKE: "Erro", MYTH: "Mito", CTA: "CTA",
};

export function ClipCollection({ clips, jobs = [], onWatch, onEdit, onGenerate, onGenerateAll, onGenerateSelected, onClearJobs }) {
  const [selected, setSelected] = useState(new Set());
  const toggleSel = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  if (!clips || clips.length === 0) {
    return (
      <div style={{ background: "#12081C", border: "1px solid #2A1A3E" }} className="rounded-lg p-4 text-center">
        <p style={{ color: "#7060A0" }} className="text-xs">Nenhum clip com qualidade suficiente foi encontrado neste vídeo.</p>
      </div>
    );
  }

  return (
    <div style={{ background: "#12081C", border: "1px solid #2A1A3E" }} className="rounded-lg p-3">
      <div className="flex items-center justify-between mb-3">
        <p style={{ color: "#F5EFFF" }} className="text-xs font-bold uppercase tracking-wide">
          Melhores clips encontrados
        </p>
        <span style={{ color: "#7060A0" }} className="text-[10px]">{clips.length} candidatos</span>
      </div>

      <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
        {clips.map((clip, i) => {
          const meta = generateClipTitle(clip);
          const job = jobs.find((j) => j.clip?.id === clip.id);
          const isSelected = selected.has(clip.id);
          return (
            <div
              key={clip.id}
              style={{
                background: isSelected ? "linear-gradient(92deg, rgba(255,106,43,0.10), rgba(255,62,165,0.10))" : "#1A0F28",
                border: isSelected ? "1px solid #FF6A2B" : "1px solid #2A1A3E",
              }}
              className="rounded p-2"
            >
              <div className="flex items-start gap-2 mb-1">
                <input type="checkbox" checked={isSelected} onChange={() => toggleSel(clip.id)} className="mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2">
                    <span style={{
                      color: "#FF6A2B", fontFamily: "'Archivo Black',sans-serif",
                      fontSize: 14,
                    }}>#{String(i + 1).padStart(2, "0")}</span>
                    <span style={{ color: "#F5EFFF" }} className="text-xs font-semibold truncate">
                      "{meta.title}"
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-[10px] mt-0.5" style={{ color: "#A090B8" }}>
                    <span style={{ color: "#FF6A2B", fontWeight: 700 }}>{clip.score}/100</span>
                    <span>· {clip.duration}s</span>
                    <span>· {MOMENT_LABEL[clip.momentType] || clip.momentType}</span>
                    <span>· {fmtT(clip.start)}–{fmtT(clip.end)}</span>
                  </div>
                  {job && (
                    <div className="mt-1 text-[10px]" style={{ color: job.status === "failed" ? "#FF3E3E" : "#5DCAA5" }}>
                      {job.status === "completed" ? "✓ Renderizado"
                        : job.status === "failed" ? `✗ ${job.error?.slice(0, 40)}`
                        : `${job.status}... ${job.progress}%`}
                    </div>
                  )}
                </div>
              </div>
              <div className="flex gap-1 mt-1.5">
                <button onClick={() => onWatch?.(clip)} className="flex-1 py-1 rounded text-[10px] font-semibold"
                        style={{ background: "#2A1A3E", color: "#F5EFFF" }}>Assistir</button>
                <button onClick={() => onEdit?.(clip)} className="flex-1 py-1 rounded text-[10px] font-semibold"
                        style={{ background: "#2A1A3E", color: "#F5EFFF" }}>Editar</button>
                <button onClick={() => onGenerate?.(clip)} disabled={job?.status === "processing" || job?.status === "rendering"}
                        className="flex-1 py-1 rounded text-[10px] font-bold disabled:opacity-50"
                        style={{ background: "linear-gradient(92deg,#FF6A2B 0%,#FF3EA5 100%)", color: "#1A0A02" }}>Gerar</button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex gap-2 mt-3">
        <button
          onClick={() => onGenerateSelected?.(Array.from(selected))}
          disabled={selected.size === 0}
          className="flex-1 py-1.5 rounded text-[11px] font-semibold disabled:opacity-40"
          style={{ background: "#2A1A3E", color: "#F5EFFF" }}
        >
          Gerar selecionados ({selected.size})
        </button>
        <button
          onClick={onGenerateAll}
          className="flex-1 py-1.5 rounded text-[11px] font-bold"
          style={{ background: "linear-gradient(92deg,#FF6A2B 0%,#FF3EA5 100%)", color: "#1A0A02" }}
        >
          Gerar todos
        </button>
      </div>
      {jobs.length > 0 && (
        <div className="mt-2 text-[10px] flex items-center justify-between" style={{ color: "#7060A0" }}>
          <span>{jobs.filter((j) => j.status === "completed").length}/{jobs.length} concluídos</span>
          <button onClick={onClearJobs} className="underline">limpar fila</button>
        </div>
      )}
    </div>
  );
}
