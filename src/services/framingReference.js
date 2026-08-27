// Framing Reference — padrão de proporção do rosto no vídeo.
// Define o "look" que o SmartZoom deve reproduzir e serve de baseline
// pra futuro face detector calibrar a escala automaticamente.
//
// REFERÊNCIA VISUAL (aprovada pelo usuário):
//   - NORMAL (zoom_out state) : rosto ocupa ~50% da altura do frame
//   - FACE_FILL (zoom_in max) : rosto ocupa ~80% da altura do frame
//
// Razão face_fill / normal = 0.80 / 0.50 = 1.6 → escala EFETIVA alvo
// pro zoom strong. Menos 8% de safety margin (evita cortar cabelo/queixo)
// = 1.52 efetivo, que é exatamente o strong atual (1.38 * BASE_ZOOM 1.10).

export const FACE_HEIGHT_FRACTION = {
  normal:    0.50,  // padrão de gravação de celular vertical
  face_fill: 0.80,  // enquadramento pós-zoom in "forte"
};

// Escalas de referência derivadas — usadas por smartZoom e futuros
// consumidores (ex: exportador que renderiza dado um crop centrado).
export const REFERENCE_SCALES = {
  light:  1.15,   // "aproximou um pouco" — dá vida ao rosto
  medium: 1.28,   // "aproximou nitidamente" — pra pontos principais
  strong: 1.38,   // "face-fill" — 80% do frame, pra CTAs / impacto
};

/**
 * Estima quantos "% do frame" o rosto ocupa depois de aplicar uma escala.
 * Assume rosto centralizado (o que é o caso da nossa política de zoom).
 */
export function faceFractionAtScale(conceptualScale, baseFraction = FACE_HEIGHT_FRACTION.normal) {
  return Math.min(0.95, baseFraction * conceptualScale);
}

/**
 * Dado um "tier" desejado (leve/moderado/forte) devolve o scale.
 */
export function scaleFor(tier) {
  return REFERENCE_SCALES[tier] ?? REFERENCE_SCALES.light;
}
