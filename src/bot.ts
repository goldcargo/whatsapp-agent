/**
 * Orquestación de GOLD AI para cada evento de Zernio (flujo de la sección 1.1).
 */

import { buildSystemContext, type ConversationOrigin } from "./context.js";
import type { ChatFn, ChatMessage } from "./deepseek.js";
import {
  FALLBACK_MESSAGE,
  containsInternalMarkers,
  containsPrice,
  splitForWhatsApp,
} from "./filters.js";
import { parseHandoff, splitReply, type HandoffInfo } from "./handoff.js";
import type { NotifyFn } from "./notify.js";
import type { Store } from "./store.js";
import {
  messageContent,
  senderPhone,
  type HistoryMessage,
  type ZernioClient,
  type ZernioWebhookEvent,
} from "./zernio.js";

export const HISTORY_LIMIT = 40;

export const TECHNICAL_ERROR_MESSAGE =
  "Gracias por escribirnos. En este momento tenemos una demora técnica; un asesor comercial de GOLDCARGO revisará su mensaje y le responderá por este mismo chat.";

const RETRY_INSTRUCTION =
  "Su respuesta anterior no se envió porque incluía montos de dinero o contenido interno. Reescriba solo el mensaje para el cliente cumpliendo la sección 6 (sin precios, tarifas ni cifras de dinero) y, si corresponde, agregue después el bloque #TRASPASO_ASESOR.";

export interface BotDeps {
  store: Store;
  zernio: ZernioClient;
  chat: ChatFn;
  notify: NotifyFn;
  masterPrompt: string;
  now?: () => Date;
  pauseHours?: number;
  log?: (msg: string, extra?: unknown) => void;
}

export type BotOutcome =
  | "ignored"
  | "paused"
  | "pause_set"
  | "standby"
  | "empty"
  | "replied"
  | "error";

export async function handleEvent(event: ZernioWebhookEvent, deps: BotDeps): Promise<BotOutcome> {
  const log = deps.log ?? ((m, e) => console.log(m, e ?? ""));
  const msg = event.message;
  if (!msg || (msg.platform && msg.platform !== "whatsapp")) return "ignored";

  // Pausa del bot cuando un asesor escribe desde el inbox de Zernio (pendiente 3 de la Parte 5).
  if (event.event === "message.sent") {
    if (msg.sentVia === "human") {
      await deps.store.pause(msg.conversationId, deps.pauseHours ?? 24);
      log("[bot] Asesor escribió; GOLD AI en pausa", { conversationId: msg.conversationId });
      return "pause_set";
    }
    return "ignored";
  }

  if (event.event !== "message.received" || msg.direction !== "incoming") return "ignored";
  if (event.metadata?.standby) return "standby";

  const conversationId = msg.conversationId;
  const accountId = event.account?.accountId ?? "";
  if (await deps.store.isPaused(conversationId)) return "paused";

  const content = messageContent(msg.text, msg.attachments);
  if (!content) return "empty";

  const now = deps.now?.() ?? new Date();
  const phone = senderPhone(msg.sender);

  try {
    const [history, remarketing, handoffDone] = await Promise.all([
      deps.zernio.getHistory(conversationId, accountId, HISTORY_LIMIT + 1),
      deps.store.getRemarketing(conversationId),
      deps.store.isHandoffDone(conversationId),
    ]);
    const origin: ConversationOrigin = remarketing?.origin ?? "ENTRANTE";

    const messages: ChatMessage[] = [
      { role: "system", content: deps.masterPrompt },
      {
        role: "system",
        content: buildSystemContext({
          now,
          phone,
          origin,
          baseData: remarketing?.baseData,
          handoffDone,
        }),
      },
    ];
    // Historial y mensaje actual; si el cliente envió varios mensajes seguidos, quedan en un solo turno "user".
    const conversation = historyToChat(history, msg.id, content);
    appendMessage(conversation, "user", content);
    messages.push(...conversation);

    let reply = await deps.chat(messages);
    let { clientText, handoffBlock } = splitReply(reply);

    if (isUnsafe(clientText)) {
      log("[bot] Respuesta bloqueada por filtro; regenerando", { conversationId });
      reply = await deps.chat([
        ...messages,
        { role: "assistant", content: reply },
        { role: "system", content: RETRY_INSTRUCTION },
      ]);
      const retry = splitReply(reply);
      clientText = isUnsafe(retry.clientText) ? FALLBACK_MESSAGE : retry.clientText;
      handoffBlock = retry.handoffBlock ?? handoffBlock;
    }

    const parts = clientText ? splitForWhatsApp(clientText) : [];
    for (const [i, part] of parts.entries()) {
      await deps.zernio.sendText(conversationId, accountId, part, `${event.id}-${i}`);
    }

    if (handoffBlock) {
      await processHandoff(handoffBlock, { conversationId, accountId, phone, name: msg.sender?.name, now }, deps, log);
    }
    return "replied";
  } catch (err) {
    log("[bot] Error procesando mensaje", { conversationId, error: String(err) });
    await safely(() => deps.zernio.sendText(conversationId, accountId, TECHNICAL_ERROR_MESSAGE, `${event.id}-error`), log);
    await safely(
      () =>
        deps.notify({
          conversationId,
          accountId,
          phone,
          customerName: msg.sender?.name,
          info: technicalErrorInfo(),
          block: `#TRASPASO_ASESOR\nPRIORIDAD: URGENTE\nTIPO: ERROR_TECNICO\n--- OBSERVACIONES ---\nGOLD AI no pudo responder. Último mensaje del cliente:\n${content}\nError: ${String(err)}`,
          at: now.toISOString(),
        }),
      log,
    );
    return "error";
  }
}

