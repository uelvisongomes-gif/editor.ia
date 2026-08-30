// Music Matcher — dado um MusicBrief, encontra a melhor track no catálogo
// disponível (catálogo curado local + biblioteca do usuário).
// Item 20 da spec: nunca música aleatória.

/**
 * @typedef {Object} MatchedTrack
 * @property {string} id
 * @property {string} title
 * @property {string} artist
 * @property {number} bpm
 * @property {string} mood
 * @property {string[]} tags
 * @property {number} score        - 0-1
 * @property {string} rationale
 */

/**
 * @param {import("./musicBrief.js").MusicBrief} brief
 * @param {Array} catalog    - tracks disponíveis (do musicCatalog + user_upload + favoritos)
 * @returns {MatchedTrack | null}
 */
export function matchMusicToBrief(brief, catalog = []) {
  if (!brief || !catalog.length) return null;

  const scored = catalog.map((track) => {
    let score = 0;
    let reasons = [];

    // Mood match
    if (track.mood === brief.mood) { score += 0.35; reasons.push("mood exato"); }
    else if (moodsCompatible(track.mood, brief.mood)) { score += 0.20; reasons.push("mood compatível"); }

    // BPM proximity
    if (track.bpm) {
      const bpmDelta = Math.abs(track.bpm - brief.bpm);
      if (bpmDelta <= 5) { score += 0.25; reasons.push(`BPM ~${track.bpm}`); }
      else if (bpmDelta <= 15) { score += 0.15; reasons.push(`BPM próximo`); }
      else if (bpmDelta <= 30) { score += 0.05; }
    }

    // Style/tags overlap
    const tags = (track.tags || []).map((t) => t.toLowerCase());
    const kw = (brief.keywords || []).map((k) => k.toLowerCase());
    const overlap = kw.filter((k) => tags.some((t) => t.includes(k) || k.includes(t))).length;
    if (overlap >= 2) { score += 0.25; reasons.push(`${overlap} tags`); }
    else if (overlap === 1) { score += 0.12; reasons.push("1 tag"); }

    // Energy alignment
    if (track.energy === brief.energy) { score += 0.10; reasons.push("energy match"); }

    // Vocals policy
    if (brief.vocals === false && track.vocals === false) { score += 0.05; }
    if (brief.vocals === false && track.vocals === true) { score -= 0.20; reasons.push("penalty vocals"); }

    return { track, score: Math.min(1, Math.max(0, score)), reasons };
  }).sort((a, b) => b.score - a.score);

  const best = scored[0];
  if (!best || best.score < 0.25) return null;
  return {
    id: best.track.id,
    title: best.track.title || best.track.name,
    artist: best.track.artist || best.track.attribution,
    bpm: best.track.bpm,
    mood: best.track.mood,
    tags: best.track.tags,
    score: Math.round(best.score * 100) / 100,
    rationale: best.reasons.join(", "),
    track: best.track,
  };
}

const MOOD_COMPAT = {
  motivational: ["energetic", "upbeat", "epic"],
  calm:         ["reflective", "focused", "smooth"],
  emotional:    ["reflective", "warm"],
  energetic:    ["motivational", "upbeat"],
  upbeat:       ["motivational", "energetic"],
  epic:         ["motivational", "cinematic"],
  focused:      ["calm", "reflective"],
  warm:         ["emotional", "reflective"],
  reflective:   ["calm", "focused", "emotional"],
  smooth:       ["calm", "sophisticated"],
  sophisticated: ["smooth", "elegant"],
  tense:        ["dramatic", "cinematic"],
  cinematic:    ["epic", "dramatic"],
  future:       ["energetic", "motivational"],
};
function moodsCompatible(a, b) {
  if (!a || !b) return false;
  return (MOOD_COMPAT[a] || []).includes(b) || (MOOD_COMPAT[b] || []).includes(a);
}
