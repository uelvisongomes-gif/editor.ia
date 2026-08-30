// Painel "Análise da IA" — mostra o que a IA identificou no vídeo.
// Consome pipeline results: narrative, visualPlan, brollPlan, graphicsPlan,
// productMoments, protectedRanges, patternInterrupts, visualTimeline.

import React, { useState } from "react";

function fmtT(t) {
  if (!Number.isFinite(t)) return "??:??";
  const mm = Math.floor(t / 60);
  const ss = Math.floor(t - mm * 60);
  return `${mm}:${String(ss).padStart(2, "0")}`;
}

const ROLE_LABEL = {
  hook: "Gancho", context: "Contexto", problem: "Problema",
  development: "Desenvolvimento", proof: "Prova", turn: "Virada",
  solution: "Solução", point: "Ponto forte", conclusion: "Conclusão",
  cta: "CTA", aside: "Comentário", off_topic: "Fora do assunto",
};

const IMPORTANCE_COLOR = {
  critical: "#FF3EA5",
  high: "#FF6A2B",
  medium: "#FFB020",
  low: "#5C6068",
};

function Section({ title, count, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  if (count === 0) return null;
  return (
    <div style={{ borderTop: "1px solid #2A1A3E" }} className="py-2">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between text-left"
      >
        <span style={{ color: "#F5EFFF" }} className="text-xs font-bold uppercase tracking-wide">
          {title} <span style={{ color: "#7060A0" }}>({count})</span>
        </span>
        <span style={{ color: "#7060A0" }} className="text-xs">{open ? "▼" : "▶"}</span>
      </button>
      {open && <div className="mt-2">{children}</div>}
    </div>
  );
}

export function AIAnalysisPanel({ narrative, brollPlan, graphicsPlan, productMoments, protectedRanges, patternInterrupts, visualPlan }) {
  if (!narrative) return null;
  const hook = narrative.timeline?.find((s) => s.role === "hook");
  const cta = narrative.timeline?.filter((s) => s.role === "cta") || [];
  const critical = narrative.criticalSpans || [];
  const weakSpots = narrative.weakSpots || [];
  const brolls = brollPlan?.suggestions || [];
  const overlays = graphicsPlan?.overlays || [];
  const products = productMoments?.moments || [];
  const patterns = patternInterrupts?.interrupts || [];

  return (
    <div style={{ background: "#12081C", border: "1px solid #2A1A3E" }} className="rounded-lg p-3 mt-2">
      <p style={{ color: "#F5EFFF" }} className="text-xs font-bold uppercase tracking-wide mb-2">
        Análise da IA
      </p>

      {/* Hook */}
      {hook && (
        <div style={{ background: "linear-gradient(92deg, rgba(255,106,43,0.15), rgba(255,62,165,0.10))", border: "1px solid #FF6A2B" }} className="rounded p-2 mb-2">
          <p style={{ color: "#FF6A2B" }} className="text-[10px] font-bold uppercase mb-1">Gancho detectado · {fmtT(hook.start)}</p>
          <p style={{ color: "#F5EFFF" }} className="text-xs italic leading-snug">"{hook.text?.slice(0, 120)}{hook.text?.length > 120 ? "…" : ""}"</p>
        </div>
      )}

      {/* CTAs */}
      <Section title="CTAs detectados" count={cta.length}>
        {cta.map((c, i) => (
          <div key={i} className="text-[11px] mb-1" style={{ color: "#A090B8" }}>
            <span style={{ color: "#FF3EA5" }} className="font-bold">{fmtT(c.start)}</span> · {c.text?.slice(0, 80)}
          </div>
        ))}
      </Section>

      {/* Trechos essenciais */}
      <Section title="Trechos essenciais" count={critical.length} defaultOpen={critical.length <= 3}>
        {critical.map((c, i) => (
          <div key={i} className="text-[11px] mb-1" style={{ color: "#A090B8" }}>
            <span style={{ color: IMPORTANCE_COLOR.critical }} className="font-bold">{fmtT(c.start)}</span>
            <span className="ml-1" style={{ color: "#7060A0" }}>{ROLE_LABEL[c.role] || c.role}</span>
            <div className="italic mt-0.5" style={{ color: "#C9BFD9" }}>"{c.text?.slice(0, 100)}{c.text?.length > 100 ? "…" : ""}"</div>
          </div>
        ))}
      </Section>

      {/* Trechos fracos */}
      <Section title="Trechos fracos" count={weakSpots.length}>
        {weakSpots.map((w, i) => (
          <div key={i} className="text-[11px] mb-1" style={{ color: "#A090B8" }}>
            <span style={{ color: "#FFB020" }} className="font-bold">{fmtT(w.start)}</span>
            <span className="ml-1" style={{ color: "#7060A0" }}>{w.weakness}</span>
            <div className="italic mt-0.5" style={{ color: "#C9BFD9" }}>"{w.text?.slice(0, 90)}"</div>
          </div>
        ))}
      </Section>

      {/* Sugestões B-roll */}
      <Section title="Sugestões de B-roll" count={brolls.length}>
        {brolls.map((b, i) => (
          <div key={i} className="text-[11px] mb-1" style={{ color: "#A090B8" }}>
            <span style={{ color: "#78BAFF" }} className="font-bold">{fmtT(b.start)}</span> · {b.query}
            <span className="ml-1" style={{ color: "#5C6068" }}>({Math.round(b.confidence * 100)}%)</span>
          </div>
        ))}
      </Section>

      {/* Overlays gráficos */}
      <Section title="Números e destaques" count={overlays.length}>
        {overlays.map((o, i) => (
          <div key={i} className="text-[11px] mb-1" style={{ color: "#A090B8" }}>
            <span style={{ color: "#5DCAA5" }} className="font-bold">{fmtT(o.start)}</span> · {o.kind} · {o.text?.replace(/\n/g, " · ")}
          </div>
        ))}
      </Section>

      {/* Produto */}
      <Section title="Momentos de produto" count={products.length}>
        {products.map((p, i) => (
          <div key={i} className="text-[11px] mb-1" style={{ color: "#A090B8" }}>
            <span style={{ color: "#FFB020" }} className="font-bold">{fmtT(p.start)}-{fmtT(p.end)}</span> · {p.kind}
          </div>
        ))}
      </Section>

      {/* Pattern interrupts */}
      <Section title="Momentos parados" count={patterns.length}>
        {patterns.map((p, i) => (
          <div key={i} className="text-[11px] mb-1" style={{ color: "#A090B8" }}>
            <span style={{ color: "#8B5CF6" }} className="font-bold">{fmtT(p.atSec)}</span> · {p.reason}
          </div>
        ))}
      </Section>

      {/* Zonas protegidas */}
      <Section title="Zonas protegidas" count={protectedRanges?.ranges?.length || 0}>
        {(protectedRanges?.ranges || []).map((r, i) => (
          <div key={i} className="text-[11px] mb-1" style={{ color: "#A090B8" }}>
            <span style={{ color: "#5DCAA5" }} className="font-bold">{fmtT(r.start)}-{fmtT(r.end)}</span>
            <span className="ml-1" style={{ color: "#7060A0" }}>{r.kind}</span>
          </div>
        ))}
      </Section>
    </div>
  );
}
