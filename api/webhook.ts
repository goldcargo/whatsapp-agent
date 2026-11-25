/**
 * POST /api/webhook — recibe los eventos de Zernio.
 *
 * Registre esta URL en Zernio (dashboard → Webhooks, o POST /v1/webhooks/settings)
 * con los eventos "message.received" y "message.sent" y el mismo secreto que
 * ZERNIO_WEBHOOK_SECRET.
 *
 * Zernio exige respuesta 2xx en menos de 5 segundos: se valida la firma, se
 * descarta el duplicado y se responde de inmediato; el trabajo con DeepSeek
 * continúa en segundo plano con waitUntil.
 */

import { waitUntil } from "@vercel/functions";
import { handleEvent } from "../src/bot.js";
import { createDeepSeekChat } from "../src/deepseek.js";
import { createWebhookNotifier } from "../src/notify.js";
import { loadMasterPrompt } from "../src/prompt.js";
import { getStore } from "../src/store.js";
import { createZernioClient, verifySignature, type ZernioWebhookEvent } from "../src/zernio.js";

export async function POST(request: Request): Promise<Response> {
  const raw = await request.text();
  const secret = process.env.ZERNIO_WEBHOOK_SECRET ?? "";
  if (!verifySignature(raw, request.headers.get("x-zernio-signature"), secret)) {
    return new Response("invalid signature", { status: 401 });
  }

  let event: ZernioWebhookEvent;
  try {
    event = JSON.parse(raw) as ZernioWebhookEvent;
  } catch {
    return new Response("invalid json", { status: 400 });
  }

  if (event.event === "webhook.test" || event.test) {
    return Response.json({ ok: true, test: true });
  }

  const store = getStore();
  const eventId = event.id || request.headers.get("x-zernio-event-id") || "";
  if (eventId && !(await store.claimEvent(eventId))) {
    return Response.json({ ok: true, duplicate: true });
  }

  waitUntil(
    handleEvent(event, {
      store,
      zernio: createZernioClient(),
      chat: createDeepSeekChat(),
      notify: createWebhookNotifier(),
      masterPrompt: loadMasterPrompt(),
      pauseHours: Number(process.env.BOT_PAUSE_HOURS || 24),
    }).catch((err) => console.error("[webhook] Error no controlado", err)),
  );

  return Response.json({ ok: true });
}

export function GET(): Response {
  return Response.json({ ok: true, service: "GOLD AI webhook" });
}
