// Style Picker — Item 33. Cards de estilo agrupados por categoria +
// favoritos + recentes + meus estilos.

import React, { useMemo, useState } from "react";
import { listStyles, listCategories, loadFavorites, toggleFavorite, loadRecent } from "../services/styleEngine/styleRegistry.js";

const CATEGORY_LABEL = {
  natural: "Natural", dynamic: "Dinâmico", viral: "Viral",
  storytelling: "Storytelling", podcast: "Podcast", tutorial: "Tutorial",
  tiktokshop: "TikTok Shop", ugc: "UGC Ads", business: "Business", high_energy: "High Energy",
  custom: "Meus estilos",
};

export function StylePicker({ selectedId, onSelect }) {
  const [favTick, setFavTick] = useState(0);
  const styles = useMemo(() => listStyles(), []);
  const categories = useMemo(() => listCategories(), []);
  const favorites = useMemo(() => loadFavorites(), [favTick]);
  const recent = useMemo(() => loadRecent(), [selectedId]);

  const handleFav = (id) => { toggleFavorite(id); setFavTick((n) => n + 1); };

  const groupedByCat = useMemo(() => {
    const out = {};
    for (const cat of categories) out[cat] = styles.filter((s) => s.category === cat);
    return out;
  }, [styles, categories]);

  return (
    <div style={{ background: "#12081C", border: "1px solid #2A1A3E" }} className="rounded-lg p-3">
      <p style={{ color: "#F5EFFF" }} className="text-xs font-bold uppercase tracking-wide mb-3">Estilo de edição</p>

      {favorites.length > 0 && (
        <div className="mb-3">
          <div style={{ color: "#7060A0" }} className="text-[10px] uppercase mb-1">Favoritos</div>
          <div className="flex flex-wrap gap-1.5">
            {favorites.map((id) => {
              const s = styles.find((x) => x.id === id);
              if (!s) return null;
              return <StyleChip key={id} style={s} selected={id === selectedId} onSelect={onSelect} onFav={handleFav} isFav />;
            })}
          </div>
        </div>
      )}

      {recent.length > 0 && (
        <div className="mb-3">
          <div style={{ color: "#7060A0" }} className="text-[10px] uppercase mb-1">Usados recentemente</div>
          <div className="flex flex-wrap gap-1.5">
            {recent.slice(0, 4).map((id) => {
              const s = styles.find((x) => x.id === id);
              if (!s) return null;
              return <StyleChip key={id} style={s} selected={id === selectedId} onSelect={onSelect} onFav={handleFav} isFav={favorites.includes(id)} />;
            })}
          </div>
        </div>
      )}

      {categories.map((cat) => (
        <div key={cat} className="mb-2">
          <div style={{ color: "#7060A0" }} className="text-[10px] uppercase mb-1">{CATEGORY_LABEL[cat] || cat}</div>
          <div className="flex flex-wrap gap-1.5">
            {(groupedByCat[cat] || []).map((s) => (
              <StyleChip key={s.id} style={s} selected={s.id === selectedId}
                onSelect={onSelect} onFav={handleFav} isFav={favorites.includes(s.id)} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function StyleChip({ style, selected, onSelect, onFav, isFav }) {
  return (
    <div
      onClick={() => onSelect?.(style.id)}
      style={{
        background: selected ? `linear-gradient(92deg, ${style.brandKit?.primary || "#FF6A2B"}20, ${style.brandKit?.secondary || "#FF3EA5"}20)` : "#1A0F28",
        border: selected ? `1px solid ${style.brandKit?.primary || "#FF6A2B"}` : "1px solid #2A1A3E",
        cursor: "pointer",
      }}
      className="px-2 py-1.5 rounded flex items-center gap-1.5 text-[11px] font-semibold"
    >
      <span style={{ color: selected ? style.brandKit?.primary : "#F5EFFF" }}>{style.name}</span>
      <button
        onClick={(e) => { e.stopPropagation(); onFav?.(style.id); }}
        style={{ background: "transparent", color: isFav ? "#FFB020" : "#7060A0", padding: 0 }}
        className="text-xs leading-none"
        title={isFav ? "Desfavoritar" : "Favoritar"}
      >{isFav ? "★" : "☆"}</button>
    </div>
  );
}
