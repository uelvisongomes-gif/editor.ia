// Style Picker v2 — biblioteca visual de modelos de edição.
// Cards verticais 9:16, 2 colunas. Preview vídeo no hover (fallback pra
// placeholder gradient quando arquivo ainda não existe).
// Inspirado em apps como Captions.

import React, { useMemo, useRef, useState } from "react";
import { EDITING_PRESETS } from "../services/editingPresets.js";
import { StylePreviewMock } from "./StylePreviewMock.jsx";

const VISIBLE_INITIAL = 4;

export function StylePicker({ selectedId, onSelect }) {
  const [showAll, setShowAll] = useState(false);
  const presets = EDITING_PRESETS;
  const displayed = showAll ? presets : presets.slice(0, VISIBLE_INITIAL);

  return (
    <div style={{ background: "#12081C", border: "1px solid #2A1A3E" }} className="rounded-lg p-3">
      <div className="flex items-center justify-between mb-3">
        <p style={{ color: "#F5EFFF" }} className="text-xs font-bold uppercase tracking-wide">
          Estilo de edição
        </p>
        <span style={{ color: "#7060A0" }} className="text-[10px]">
          {presets.length} modelos
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {displayed.map((preset) => (
          <PresetCard key={preset.id} preset={preset}
                      selected={preset.id === selectedId}
                      onSelect={onSelect} />
        ))}
      </div>

      {!showAll && presets.length > VISIBLE_INITIAL && (
        <button onClick={() => setShowAll(true)}
                style={{ color: "#FF6A2B", background: "transparent" }}
                className="w-full mt-2 py-1.5 text-[11px] font-semibold hover:underline">
          Ver todos ({presets.length - VISIBLE_INITIAL} mais)
        </button>
      )}
      {showAll && (
        <button onClick={() => setShowAll(false)}
                style={{ color: "#7060A0", background: "transparent" }}
                className="w-full mt-2 py-1.5 text-[10px] hover:underline">
          Mostrar menos
        </button>
      )}
    </div>
  );
}

function PresetCard({ preset, selected, onSelect }) {
  const videoRef = useRef(null);
  const [videoLoaded, setVideoLoaded] = useState(false);
  const [hovering, setHovering] = useState(false);

  const handleHover = (val) => {
    setHovering(val);
    if (videoRef.current) {
      if (val) { videoRef.current.play?.().catch(() => {}); }
      else { try { videoRef.current.pause(); videoRef.current.currentTime = 0; } catch {} }
    }
  };

  const borderColor = selected ? "#FF6A2B" : "#2A1A3E";
  const glow = selected ? "0 0 24px rgba(255,106,43,0.35)" : "none";

  return (
    <div
      onClick={() => onSelect?.(preset.id)}
      onMouseEnter={() => handleHover(true)}
      onMouseLeave={() => handleHover(false)}
      style={{
        border: `2px solid ${borderColor}`,
        borderRadius: 10,
        overflow: "hidden",
        cursor: "pointer",
        background: "#1A0F28",
        transition: "transform 0.15s ease, box-shadow 0.2s ease",
        transform: selected ? "translateY(-2px)" : "translateY(0)",
        boxShadow: glow,
      }}
    >
      {/* Preview 9:16 */}
      <div style={{
        position: "relative",
        aspectRatio: "9 / 16",
        background: preset.preview?.placeholderBg || "#0A0410",
        overflow: "hidden",
      }}>
        {/* Video sempre monta; se load falhar, placeholder mostrado por cima */}
        <video
          ref={videoRef}
          src={preset.preview?.videoUrl}
          muted loop playsInline preload="metadata"
          onLoadedData={() => setVideoLoaded(true)}
          onError={() => setVideoLoaded(false)}
          style={{
            position: "absolute", inset: 0, width: "100%", height: "100%",
            objectFit: "cover", opacity: videoLoaded ? 1 : 0,
            transition: "opacity 0.2s",
          }}
        />
        {/* Preview procedural — mini-mock animado do layout real do estilo.
            Substituído pelo <video> quando arquivo .mp4 existir. */}
        {!videoLoaded && (
          <StylePreviewMock presetId={preset.id} animate={hovering || selected} />
        )}
        {/* Selected badge */}
        {selected && (
          <div style={{
            position: "absolute", top: 6, right: 6,
            background: "#FF6A2B", color: "#fff",
            width: 20, height: 20, borderRadius: 999,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 11, fontWeight: 900,
            boxShadow: "0 2px 8px rgba(0,0,0,0.4)",
          }}>✓</div>
        )}
        {/* Hover play indicator */}
        {hovering && videoLoaded && (
          <div style={{
            position: "absolute", bottom: 6, right: 6,
            background: "rgba(0,0,0,0.7)", color: "#fff",
            padding: "2px 6px", borderRadius: 3,
            fontSize: 8, fontWeight: 700,
          }}>▶ preview</div>
        )}
      </div>

      {/* Nome + descrição */}
      <div style={{ padding: "8px 8px 10px" }}>
        <div style={{
          color: selected ? "#FF6A2B" : "#F5EFFF",
          fontSize: 12, fontWeight: 800,
          fontFamily: "'Inter Tight',sans-serif",
          lineHeight: 1.1, marginBottom: 3,
        }}>{preset.name}</div>
        <div style={{
          color: "#7060A0", fontSize: 9,
          lineHeight: 1.3,
          display: "-webkit-box", WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical", overflow: "hidden",
        }}>{preset.description}</div>
      </div>
    </div>
  );
}
