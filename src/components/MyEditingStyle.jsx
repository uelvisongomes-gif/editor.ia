// "Meu estilo de edição" — Item 6.18 da Fase 6.
// Card simples que mostra as preferências aprendidas + botão de reset.

import React, { useState } from "react";
import { summarizeStyleForUI, resetUserStyle } from "../services/userStyleLearning.js";

export function MyEditingStyle({ onReset }) {
  const [summary, setSummary] = useState(() => summarizeStyleForUI());

  if (!summary || summary.videosAnalyzed === 0) {
    return (
      <div style={{ background: "#12081C", border: "1px solid #2A1A3E" }} className="rounded-lg p-3">
        <p style={{ color: "#7060A0" }} className="text-xs">
          Meu estilo de edição — aprendemos suas preferências à medida que você edita.
        </p>
        <p style={{ color: "#A090B8" }} className="text-[10px] mt-1">
          Nenhum vídeo analisado ainda.
        </p>
      </div>
    );
  }

  const handleReset = () => {
    if (!window.confirm("Reset das preferências aprendidas? Voltará ao padrão CRIE.")) return;
    resetUserStyle();
    setSummary(null);
    onReset?.();
  };

  const conf = summary.confidenceByDim || {};
  const confDot = (level) => level === "HIGH" ? "#5DCAA5" : level === "MEDIUM" ? "#FFB020" : "#7060A0";

  const Row = ({ label, value, dimKey }) => (
    <div className="flex items-center justify-between py-1 text-[11px]">
      <span style={{ color: "#A090B8" }}>{label}</span>
      <span className="flex items-center gap-1.5">
        <span style={{ color: "#F5EFFF" }} className="font-semibold">{value}</span>
        <span style={{ background: confDot(conf[dimKey]), width: 6, height: 6, borderRadius: 3, display: "inline-block" }} />
      </span>
    </div>
  );

  return (
    <div style={{ background: "linear-gradient(140deg, #12081C 0%, #1A0F28 100%)", border: "1px solid #2A1A3E" }} className="rounded-lg p-3">
      <div className="flex items-center justify-between mb-2">
        <p style={{ color: "#F5EFFF" }} className="text-xs font-bold uppercase tracking-wide">Meu estilo de edição</p>
        <span style={{ color: "#7060A0" }} className="text-[10px]">{summary.videosAnalyzed} vídeo{summary.videosAnalyzed > 1 ? "s" : ""}</span>
      </div>
      <Row label="Cortes" value={summary.cortes} dimKey="cut_pace" />
      <Row label="Zoom" value={summary.zoom} dimKey="zoom_frequency" />
      <Row label="B-roll" value={summary.broll} dimKey="broll_frequency" />
      <Row label="Música" value={summary.musica} dimKey="music_frequency" />
      <Row label="Legenda" value={summary.legendaPosicao} dimKey="caption_position" />
      <Row label="Efeitos" value={summary.sfx} dimKey="sfx_density" />
      {summary.suggestedProfile && (
        <div style={{ color: "#FF6A2B" }} className="text-[10px] mt-2 italic">
          Perfil sugerido: <b>{summary.suggestedProfile}</b>
        </div>
      )}
      <button
        onClick={handleReset}
        style={{ background: "transparent", color: "#7060A0", border: "1px solid #2A1A3E" }}
        className="w-full mt-2 py-1 rounded text-[10px] hover:opacity-80"
      >
        Redefinir preferências
      </button>
      <p style={{ color: "#5060A0" }} className="text-[9px] mt-1 italic">
        🟢 alto · 🟡 médio · ⚪ baixo — só influencia com confiança ≥ média
      </p>
    </div>
  );
}
