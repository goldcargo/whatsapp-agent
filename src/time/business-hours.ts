import { isColombianHoliday } from "./holidays.js";

/**
 * Colombia (America/Bogota) usa UTC-5 todo el año, sin horario de verano,
 * así que basta con restar 5 horas y leer los campos UTC.
 */
const BOGOTA_OFFSET_MS = -5 * 60 * 60 * 1000;

const DAYS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MONTHS = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

/** Hora de apertura de los asesores (8:00 a.m.) para todos los días hábiles. */
const OPEN_MINUTES = 8 * 60;

export interface BogotaClock {
  year: number;
  month: number; // 1-12
  day: number;
  weekday: number; // 0 = domingo
  hour: number;
  minute: number;
  isoDate: string; // YYYY-MM-DD
}

export function bogotaClock(now: Date): BogotaClock {
  const b = new Date(now.getTime() + BOGOTA_OFFSET_MS);
  return {
    year: b.getUTCFullYear(),
    month: b.getUTCMonth() + 1,
    day: b.getUTCDate(),
    weekday: b.getUTCDay(),
    hour: b.getUTCHours(),
    minute: b.getUTCMinutes(),
    isoDate: b.toISOString().slice(0, 10),
  };
}

/** Minuto de cierre del día (exclusivo), o null si ese día no hay asesores. */
function closeMinutes(weekday: number, isoDate: string): number | null {
  if (weekday === 0 || isColombianHoliday(isoDate)) return null;
  if (weekday === 6) return 12 * 60; // sábado hasta 12:00 m.
  return 18 * 60; // lunes a viernes hasta 6:00 p.m.
}

export function isBusinessHours(now: Date): boolean {
  const c = bogotaClock(now);
  const close = closeMinutes(c.weekday, c.isoDate);
  if (close === null) return false;
  const minutes = c.hour * 60 + c.minute;
  return minutes >= OPEN_MINUTES && minutes < close;
}

export type GreetingSlot = "MAÑANA" | "TARDE" | "NOCHE";

export function greetingSlot(now: Date): GreetingSlot {
  const { hour } = bogotaClock(now);
  if (hour >= 5 && hour < 12) return "MAÑANA";
  if (hour >= 12 && hour < 19) return "TARDE";
  return "NOCHE";
}

/** Ej.: "9:02 p.m.", "8:00 a.m.", "12:00 m." */
export function formatTime(hour: number, minute: number): string {
  const mm = String(minute).padStart(2, "0");
  if (hour === 12 && minute === 0) return "12:00 m.";
  const suffix = hour < 12 ? "a.m." : "p.m.";
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}:${mm} ${suffix}`;
}

function formatDate(c: Pick<BogotaClock, "weekday" | "day" | "month" | "year">): string {
  return `${DAYS[c.weekday]} ${c.day} de ${MONTHS[c.month - 1]} de ${c.year}`;
}

/** Ej.: "martes 24 de noviembre de 2026, 9:02 p.m." */
export function formatBogotaDateTime(now: Date): string {
  const c = bogotaClock(now);
  return `${formatDate(c)}, ${formatTime(c.hour, c.minute)}`;
}

/**
 * Próxima apertura de los asesores, saltando domingos y festivos.
 * Ej.: "miércoles 25 de noviembre de 2026 a partir de las 8:00 a.m."
 * Si ahora es horario hábil, indica que la atención está en curso.
 */
export function nextBusinessOpening(now: Date): string {
  if (isBusinessHours(now)) {
    return "en este momento (horario hábil en curso)";
  }
  const today = bogotaClock(now);
  const minutesNow = today.hour * 60 + today.minute;
  const todayStart = Date.UTC(today.year, today.month - 1, today.day);

  for (let offset = 0; offset < 30; offset++) {
    if (offset === 0 && minutesNow >= OPEN_MINUTES) continue; // ya pasó la apertura de hoy
    const day = new Date(todayStart + offset * 86_400_000);
    const iso = day.toISOString().slice(0, 10);
    const weekday = day.getUTCDay();
    if (closeMinutes(weekday, iso) === null) continue;
    const label = formatDate({
      weekday,
      day: day.getUTCDate(),
      month: day.getUTCMonth() + 1,
      year: day.getUTCFullYear(),
    });
    return `${label} a partir de las ${formatTime(8, 0)}`;
  }
  throw new Error("No se encontró un día hábil en los próximos 30 días");
}
