// Style Picker v3 — galeria profissional de modelos de edição.
// Inspirado em apps como Captions.
//
// Comportamento:
//   - Carrossel horizontal com scroll suave + snap
//   - Cards 80/20 (video 80% / info 20%)
//   - Categorias em chips clicáveis (filtragem)
//   - Poster estático mostrado até primeiro hover
//   - <video> só monta quando entra viewport (IntersectionObserver)
//   - Hover → play (com preload metadata); leave → pause + reset
//   - Click → seleciona (sem modal)
//   - Preview player MAIOR embaixo mostra o selecionado
//   - Fallback pra mini-mock CSS quando .mp4 ainda não existe

import React, { useEffect, useMemo, useRef, useState } from "react";
import { PRESET_VARIANTS, listCategories, CATEGORY_LABEL, getVariant } from "../services/editingPresetVariants.js";
import { StylePreviewMock } from "./StylePreviewMock.jsx";

const ALL_CATEGORY = "all";

export function StylePicker({ selectedId, onSelect }) {
  const [activeCategory, setActiveCategory] = useState(ALL_CATEGORY);
  const [showBigPreview, setShowBigPreview] = useState(true);

  const categories = useMemo(() => [ALL_CATEGORY, ...listCategories()], []);
  const filtered = useMemo(() => {
    if (activeCategory === ALL_CATEGORY) return PRESET_VARIANTS;
    return PRESET_VARIANTS.filter((v) => v.category === activeCategory);
  }, [activeCategory]);

  const selected = useMemo(() => getVariant(selectedId) || PRESET_VARIANTS[0], [selectedId]);

  return (
    <div style={{ background: "#12081C", border: "1px solid #2A1A3E" }} className="rounded-lg p-3">
      <div className="flex items-center justify-between mb-2">
        <p style={{ color: "#F5EFFF" }} className="text-xs font-bold uppercase tracking-wide">
          Estilo de edição
        </p>
        <span style={{ color: "#7060A0" }} className="text-[10px]">
          {PRESET_VARIANTS.length} modelos
        </span>
      </div>

      {/* Chips de categoria — scroll horizontal */}
      <div className="flex gap-1 mb-2 overflow-x-auto pb-1"
           style={{ scrollbarWidth: "thin", scrollbarColor: "#2A1A3E transparent" }}>
        {categories.map((cat) => {
          const active = cat === activeCategory;
          return (
            <button key={cat} onClick={() => setActiveCategory(cat)}
              style={{
                background: active ? "linear-gradient(92deg,#FF6A2B,#FF3EA5)" : "#1A0F28",
                color: active ? "#150610" : "#A090B8",
                border: `1px solid ${active ? "transparent" : "#2A1A3E"}`,
                padding: "3px 10px", borderRadius: 999,
                fontSize: 10, fontWeight: 700,
                whiteSpace: "nowrap", flexShrink: 0,
                cursor: "pointer",
              }}>
              {cat === ALL_CATEGORY ? "Todos" : (CATEGORY_LABEL[cat] || cat)}
            </button>
          );
        })}
      </div>

      {/* Carrossel horizontal de cards 9:16 */}
      <div style={{
        display: "flex", gap: 8,
        overflowX: "auto", overflowY: "hidden",
        scrollSnapType: "x mandatory",
        paddingBottom: 8,
        scrollbarWidth: "thin", scrollbarColor: "#2A1A3E transparent",
      }}>
        {filtered.map((preset) => (
          <StyleCard key={preset.id} preset={preset}
                     selected={preset.id === selectedId}
                     onSelect={onSelect} />
        ))}
      </div>

      {/* Preview player MAIOR do selecionado */}
      {showBigPreview && selected && (
        <div className="mt-3">
          <div style={{ color: "#7060A0" }} className="text-[10px] uppercase mb-1 flex items-center justify-between">
            <span>Prévia · {selected.name}</span>
            <button onClick={() => setShowBigPreview(false)} style={{ color: "#7060A0", background: "transparent" }}>▲</button>
          </div>
          <BigPreview preset={selected} />
        </div>
      )}
      {!showBigPreview && (
        <button onClick={() => setShowBigPreview(true)}
                style={{ color: "#7060A0", background: "transparent" }}
                className="w-full mt-2 text-[10px] hover:underline">
          ▼ Mostrar prévia do estilo
        </button>
      )}
    </div>
  );
}

