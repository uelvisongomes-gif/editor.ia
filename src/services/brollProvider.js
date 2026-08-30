// B-Roll Provider — abstração pra buscar mídia (imagem/vídeo) por keyword.
// Providers implementados como funções `search()` que retornam URLs.
//
// Arquitetura pronta pra swap — hoje temos:
//   - "stub" (default): retorna placeholders (sem chamar API)
//   - "user_upload": mídia carregada pelo usuário
//   - "pexels": Pexels API (requer PEXELS_API_KEY env var)
//   - "pixabay": Pixabay API (requer PIXABAY_API_KEY env var)
//   - "ai_gen" (futuro): geração de vídeo/imagem por IA
//
// Provider chosen at call time via `provider` arg.

/**
 * @typedef {Object} BrollMedia
 * @property {string} id
 * @property {string} type    - "image" | "video"
 * @property {string} url     - URL do asset
 * @property {string} thumbUrl
 * @property {number} durationSec  - só pra videos
 * @property {number} width
 * @property {number} height
 * @property {string} attribution  - créditos (importante pra CC-BY)
 * @property {string} source
 */

async function searchStub(query, limit = 6) {
  // Fallback — retorna placeholders sem chamar API externa.
  const items = [];
  for (let i = 0; i < limit; i++) {
    items.push({
      id: `stub-${query}-${i}`,
      type: "image",
      url: `https://placehold.co/1080x1920/1A0F28/FF6A2B?text=${encodeURIComponent(query)}+${i + 1}`,
      thumbUrl: `https://placehold.co/300x300/1A0F28/FF6A2B?text=${encodeURIComponent(query)}`,
      durationSec: null,
      width: 1080, height: 1920,
      attribution: "Placeholder (stub provider)",
      source: "stub",
    });
  }
  return items;
}

/**
 * Pesquisa mídia pra uma query textual.
 * @param {string} query
 * @param {object} [opts]
 * @param {"stub"|"pexels"|"pixabay"|"user_upload"} [opts.provider="stub"]
 * @param {number} [opts.limit=6]
 * @returns {Promise<BrollMedia[]>}
 */
export async function searchBrollMedia(query, opts = {}) {
  const provider = opts.provider || "stub";
  const limit = opts.limit ?? 6;
  if (!query || query.length < 2) return [];
  switch (provider) {
    case "pexels":
    case "pixabay":
      // Estes providers precisam de proxy backend com API key.
      // Fica pra próxima etapa quando integração real for feita.
      console.warn(`[brollProvider] "${provider}" não implementado — usando stub.`);
      return searchStub(query, limit);
    case "user_upload":
      // Retorna do storage local do usuário (futuro).
      return [];
    default:
      return searchStub(query, limit);
  }
}
