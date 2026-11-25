/** Controles de salida (sección 1.6 de la especificación). */

const CURRENCY_WORDS = "(?:usd|cop|eur|us\\$|d[oó]lares?|pesos?|euros?|millones?|mil(?:lones)?\\s+de\\s+pesos)";

const PRICE_PATTERNS: RegExp[] = [
  // Símbolo o código antes de la cifra: $1.500, US$ 300, USD 2,000, COP 5.000.000, € 40
  /(?:us\s?\$|\$|€|\busd\b|\bcop\b|\beur\b)\s?\d/i,
  // Cifra seguida de moneda: 3.000 dólares, 2,5 millones, 500 USD, 1.200.000 pesos
  new RegExp(`\\d[\\d.,]*\\s?(?:k\\s)?${CURRENCY_WORDS}\\b`, "i"),
];

/** true si el texto parece contener un monto de dinero. */
export function containsPrice(text: string): boolean {
  return PRICE_PATTERNS.some((re) => re.test(text));
}

const INTERNAL_MARKERS = [/#TRASPASO_ASESOR/i, /\bPRIORIDAD\s*:/i, /\bTIPO\s*:/i, /\[\/?CONTEXTO_SISTEMA\]/i];

/** true si el texto contiene restos del bloque interno o del contexto. */
export function containsInternalMarkers(text: string): boolean {
  return INTERNAL_MARKERS.some((re) => re.test(text));
}

export const WHATSAPP_MAX_CHARS = 4096;

/**
 * Divide un texto largo en partes de máximo `max` caracteres,
 * cortando preferiblemente en párrafos, luego en líneas y luego en espacios.
 */
export function splitForWhatsApp(text: string, max = WHATSAPP_MAX_CHARS): string[] {
  const parts: string[] = [];
  let rest = text.trim();
  while (rest.length > max) {
    const window = rest.slice(0, max);
    let cut = window.lastIndexOf("\n\n");
    if (cut < max * 0.5) cut = window.lastIndexOf("\n");
    if (cut < max * 0.5) cut = window.lastIndexOf(" ");
    if (cut <= 0) cut = max;
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}

/** Mensaje estándar cuando la respuesta generada no pasa los filtros. */
export const FALLBACK_MESSAGE =
  "Gracias por su mensaje. Los valores, tiempos y condiciones los confirma nuestro asesor comercial con base en los datos de su solicitud; le responderá por este mismo chat. ¿Hay algún otro dato de su carga que quiera compartirme?";
