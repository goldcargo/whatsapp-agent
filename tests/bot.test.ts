import { describe, expect, it, vi } from "vitest";
import { FALLBACK_MESSAGE } from "../src/filters.js";
import { TECHNICAL_ERROR_MESSAGE, handleEvent, historyToChat, type BotDeps } from "../src/bot.js";
import type { ChatMessage } from "../src/deepseek.js";
import type { HandoffNotice } from "../src/notify.js";
import { loadMasterPrompt } from "../src/prompt.js";
import { MemoryStore } from "../src/store.js";
import type { HistoryMessage, ZernioClient, ZernioWebhookEvent } from "../src/zernio.js";

const NOW = new Date("2026-11-24T21:02:00-05:00"); // martes, fuera de horario

function incoming(text: string | null, extra: Partial<ZernioWebhookEvent> = {}): ZernioWebhookEvent {
  return {
    id: `evt_${Math.random()}`,
    event: "message.received",
    message: {
      id: "msg_current",
      conversationId: "conv_1",
      platform: "whatsapp",
      direction: "incoming",
      text,
      sender: { id: "573001234567", phoneNumber: "+573001234567", name: "Ana" },
    },
    account: { accountId: "acc_1" },
    ...extra,
  };
}

function setup(replies: Array<string | Error>, history: HistoryMessage[] = []) {
  const store = new MemoryStore(() => NOW.getTime());
  const sent: string[] = [];
  const prompts: ChatMessage[][] = [];
  const notices: HandoffNotice[] = [];
  const zernio: ZernioClient = {
    sendText: vi.fn(async (_c, _a, text) => {
      sent.push(text);
    }),
    getHistory: vi.fn(async () => history),
    startTemplateConversation: vi.fn(async () => "conv_new"),
  };
  const queue = [...replies];
  const deps: BotDeps = {
    store,
    zernio,
    chat: async (messages) => {
      prompts.push(messages.map((m) => ({ ...m })));
      const next = queue.shift();
      if (next === undefined) throw new Error("sin respuesta preparada");
      if (next instanceof Error) throw next;
      return next;
    },
    notify: async (n) => {
      notices.push(n);
    },
    masterPrompt: "PROMPT",
    now: () => NOW,
    log: () => {},
  };
  return { deps, store, sent, prompts, notices, zernio };
}

