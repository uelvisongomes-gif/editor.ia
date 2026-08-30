// Backend proxy pra semantic check da Fase 5.
// Usa OpenAI gpt-4o-mini (barato + rápido). Cai pra Anthropic se OpenAI falhar.

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });
  const { prompt, maxTokens = 400 } = req.body || {};
  if (!prompt) return res.status(400).json({ error: "no_prompt" });

  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) return res.status(200).json({ content: '{"issues":[]}', usage: null, provider: "none" });

  try {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openaiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "Você é um assistente que analisa transcripts de vídeo. Responde SEMPRE JSON puro, sem markdown." },
          { role: "user", content: prompt },
        ],
        temperature: 0,
        max_tokens: maxTokens,
        response_format: { type: "json_object" },
      }),
    });
    if (!r.ok) return res.status(502).json({ error: "openai_error", status: r.status });
    const data = await r.json();
    const content = data.choices?.[0]?.message?.content || '{"issues":[]}';
    const usage = data.usage
      ? { promptTokens: data.usage.prompt_tokens, completionTokens: data.usage.completion_tokens, model: "gpt-4o-mini" }
      : null;
    return res.status(200).json({ content, usage, provider: "openai" });
  } catch (err) {
    return res.status(500).json({ error: "fetch_failed", message: err.message });
  }
}
