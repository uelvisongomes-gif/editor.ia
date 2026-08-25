import React, { useMemo, useState } from "react";
import { Scissors, Undo2, AlertTriangle, Check, Volume2, Repeat, Ban, Zap, MessageSquare, Sparkles, ChevronDown, ChevronRight } from "lucide-react";
import { labelReason } from "../services/editDecisionList.js";

function formatTime(s) {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

const REASON_ICON = {
  long_pause: Volume2,
  filler: MessageSquare,
  stutter: Repeat,
  false_start: Zap,
  abandoned_phrase: Zap,
  repeated_idea: Repeat,
  off_topic: Ban,
  low_value: AlertTriangle,
  trim_low_importance: AlertTriangle,
};

const ROLE_LABELS = {
  hook: "Hook",
  context: "Contexto",
  development: "Desenvolvimento",
  point: "Ponto-chave",
  conclusion: "Conclusão",
  cta: "CTA",
  aside: "Digressão",
  off_topic: "Fora do assunto",
};

const FILTERS = [
  { id: "all", label: "Todos" },
  { id: "remove", label: "Removidos" },
  { id: "review", label: "A revisar" },
  { id: "keep", label: "Mantidos" },
];

export function EdlReview({ segments, topic, onRestore, onDelete, onSeek, onConfirmReview }) {
  const [filter, setFilter] = useState("remove");
  const [expandedIds, setExpandedIds] = useState(() => new Set());

  const items = useMemo(() => {
    const sorted = [...(segments || [])].sort((a, b) => a.start - b.start);
    if (filter === "all") return sorted;
    if (filter === "keep") return sorted.filter((s) => !s.deleted && s.action !== "review");
    if (filter === "review") return sorted.filter((s) => s.action === "review");
    return sorted.filter((s) => s.deleted);
  }, [segments, filter]);

  const counts = useMemo(() => {
    const c = { remove: 0, review: 0, keep: 0 };
    for (const s of segments || []) {
      if (s.action === "review") c.review += 1;
      else if (s.deleted) c.remove += 1;
      else c.keep += 1;
    }
    return c;
  }, [segments]);

  const toggleExpanded = (id) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (!segments || !segments.length) {
    return (
      <div style={{ color: "#9A9AA5" }} className="text-xs">
        Nenhuma decisão de edição ainda. Rode a edição inteligente para gerar a EDL.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {topic && (
        <div style={{ background: "#0F0F13", border: "1px solid #1F1F26" }} className="rounded-lg p-2.5">
          <p style={{ color: "#9A9AA5" }} className="text-[10px] font-bold uppercase tracking-wide mb-1">Assunto detectado</p>
          <p style={{ color: "#F5F5F7" }} className="text-xs leading-snug">{topic}</p>
        </div>
      )}

      <div className="flex items-center gap-1.5">
        {FILTERS.map((f) => {
          const active = filter === f.id;
          const count = f.id === "all" ? segments.length : counts[f.id];
          return (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              style={{
                background: active ? "#FF6A2B" : "#1B1B21",
                color: active ? "#1A0A02" : "#C9C9D1",
              }}
              className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold"
            >
              {f.label}
              <span
                style={{
                  background: active ? "#1A0A02" : "#0A0A0D",
                  color: active ? "#FF6A2B" : "#9A9AA5",
                }}
                className="px-1.5 rounded text-[10px] tabular-nums"
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-col gap-1.5 max-h-[420px] overflow-y-auto pr-1">
        {items.length === 0 && (
          <p style={{ color: "#6B6B75" }} className="text-xs py-2 text-center">Nenhum item nesse filtro.</p>
        )}
        {items.map((seg) => {
          const Icon = REASON_ICON[seg.reason] || Sparkles;
          const isReview = seg.action === "review";
          const isRemoved = seg.deleted;
          const isExpanded = expandedIds.has(seg.id);
          const borderColor = isReview ? "#FFB020" : isRemoved ? "#5A2A1E" : "#1F3C2A";
          return (
            <div
              key={seg.id}
              style={{
                background: "#0F0F13",
                border: `1px solid ${borderColor}`,
              }}
              className="rounded-lg p-2"
            >
              <div className="flex items-start gap-2">
                <button
                  onClick={() => toggleExpanded(seg.id)}
                  style={{ color: "#6B6B75" }}
                  className="mt-0.5"
                >
                  {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                </button>
                <span
                  style={{
                    background: isReview ? "#FFB020" : isRemoved ? "#FF6A2B" : "#1D9E75",
                    color: "#1A0A02",
                  }}
                  className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
                >
                  <Icon size={12} />
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span style={{ color: "#F5F5F7" }} className="text-xs font-semibold">
                      {labelReason(seg.reason)}
                    </span>
                    {seg.narrativeRole && ROLE_LABELS[seg.narrativeRole] && (
                      <span
                        style={{ background: "#1B1B21", color: "#9A9AA5" }}
                        className="text-[10px] px-1.5 py-0.5 rounded"
                      >
                        {ROLE_LABELS[seg.narrativeRole]}
                      </span>
                    )}
                    {isReview && (
                      <span style={{ color: "#FFB020" }} className="text-[10px] font-bold uppercase">
                        A revisar
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => onSeek?.(seg.start)}
                    style={{ color: "#9A9AA5" }}
                    className="text-[11px] tabular-nums mt-0.5 hover:underline"
                  >
                    {formatTime(seg.start)} → {formatTime(seg.end)}
                    <span style={{ color: "#6B6B75" }}> · {Math.round((seg.end - seg.start) * 10) / 10}s</span>
                    <span style={{ color: "#6B6B75" }}> · confiança {Math.round((seg.confidence || 0) * 100)}%</span>
                  </button>
                  {isExpanded && seg.text && (
                    <p
                      style={{ color: "#C9C9D1", background: "#1B1B21", borderLeft: "2px solid #FF6A2B" }}
                      className="text-[11px] mt-2 p-2 rounded italic leading-snug"
                    >
                      "{seg.text}"
                    </p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1.5 mt-2 justify-end">
                {isReview && (
                  <>
                    <button
                      onClick={() => onConfirmReview?.(seg.id, true)}
                      style={{ background: "#5A2A1E", color: "#FFB0A0" }}
                      className="flex items-center gap-1 px-2 py-1 rounded text-[11px] font-semibold"
                    >
                      <Scissors size={11} /> Cortar
                    </button>
                    <button
                      onClick={() => onConfirmReview?.(seg.id, false)}
                      style={{ background: "#1F3C2A", color: "#A0E8C0" }}
                      className="flex items-center gap-1 px-2 py-1 rounded text-[11px] font-semibold"
                    >
                      <Check size={11} /> Manter
                    </button>
                  </>
                )}
                {!isReview && isRemoved && (
                  <button
                    onClick={() => onRestore?.(seg.id)}
                    style={{ background: "#1B1B21", color: "#5DCAA5" }}
                    className="flex items-center gap-1 px-2 py-1 rounded text-[11px] font-semibold"
                  >
                    <Undo2 size={11} /> Restaurar
                  </button>
                )}
                {!isReview && !isRemoved && (
                  <button
                    onClick={() => onDelete?.(seg.id)}
                    style={{ background: "#1B1B21", color: "#F09595" }}
                    className="flex items-center gap-1 px-2 py-1 rounded text-[11px] font-semibold"
                  >
                    <Scissors size={11} /> Cortar
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
