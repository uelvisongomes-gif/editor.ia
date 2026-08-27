// Catálogo de música — organizado por categoria estilo TikTok.
// URLs de sample são placeholders públicos (SoundHelix, CC0). Pra
// catálogo comercial real com licenciamento, integrar com Epidemic
// Sound / Artlist / Pixabay Music API. A estrutura aqui já suporta
// isso: só trocar url e license.

const SH = (n) => `https://www.soundhelix.com/examples/mp3/SoundHelix-Song-${n}.mp3`;

export const MUSIC_CATEGORIES = [
  { id: "trending",     label: "Em alta",       emoji: "🔥" },
  { id: "chill",        label: "Chill",         emoji: "🌙" },
  { id: "motivational", label: "Motivacional",  emoji: "💪" },
  { id: "cinematic",    label: "Cinemático",    emoji: "🎬" },
  { id: "vlog",         label: "Vlog",          emoji: "🎥" },
  { id: "beats",        label: "Beats",         emoji: "🎧" },
];

/**
 * @typedef {Object} MusicTrack
 * @property {string} id
 * @property {string} title
 * @property {string} artist
 * @property {string} category
 * @property {number} durationSec
 * @property {string} url            - MP3 stream
 * @property {number} bpm
 * @property {"cc0"|"licensed"} license
 * @property {string[]} tags
 */

export const MUSIC_CATALOG = [
  // Trending
  { id: "tr-1", title: "Sunset Vibe",       artist: "House of Beats", category: "trending",     durationSec: 210, url: SH(1),  bpm: 118, license: "cc0", tags: ["reels","fresh","viral"] },
  { id: "tr-2", title: "Neon Nights",       artist: "Aurora",         category: "trending",     durationSec: 195, url: SH(2),  bpm: 124, license: "cc0", tags: ["night","dance"] },
  { id: "tr-3", title: "Uplift Now",        artist: "Vibe Studio",    category: "trending",     durationSec: 180, url: SH(3),  bpm: 128, license: "cc0", tags: ["energy","viral"] },
  { id: "tr-4", title: "Boom Trap",         artist: "808 Labs",       category: "trending",     durationSec: 168, url: SH(4),  bpm: 140, license: "cc0", tags: ["trap","hard"] },
  // Chill
  { id: "ch-1", title: "Coffee Shop",       artist: "Lo-Fi Room",     category: "chill",        durationSec: 225, url: SH(5),  bpm: 78,  license: "cc0", tags: ["lofi","cozy"] },
  { id: "ch-2", title: "Sunday Morning",    artist: "Soft Keys",      category: "chill",        durationSec: 240, url: SH(6),  bpm: 82,  license: "cc0", tags: ["mellow","piano"] },
  { id: "ch-3", title: "Warm Rain",         artist: "Ambient Loop",   category: "chill",        durationSec: 260, url: SH(7),  bpm: 70,  license: "cc0", tags: ["ambient","rain"] },
  { id: "ch-4", title: "Slow Sunset",       artist: "Wave Studio",    category: "chill",        durationSec: 210, url: SH(8),  bpm: 86,  license: "cc0", tags: ["chill","warm"] },
  // Motivational
  { id: "mo-1", title: "Get It Done",       artist: "Peak Focus",     category: "motivational", durationSec: 195, url: SH(9),  bpm: 130, license: "cc0", tags: ["gym","drive"] },
  { id: "mo-2", title: "Push Harder",       artist: "Iron Beat",      category: "motivational", durationSec: 200, url: SH(10), bpm: 138, license: "cc0", tags: ["gym","hard"] },
  { id: "mo-3", title: "Chase the Goal",    artist: "Momentum",       category: "motivational", durationSec: 210, url: SH(11), bpm: 132, license: "cc0", tags: ["success","mindset"] },
  { id: "mo-4", title: "Break Through",     artist: "Vertical",       category: "motivational", durationSec: 185, url: SH(12), bpm: 128, license: "cc0", tags: ["inspire"] },
  // Cinematic
  { id: "ci-1", title: "Rising",            artist: "Score Room",     category: "cinematic",    durationSec: 245, url: SH(13), bpm: 100, license: "cc0", tags: ["epic","score"] },
  { id: "ci-2", title: "The Reveal",        artist: "Orchestra One",  category: "cinematic",    durationSec: 220, url: SH(1),  bpm: 92,  license: "cc0", tags: ["reveal","big"] },
  { id: "ci-3", title: "Deep Blue",         artist: "String Layer",   category: "cinematic",    durationSec: 260, url: SH(2),  bpm: 88,  license: "cc0", tags: ["drama","strings"] },
  { id: "ci-4", title: "Rain of Stars",     artist: "Nova",           category: "cinematic",    durationSec: 235, url: SH(3),  bpm: 96,  license: "cc0", tags: ["magic","score"] },
  // Vlog
  { id: "vl-1", title: "Daily Ride",        artist: "Vlog Kit",       category: "vlog",         durationSec: 175, url: SH(4),  bpm: 108, license: "cc0", tags: ["daily","upbeat"] },
  { id: "vl-2", title: "Weekend Plans",     artist: "Bright Studio",  category: "vlog",         durationSec: 190, url: SH(5),  bpm: 112, license: "cc0", tags: ["cheerful"] },
  { id: "vl-3", title: "Sunny Feeling",     artist: "Warm Palette",   category: "vlog",         durationSec: 205, url: SH(6),  bpm: 110, license: "cc0", tags: ["sunny","happy"] },
  { id: "vl-4", title: "Little Adventures", artist: "Roam",           category: "vlog",         durationSec: 180, url: SH(7),  bpm: 114, license: "cc0", tags: ["travel"] },
  // Beats
  { id: "be-1", title: "Groove Line",       artist: "Deep Bass",      category: "beats",        durationSec: 175, url: SH(8),  bpm: 120, license: "cc0", tags: ["groove","bass"] },
  { id: "be-2", title: "808 Rider",         artist: "Sub Kingdom",    category: "beats",        durationSec: 168, url: SH(9),  bpm: 140, license: "cc0", tags: ["808","trap"] },
  { id: "be-3", title: "Late Drive",        artist: "Night Wave",     category: "beats",        durationSec: 205, url: SH(10), bpm: 96,  license: "cc0", tags: ["drive","cool"] },
  { id: "be-4", title: "City Pulse",        artist: "Neon Grid",      category: "beats",        durationSec: 190, url: SH(11), bpm: 118, license: "cc0", tags: ["urban"] },
];

export function searchMusic(query, categoryId) {
  const q = (query || "").toLowerCase().trim();
  let list = MUSIC_CATALOG;
  if (categoryId) list = list.filter((t) => t.category === categoryId);
  if (!q) return list;
  return list.filter((t) =>
    t.title.toLowerCase().includes(q) ||
    t.artist.toLowerCase().includes(q) ||
    t.tags.some((tag) => tag.includes(q))
  );
}

export function getMusicById(id) {
  return MUSIC_CATALOG.find((t) => t.id === id) || null;
}
