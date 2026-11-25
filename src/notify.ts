/**
 * Entrega del bloque #TRASPASO_ASESOR al equipo comercial.
 *
 * Zernio no documenta un endpoint de notas internas ni de asignación,
 * así que el bloque se envía por POST JSON a la URL configurada
 * (Slack / Google Chat / Teams vía Make, Zapier, n8n, etc.).
 */

import type { HandoffInfo } from "./handoff.js";

export interface HandoffNotice {
  conversationId: string;
  accountId: string;
  phone: string;
  customerName?: string;
  info: HandoffInfo;
  block: string;
  at: string;
}

export type NotifyFn = (notice: HandoffNotice) => Promise<void>;

export function createWebhookNotifier(
  url = process.env.ADVISOR_WEBHOOK_URL ?? "",
  urgentUrl = process.env.URGENT_WEBHOOK_URL ?? "",
): NotifyFn {
  return async (notice) => {
    const target = notice.info.isUrgent && urgentUrl ? urgentUrl : url;
    if (!target) {
      console.warn("[notify] ADVISOR_WEBHOOK_URL no configurada; el traspaso solo quedó en el registro.");
      return;
    }
    const header = notice.info.isUrgent ? "🚨 URGENTE — " : "";
    const title = `${header}${notice.info.type} · ${notice.customerName || notice.phone || notice.conversationId}`;
    const res = await fetch(target, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        // "text" lo entienden directamente los webhooks entrantes de Slack y Google Chat.
        text: `*${title}*\nConversación Zernio: ${notice.conversationId}\n\n${notice.block}`,
        conversationId: notice.conversationId,
        accountId: notice.accountId,
        phone: notice.phone,
        priority: notice.info.priority,
        type: notice.info.type,
        alerts: notice.info.alerts,
        block: notice.block,
        at: notice.at,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Notificación al asesor falló: ${res.status} ${await res.text()}`);
  };
}