function isUnsafe(text: string): boolean {
  return containsPrice(text) || containsInternalMarkers(text);
}

function technicalErrorInfo(): HandoffInfo {
  return { priority: "URGENTE", type: "ERROR_TECNICO", alerts: [], isUrgent: true, isOptOut: false, isUpdate: false };
}

async function processHandoff(
  block: string,
  ctx: { conversationId: string; accountId: string; phone: string; name?: string; now: Date },
  deps: BotDeps,
  log: NonNullable<BotDeps["log"]>,
) {
  const info = parseHandoff(block);
  const at = ctx.now.toISOString();
  await safely(
    () =>
      deps.store.logHandoff({
        at,
        conversationId: ctx.conversationId,
        phone: ctx.phone,
        priority: info.priority,
        type: info.type,
        block,
      }),
    log,
  );
  await safely(() => deps.store.setHandoffDone(ctx.conversationId), log);
  if (info.isOptOut && ctx.phone) {
    await safely(() => deps.store.optOut(ctx.phone), log);
  }
  await safely(
    () =>
      deps.notify({
        conversationId: ctx.conversationId,
        accountId: ctx.accountId,
        phone: ctx.phone,
        customerName: ctx.name,
        info,
        block,
        at,
      }),
    log,
  );
  log("[bot] Traspaso registrado", { conversationId: ctx.conversationId, type: info.type, priority: info.priority });
}

async function safely(fn: () => Promise<unknown>, log: NonNullable<BotDeps["log"]>) {
  try {
    await fn();
  } catch (err) {
    log("[bot] Paso secundario falló", String(err));
  }
}

/**
 * Convierte el historial de Zernio en mensajes user/assistant:
 * quita el mensaje actual (se agrega al final), recorta a HISTORY_LIMIT
 * y une mensajes consecutivos del mismo rol.
 */
export function historyToChat(history: HistoryMessage[], currentId: string, currentContent: string): ChatMessage[] {
  const items = history.filter((h) => h.id !== currentId);
  const last = items[items.length - 1];
  if (last && last.direction === "incoming" && messageContent(last.message ?? last.text, last.attachments) === currentContent) {
    items.pop();
  }

  const out: ChatMessage[] = [];
  for (const h of items.slice(-HISTORY_LIMIT)) {
    const content = messageContent(h.message ?? h.text, h.attachments);
    if (!content) continue;
    appendMessage(out, h.direction === "incoming" ? "user" : "assistant", content);
  }
  return out;
}

/** Agrega un mensaje, uniéndolo con el anterior si es del mismo rol. */
export function appendMessage(list: ChatMessage[], role: "user" | "assistant", content: string): void {
  const prev = list[list.length - 1];
  if (prev && prev.role === role) prev.content += `\n${content}`;
  else list.push({ role, content });
}
