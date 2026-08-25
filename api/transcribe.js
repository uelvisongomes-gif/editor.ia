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

    const openaiResp = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: form,
    });

    const data = await openaiResp.json();

    if (!openaiResp.ok) {
      res.status(openaiResp.status).json({ error: data.error?.message || "Falha na transcrição." });
      return;
    }

    res.status(200).json(data);
  } catch (err) {
    console.error("Transcription error:", err);
    res.status(500).json({ error: err.message || "Erro interno ao transcrever o áudio." });
  }
}
