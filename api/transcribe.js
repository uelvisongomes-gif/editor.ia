// Transcription endpoint. Whisper's verbose_json includes duration; we
// return it separately so the client can bill by minute (Whisper is
// per-minute-of-audio, not per-token).

export const config = {
  api: {
    bodyParser: false,
  },
};

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
    // Baixa temperatura para reduzir "criatividade" do Whisper — melhora
    // fidelidade e tende a manter gagueiras/muletas em vez de suavizar.
    form.append("temperature", "0");
    // Prompt de estilo: reforça que a transcrição deve preservar
    // disfluências. Whisper usa este texto como pista de estilo/vocabulário.
    // Ele NÃO é adicionado ao output — só influencia como o modelo decodifica.
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

    // Attach billing hints without changing the existing shape the client already reads.
    data._usage = {
      model: "whisper-1",
      audioDurationSec: typeof data.duration === "number" ? data.duration : null,
      audioBytes: buffer.length,
      latencyMs,
    };
    res.status(200).json(data);
  } catch (err) {
    console.error("Transcription error:", err);
    res.status(500).json({ error: err.message || "Erro interno ao transcrever o áudio." });
  }
}
