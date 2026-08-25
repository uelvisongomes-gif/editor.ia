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
    const { prompt, maxTokens } = req.body || {};
    if (!prompt || typeof prompt !== "string") {
      res.status(400).json({ error: "Prompt ausente ou inválido." });
      return;
    }

    const openaiResp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        max_tokens: maxTokens || 1500,
        temperature: 0.3,
      }),
    });

    const data = await openaiResp.json();

    if (!openaiResp.ok) {
      res.status(openaiResp.status).json({ error: data.error?.message || "Falha na chamada à IA." });
      return;
    }

    const text = data.choices?.[0]?.message?.content || "";
    res.status(200).json({ text });
  } catch (err) {
    console.error("AI text error:", err);
    res.status(500).json({ error: err.message || "Erro interno ao gerar texto com IA." });
  }
}