describe("handleEvent", () => {
  it("arma la llamada en el orden de la sección 1.2 y responde", async () => {
    const t = setup(["Buenas noches, le saluda GOLD AI 🚢 ¿En qué podemos ayudarle?"], [
      { id: "m1", direction: "incoming", message: "Hola" },
      { id: "m2", direction: "outgoing", message: "Buenas noches" },
      { id: "msg_current", direction: "incoming", message: "Necesito importar" },
    ]);
    expect(await handleEvent(incoming("Necesito importar"), t.deps)).toBe("replied");
    const call = t.prompts[0]!;
    expect(call.map((m) => m.role)).toEqual(["system", "system", "user", "assistant", "user"]);
    expect(call[0]!.content).toBe("PROMPT");
    expect(call[1]!.content).toContain("horario_habil: NO");
    expect(call[1]!.content).toContain("telefono_whatsapp: +573001234567");
    expect(call[4]!.content).toBe("Necesito importar");
    expect(t.sent).toEqual(["Buenas noches, le saluda GOLD AI 🚢 ¿En qué podemos ayudarle?"]);
  });

  it("nunca envía el bloque al cliente y lo entrega al asesor (caso 17)", async () => {
    const t = setup(["Perfecto, Ana. ✅\n#TRASPASO_ASESOR\nPRIORIDAD: NORMAL\nTIPO: NUEVO_CLIENTE\nALERTAS: Ninguna"]);
    await handleEvent(incoming("ana@empresa.com"), t.deps);
    expect(t.sent).toEqual(["Perfecto, Ana. ✅"]);
    expect(t.notices).toHaveLength(1);
    expect(t.notices[0]!.block.startsWith("#TRASPASO_ASESOR")).toBe(true);
    expect(t.store.handoffs).toHaveLength(1);
    expect(await t.store.isHandoffDone("conv_1")).toBe(true);
  });

  it("envía traspaso_realizado: SI después del primer traspaso (regla 6)", async () => {
    const t = setup(["Con gusto."]);
    await t.store.setHandoffDone("conv_1");
    await handleEvent(incoming("¿Cuándo me responden?"), t.deps);
    expect(t.prompts[0]![1]!.content).toContain("traspaso_realizado: SI");
  });

  it("marca urgente en reclamos (caso 7)", async () => {
    const t = setup(["Lamento mucho la situación.\n#TRASPASO_ASESOR\nPRIORIDAD: URGENTE\nTIPO: RECLAMO\nALERTAS: Ninguna"]);
    await handleEvent(incoming("Mi carga llegó dañada"), t.deps);
    expect(t.notices[0]!.info.isUrgent).toBe(true);
  });

  it("registra la baja de remarketing (caso 10)", async () => {
    const t = setup(["Entendido, Ana.\n#TRASPASO_ASESOR\nPRIORIDAD: NORMAL\nTIPO: BAJA_REMARKETING\nALERTAS: Ninguna"]);
    await handleEvent(incoming("No me escriban más"), t.deps);
    expect(await t.store.isOptedOut("+573001234567")).toBe(true);
  });

  it("regenera si la respuesta trae un precio y luego la envía (filtro 1.6)", async () => {
    const t = setup(["Le cuesta unos 3.000 dólares", "Los valores los calcula nuestro asesor comercial."]);
    await handleEvent(incoming("deme un aproximado"), t.deps);
    expect(t.prompts).toHaveLength(2);
    expect(t.sent).toEqual(["Los valores los calcula nuestro asesor comercial."]);
  });

  it("envía el mensaje estándar si la regeneración también trae precio", async () => {
    const t = setup(["USD 500", "Unos 400 dólares"]);
    await handleEvent(incoming("deme un aproximado"), t.deps);
    expect(t.sent).toEqual([FALLBACK_MESSAGE]);
  });

  it("no responde mientras un asesor atiende la conversación", async () => {
    const t = setup(["no debería usarse"]);
    const humanSent: ZernioWebhookEvent = {
      id: "evt_h",
      event: "message.sent",
      message: { id: "m_h", conversationId: "conv_1", platform: "whatsapp", direction: "outgoing", text: "Hola, soy su asesor", sentVia: "human" },
    };
    expect(await handleEvent(humanSent, t.deps)).toBe("pause_set");
    expect(await handleEvent(incoming("Gracias"), t.deps)).toBe("paused");
    expect(t.sent).toEqual([]);
  });

  it("ignora los mensajes que envía el propio bot por la API", async () => {
    const t = setup([]);
    const apiSent: ZernioWebhookEvent = {
      id: "evt_a",
      event: "message.sent",
      message: { id: "m_a", conversationId: "conv_1", platform: "whatsapp", direction: "outgoing", text: "x", sentVia: "api" },
    };
    expect(await handleEvent(apiSent, t.deps)).toBe("ignored");
    expect(await t.store.isPaused("conv_1")).toBe(false);
  });

  it("usa el origen y los datos de remarketing guardados", async () => {
    const t = setup(["Es un gusto volver a saludarle."]);
    await t.store.setRemarketing("conv_1", {
      origin: "REMARKETING_LEAD_SIN_CERRAR",
      baseData: { nombre: "Ana", empresa: "Andes SAS" },
    });
    await handleEvent(incoming("Sí, sigue vigente"), t.deps);
    expect(t.prompts[0]![1]!.content).toContain("origen_conversacion: REMARKETING_LEAD_SIN_CERRAR");
    expect(t.prompts[0]![1]!.content).toContain("datos_base: nombre=Ana; empresa=Andes SAS");
  });

  it("pasa los adjuntos como marcadores (caso 16)", async () => {
    const t = setup(["Gracias, el asesor lo revisará."]);
    const ev = incoming(null);
    ev.message!.attachments = [{ type: "file", mimeType: "application/pdf" }];
    await handleEvent(ev, t.deps);
    expect(t.prompts[0]!.at(-1)!.content).toBe("[ADJUNTO: documento application/pdf]");
  });

  it("ante un error técnico avisa al cliente y al asesor", async () => {
    const t = setup([new Error("DeepSeek 503")]);
    expect(await handleEvent(incoming("Hola"), t.deps)).toBe("error");
    expect(t.sent).toEqual([TECHNICAL_ERROR_MESSAGE]);
    expect(t.notices[0]!.info.type).toBe("ERROR_TECNICO");
  });

  it("ignora mensajes en standby", async () => {
    const t = setup([]);
    expect(await handleEvent(incoming("Hola", { metadata: { standby: true } }), t.deps)).toBe("standby");
  });
});

describe("historyToChat", () => {
  it("quita el mensaje actual, une roles repetidos y recorta a 40", () => {
    const history: HistoryMessage[] = [
      ...Array.from({ length: 50 }, (_, i): HistoryMessage => ({
        id: `h${i}`,
        direction: i % 2 === 0 ? "incoming" : "outgoing",
        message: `m${i}`,
      })),
      { id: "x1", direction: "outgoing", message: "a" },
      { id: "x2", direction: "outgoing", message: "b" },
      { id: "cur", direction: "incoming", message: "actual" },
    ];
    const chat = historyToChat(history, "cur", "actual");
    expect(chat.at(-1)).toEqual({ role: "assistant", content: "m49\na\nb" });
    expect(chat.every((m, i) => i === 0 || m.role !== chat[i - 1]!.role)).toBe(true);
    expect(chat.some((m) => m.content.includes("actual"))).toBe(false);
  });
});

describe("prompt maestro", () => {
  it("carga el archivo completo", () => {
    const p = loadMasterPrompt();
    expect(p.startsWith("# 1. IDENTIDAD")).toBe(true);
    expect(p).toContain("# 10. FORMATO DEL BLOQUE #TRASPASO_ASESOR");
    expect(p).toContain("## Ejemplo C — Reclamo");
  });
});