// ============================================================================
// Card individual
// ============================================================================

function StyleCard({ preset, selected, onSelect }) {
  const cardRef = useRef(null);
  const videoRef = useRef(null);
  const [inViewport, setInViewport] = useState(false);
  const [videoAvailable, setVideoAvailable] = useState(null); // null=unknown, true=ok, false=falha
  const [hovering, setHovering] = useState(false);

  // IntersectionObserver — só monta video quando entra viewport
  useEffect(() => {
    if (!cardRef.current) return;
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          setInViewport(true);
        } else {
          setInViewport(false);
          if (videoRef.current) {
            try { videoRef.current.pause(); videoRef.current.currentTime = 0; } catch {}
          }
        }
      }
    }, { threshold: 0.2 });
    io.observe(cardRef.current);
    return () => io.disconnect();
  }, []);

  // Hover play
  useEffect(() => {
    if (!videoRef.current || !videoAvailable) return;
    if (hovering) {
      videoRef.current.play?.().catch(() => {});
    } else {
      try {
        videoRef.current.pause();
        videoRef.current.currentTime = 0;
      } catch {}
    }
  }, [hovering, videoAvailable]);

  const borderColor = selected ? "#FF6A2B" : "#2A1A3E";
  const glow = selected ? "0 0 20px rgba(255,106,43,0.4)" : "none";

  return (
    <div
      ref={cardRef}
      onClick={() => onSelect?.(preset.id)}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      onTouchStart={() => setHovering(true)}
      style={{
        flex: "0 0 auto",
        width: 130,
        border: `2px solid ${borderColor}`,
        borderRadius: 10,
        overflow: "hidden",
        cursor: "pointer",
        background: "#1A0F28",
        transition: "transform 0.2s, box-shadow 0.2s",
        transform: selected || hovering ? "translateY(-2px)" : "translateY(0)",
        boxShadow: glow,
        scrollSnapAlign: "start",
      }}
    >
      {/* 80% — vídeo 9:16 */}
      <div style={{
        position: "relative",
        aspectRatio: "9 / 16",
        background: "#0A0410",
        overflow: "hidden",
      }}>
        {/* Video só monta quando entrou viewport pelo menos 1x */}
        {inViewport && preset.preview?.videoUrl && videoAvailable !== false && (
          <video
            ref={videoRef}
            src={preset.preview.videoUrl}
            poster={preset.preview.posterImage || undefined}
            muted loop playsInline preload="metadata"
            onLoadedData={() => setVideoAvailable(true)}
            onError={() => setVideoAvailable(false)}
            style={{
              position: "absolute", inset: 0, width: "100%", height: "100%",
              objectFit: "cover",
              opacity: videoAvailable ? 1 : 0,
              transition: "opacity 0.2s",
            }}
          />
        )}
        {/* Fallback: mini-mock CSS animado quando .mp4 não existe */}
        {videoAvailable === false && (
          <StylePreviewMock presetId={preset.baseId || preset.id} animate={hovering || selected} />
        )}
        {/* Loading state antes de saber se tem vídeo */}
        {videoAvailable === null && (
          <StylePreviewMock presetId={preset.baseId || preset.id} animate={false} />
        )}
        {/* Selected badge */}
        {selected && (
          <div style={{
            position: "absolute", top: 5, right: 5,
            background: "#FF6A2B", color: "#fff",
            width: 20, height: 20, borderRadius: 999,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 12, fontWeight: 900,
            boxShadow: "0 2px 8px rgba(0,0,0,0.5)",
          }}>✓</div>
        )}
        {/* Play indicator no hover se tem vídeo real */}
        {hovering && videoAvailable && (
          <div style={{
            position: "absolute", bottom: 4, right: 4,
            background: "rgba(0,0,0,0.6)", color: "#fff",
            padding: "1px 5px", borderRadius: 3,
            fontSize: 8, fontWeight: 700,
          }}>▶</div>
        )}
      </div>

      {/* 20% — nome + descrição embaixo */}
      <div style={{ padding: "6px 7px 8px" }}>
        <div style={{
          color: selected ? "#FF6A2B" : "#F5EFFF",
          fontSize: 10.5, fontWeight: 800,
          fontFamily: "'Inter Tight',sans-serif",
          lineHeight: 1.15, marginBottom: 2,
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        }}>{preset.name}</div>
        <div style={{
          color: "#7060A0", fontSize: 8.5,
          lineHeight: 1.25,
          display: "-webkit-box", WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical", overflow: "hidden",
        }}>{preset.description}</div>
      </div>
    </div>
  );
}

