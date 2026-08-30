// Audio Timeline — decisões tipadas por trecho de tempo.
// Formato único que unifica noise_reduction, eq, compressor, ducking,
// música, sfx, crossfade, room_tone, gain, etc.
//
// Consumido pelo audioMixer no export e pela UI "Antes/Depois" (Item 31).
//
// Cada decisão vem com: type, start, end, intensity, reason, confidence.

/**
 * @typedef {Object} AudioDecision
 * @property {string} type       - noise_reduction | eq | compressor | de_esser | plosive | crossfade | room_tone | gain | music | sfx | dereverb
 * @property {number} start
 * @property {number} end
 * @property {number} intensity  - 0-1 (0 = off, 1 = máximo)
 * @property {string} reason
 * @property {number} confidence - 0-1
 * @property {object} [params]   - parâmetros específicos do tipo
 */

/**
 * Cria uma decisão tipada e valida os campos obrigatórios.
 */
export function makeDecision({ type, start, end, intensity = 1, reason = "", confidence = 1, params = {} }) {
  if (!type) throw new Error("audioTimeline.makeDecision requer type");
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    throw new Error(`audioTimeline.makeDecision start/end inválidos: ${start}/${end}`);
  }
  return {
    type, start, end,
    intensity: Math.max(0, Math.min(1, intensity)),
    reason,
    confidence: Math.max(0, Math.min(1, confidence)),
    params,
  };
}

/**
 * Ordena, deduplica e valida timeline.
 */
export function buildAudioTimeline(decisions = []) {
  const sorted = [...decisions].sort((a, b) => a.start - b.start || a.type.localeCompare(b.type));
  return {
    decisions: sorted,
    summary: {
      total: sorted.length,
      byType: sorted.reduce((acc, d) => {
        acc[d.type] = (acc[d.type] || 0) + 1;
        return acc;
      }, {}),
      totalDuration: sorted.reduce((sum, d) => sum + (d.end - d.start), 0),
    },
  };
}

/**
 * Retorna decisões ativas em um instante t.
 */
export function decisionsAt(timeline, t) {
  if (!timeline?.decisions) return [];
  return timeline.decisions.filter((d) => t >= d.start && t < d.end);
}

/**
 * Retorna decisões de um tipo específico.
 */
export function decisionsOfType(timeline, type) {
  if (!timeline?.decisions) return [];
  return timeline.decisions.filter((d) => d.type === type);
}
