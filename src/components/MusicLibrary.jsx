// Music Library — busca híbrida:
//   - Sem query: mostra catálogo curado local (24 tracks CC0 por categoria)
//   - Com query 2+ chars: busca na iTunes Search API via /api/music-search
//     (previews de 30s de qualquer música/artista existente)

import React, { useEffect, useMemo, useRef, useState } from "react";
import { MUSIC_CATEGORIES, MUSIC_CATALOG, searchMusic } from "../services/musicCatalog.js";

function fmtDur(s) {
  const mm = Math.floor(s / 60);
  const ss = Math.floor(s - mm * 60);
  return `${mm}:${String(ss).padStart(2, "0")}`;
}

export function MusicLibrary({ selectedMusicId, onSelect, resolveTrack }) {
  const [query, setQuery] = useState("");
  const [categoryId, setCategoryId] = useState(null);
  const [previewId, setPreviewId] = useState(null);
  const [remoteTracks, setRemoteTracks] = useState([]);
  const [remoteLoading, setRemoteLoading] = useState(false);
  const [remoteError, setRemoteError] = useState(null);
  const audioRef = useRef(null);
  const searchTimerRef = useRef(null);

  // Busca remota com debounce quando query >= 2 chars.
  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    if (!query || query.length < 2) {
      setRemoteTracks([]);
      setRemoteLoading(false);
      setRemoteError(null);
      return;
    }
    setRemoteLoading(true);
    setRemoteError(null);
    searchTimerRef.current = setTimeout(async () => {
      try {
        const r = await fetch(`/api/music-search?q=${encodeURIComponent(query)}&limit=40`);
        const data = await r.json();
        if (data.tracks) setRemoteTracks(data.tracks);
        else setRemoteTracks([]);
      } catch (e) {
        setRemoteError("Sem conexão com a biblioteca online");
        setRemoteTracks([]);
      } finally {
        setRemoteLoading(false);
      }
    }, 350);
    return () => searchTimerRef.current && clearTimeout(searchTimerRef.current);
  }, [query]);

  const localResults = useMemo(() => searchMusic(query, categoryId), [query, categoryId]);

  const showRemote = query.length >= 2;

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

  const handleSelect = (track) => {
    const isSelected = selectedMusicId === track.id;
    if (isSelected) {
      onSelect(null);
    } else {
      // Passa o objeto completo pro pai — pra tracks remotos que não estão
      // no catálogo local, ele precisa saber título/URL.
      onSelect(track.id, track);
    }
  };

  const renderTrack = (track) => {
    const isSelected = selectedMusicId === track.id;
    const isPreviewing = previewId === track.id;
    const isRemote = track.source === "itunes" || track.source === "jamendo";
    const isPreviewOnly = track.source === "itunes";
    const isFull = track.source === "jamendo";
    return (
      <div
        key={track.id}
        style={{
          background: isSelected ? "#2A1B10" : "#0F0F13",
          border: isSelected ? "1px solid #FF6A2B" : "1px solid #1F1F26",
        }}
        className="flex items-center gap-2 p-2 rounded-lg"
      >
        {track.artwork ? (
          <img src={track.artwork} alt="" style={{ width: 32, height: 32, borderRadius: 4 }} className="flex-shrink-0" />
        ) : (
          <div style={{ width: 32, height: 32, borderRadius: 4, background: "#1B1B21" }} className="flex-shrink-0 flex items-center justify-center text-sm">
            🎵
          </div>
        )}
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
            {track.artist}{track.bpm ? ` · ${track.bpm} BPM` : ""} · {fmtDur(track.durationSec)}
            {isPreviewOnly && <span style={{ color: "#FFB020" }} className="ml-1">· preview 30s (loop)</span>}
            {isFull && <span style={{ color: "#5DCAA5" }} className="ml-1">· CC-BY (completa)</span>}
          </p>
        </div>
        <button
          onClick={() => handleSelect(track)}
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
          placeholder="Buscar música ou artista (qualquer)"
          className="flex-1 text-xs outline-none"
          style={{ background: "transparent", color: "#F5F5F7" }}
        />
        {query && (
          <button onClick={() => setQuery("")} style={{ color: "#9A9AA5" }} className="text-xs">✕</button>
        )}
      </div>

      {/* Categorias (só quando não está buscando remotamente) */}
      {!showRemote && (
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
      )}

      {/* Lista */}
      <div className="max-h-[420px] overflow-y-auto pr-1 space-y-1">
        {showRemote ? (
          <>
            {remoteLoading && (
              <p style={{ color: "#9A9AA5" }} className="text-xs text-center py-2">Buscando na biblioteca online...</p>
            )}
            {remoteError && (
              <p style={{ color: "#F09595" }} className="text-xs text-center py-2">{remoteError}</p>
            )}
            {!remoteLoading && !remoteError && remoteTracks.length === 0 && (
              <p style={{ color: "#6B6B75" }} className="text-xs text-center py-2">Nenhum resultado. Tente outro termo.</p>
            )}
            {remoteTracks.map(renderTrack)}
            {remoteTracks.length > 0 && (() => {
              const hasFull = remoteTracks.some((t) => t.source === "jamendo");
              return (
                <p style={{ color: "#6B6B75" }} className="text-[10px] text-center pt-2 leading-snug">
                  {hasFull
                    ? "Trilhas completas via Jamendo (CC-BY — creditar artista no uso)."
                    : "Previews de 30s via iTunes (loop automático). Uso comercial completo requer licenciamento à parte."}
                </p>
              );
            })()}
          </>
        ) : (
          <>
            {localResults.map(renderTrack)}
            {!localResults.length && (
              <p style={{ color: "#6B6B75" }} className="text-xs text-center py-3">Nenhuma música local.</p>
            )}
          </>
        )}
      </div>

      <audio ref={audioRef} onEnded={() => setPreviewId(null)} className="hidden" />
    </div>
  );
}
