// Proxy backend pra buscar B-roll em Pexels/Pixabay sem expor API key
// no browser. Set env vars: PEXELS_API_KEY, PIXABAY_API_KEY
//
// GET /api/broll-search?q=escritorio&type=video&limit=6&provider=pexels

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "s-maxage=600, stale-while-revalidate=1200");

  const q = (req.query?.q || "").toString().trim();
  const type = (req.query?.type || "video").toString();
  const limit = Math.min(20, Math.max(1, parseInt(req.query?.limit || "6", 10)));
  const provider = (req.query?.provider || "pexels").toString();

  if (!q || q.length < 2) {
    return res.status(200).json({ media: [], query: q, provider });
  }

  try {
    if (provider === "pexels") return await searchPexels(q, type, limit, res);
    if (provider === "pixabay") return await searchPixabay(q, type, limit, res);
    return res.status(400).json({ error: "invalid_provider" });
  } catch (err) {
    return res.status(500).json({ error: "fetch_failed", message: err.message, media: [] });
  }
}

async function searchPexels(q, type, limit, res) {
  const key = process.env.PEXELS_API_KEY;
  if (!key) return res.status(200).json({ media: [], provider: "pexels", error: "no_key" });
  const endpoint = type === "video"
    ? `https://api.pexels.com/videos/search?query=${encodeURIComponent(q)}&per_page=${limit}&orientation=portrait`
    : `https://api.pexels.com/v1/search?query=${encodeURIComponent(q)}&per_page=${limit}&orientation=portrait`;
  const upstream = await fetch(endpoint, {
    headers: { Authorization: key, "User-Agent": "editor.ia/1.0" },
  });
  if (!upstream.ok) return res.status(502).json({ error: "pexels_error", status: upstream.status, media: [] });
  const data = await upstream.json();
  const media = (type === "video" ? data.videos : data.photos || []).map((item) => ({
    id: `pexels-${item.id}`,
    type,
    url: type === "video" ? item.video_files?.find((f) => f.quality === "hd")?.link || item.video_files?.[0]?.link : item.src?.large2x,
    thumbUrl: type === "video" ? item.image : item.src?.medium,
    durationSec: item.duration || null,
    width: item.width, height: item.height,
    attribution: `${item.user?.name || "Pexels"} @ Pexels`,
    source: "pexels",
  })).filter((m) => m.url);
  return res.status(200).json({ media, query: q, provider: "pexels", total: media.length });
}

async function searchPixabay(q, type, limit, res) {
  const key = process.env.PIXABAY_API_KEY;
  if (!key) return res.status(200).json({ media: [], provider: "pixabay", error: "no_key" });
  const endpoint = type === "video"
    ? `https://pixabay.com/api/videos/?key=${key}&q=${encodeURIComponent(q)}&per_page=${limit}&video_type=film`
    : `https://pixabay.com/api/?key=${key}&q=${encodeURIComponent(q)}&per_page=${limit}&image_type=photo&orientation=vertical`;
  const upstream = await fetch(endpoint, { headers: { "User-Agent": "editor.ia/1.0" } });
  if (!upstream.ok) return res.status(502).json({ error: "pixabay_error", status: upstream.status, media: [] });
  const data = await upstream.json();
  const media = (data.hits || []).map((item) => ({
    id: `pixabay-${item.id}`,
    type,
    url: type === "video" ? (item.videos?.medium?.url || item.videos?.small?.url) : item.largeImageURL,
    thumbUrl: item.userImageURL || item.previewURL,
    durationSec: item.duration || null,
    width: item.videos?.medium?.width || item.imageWidth,
    height: item.videos?.medium?.height || item.imageHeight,
    attribution: `${item.user || "Pixabay"} @ Pixabay`,
    source: "pixabay",
  })).filter((m) => m.url);
  return res.status(200).json({ media, query: q, provider: "pixabay", total: media.length });
}
