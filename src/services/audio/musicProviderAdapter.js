// Music Provider Adapter — abstração pra buscar/gerar música a partir de um
// MusicBrief. Items 18-19 da spec.
//
// Providers implementados:
//   - "catalog" (default): busca no catálogo curado + user_upload
//   - "itunes": iTunes Search API (previews 30s — só demo)
//   - "generative": stub pra Suno/Udio/MusicGen (NÃO ATIVO — arquitetura só)
//
// Pra ativar generative depois: cadastrar API key + adapter concreto.
// Zero acoplamento — trocar provider é uma linha.

import { MUSIC_CATALOG } from "../musicCatalog.js";
import { matchMusicToBrief } from "./musicMatcher.js";

/**
 * @typedef {Object} MusicResult
 * @property {string} providerId
 * @property {import("./musicMatcher.js").MatchedTrack | null} track
 * @property {string} status         - "ok" | "no_match" | "provider_disabled"
 * @property {string} rationale
 */

const ADAPTERS = {
  catalog: async (brief) => {
    const catalog = MUSIC_CATALOG || [];
    // Enriquece catálogo com hints de mood/bpm/energy pra scoring
    const enriched = catalog.map(inferMoodEnergy);
    const matched = matchMusicToBrief(brief, enriched);
    return {
      providerId: "catalog",
      track: matched,
      status: matched ? "ok" : "no_match",
      rationale: matched ? `catálogo local: ${matched.rationale}` : "nenhuma track do catálogo bate com o brief",
    };
  },

  itunes: async (brief) => {
    // iTunes é usado como fallback pra preview manual (usuário escolhe).
    // Não é bom pra matching automático porque não temos BPM/mood.
    return {
      providerId: "itunes",
      track: null,
      status: "no_match",
      rationale: "iTunes é busca manual, sem metadata pra matching automático",
    };
  },

  generative: async (brief) => {
    // Stub — arquitetura pronta pra Suno/Udio/MusicGen.
    // Ativar exige env var SUNO_API_KEY / UDIO_API_KEY / etc + implementação.
    return {
      providerId: "generative",
      track: null,
      status: "provider_disabled",
      rationale: "generative music não configurado (falta API key + implementação)",
    };
  },
};

/**
 * Busca música pra um brief. Fallback em cascata: generative → catalog → itunes.
 *
 * @param {import("./musicBrief.js").MusicBrief} brief
 * @param {object} [opts]
 * @param {string[]} [opts.providers=["catalog"]]  - ordem de tentativa
 * @returns {Promise<MusicResult>}
 */
export async function searchMusicForBrief(brief, { providers = ["catalog"] } = {}) {
  if (!brief) return { providerId: "none", track: null, status: "no_match", rationale: "sem brief" };

  for (const providerId of providers) {
    const adapter = ADAPTERS[providerId];
    if (!adapter) continue;
    try {
      const result = await adapter(brief);
      if (result.status === "ok") return result;
    } catch (err) {
      console.warn(`[musicProvider] "${providerId}" falhou:`, err.message);
    }
  }
  return { providerId: providers[0] || "none", track: null, status: "no_match", rationale: "nenhum provider retornou match" };
}

/**
 * Inferência simples de mood/bpm/energy pra tracks do catálogo (que só têm
 * category/tags). Isso alimenta o matcher.
 */
function inferMoodEnergy(track) {
  const tags = ((track.tags || []).concat([track.category || ""])).map((t) => (t || "").toLowerCase());
  let mood = "calm";
  let energy = "medium";
  let bpm = 100;
  const has = (word) => tags.some((t) => t.includes(word));

  if (has("motivational") || has("uplifting") || has("epic")) { mood = "motivational"; energy = "high"; bpm = 118; }
  else if (has("corporate") || has("ambient") || has("calm")) { mood = "calm"; energy = "low"; bpm = 85; }
  else if (has("emotional") || has("piano")) { mood = "emotional"; energy = "medium"; bpm = 78; }
  else if (has("hip") || has("trap") || has("viral")) { mood = "energetic"; energy = "high"; bpm = 130; }
  else if (has("lofi") || has("focus") || has("study")) { mood = "focused"; energy = "low"; bpm = 82; }
  else if (has("jazz") || has("elegant")) { mood = "sophisticated"; energy = "low"; bpm = 92; }
  else if (has("tech") || has("synth") || has("future")) { mood = "future"; energy = "medium"; bpm = 110; }
  else if (has("pop") || has("commercial") || has("upbeat")) { mood = "upbeat"; energy = "medium"; bpm = 115; }

  return {
    ...track,
    mood: track.mood || mood,
    energy: track.energy || energy,
    bpm: track.bpm || bpm,
    vocals: track.vocals ?? false,
  };
}
