/** Llamada a DeepSeek (API compatible con OpenAI). Configuración: sección 1.2. */

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export type ChatFn = (messages: ChatMessage[]) => Promise<string>;

export function createDeepSeekChat(
  apiKey = process.env.DEEPSEEK_API_KEY ?? "",
  model = process.env.DEEPSEEK_MODEL || "deepseek-flash",
  baseUrl = process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com",
): ChatFn {
  return async (messages) => {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.4,
        max_tokens: 800,
        stream: false,
        // Razonamiento desactivado: en WhatsApp importa más la velocidad.
        thinking: { type: "disabled" },
      }),
      signal: AbortSignal.timeout(40_000),
    });
    const body = await res.text();
    if (!res.ok) throw new Error(`DeepSeek ${res.status}: ${body.slice(0, 500)}`);
    const data = JSON.parse(body) as { choices?: Array<{ message?: { content?: string | null } }> };
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error("DeepSeek devolvió una respuesta vacía");
    return content;
  };
}
