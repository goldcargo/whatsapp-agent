/**
 * POST /api/remarketing — inicia una conversación de remarketing con una plantilla aprobada por Meta.
 *
 * Header: Authorization: Bearer <ADMIN_API_KEY>
 * Body:
 * {
 *   "phone": "+573001234567",
 *   "origin": "REMARKETING_CLIENTE_INACTIVO" | "REMARKETING_LEAD_SIN_CERRAR",
 *   "templateName": "goldcargo_reactivacion_01",
 *   "templateLanguage": "es",              // opcional, por defecto "es"
 *   "templateParams": [...],               // formato de parámetros de Zernio
 *   "baseData": { "nombre": "...", "empresa": "...", "ultimo_servicio": "...",
 *                 "fecha_ultima_operacion": "...", "correo": "..." },
 *   "accountId": "..."                      // opcional, por defecto ZERNIO_ACCOUNT_ID
 * }
 *
 * - Rechaza contactos dados de baja (BAJA_REMARKETING).
 * - Guarda origen y datos_base para que GOLD AI los reciba en el CONTEXTO_SISTEMA
 *   cuando el cliente responda.
 * - Solo envíe a contactos con autorización vigente de tratamiento de datos (Parte 5).
 */

import { timingSafeEqual } from "node:crypto";
import { REMARKETING_ORIGINS, type BaseData, type ConversationOrigin } from "../src/context.js";
import { getStore, phoneKey } from "../src/store.js";
import { createZernioClient } from "../src/zernio.js";

interface RemarketingBody {
  phone?: string;
  origin?: ConversationOrigin;
  templateName?: string;
  templateLanguage?: string;
  templateParams?: unknown;
  baseData?: BaseData;
  accountId?: string;
}

function authorized(request: Request): boolean {
  const key = process.env.ADMIN_API_KEY ?? "";
  const header = request.headers.get("authorization") ?? "";
  const given = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!key || !given) return false;
  const a = Buffer.from(key);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request): Promise<Response> {
  if (!authorized(request)) return new Response("unauthorized", { status: 401 });

  let body: RemarketingBody;
  try {
    body = (await request.json()) as RemarketingBody;
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400 });
  }

  const participantId = phoneKey(body.phone ?? "");
  const accountId = body.accountId || process.env.ZERNIO_ACCOUNT_ID || "";
  if (!participantId || !body.templateName || !accountId) {
    return Response.json({ error: "Faltan phone, templateName o accountId" }, { status: 400 });
  }
  if (!body.origin || !REMARKETING_ORIGINS.includes(body.origin)) {
    return Response.json({ error: `origin debe ser uno de: ${REMARKETING_ORIGINS.join(", ")}` }, { status: 400 });
  }

  const store = getStore();
  if (await store.isOptedOut(participantId)) {
    return Response.json({ skipped: true, reason: "Contacto dado de baja (no contactar)" }, { status: 409 });
  }

  const conversationId = await createZernioClient().startTemplateConversation({
    accountId,
    participantId,
    templateName: body.templateName,
    templateLanguage: body.templateLanguage || "es",
    templateParams: body.templateParams,
  });

  await store.setRemarketing(conversationId, { origin: body.origin, baseData: body.baseData ?? {} });
  return Response.json({ ok: true, conversationId });
}
