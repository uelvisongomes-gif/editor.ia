// Busca de musica — 2 backends:
//
// 1) JAMENDO (preferido): tracks CC-BY completos (1-5min). Requer
//    JAMENDO_CLIENT_ID no env. Free tier registrado em
//    https://developer.jamendo.com/v3.0/. Sem chave, pula pro fallback.
//
// 2) ITUNES SEARCH API (fallback): previews de 30s de QUALQUER artista.
//    Sem chave. Perfeito pra buscar musica popular por nome.
//
// GET /api/music-search?q=chill&limit=30

async function searchJamendo(q, limit) {
  const clientId = process.env.JAMENDO_CLIENT_ID;
  if (!clientId) return null;
  const params = new URLSearchParams({
    client_id: clientId,
    format: "json",
    limit: String(limit),
    search: q,
    include: "musicinfo",
    audioformat: "mp32",
  });
  const url = `https://api.jamendo.com/v3.0/tracks/?${params.toString()}`;
  try {
    const r = await fetch(url, { headers: { "User-Agent": "editor.ia/1.0" } });
    if (!r.ok) return null;
    const data = await r.json();
    const results = data.results || [];
    return results
      .filter((t) => t.audio && t.name && t.artist_name)
      .map((t) => ({
        id: `jamendo-${t.id}`,
        title: t.name,
        artist: t.artist_name,
        album: t.album_name || "",
        category: (t.musicinfo?.tags?.genres || [])[0] || "cc",
        durationSec: t.duration || 180,
        previewSec: t.duration || 180,
        url: t.audio,
        artwork: t.image || t.album_image || null,
        license: "cc-by",
        bpm: null,
        source: "jamendo",
      }));
  } catch {
    return null;
  }
}

async function searchITunes(q, limit, country) {
  const params = new URLSearchParams({
    term: q,
    media: "music",
    entity: "musicTrack",
    limit: String(limit),
    country,
  });
  const url = `https://itunes.apple.com/search?${params.toString()}`;
  try {
    const r = await fetch(url, { headers: { "User-Agent": "editor.ia/1.0" } });
    if (!r.ok) return [];
    const data = await r.json();
    return (data.results || [])
      .filter((r) => r.previewUrl && r.trackName && r.artistName)
      .map((r) => ({
        id: `itunes-${r.trackId}`,
        title: r.trackName,
        artist: r.artistName,
        album: r.collectionName || "",
        category: r.primaryGenreName || "music",
        durationSec: r.trackTimeMillis ? Math.round(r.trackTimeMillis / 1000) : 30,
        previewSec: 30,
        url: r.previewUrl,
        artwork: r.artworkUrl100 || r.artworkUrl60 || null,
        license: "preview_only",
        source: "itunes",
      }));
  } catch {
    return [];
  }
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");

  const q = (req.query?.q || "").toString().trim();
  const limit = Math.min(50, Math.max(1, parseInt(req.query?.limit || "25", 10)));
  const country = (req.query?.country || "BR").toString().slice(0, 2);

  if (!q || q.length < 2) {
    return res.status(200).json({ tracks: [], query: q });
  }

  // Preferência: Jamendo (full tracks). Fallback: iTunes (30s previews).
  let tracks = null;
  let source = "itunes";
  const jamendoTracks = await searchJamendo(q, limit);
  if (jamendoTracks && jamendoTracks.length > 0) {
    tracks = jamendoTracks;
    source = "jamendo";
  } else {
    tracks = await searchITunes(q, limit, country);
  }

  return res.status(200).json({ tracks, query: q, total: tracks.length, source });
}
