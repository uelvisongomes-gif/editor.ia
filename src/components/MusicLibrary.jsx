// Music Library — busca + navegação por categoria (estilo TikTok).
// Toca preview quando o usuário clica no track; seleciona pra usar
// como trilha de fundo.

import React, { useMemo, useRef, useState } from "react";
import { MUSIC_CATEGORIES, MUSIC_CATALOG, searchMusic } from "../services/musicCatalog.js";

function fmtDur(s) {
  const mm = Math.floor(s / 60);
  const ss = Math.floor(s - mm * 60);
  return `${mm}:${String(ss).padStart(2, "0")}`;
}

export function MusicLibrary({ selectedMusicId, onSelect }) {
  const [query, setQuery] = useState("");
  const [categoryId, setCategoryId] = useState(null);
  const [previewId, setPreviewId] = useState(null);
  const audioRef = useRef(null);

  const results = useMemo(() => searchMusic(query, categoryId), [query, categoryId]);

  const togglePreview = (track) => {
    if (previewId === track.id) {
      audioRef.current?.pause();
      setPreviewId(null);
      return;
    }
    if (audioRef.current) {
      audioRef.current.src = track.url;
      audioRef.current.currentTime = 0;
      audioRef.current.volume = 0.7;
      audioRef.current.play().catch(() => {});
    }
    setPreviewId(track.id);
  };

  return (
    <div>
      {/* Busca */}
      <div className="flex items-center gap-1.5 mb-2" style={{ background: "#0F0F13", border: "1px solid #1F1F26", borderRadius: 8, padding: "6px 10px" }}>
        <span style={{ color: "#5C5C66" }}>🔍</span>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar música..."
          className="flex-1 text-xs outline-none"
          style={{ background: "transparent", color: "#F5F5F7" }}
        />
        {query && (
          <button onClick={() => setQuery("")} style={{ color: "#9A9AA5" }} className="text-xs">✕</button>
        )}
      </div>

      {/* Categorias */}
      <div className="flex flex-wrap gap-1 mb-2">
        <button
          onClick={() => setCategoryId(null)}
          style={{
            background: categoryId === null ? "#FF6A2B" : "#1B1B21",
            color: categoryId === null ? "#1A0A02" : "#C9C9D1",
          }}
          className="text-[10px] px-2 py-1 rounded font-semibold"
        >
          Tudo
        </button>
        {MUSIC_CATEGORIES.map((c) => (
          <button
            key={c.id}
            onClick={() => setCategoryId(c.id)}
            style={{
              background: categoryId === c.id ? "#FF6A2B" : "#1B1B21",
              color: categoryId === c.id ? "#1A0A02" : "#C9C9D1",
            }}
            className="text-[10px] px-2 py-1 rounded font-semibold"
          >
            {c.emoji} {c.label}
          </button>
        ))}
      </div>

      {/* Lista de tracks */}
      <div className="max-h-[420px] overflow-y-auto pr-1 space-y-1">
        {results.map((track) => {
          const isSelected = selectedMusicId === track.id;
          const isPreviewing = previewId === track.id;
          return (
            <div
              key={track.id}
              style={{
                background: isSelected ? "#2A1B10" : "#0F0F13",
                border: isSelected ? "1px solid #FF6A2B" : "1px solid #1F1F26",
              }}
              className="flex items-center gap-2 p-2 rounded-lg"
            >
              <button
                onClick={() => togglePreview(track)}
                style={{ background: isPreviewing ? "#2E7D4F" : "#1B1B21", color: "#FFFFFF" }}
                className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-xs"
                title={isPreviewing ? "Pausar preview" : "Ouvir preview"}
              >
                {isPreviewing ? "⏸" : "▶"}
              </button>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold truncate" style={{ color: "#F5F5F7" }}>{track.title}</p>
                <p className="text-[10px] truncate" style={{ color: "#9A9AA5" }}>
                  {track.artist} · {track.bpm} BPM · {fmtDur(track.durationSec)}
                </p>
              </div>
              <button
                onClick={() => onSelect(isSelected ? null : track.id)}
                style={{
                  background: isSelected ? "#FF6A2B" : "#1B1B21",
                  color: isSelected ? "#1A0A02" : "#C9C9D1",
                }}
                className="text-[10px] px-2 py-1 rounded font-semibold flex-shrink-0"
              >
                {isSelected ? "✓ Usando" : "Usar"}
              </button>
            </div>
          );
        })}
        {!results.length && (
          <p style={{ color: "#6B6B75" }} className="text-xs text-center py-3">
            Nenhuma música encontrada.
          </p>
        )}
      </div>

      <audio ref={audioRef} onEnded={() => setPreviewId(null)} className="hidden" />
    </div>
  );
}
