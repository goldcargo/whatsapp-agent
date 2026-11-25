/** Protocolo #TRASPASO_ASESOR (sección 1.4 de la especificación). */

export const HANDOFF_TAG = "#TRASPASO_ASESOR";

export interface SplitReply {
  /** Texto para el cliente (todo lo anterior a la etiqueta). Puede ser "". */
  clientText: string;
  /** Bloque para el asesor desde la etiqueta inclusive, o null si no hay traspaso. */
  handoffBlock: string | null;
}

/** Busca la etiqueta en cualquier posición (regla 1), sin importar mayúsculas. */
export function splitReply(reply: string): SplitReply {
  const idx = reply.toUpperCase().indexOf(HANDOFF_TAG);
  if (idx === -1) return { clientText: reply.trim(), handoffBlock: null };
  return {
    clientText: reply.slice(0, idx).trim(),
    handoffBlock: reply.slice(idx).trim(),
  };
}

export interface HandoffInfo {
  priority: "NORMAL" | "URGENTE";
  type: string;
  alerts: string[];
  isUrgent: boolean;
  isOptOut: boolean;
  isUpdate: boolean;
}

function field(block: string, name: string): string | null {
  const re = new RegExp(`^\\s*${name}\\s*:\\s*(.+)$`, "im");
  const m = block.match(re);
  return m?.[1]?.trim() ?? null;
}

export function parseHandoff(block: string): HandoffInfo {
  const priorityRaw = (field(block, "PRIORIDAD") ?? "").toUpperCase();
  const type = (field(block, "TIPO") ?? "NO_INFORMADO").toUpperCase().split(/\s+/)[0] ?? "NO_INFORMADO";
  const alertsRaw = field(block, "ALERTAS") ?? "";
  const alerts = alertsRaw
    .split(",")
    .map((a) => a.trim())
    .filter((a) => a && a.toLowerCase() !== "ninguna");
  const isUrgent = priorityRaw.includes("URGENTE");
  return {
    priority: isUrgent ? "URGENTE" : "NORMAL",
    type,
    alerts,
    isUrgent,
    isOptOut: type === "BAJA_REMARKETING",
    isUpdate: type === "ACTUALIZACION",
  };
}
