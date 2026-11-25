/**
 * Estado mínimo que la API de DeepSeek y Zernio no guardan por nosotros:
 * - traspaso realizado por conversación
 * - pausa del bot cuando un asesor escribe
 * - origen y datos de remarketing por conversación
 * - lista de bajas ("no contactar")
 * - eventos de webhook ya procesados (Zernio puede reenviar duplicados)
 * - registro de bloques de traspaso
 *
 * Usa Upstash Redis / Vercel KV por su API REST (sin dependencias).
 * Sin credenciales usa memoria, útil solo para pruebas locales.
 */

import type { BaseData, ConversationOrigin } from "./context.js";

export interface RemarketingRecord {
  origin: ConversationOrigin;
  baseData: BaseData;
}

export interface HandoffLogEntry {
  at: string;
  conversationId: string;
  phone: string;
  priority: string;
  type: string;
  block: string;
}

export interface Store {
  /** Marca el evento como procesado. Devuelve false si ya lo estaba. */
  claimEvent(eventId: string): Promise<boolean>;
  isHandoffDone(conversationId: string): Promise<boolean>;
  setHandoffDone(conversationId: string): Promise<void>;
  isPaused(conversationId: string): Promise<boolean>;
  pause(conversationId: string, hours: number): Promise<void>;
  getRemarketing(conversationId: string): Promise<RemarketingRecord | null>;
  setRemarketing(conversationId: string, record: RemarketingRecord): Promise<void>;
  isOptedOut(phone: string): Promise<boolean>;
  optOut(phone: string): Promise<void>;
  logHandoff(entry: HandoffLogEntry): Promise<void>;
}

const DAY = 86_400;
const TTL = {
  event: 3 * DAY, // Zernio reintenta hasta ~51 horas
  handoff: 30 * DAY,
  remarketing: 30 * DAY,
};

/** Normaliza teléfonos a solo dígitos para usarlos como clave. */
export function phoneKey(phone: string): string {
  return phone.replace(/\D/g, "");
}

type Command = Array<string | number>;

class RedisRestStore implements Store {
  constructor(private url: string, private token: string) {}

  private async cmd<T = unknown>(command: Command): Promise<T> {
    const res = await fetch(this.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(command),
    });
    if (!res.ok) throw new Error(`Redis ${command[0]} falló: ${res.status} ${await res.text()}`);
    const data = (await res.json()) as { result: T; error?: string };
    if (data.error) throw new Error(`Redis ${command[0]}: ${data.error}`);
    return data.result;
  }

  async claimEvent(eventId: string) {
    const r = await this.cmd(["SET", `evt:${eventId}`, "1", "NX", "EX", TTL.event]);
    return r === "OK";
  }
  async isHandoffDone(id: string) {
    return (await this.cmd(["EXISTS", `conv:${id}:handoff`])) === 1;
  }
  async setHandoffDone(id: string) {
    await this.cmd(["SET", `conv:${id}:handoff`, "1", "EX", TTL.handoff]);
  }
  async isPaused(id: string) {
    return (await this.cmd(["EXISTS", `conv:${id}:paused`])) === 1;
  }
  async pause(id: string, hours: number) {
    await this.cmd(["SET", `conv:${id}:paused`, "1", "EX", Math.max(60, Math.round(hours * 3600))]);
  }
  async getRemarketing(id: string) {
    const raw = await this.cmd<string | null>(["GET", `conv:${id}:remarketing`]);
    return raw ? (JSON.parse(raw) as RemarketingRecord) : null;
  }
  async setRemarketing(id: string, record: RemarketingRecord) {
    await this.cmd(["SET", `conv:${id}:remarketing`, JSON.stringify(record), "EX", TTL.remarketing]);
  }
  async isOptedOut(phone: string) {
    return (await this.cmd(["SISMEMBER", "optout", phoneKey(phone)])) === 1;
  }
  async optOut(phone: string) {
    await this.cmd(["SADD", "optout", phoneKey(phone)]);
  }
  async logHandoff(entry: HandoffLogEntry) {
    await this.cmd(["LPUSH", "handoffs", JSON.stringify(entry)]);
  }
}

export class MemoryStore implements Store {
  private kv = new Map<string, { value: string; expires: number }>();
  private optouts = new Set<string>();
  readonly handoffs: HandoffLogEntry[] = [];
  constructor(private clock: () => number = Date.now) {}

  private get(key: string): string | null {
    const e = this.kv.get(key);
    if (!e) return null;
    if (e.expires <= this.clock()) {
      this.kv.delete(key);
      return null;
    }
    return e.value;
  }
  private set(key: string, value: string, ttlSeconds: number) {
    this.kv.set(key, { value, expires: this.clock() + ttlSeconds * 1000 });
  }

  async claimEvent(eventId: string) {
    if (this.get(`evt:${eventId}`)) return false;
    this.set(`evt:${eventId}`, "1", TTL.event);
    return true;
  }
  async isHandoffDone(id: string) {
    return this.get(`conv:${id}:handoff`) !== null;
  }
  async setHandoffDone(id: string) {
    this.set(`conv:${id}:handoff`, "1", TTL.handoff);
  }
  async isPaused(id: string) {
    return this.get(`conv:${id}:paused`) !== null;
  }
  async pause(id: string, hours: number) {
    this.set(`conv:${id}:paused`, "1", Math.max(60, Math.round(hours * 3600)));
  }
  async getRemarketing(id: string) {
    const raw = this.get(`conv:${id}:remarketing`);
    return raw ? (JSON.parse(raw) as RemarketingRecord) : null;
  }
  async setRemarketing(id: string, record: RemarketingRecord) {
    this.set(`conv:${id}:remarketing`, JSON.stringify(record), TTL.remarketing);
  }
  async isOptedOut(phone: string) {
    return this.optouts.has(phoneKey(phone));
  }
  async optOut(phone: string) {
    this.optouts.add(phoneKey(phone));
  }
  async logHandoff(entry: HandoffLogEntry) {
    this.handoffs.unshift(entry);
  }
}

let shared: Store | null = null;

export function getStore(): Store {
  if (shared) return shared;
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (url && token) {
    shared = new RedisRestStore(url, token);
  } else {
    console.warn("[store] Sin Redis configurado: usando memoria. No use esto en producción.");
    shared = new MemoryStore();
  }
  return shared;
}
