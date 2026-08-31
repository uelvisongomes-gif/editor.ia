# Editing Presets · Vídeos de preview

## Contexto

A galeria de estilos ("Estilo de edição" no editor) mostra **cards visuais**
com preview em vídeo. Enquanto os arquivos abaixo não existirem, cada card
usa um mini-mock CSS animado (procedural) que já demonstra o LAYOUT do
estilo.

Substituir por vídeos reais é só colocar os arquivos nesta pasta com o
nome exato — sem alterar código.

## Arquivos esperados (12 modelos com variantes)

| Preset ID                | Arquivo .mp4                  | Poster .jpg                   |
|--------------------------|-------------------------------|-------------------------------|
| creator_dynamic_01       | `creator_dynamic_01.mp4`      | `creator_dynamic_01.jpg`      |
| creator_dynamic_02       | `creator_dynamic_02.mp4`      | `creator_dynamic_02.jpg`      |
| clean_pro_01             | `clean_pro_01.mp4`            | `clean_pro_01.jpg`            |
| clean_pro_02             | `clean_pro_02.mp4`            | `clean_pro_02.jpg`            |
| viral_fast_01            | `viral_fast_01.mp4`           | `viral_fast_01.jpg`           |
| viral_fast_02            | `viral_fast_02.mp4`           | `viral_fast_02.jpg`           |
| viral_fast_03            | `viral_fast_03.mp4`           | `viral_fast_03.jpg`           |
| storytelling_01          | `storytelling_01.mp4`         | `storytelling_01.jpg`         |
| storytelling_02          | `storytelling_02.mp4`         | `storytelling_02.jpg`         |
| tiktok_shop_01           | `tiktok_shop_01.mp4`          | `tiktok_shop_01.jpg`          |
| tiktok_shop_02           | `tiktok_shop_02.mp4`          | `tiktok_shop_02.jpg`          |
| podcast_clips_01         | `podcast_clips_01.mp4`        | `podcast_clips_01.jpg`        |
| tutorial_pro_01          | `tutorial_pro_01.mp4`         | `tutorial_pro_01.jpg`         |
| ugc_ads_01               | `ugc_ads_01.mp4`              | `ugc_ads_01.jpg`              |

## Especificações

- **Formato:** `.mp4` H.264 (ou `.webm` VP9)
- **Aspect ratio:** 9:16 vertical
- **Resolução recomendada:** 540x960 (leve, carrega rápido)
- **Duração:** 5-8 segundos em loop perfeito (frame inicial = frame final)
- **Bitrate:** ~1.5-2 Mbps (~1-2 MB por vídeo)
- **Sem áudio** (o card é muted)
- **Poster:** JPG do primeiro frame (~50-100 KB), mostrado antes do vídeo tocar

## Como gerar previews (estratégia recomendada)

A melhor estratégia é **renderizar via Style Engine**:

1. Grave 1 vídeo demo padrão (~30s, pessoa falando, com potencial pra hook, número, prova)
2. No editor, faça upload desse demo
3. Escolha o preset (ex: `Creator Dynamic 01`) → rode "Edição inteligente"
4. Exporta os 8 segundos mais representativos (aparece composição diferente, big number, B-roll)
5. Salva como `creator_dynamic_01.mp4`
6. Repete pros outros 13 modelos

Assim o **preview mostra exatamente o que o motor produz** — nada de vídeo
fake que promete algo que o editor não entrega.

## Poster (opcional, mas recomendado)

Frame representativo do estilo. Se não fornecer, o browser gera automático
do primeiro frame do vídeo. Fornecer melhora carregamento e evita "flash"
de tela preta.

## Como funciona sem os arquivos

Quando `.mp4` não existe:
- Card mostra `<StylePreviewMock>` (mini-mock CSS animado)
- Mock respeita o `compositionBehavior` do preset (mostra cenas alternando entre `full_speaker`, `top_media_bottom_speaker`, `big_number_composed`, etc)
- Substituição é 100% automática quando arquivo aparece na pasta
