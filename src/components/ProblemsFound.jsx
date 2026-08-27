// Painel "Problemas encontrados" — mostra TUDO que os detectores acharam,
// mesmo o que não virou corte automático. Cada card lista as evidências
// (heurístico + LLM + semântico) e, quando o item foi bloqueado, por quê.
//
// Diferente do EdlReview (que consome os segments), este componente
// consome problemCandidates crus. Ele existe pra responder:
//   "a IA achou este erro? se não achou, em qual etapa se perdeu?"

import React, { useMemo, useState } from "react";
import { Play, Scissors, Check, Volume2, MessageSquare, Repeat, Ban, AlertTriangle, Zap, ShieldAlert, Eye } from "lucide-react";
import { labelReason, labelContextGuard } from "../services/editDecisionList.js";
import { labelBlocked } from "../services/decisionEngine.js";

function formatTime(s) {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  const ms = Math.round((s - Math.floor(s)) * 10);
  return `${m}:${sec.toString().padStart(2, "0")}.${ms}`;
}

const TYPE_ICON = {
  long_pause: Volume2,
  filler: MessageSquare,
  stutter: Repeat,
  false_start: Zap,
  abandoned_phrase: Zap,
  self_correction: Zap,
  repeated_idea: Repeat,
  off_topic: Ban,
  low_value: AlertTriangle,
  trim_low_importance: AlertTriangle,
};

const FILTERS = [
  { id: "all", label: "Todos" },
  { id: "auto", label: "Auto-cortar" },
  { id: "review", label: "A revisar" },
  { id: "detected", label: "Só detectados" },
  { id: "blocked", label: "Bloqueados" },
];

