/**
 * Cliente mínimo de Zernio (https://docs.zernio.com).
 * Campos tomados de la documentación de webhooks `message.received` / `message.sent`
 * y de los endpoints de Inbox. Verifique contra la referencia vigente si algo cambia.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

// ---------- Webhooks ----------

export interface ZernioAttachment {
  type: "image" | "video" | "file" | "sticker" | "audio" | "share" | string;
  url?: string;
  originalType?: string;
  mimeType?: string;
  payload?: { voice?: boolean; [k: string]: unknown };
  [k: string]: unknown;
}

export interface ZernioSender {
  id?: string;
  phoneNumber?: string | null;
  businessScopedUserId?: string;
  whatsappUsername?: string;
  name?: string;
  contactId?: string;
}

export interface ZernioMessage {
  id: string;
  conversationId: string;
  platform: string;
  platformMessageId?: string;
  direction: "incoming" | "outgoing";
  text: string | null;
  attachments?: ZernioAttachment[];
  sender?: ZernioSender;
  sentAt?: string;
  /** Solo en salientes: human | api | broadcast | sequence | workflow | ... (null = desconocido). */
  sentVia?: string | null;
}

export interface ZernioWebhookEvent {
  id: string;
  event: string; // "message.received", "message.sent", "webhook.test", ...
  timestamp?: string;
  test?: boolean;
  message?: ZernioMessage;
  conversation?: { id?: string; [k: string]: unknown };
  account?: { accountId?: string; [k: string]: unknown };
  metadata?: { standby?: boolean; [k: string]: unknown } | null;
}

/**
 * X-Zernio-Signature = HMAC-SHA256 en hexadecimal del cuerpo CRUDO, con el secreto del webhook.
 */
export function verifySignature(rawBody: string, signature: string | null, secret: string): boolean {
  if (!signature || !secret) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature.trim().toLowerCase(), "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Teléfono E.164 del remitente (con "+"), o "" si solo hay usuario. */
export function senderPhone(sender?: ZernioSender): string {
  if (sender?.phoneNumber) return sender.phoneNumber;
  if (sender?.id && /^\d{7,15}$/.test(sender.id)) return `+${sender.id}`;
  return "";
}

/** Marcadores [ADJUNTO: ...] para el modelo (sección 1.3). */
export function attachmentMarkers(attachments: ZernioAttachment[] = []): string[] {
  return attachments.map((a) => {
    const mime = a.mimeType ? ` ${a.mimeType}` : "";
    switch (a.type) {
      case "audio":
        return a.payload?.voice ? "[ADJUNTO: audio (nota de voz)]" : "[ADJUNTO: audio]";
      case "image":
        return "[ADJUNTO: imagen]";
      case "video":
        return "[ADJUNTO: video]";
      case "sticker":
        return "[ADJUNTO: sticker]";
      case "file":
        return `[ADJUNTO: documento${mime}]`;
      case "share":
        return "[ADJUNTO: ubicación o contenido compartido]";
      default:
        return `[ADJUNTO: ${a.originalType ?? a.type}${mime}]`;
    }
  });
}

/** Texto del mensaje + marcadores de adjuntos, o "" si no hay nada. */
export function messageContent(text: string | null | undefined, attachments?: ZernioAttachment[]): string {
  return [text?.trim() ?? "", ...attachmentMarkers(attachments)].filter(Boolean).join("\n");
}

// ---------- API ----------

export interface HistoryMessage {
  id?: string;
  direction: "incoming" | "outgoing";
  message?: string | null;
  text?: string | null;
  attachments?: ZernioAttachment[];
  createdAt?: string;
  sentVia?: string | null;
}

export interface ZernioClient {
  sendText(conversationId: string, accountId: string, text: string, idempotencyKey?: string): Promise<void>;
  /** Últimos `limit` mensajes en orden cronológico. */
  getHistory(conversationId: string, accountId: string, limit: number): Promise<HistoryMessage[]>;
  /** Abre una conversación con plantilla aprobada. Devuelve el conversationId. */
  startTemplateConversation(input: {
    accountId: string;
    participantId: string;
    templateName: string;
    templateLanguage: string;
    templateParams?: unknown;
  }): Promise<string>;
}

export function createZernioClient(
  apiKey = process.env.ZERNIO_API_KEY ?? "",
  baseUrl = process.env.ZERNIO_BASE_URL || "https://zernio.com/api/v1",
): ZernioClient {
  async function call<T>(method: string, path: string, body?: unknown, extraHeaders: Record<string, string> = {}): Promise<T> {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        ...extraHeaders,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    const textBody = await res.text();
    if (!res.ok) throw new Error(`Zernio ${method} ${path} → ${res.status}: ${textBody.slice(0, 500)}`);
    return (textBody ? JSON.parse(textBody) : {}) as T;
  }

  return {
    async sendText(conversationId, accountId, text, idempotencyKey) {
      await call(
        "POST",
        `/inbox/conversations/${encodeURIComponent(conversationId)}/messages`,
        { accountId, message: text },
        idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {},
      );
    },

    async getHistory(conversationId, accountId, limit) {
      const qs = new URLSearchParams({
        accountId,
        limit: String(Math.min(100, limit)),
        sortOrder: "desc",
      });
      const data = await call<{ messages?: HistoryMessage[]; data?: { messages?: HistoryMessage[] } }>(
        "GET",
        `/inbox/conversations/${encodeURIComponent(conversationId)}/messages?${qs}`,
      );
      const messages = data.messages ?? data.data?.messages ?? [];
      return messages.slice().reverse();
    },

    async startTemplateConversation(input) {
      const data = await call<{ data?: { conversationId?: string }; conversationId?: string }>(
        "POST",
        "/inbox/conversations",
        input,
      );
      const id = data.data?.conversationId ?? data.conversationId;
      if (!id) throw new Error("Zernio no devolvió conversationId al abrir la conversación");
      return id;
    },
  };
}
