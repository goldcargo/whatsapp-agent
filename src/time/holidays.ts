/**
 * Festivos de Colombia (Ley 51 de 1983, "Ley Emiliani").
 *
 * Se calculan para cualquier año, así que no hay tabla que actualizar:
 * - Fijos: se celebran el día exacto.
 * - Trasladables: si no caen en lunes, pasan al lunes siguiente.
 * - Basados en la Pascua: Jueves y Viernes Santo (fijos) y Ascensión,
 *   Corpus Christi y Sagrado Corazón (ya trasladados a lunes).
 *
 * Si el Congreso crea o cambia un festivo, agréguelo aquí.
 */

const FIXED: Array<[month: number, day: number]> = [
  [1, 1], // Año Nuevo
  [5, 1], // Día del Trabajo
  [7, 20], // Independencia
  [8, 7], // Batalla de Boyacá
  [12, 8], // Inmaculada Concepción
  [12, 25], // Navidad
];

const MOVED_TO_MONDAY: Array<[month: number, day: number]> = [
  [1, 6], // Reyes Magos
  [3, 19], // San José
  [6, 29], // San Pedro y San Pablo
  [8, 15], // Asunción de la Virgen
  [10, 12], // Día de la Raza
  [11, 1], // Todos los Santos
  [11, 11], // Independencia de Cartagena
];

/** Días después del Domingo de Pascua (ya en lunes para los trasladados). */
const EASTER_OFFSETS = [
  -3, // Jueves Santo
  -2, // Viernes Santo
  43, // Ascensión del Señor (lunes)
  64, // Corpus Christi (lunes)
  71, // Sagrado Corazón (lunes)
];

/** Fecha en UTC a medianoche, usada solo como "fecha de calendario". */
function utcDate(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day));
}

export function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 86_400_000);
}

function nextMonday(d: Date): Date {
  const dow = d.getUTCDay(); // 0 = domingo, 1 = lunes
  const shift = dow === 1 ? 0 : (8 - dow) % 7;
  return addDays(d, shift);
}

/** Domingo de Pascua (algoritmo anónimo gregoriano / Meeus). */
export function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return utcDate(year, month, day);
}

const cache = new Map<number, Set<string>>();

/** Conjunto de festivos del año en formato YYYY-MM-DD. */
export function colombianHolidays(year: number): Set<string> {
  const cached = cache.get(year);
  if (cached) return cached;

  const days = new Set<string>();
  for (const [m, d] of FIXED) days.add(toIsoDate(utcDate(year, m, d)));
  for (const [m, d] of MOVED_TO_MONDAY) days.add(toIsoDate(nextMonday(utcDate(year, m, d))));
  const easter = easterSunday(year);
  for (const offset of EASTER_OFFSETS) days.add(toIsoDate(addDays(easter, offset)));

  cache.set(year, days);
  return days;
}

/** `isoDate` en formato YYYY-MM-DD (fecha de calendario en Colombia). */
export function isColombianHoliday(isoDate: string): boolean {
  const year = Number(isoDate.slice(0, 4));
  return colombianHolidays(year).has(isoDate);
}
