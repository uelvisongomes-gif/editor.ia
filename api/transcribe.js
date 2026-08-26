// Transcription endpoint. Whisper cobra por minuto de áudio — a quota
// deste endpoint é transcriptionMinutes.

import { authGuard } from "./_lib/authGuard.js";

export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  if (!process.env.OPENAI_API_KEY) {
    res.status(500).json({
      error: "OPENAI_API_KEY não está configurada nas variáveis de ambiente do projeto na Vercel.",
    });
    return;
  }

  const guard = await authGuard(req, res, { require: "transcriptionMinutes" });
  if (!guard) return;

  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const buffer = Buffer.concat(chunks);

    if (!buffer.length) {
      res.status(400).json({ error: "Nenhum áudio recebido." });
      return;
    }

    const contentType = req.headers["content-type"] || "audio/webm";

    const form = new FormData();
    form.append("file", new Blob([buffer], { type: contentType }), "audio.webm");
    form.append("model", "whisper-1");
    form.append("response_format", "verbose_json");
    form.append("timestamp_granularities[]", "word");
    form.append("temperature", "0");
    form.append(
      "prompt",
      "Transcrição literal de fala em português brasileiro, preservando repetições de palavras, muletas (é, tipo, né), hesitações (ah, uh, hum) e falsos começos exatamente como falados. Não normalize."
    );
    form.append("language", "pt");

    const t0 = Date.now();
    const openaiResp = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: form,
    });

    const data = await openaiResp.json();
    const latencyMs = Date.now() - t0;

    if (!openaiResp.ok) {
      res.status(openaiResp.status).json({ error: data.error?.message || "Falha na transcrição." });
      return;
    }

    const audioMinutes = typeof data.duration === "number" ? data.duration / 60 : 0;
    // Ticka os minutos reais que a OpenAI reportou — cobrança fiel.
    await guard.tick({
      transcriptionMinutes: audioMinutes,
      meta: { audioBytes: buffer.length, latencyMs },
    });

    data._usage = {
      model: "whisper-1",
      audioDurationSec: typeof data.duration === "number" ? data.duration : null,
      audioBytes: buffer.length,
      latencyMs,
    };
    data._quota = guard.quota;
    res.status(200).json(data);
  } catch (err) {
    console.error("Transcription error:", err);
    res.status(500).json({ error: err.message || "Erro interno ao transcrever o áudio." });
  }
}
