import { readFileSync } from "node:fs";
import { join } from "node:path";

let cached: string | null = null;

/** Prompt maestro (Parte 2), cargado desde prompts/prompt-maestro.md. */
export function loadMasterPrompt(): string {
  if (cached) return cached;
  const text = readFileSync(join(process.cwd(), "prompts", "prompt-maestro.md"), "utf8").trim();
  if (text.includes("[PENDIENTE: HABEAS DATA")) {
    console.warn(
      "[prompt] El bloque [PENDIENTE: HABEAS DATA] sigue sin completar. No ponga GOLD AI en producción hasta reemplazarlo (Parte 5 de la especificación).",
    );
  }
  cached = text;
  return text;
}
