// Vocabulário compartilhado entre detectores. Constantes só, nada de
// lógica de decisão.

export const FILLER_WORDS = new Set([
  "é", "eh", "ah", "hum", "hmm", "uh", "uhm", "tipo", "tá",
  "né", "sei", "então", "aí",
]);

export const STANDALONE_HESITATIONS = new Set([
  "bom", "então", "olha", "assim", "aí", "ah", "bem", "eh", "e", "é",
  "veja", "vejam", "gente", "pessoal",
]);

// Conectores que quando "pendurados" (sem completação) sinalizam frase
// abandonada. NÃO inclui "e"/"mas"/"ou" — esses são discurso normal e
// causam FP se tratados como marcadores de abandono ("mas o grande
// problema é ..." não é abandono, é abertura legítima).
export const HANGING_CONNECTORS = new Set([
  "porque", "quando", "como", "para", "pra", "que", "se",
  "pois", "porém", "todavia", "contudo",
]);

export const RESET_WORDS = new Set([
  "então", "aí", "bom", "olha", "assim", "bem", "veja",
  "gente", "pessoal", "enfim", "ok", "beleza",
]);

export const CONNECTOR_BEFORE_STUTTER = new Set([
  "porque", "quando", "como", "para", "pra", "que", "se",
  "e", "ou", "mas", "pois",
]);

export const RESTART_MARKERS = [
  ["não", "pera"], ["não", "espera"], ["não", "peraí"],
  ["pera", "aí"], ["peraí"],
  // ["não", "é"] removido — pattern "X não é Y" é conteúdo legítimo comum
  // ("Revelação não é saber de tudo") e causava FP.
  ["deixa", "eu", "ver"], ["deixa", "eu", "pensar"], ["deixa", "eu", "refazer"],
  ["esquece", "isso"], ["esquece", "o", "que"],
  ["vou", "refazer"], ["vamos", "de", "novo"],
  ["vou", "começar", "de", "novo"], ["vou", "recomeçar"], ["recomeça"],
  ["ai", "meu", "deus"], ["puta", "que", "pariu"], ["caraca"],
  // Marcadores explícitos de autocorreção — apresentador diz algo,
  // percebe o erro e sinaliza "quer dizer" / "digo" / "melhor dizendo"
  // antes da versão correta.
  ["quer", "dizer"], ["digo"], ["melhor", "dizendo"], ["ou", "seja"],
];

export const ELONG_FILLERS = new Set([
  "é", "eh", "ah", "eee", "ééé", "hum", "hmm", "uhm", "uh", "aaa",
]);

export function normalize(w) {
  return (w || "").toLowerCase().replace(/[.,!?;:"'()]/g, "").trim();
}

export function endsSentenceHard(raw) {
  const s = (raw || "").trim();
  if (/\.{2,}$/.test(s)) return false;
  return /[.!?]$/.test(s);
}
