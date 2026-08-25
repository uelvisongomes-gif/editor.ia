# Editor de Vídeo com IA — CRIE Studios

Protótipo funcional construído com Claude (via chat), publicado como app standalone na Vercel.
Este pacote é o código-fonte para servir de ponto de partida na integração dentro do editor de vídeo do CRIE.

## Stack
- React 18 + Vite
- Tailwind (via CDN no index.html — se for integrar num projeto que já usa Tailwind via build, ajustar)
- lucide-react para ícones
- Processamento de vídeo 100% no navegador (Web Audio API, MediaRecorder, Canvas) — nenhum upload de vídeo pra servidor
- Duas funções serverless (pensadas para Vercel, mas a lógica é portável para qualquer backend Node):
  - `api/transcribe.js` — recebe áudio, chama a Whisper API da OpenAI (usa `OPENAI_API_KEY`)
  - `api/ai-text.js` — recebe um prompt de texto, chama o GPT da OpenAI (mesma `OPENAI_API_KEY`) — usado para gerar legendas e detectar erros de fala

## Estrutura
```
src/App.jsx        — componente principal (todo o editor está aqui, ~2100 linhas)
src/main.jsx        — entry point React
api/transcribe.js   — endpoint de transcrição (Whisper)
api/ai-text.js       — endpoint de geração de texto (GPT)
public/logo.png      — logo usado no cabeçalho
index.html           — inclui Tailwind via CDN
package.json / vite.config.js
```

## Variáveis de ambiente necessárias
- `OPENAI_API_KEY` — usada pelos dois endpoints em `api/`

## Funcionalidades já implementadas
- Upload de vídeo (MP4/WebM/MOV — HEVC do iPhone pode falhar, é limitação do navegador)
- Transcrição real via Whisper (com timestamps por palavra)
- Corte automático de silêncios/pausas (análise real de áudio, sem IA)
- Detecção e corte de erros de fala (gagueira, hesitação) via GPT
- Legendas automáticas cronometradas com precisão (a partir dos timestamps do Whisper), 5 estilos visuais
- Zoom automático (aponta pra pausas na fala como "gatilho")
- Transições (fade) reais entre cortes
- 12 "tipos de vídeo" (Educacional, Vendas, Storytelling, etc.) que ajustam ritmo de corte/zoom/cor/legenda automaticamente
- Seleção de rede de destino (TikTok, Reels, Feed, Shorts, YouTube) que ajusta a proporção de exportação
- Linha do tempo com miniaturas reais extraídas do vídeo, régua de tempo, trilhas de vídeo/áudio/legendas/efeitos/transições/IA
- Exportação para .webm (canvas + MediaRecorder) com tudo "queimado" (cortes, zoom, cor, legendas, transições)
- "Editar tudo automaticamente": roda o pipeline inteiro (transcrever → cortar silêncio → cortar erros → legendar → zoom → transição → renderizar) de um clique

## Limitações conhecidas / não implementado
- **Sem trilha sonora/música de fundo** — não existe upload nem mixagem de áudio externo
- Zoom só faz "zoom in" pontual, não "zoom out" além do tamanho original
- Exportação gera `.webm`, não `.mp4` (ffmpeg.wasm não foi usado)
- Sem autenticação de usuário, sem cobrança/assinatura, sem limite de uso por conta — hoje qualquer pessoa com acesso ao app consome a `OPENAI_API_KEY` configurada
- "Score de Qualidade" nas estatísticas é um cálculo real baseado em quais recursos foram aplicados (legendas, zoom, cor, cortes, resolução) — não é uma avaliação de qualidade de vídeo de verdade (sem análise de nitidez/iluminação etc.)

## Deploy atual (standalone, fora do repositório do CRIE)
https://ai-video-editor-2558r47qy-uelvisongomes-2447s-projects.vercel.app
