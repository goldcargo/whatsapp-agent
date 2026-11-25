import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { containsInternalMarkers, containsPrice, splitForWhatsApp } from "../src/filters.js";
import { parseHandoff, splitReply } from "../src/handoff.js";
import { attachmentMarkers, senderPhone, verifySignature } from "../src/zernio.js";

const BLOCK = `#TRASPASO_ASESOR
PRIORIDAD: URGENTE
TIPO: RECLAMO
ALERTAS: CARGA ESPECIAL, DATOS OBLIGATORIOS INCOMPLETOS
IDIOMA DEL CLIENTE: Español
--- CONTACTO ---
Nombre: Ana`;

describe("splitReply", () => {
  it("separa el texto del cliente y el bloque", () => {
    const r = splitReply(`Perfecto, Ana. ✅\n${BLOCK}`);
    expect(r.clientText).toBe("Perfecto, Ana. ✅");
    expect(r.handoffBlock?.startsWith("#TRASPASO_ASESOR")).toBe(true);
  });

  it("encuentra la etiqueta en medio de una línea (regla 1)", () => {
    const r = splitReply("Gracias. #TRASPASO_ASESOR PRIORIDAD: NORMAL");
    expect(r.clientText).toBe("Gracias.");
    expect(r.handoffBlock).toBe("#TRASPASO_ASESOR PRIORIDAD: NORMAL");
  });

  it("texto vacío si la respuesta empieza con la etiqueta (regla 2)", () => {
    expect(splitReply(BLOCK).clientText).toBe("");
  });

  it("sin etiqueta no hay traspaso", () => {
    expect(splitReply("Hola").handoffBlock).toBeNull();
  });
});

describe("parseHandoff", () => {
  it("lee prioridad, tipo y alertas", () => {
    const info = parseHandoff(BLOCK);
    expect(info).toMatchObject({
      priority: "URGENTE",
      type: "RECLAMO",
      alerts: ["CARGA ESPECIAL", "DATOS OBLIGATORIOS INCOMPLETOS"],
      isUrgent: true,
      isOptOut: false,
    });
  });

  it("detecta baja y actualización", () => {
    expect(parseHandoff("#TRASPASO_ASESOR\nPRIORIDAD: NORMAL\nTIPO: BAJA_REMARKETING\nALERTAS: Ninguna").isOptOut).toBe(true);
    const upd = parseHandoff("#TRASPASO_ASESOR\nTIPO: ACTUALIZACION\nALERTAS: Ninguna");
    expect(upd.isUpdate).toBe(true);
    expect(upd.alerts).toEqual([]);
  });
});

describe("filtro de precios", () => {
  it.each([
    "El flete cuesta $1.500",
    "Le sale en US$ 300",
    "Son USD 2,000 aproximadamente",
    "COP 5.000.000",
    "otra empresa me dio 3.000 dólares",
    "unos 2 millones de pesos",
    "alrededor de 1.200.000 pesos",
    "500 USD",
    "40 euros",
  ])("bloquea: %s", (text) => {
    expect(containsPrice(text)).toBe(true);
  });

  it.each([
    "Con 15 años de experiencia en logística internacional",
    "¿El contenedor sería de 20 o de 40 pies?",
    "Pesa unos 500 kg, son 12 bultos",
    "Peso: No informado",
    "Exportación a Europa",
    "Nuestro horario es de 8:00 a.m. a 6:00 p.m.",
  ])("permite: %s", (text) => {
    expect(containsPrice(text)).toBe(false);
  });
});

describe("filtro de etiquetas internas", () => {
  it("detecta restos del bloque", () => {
    expect(containsInternalMarkers("TIPO: NUEVO_CLIENTE")).toBe(true);
    expect(containsInternalMarkers("PRIORIDAD: NORMAL")).toBe(true);
    expect(containsInternalMarkers("[CONTEXTO_SISTEMA]")).toBe(true);
    expect(containsInternalMarkers("¿Qué tipo de mercancía es?")).toBe(false);
  });
});

describe("splitForWhatsApp", () => {
  it("no divide textos cortos", () => {
    expect(splitForWhatsApp("hola")).toEqual(["hola"]);
  });

  it("divide en partes de máximo 4.096 caracteres", () => {
    const text = Array.from({ length: 300 }, (_, i) => `Línea número ${i} con algo de texto.`).join("\n");
    const parts = splitForWhatsApp(text);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(4096);
    expect(parts.join("\n")).toBe(text);
  });
});

describe("Zernio", () => {
  it("verifica la firma HMAC-SHA256 del cuerpo crudo", () => {
    const body = '{"id":"evt_1","event":"message.received"}';
    const sig = createHmac("sha256", "secreto").update(body).digest("hex");
    expect(verifySignature(body, sig, "secreto")).toBe(true);
    expect(verifySignature(body, sig, "otro")).toBe(false);
    expect(verifySignature(body + " ", sig, "secreto")).toBe(false);
    expect(verifySignature(body, null, "secreto")).toBe(false);
    expect(verifySignature(body, sig, "")).toBe(false);
  });

  it("obtiene el teléfono del remitente", () => {
    expect(senderPhone({ phoneNumber: "+573001234567", id: "573001234567" })).toBe("+573001234567");
    expect(senderPhone({ id: "573001234567" })).toBe("+573001234567");
    expect(senderPhone({ id: "bsuid_abc" })).toBe("");
  });

  it("genera marcadores de adjuntos", () => {
    expect(
      attachmentMarkers([
        { type: "audio", payload: { voice: true } },
        { type: "file", mimeType: "application/pdf" },
        { type: "image" },
      ]),
    ).toEqual(["[ADJUNTO: audio (nota de voz)]", "[ADJUNTO: documento application/pdf]", "[ADJUNTO: imagen]"]);
  });
});
