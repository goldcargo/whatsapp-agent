import {
  formatBogotaDateTime,
  greetingSlot,
  isBusinessHours,
  nextBusinessOpening,
} from "./time/business-hours.js";

export type ConversationOrigin =
  | "ENTRANTE"
  | "REMARKETING_CLIENTE_INACTIVO"
  | "REMARKETING_LEAD_SIN_CERRAR";

export const REMARKETING_ORIGINS: ConversationOrigin[] = [
  "REMARKETING_CLIENTE_INACTIVO",
  "REMARKETING_LEAD_SIN_CERRAR",
];

/** Datos de la base de remarketing (nombre, empresa, ultimo_servicio, fecha_ultima_operacion, correo...). */
export type BaseData = Record<string, string>;

export interface ContextInput {
  now: Date;
  phone: string;
  origin: ConversationOrigin;
  baseData?: BaseData;
  handoffDone: boolean;
}

function formatBaseData(origin: ConversationOrigin, baseData?: BaseData): string {
  if (origin === "ENTRANTE" || !baseData || Object.keys(baseData).length === 0) {
    return "No aplica";
  }
  return Object.entries(baseData)
    .map(([k, v]) => `${k}=${clean(v)}`)
    .join("; ");
}

/** Evita que datos de la base rompan el formato del bloque. */
function clean(value: string): string {
  return String(value)
    .replace(/\[\/?CONTEXTO_SISTEMA\]/g, "")
    .replace(/[\r\n;]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Bloque CONTEXTO_SISTEMA (sección 1.3 de la especificación). */
export function buildSystemContext(input: ContextInput): string {
  const { now } = input;
  return [
    "[CONTEXTO_SISTEMA]",
    `fecha_hora_bogota: ${formatBogotaDateTime(now)}`,
    `franja_saludo: ${greetingSlot(now)}`,
    `horario_habil: ${isBusinessHours(now) ? "SI" : "NO"}`,
    `proximo_horario_habil: ${nextBusinessOpening(now)}`,
    `telefono_whatsapp: ${input.phone || "No disponible"}`,
    `origen_conversacion: ${input.origin}`,
    `datos_base: ${formatBaseData(input.origin, input.baseData)}`,
    `traspaso_realizado: ${input.handoffDone ? "SI" : "NO"}`,
    "[/CONTEXTO_SISTEMA]",
  ].join("\n");
}
