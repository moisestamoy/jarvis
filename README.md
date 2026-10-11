# J.A.R.V.I.S. de Moisés

Asistente personal por WhatsApp. Por dentro es **Claude Code** (tu plan Max) trabajando sobre una memoria privada
(`jarvis-memoria`), en un servidor de DigitalOcean prendido 24/7. Su trabajo es darte **claridad**: tu prioridad al
despertar, menos cosas abiertas y saber cómo vas con los números.

Basado en [NikQuila/jarvis](https://github.com/NikQuila/jarvis) (MIT), con la seguridad y las funciones rehechas.

## Qué hace (Fase 1)

| | |
|---|---|
| 🌅 **Reporte de claridad** | Con tu primer mensaje del día, o a la hora de respaldo si no escribes. Siempre 7 bloques en menos de 10 líneas: cuerpo (WHOOP), lo que viene hoy por negocio, números, acuerdos de equipos, **la UNA prioridad**, lo que puede esperar y la cuenta pendiente |
| ✅ **Botones** | ✅ Hecho / ⏳ Mañana / ❌ Soltar en la prioridad y los pendientes. Cierras cosas con un toque |
| ⛔ **Límite de 5 abiertos** | Si ya tienes 5 compromisos abiertos, no anota el sexto hasta que cierres o sueltes uno |
| 🤫 **Silencio** | No te escribe durante reuniones (cualquier evento en curso) ni de noche. Lo acumulado llega junto al terminar |
| 📨 **Ventana de 24 h** | Si llevas 24 h sin escribirle, manda la plantilla "ping" (máx. 2 al día) y te entrega todo al responder |
| ⏰ **Avisos** | Antes de cada evento, agrupados |
| 📅 **Calendario** | Crea y mueve bloques. Borrar o tocar eventos con otras personas pide un "Sí" con botón |
| 🌙 **Cierre del día** | 30 min antes del silencio: qué lograste, qué se trabó, qué arrastras, y el caos del día (1-5) |
| 🗓️ **Revisión semanal** | Domingo 18:00, guardada en `revisiones/` |
| 🌍 **Zona horaria** | `/zona America/Bogota`, "estoy en Bogotá", o automática al aterrizar (te pregunta antes) |
| 🧭 **Onboarding** | El primer día te hace 10 preguntas y llena la memoria |
| 📏 **Medición de 30 días** | Registra a qué hora supiste tu prioridad, si la cumpliste, cuántas veces pediste números, el caos y los abiertos. El día 30 te da el veredicto |
| 🎙️ **Audios** | Kapso los transcribe |

## Cómo funciona

```
Tu WhatsApp ──► Kapso ──► /webhook ──► server.mjs (bridge) ──► claude -p --resume   (cwd = jarvis-memoria)
                                          │   ▲                     │
                                          │   └── jarvis-acciones ◄─┘  (Claude propone; el bridge valida y ejecuta)
                                          ├── Google Calendar (OAuth propio)
                                          ├── WHOOP (whoop.mjs)
                                          └── git pull / push de jarvis-memoria
```

**Seguridad:**
- Claude corre con `--restricted`, una lista blanca (`Read/Edit/Write/Glob/Grep` solo dentro de `jarvis-memoria`,
  `git add/commit/status/diff/log`, `WebSearch`) y sin ningún MCP. Sin `bypassPermissions`, sin Bash general, sin curl ni WebFetch.
- Claude recibe un entorno limpio: `HOME`, `PATH`, `LANG`, `TZ` y `CLAUDE_CODE_OAUTH_TOKEN`. **Ninguna otra clave.**
- El bridge trae los datos (agenda, WHOOP) y se los pasa a Claude como JSON. Las acciones (calendario, compromisos, zona)
  las propone Claude en un bloque `jarvis-acciones`; el bridge las valida (sin invitados, sin otros calendarios) y las ejecuta.
- Solo responde a tu número, verifica la firma HMAC de Kapso y nunca le escribe a nadie más.
- El HUD solo responde preguntas: no ejecuta acciones. Su clave va solo por header.
- Conectar Google o WHOOP exige un código de un solo uso, que pides por WhatsApp (`/conectar google`) o sale en los logs.

## Probar en local

Necesitas Node 22. No hay dependencias que instalar.

```bash
npm test                                   # pruebas: reporte, silencio, ventana 24 h, zona, límite, acciones, seguridad
node scripts/simular.mjs scripts/demo.txt  # un lunes completo con Claude falso
node scripts/simular.mjs                   # modo interactivo: escribe como si fueras tú
SIM_CLAUDE=real node scripts/simular.mjs   # igual, pero con tu Claude Code de verdad (memoria temporal)
SIM_ONBOARDING=1 SIM_CLAUDE=real node scripts/simular.mjs   # prueba el onboarding
```

En el simulador: texto libre = tu mensaje · `/boton <id>` toca un botón · `/hora 2026-10-12T22:30` mueve el reloj ·
`/avanzar 30` · `/estado` · `/memoria compromisos.md` · `/salir`. No se manda nada ni se toca tu calendario.

Con el servidor real, `DRY_RUN=1` hace lo mismo: imprime los mensajes y las acciones de calendario en vez de ejecutarlos.

## Las claves que necesitas

| Clave | De dónde sale |
|---|---|
| `CLAUDE_CODE_OAUTH_TOKEN` | En el servidor, como usuario `jarvis`: `claude setup-token` (usa tu plan Max) |
| `KAPSO_API_KEY` | [kapso.ai](https://kapso.ai) → tu proyecto → API keys |
| `KAPSO_PHONE_NUMBER_ID` | Kapso → Connected numbers → tu número |
| `KAPSO_WEBHOOK_SECRET` | Lo inventas: `openssl rand -hex 32`. Va igual en el webhook de Kapso |
| Plantilla `jarvis_ping` | Kapso → Templates (ver abajo). Meta la aprueba en horas o días: pídela primero |
| `GOOGLE_CLIENT_ID` / `SECRET` | [Google Cloud Console](https://console.cloud.google.com) → proyecto nuevo → habilita **Google Calendar API** → Pantalla de consentimiento (externa, agrégate como usuario de prueba) → Credenciales → ID de cliente OAuth → *Aplicación web*, con URI de redirección `https://TU-HOST/google/callback` |
| `WHOOP_CLIENT_ID` / `SECRET` | [developer.whoop.com](https://developer.whoop.com) → crea una app, redirect `https://TU-HOST/whoop/callback`, privacidad `https://TU-HOST/privacy` |
| `JARVIS_TOKEN` | Lo inventas: `openssl rand -hex 24` |
| `ELEVENLABS_API_KEY` / `VOICE_ID` | ElevenLabs → Profile → API key; la voz, desde Voices (Fase 3) |

### Plantilla "ping"
En Kapso → **Templates → New**: nombre `jarvis_ping`, categoría **Utility**, idioma español, **sin variables**. Texto sugerido:

> Señor, tengo novedades para usted. Responda cuando pueda y se las envío.

Si te la aprueban con otro nombre, cámbialo en `PING_TEMPLATE`.

## Despliegue en DigitalOcean

1. **Droplet:** Ubuntu 24.04, Basic, 1 vCPU / 2 GB (~US$12/mes) alcanza (no hay whisper en el servidor). Agrega tu llave SSH.
2. **Dominio:** crea un registro A (ej. `jarvis.tudominio.com`) que apunte a la IP del droplet.
3. **Preparar el servidor:**
   ```bash
   scp deploy/setup.sh root@IP:/root/ && ssh root@IP 'bash /root/setup.sh jarvis.tudominio.com'
   ```
   Al final imprime **dos deploy keys**.
4. **Deploy keys en GitHub** (repo → Settings → Deploy keys → Add deploy key):
   - en `jarvis`: la llave `jarvis codigo`, **sin** marcar *Allow write access*;
   - en `jarvis-memoria`: la llave `jarvis-memoria`, **marcando** *Allow write access*.
   Así el servidor solo puede escribir en la memoria, y en ningún otro repo.
5. **Clonar e iniciar sesión** (como usuario `jarvis`):
   ```bash
   ssh jarvis@IP
   git clone git@github-jarvis:moisestamoy/jarvis.git
   git clone git@github-memoria:moisestamoy/jarvis-memoria.git
   git config --global user.name "JARVIS" && git config --global user.email "jarvis@localhost"
   claude setup-token        # copia el token que te da
   cp jarvis/.env.example ~/.config/jarvis/jarvis.env && chmod 600 ~/.config/jarvis/jarvis.env
   nano ~/.config/jarvis/jarvis.env   # completa las claves
   ```
6. **Arrancar:**
   ```bash
   sudo systemctl enable --now jarvis
   journalctl -u jarvis -f    # aquí aparecen los enlaces de un solo uso para conectar Google y WHOOP
   ```
7. **Webhook en Kapso:** Kapso → Webhooks → URL `https://jarvis.tudominio.com/webhook`, evento `whatsapp.message.received`,
   el secreto de `KAPSO_WEBHOOK_SECRET`. Activa la transcripción de audios.
8. **Conectar:** abre los enlaces de los logs, o escríbele `/conectar google` y `/conectar whoop`.
9. **Primer mensaje:** escríbele "hola". Como `perfil.md` está vacío, arranca el onboarding.

**Actualizar:** `cd ~/jarvis && git pull && sudo systemctl restart jarvis`.

## Comandos por WhatsApp

| | |
|---|---|
| `/zona America/Bogota` o "estoy en Bogotá" | Cambia la zona horaria |
| `/conectar google` · `/conectar whoop` | Te manda un enlace de un solo uso para conectar |
| `/nuevo` | Empieza una conversación nueva con Claude (la memoria se mantiene) |

## Archivos

| | |
|---|---|
| `server.mjs` | HTTP: webhook, OAuth, HUD. Arma los clientes reales |
| `lib/app.mjs` | La lógica: reporte, silencio, ventana, botones, acciones, cierre, revisiones, zona |
| `lib/claude.mjs` | Lista blanca y entorno limpio de Claude |
| `lib/acciones.mjs` | Esquema y validación de `jarvis-acciones` |
| `lib/compromisos.mjs` | Formato fijo de `compromisos.md` y de los acuerdos de equipo |
| `lib/calendario.mjs` | Google Calendar con OAuth propio |
| `lib/tiempo.mjs` | Zona dinámica, silencio, ciudades |
| `system-prompt.md` | Tono y reglas de JARVIS |
| `memoria-inicial/` | Estructura inicial de `jarvis-memoria` |
| `jarvis-ui/` | El HUD con voz (se adapta en la Fase 3) |

## Próximas fases

- **Fase 2:** números de AntoEcom, Imperio YT y Fiama (`numeros.mjs`: demo y Google Sheets CSV), prep 10 min antes de cada daily
  y extracción de acuerdos de los audios de las dailys hacia Notion.
- **Fase 3:** HUD con estética JARVIS clásica y los números de los tres negocios, "pensar en voz alta", revisión mensual y
  aprendizajes para Congruence.
