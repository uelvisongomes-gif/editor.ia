# Editing Presets · Vídeos de preview

Cada preset tem um `.mp4` de preview (9:16, loop, muted, ~5-8s).

**Arquivos esperados:**

| Preset ID          | Arquivo esperado          |
|--------------------|---------------------------|
| creator_dynamic    | `creator_dynamic.mp4`     |
| clean_pro          | `clean_pro.mp4`           |
| viral_fast         | `viral_fast.mp4`          |
| storytelling       | `storytelling.mp4`        |
| tiktok_shop        | `tiktok_shop.mp4`         |
| podcast_clips      | `podcast_clips.mp4`       |
| tutorial_pro       | `tutorial_pro.mp4`        |
| ugc_ads            | `ugc_ads.mp4`             |

**Especificações:**
- Formato: `.mp4` H.264 (ou `.webm` VP9)
- Aspect ratio: **9:16** vertical
- Resolução recomendada: 540x960 (leve, carrega rápido)
- Duração: **5-8 segundos** em loop perfeito
- Sem áudio (o card é muted)
- Deve mostrar CLARAMENTE as características visuais do estilo

**Enquanto arquivos não existirem:** o card mostra placeholder gradient com o nome do estilo.

**Onde entram no código:** `src/services/editingPresets.js` → cada preset tem
`preview.videoUrl: "/assets/editing-presets/<id>.mp4"`