// ============================================================================
// Preview player MAIOR (aparece embaixo, mostra o selecionado grande)
// ============================================================================

function BigPreview({ preset }) {
  const videoRef = useRef(null);
  const [videoAvailable, setVideoAvailable] = useState(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    setVideoAvailable(null);
    setPlaying(false);
    if (videoRef.current) {
      try { videoRef.current.pause(); videoRef.current.currentTime = 0; } catch {}
    }
  }, [preset.id]);

  const handleClick = () => {
    if (!videoRef.current || !videoAvailable) return;
    if (playing) {
      videoRef.current.pause();
      setPlaying(false);
    } else {
      videoRef.current.play?.().catch(() => {});
      setPlaying(true);
    }
  };

  return (
    <div style={{ background: "#0A0410", border: "1px solid #2A1A3E", borderRadius: 8, overflow: "hidden" }}>
      <div style={{ position: "relative", aspectRatio: "9 / 16", maxWidth: 220, margin: "0 auto" }}
           onClick={handleClick}>
        {preset.preview?.videoUrl && videoAvailable !== false && (
          <video
            ref={videoRef}
            src={preset.preview.videoUrl}
            poster={preset.preview.posterImage || undefined}
            muted loop playsInline preload="metadata"
            onLoadedData={() => setVideoAvailable(true)}
            onError={() => setVideoAvailable(false)}
            style={{
              width: "100%", height: "100%", objectFit: "cover",
              opacity: videoAvailable ? 1 : 0,
              transition: "opacity 0.2s",
              cursor: "pointer",
            }}
          />
        )}
        {videoAvailable !== true && (
          <div style={{ position: "absolute", inset: 0 }}>
            <StylePreviewMock presetId={preset.baseId || preset.id} animate={true} />
          </div>
        )}
        {videoAvailable && !playing && (
          <div style={{
            position: "absolute", inset: 0,
            display: "flex", alignItems: "center", justifyContent: "center",
            pointerEvents: "none",
            background: "rgba(0,0,0,0.2)",
          }}>
            <div style={{
              width: 48, height: 48, borderRadius: 999,
              background: "rgba(255,106,43,0.9)", color: "#fff",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 22, fontWeight: 900,
              boxShadow: "0 4px 20px rgba(255,106,43,0.5)",
            }}>▶</div>
          </div>
        )}
      </div>
      <div style={{ padding: "8px 10px", borderTop: "1px solid #2A1A3E" }}>
        <div style={{ color: "#FF6A2B", fontSize: 11, fontWeight: 800 }}>{preset.name}</div>
        <div style={{ color: "#A090B8", fontSize: 9.5, marginTop: 2, lineHeight: 1.3 }}>{preset.description}</div>
      </div>
    </div>
  );
}
