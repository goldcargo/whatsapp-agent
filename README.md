# whatsapp-agent — GOLD AI

Asistente virtual de GOLDCARGO en WhatsApp Business.
**Arquitectura:** Zernio (WhatsApp) → función en Vercel → DeepSeek → Zernio.

- Especificación completa: [`docs/especificacion-gold-ai.md`](docs/especificacion-gold-ai.md)
- Prompt maestro (lo que carga el código): [`prompts/prompt-maestro.md`](prompts/prompt-maestro.md)

> ⚠️ **No poner en producción** hasta reemplazar el bloque `[PENDIENTE: HABEAS DATA]` del prompt
> (Ley 1581 de 2012) y confirmar la autorización de las bases de remarketing (Parte 5).

## Cómo funciona

| Archivo | Qué hace |
|---|---|
| `api/webhook.ts` | Recibe los eventos de Zernio, valida la firma `X-Zernio-Signature`, descarta duplicados y responde en menos de 5 s; el trabajo sigue en segundo plano (`waitUntil`). |
| `src/bot.ts` | Arma la llamada (prompt maestro + `CONTEXTO_SISTEMA` + últimos 40 mensajes + mensaje nuevo), llama a DeepSeek, separa el texto del cliente del bloque `#TRASPASO_ASESOR`, aplica los filtros y envía. |
| `src/context.ts`, `src/time/` | Genera el `CONTEXTO_SISTEMA`: hora de Bogotá, franja de saludo, horario hábil y próxima apertura. Los festivos de Colombia (Ley Emiliani y Semana Santa) se calculan solos para cualquier año. |
| `src/handoff.ts` | Busca `#TRASPASO_ASESOR` en cualquier posición y lee `PRIORIDAD`, `TIPO` y `ALERTAS`. |
| `src/filters.ts` | Filtro de precios (regenera una vez y si no, envía un mensaje estándar), filtro de etiquetas internas y división de mensajes de más de 4.096 caracteres. |
| `src/notify.ts` | Envía cada bloque de traspaso al equipo comercial por webhook (`ADVISOR_WEBHOOK_URL`). |
| `src/store.ts` | Estado en Upstash Redis / Vercel KV: traspaso realizado, pausa, remarketing, bajas, log de traspasos, eventos procesados. |
| `api/remarketing.ts` | Inicia conversaciones con plantillas aprobadas por Meta, rechaza contactos dados de baja y guarda `origen_conversacion` y `datos_base`. |

### Reglas del protocolo de traspaso (sección 1.4) cubiertas

1. La etiqueta se busca en cualquier posición. 2. Lo anterior va al cliente (si está vacío, no se envía nada).
3. Lo demás va solo al asesor. 4. `PRIORIDAD: URGENTE` usa `URGENT_WEBHOOK_URL` si está configurada.
5. `TIPO: BAJA_REMARKETING` marca "no contactar". 6. Después del primer traspaso se envía `traspaso_realizado: SI`.
7. Cada `TIPO: ACTUALIZACION` se notifica como una nueva nota. 8. Cada bloque queda en el log `handoffs` de Redis.

### Decisiones que conviene revisar

- **Notas internas:** la documentación de Zernio no tiene endpoint de notas internas ni de asignación, así que el traspaso llega por webhook (Slack, Google Chat, o Make/Zapier/n8n hacia Teams, correo, CRM...). El JSON incluye un campo `text` listo para Slack/Google Chat.
- **Pausa del bot (pendiente 3):** cuando un asesor escribe desde el inbox de Zernio (`message.sent` con `sentVia: "human"`), GOLD AI deja de responder en esa conversación durante `BOT_PAUSE_HOURS` (24 h por defecto). Los mensajes con `sentVia` nulo no pausan, como indica Zernio.
- **Errores técnicos:** si DeepSeek o Zernio fallan, el cliente recibe un aviso corto y el equipo recibe una alerta `TIPO: ERROR_TECNICO` urgente.
- **Audios:** todavía no se transcriben; el modelo recibe `[ADJUNTO: audio (nota de voz)]` y pide escribir el mensaje (sección 7.5).
- **Modelo:** `DEEPSEEK_MODEL` es `deepseek-flash` por defecto, con `thinking` desactivado. Confirme el nombre vigente en la documentación de DeepSeek.
- Se corrigió en el prompt una referencia interna: el Paso 7 decía "formato de la sección 9" y el formato está en la sección 10.

## Puesta en marcha

1. **Vercel:** importe este repositorio de GitHub como proyecto nuevo (framework "Other").
2. **Redis:** en Vercel → Storage, agregue Upstash Redis (crea `KV_REST_API_URL` / `KV_REST_API_TOKEN`).
3. **Variables de entorno:** copie las de [`.env.example`](.env.example) en Vercel → Settings → Environment Variables.
4. **Webhook en Zernio:** registre `https://<su-proyecto>.vercel.app/api/webhook` con los eventos `message.received` y `message.sent` y el mismo secreto de `ZERNIO_WEBHOOK_SECRET`. Use "Send test" para verificar.
5. **Pruebas manuales:** ejecute los 18 casos de la Parte 4 de la especificación desde un número de prueba.

### Remarketing

```http
POST /api/remarketing
Authorization: Bearer <ADMIN_API_KEY>
Content-Type: application/json

{
  "phone": "+573001234567",
  "origin": "REMARKETING_CLIENTE_INACTIVO",
  "templateName": "goldcargo_reactivacion_01",
  "templateLanguage": "es",
  "templateParams": ["Ana", "Andes SAS"],
  "baseData": { "nombre": "Ana", "empresa": "Andes SAS", "correo": "ana@andes.com" }
}
```

Verifique en la referencia de Zernio el formato exacto de `templateParams` para su plantilla.

## Desarrollo local

Node.js portátil está en `tools/node` (excluido de Git). En PowerShell:

```powershell
$env:Path = "$PWD\tools\node;" + $env:Path
```
```powershell
npm install
```
```powershell
npm test
```
```powershell
npm run typecheck
```

Las pruebas cubren festivos y horarios, el `CONTEXTO_SISTEMA`, la separación del bloque de traspaso, los filtros, la firma de Zernio y el flujo completo del bot con DeepSeek y Zernio simulados. No reemplazan los casos de la Parte 4, que prueban el comportamiento real del modelo.