export function ProblemsFound({ candidates, onPlay, onRemove, onKeep }) {
  const [filter, setFilter] = useState("all");

  const items = useMemo(() => {
    const list = [...(candidates || [])].sort((a, b) => a.start - b.start);
    if (filter === "all") return list;
    if (filter === "auto") return list.filter((c) => c.finalAction === "remove" || c.finalAction === "trim");
    if (filter === "review") return list.filter((c) => c.finalAction === "review");
    if (filter === "detected") return list.filter((c) => c.finalAction === "detected_only");
    if (filter === "blocked") return list.filter((c) => c.blockedReasons && c.blockedReasons.length > 0);
    return list;
  }, [candidates, filter]);

  const counts = useMemo(() => {
    const c = { auto: 0, review: 0, detected: 0, blocked: 0 };
    for (const cand of candidates || []) {
      if (cand.finalAction === "remove" || cand.finalAction === "trim") c.auto += 1;
      else if (cand.finalAction === "review") c.review += 1;
      else if (cand.finalAction === "detected_only") c.detected += 1;
      if (cand.blockedReasons?.length) c.blocked += 1;
    }
    return c;
  }, [candidates]);

  if (!candidates || !candidates.length) {
    return (
      <div style={{ color: "#9A9AA5" }} className="text-xs">
        Nenhum problema detectado ainda. Rode a análise inteligente.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5 flex-wrap">
        {FILTERS.map((f) => {
          const active = filter === f.id;
          const count = f.id === "all" ? candidates.length : counts[f.id];
          return (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              style={{ background: active ? "#FF6A2B" : "#1B1B21", color: active ? "#1A0A02" : "#C9C9D1" }}
              className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold"
            >
              {f.label}
              <span style={{ background: active ? "#1A0A02" : "#0A0A0D", color: active ? "#FF6A2B" : "#9A9AA5" }}
                className="px-1.5 rounded text-[10px] tabular-nums">
                {count}
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-col gap-1.5 max-h-[240px] overflow-y-auto pr-1">
        {items.length === 0 && (
          <p style={{ color: "#6B6B75" }} className="text-xs py-2 text-center">Nenhum item nesse filtro.</p>
        )}
        {items.map((cand) => {
          const Icon = TYPE_ICON[cand.primaryType] || AlertTriangle;
          const isAuto = cand.finalAction === "remove" || cand.finalAction === "trim";
          const isReview = cand.finalAction === "review";
          const isDetected = cand.finalAction === "detected_only";
          const isDropped = cand.finalAction === "dropped";
          const borderColor = isAuto ? "#5A2A1E" : isReview ? "#FFB020" : isDetected ? "#3A3A44" : "#1F1F26";
          const badgeBg = isAuto ? "#FF6A2B" : isReview ? "#FFB020" : "#7C5CFF";
          const statusLabel = isAuto ? "Auto-cortar" : isReview ? "A revisar" : isDetected ? "Detectado" : isDropped ? "Descartado" : "";
          return (
            <div key={cand.id} style={{ background: "#0F0F13", border: `1px solid ${borderColor}` }} className="rounded-lg p-2">
              <div className="flex items-start gap-2">
                <span style={{ background: badgeBg, color: "#1A0A02" }}
                  className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Icon size={12} />
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span style={{ color: "#F5F5F7" }} className="text-xs font-semibold">
                      {labelReason(cand.primaryType)}
                    </span>
                    <span style={{ color: badgeBg }} className="text-[10px] font-bold uppercase">{statusLabel}</span>
                  </div>
                  <div style={{ color: "#9A9AA5" }} className="text-[11px] tabular-nums mt-0.5">
                    {(cand.cutStart != null && cand.cutEnd != null &&
                      (Math.abs(cand.cutStart - cand.start) > 0.05 || Math.abs(cand.cutEnd - cand.end) > 0.05)) ? (
                      <div style={{ color: "#FFB0A0" }}>
                        {formatTime(cand.cutStart)} → {formatTime(cand.cutEnd)}
                        <span style={{ color: "#6B6B75" }}> · {(cand.cutEnd - cand.cutStart).toFixed(1)}s</span>
                      </div>
                    ) : (
                      <>
                        {formatTime(cand.start)} → {formatTime(cand.end)}
                        <span style={{ color: "#6B6B75" }}> · {(cand.end - cand.start).toFixed(1)}s</span>
                      </>
                    )}
                  </div>
                  {cand.text && (
                    <p style={{ color: "#C9C9D1", background: "#1B1B21", borderLeft: "2px solid #FF6A2B" }}
                      className="text-[11px] mt-2 p-2 rounded italic leading-snug">
                      "{cand.text.slice(0, 200)}{cand.text.length > 200 ? "..." : ""}"
                    </p>
                  )}
                  {cand.replacementNote && (
                    <p style={{ color: "#5DCAA5" }} className="text-[10px] mt-1">
                      Versão preservada: {cand.replacementNote}
                    </p>
                  )}
                  {cand.contextGuardReason && (
                    <div style={{ color: "#78BAFF" }} className="flex items-center gap-1 text-[10px] mt-1">
                      <ShieldAlert size={11} /> Context Guard: {labelContextGuard(cand.contextGuardReason)}
                    </div>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1.5 mt-2 justify-end flex-wrap">
                <button onClick={() => onPlay?.(cand.cutStart ?? cand.start, cand.cutEnd ?? cand.end)}
                  style={{ background: "#1B1B21", color: "#C9C9D1" }}
                  className="flex items-center gap-1 px-2 py-1 rounded text-[11px] font-semibold">
                  <Play size={11} /> Ouvir
                </button>
                <button onClick={() => onRemove?.(cand)}
                  style={{ background: "#5A2A1E", color: "#FFB0A0" }}
                  className="flex items-center gap-1 px-2 py-1 rounded text-[11px] font-semibold">
                  <Scissors size={11} /> Remover
                </button>
                <button onClick={() => onKeep?.(cand)}
                  style={{ background: "#1F3C2A", color: "#A0E8C0" }}
                  className="flex items-center gap-1 px-2 py-1 rounded text-[11px] font-semibold">
                  <Check size={11} /> Manter
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
