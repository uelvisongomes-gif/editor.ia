// Seed Random — Item 23. RNG determinístico por projectId + styleId.
// Mesmo input → mesmo output. Diferentes projetos com o mesmo estilo
// variam nas escolhas (chance/priority) mas cada projeto é reproduzível.

/**
 * Mulberry32 — algoritmo simples, rápido, determinístico.
 */
export function createSeededRng(seedStr = "default") {
  let seed = hashString(seedStr);
  return function next() {
    seed |= 0;
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Rola dado 0-1 e retorna se passou pela chance */
export function roll(rng, chance = 1) {
  if (chance >= 1) return true;
  if (chance <= 0) return false;
  return rng() < chance;
}

/** Retorna valor aleatório entre [min, max] com seed */
export function jitter(rng, min, max) {
  return min + rng() * (max - min);
}
