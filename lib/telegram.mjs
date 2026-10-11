// Telegram como canal. Misma interfaz que kapso.mjs (texto, plantilla, botones, lista), así la app no sabe qué canal usa.
// Recibe mensajes por long polling (getUpdates): el servidor no necesita dominio ni HTTPS para el chat.

// TELEGRAM_API_URL solo sirve para pruebas contra una API falsa.
const API = () => process.env.TELEGRAM_API_URL || 'https://api.telegram.org';
const url = (token, metodo) => `${API()}/bot${token}/${metodo}`;

export function crearTelegram({ token, dryRun, log = console.log, fetchFn = fetch }) {
  async function llamar(metodo, body = {}) {
    const r = await fetchFn(url(token, metodo), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      signal: AbortSignal.timeout(metodo === 'getUpdates' ? 70_000 : 20_000),
    });
    const j = await r.json().catch(() => ({ ok: false, description: `HTTP ${r.status}` }));
    if (!j.ok) throw new Error(`telegram ${metodo}: ${j.description}`);
    return j.result;
  }

  // WhatsApp y el Markdown clásico de Telegram usan el mismo *negrita* y _cursiva_.
  // Si Telegram no puede interpretar el formato (un "_" suelto, por ejemplo), se reenvía como texto plano.
  async function mensaje(chat_id, text, extra = {}) {
    if (dryRun) { log('DRY_RUN telegram →', text, extra.reply_markup ? JSON.stringify(extra.reply_markup.inline_keyboard) : ''); return; }
    const base = { chat_id, text, disable_web_page_preview: true, ...extra };
    try { return await llamar('sendMessage', { ...base, parse_mode: 'Markdown' }); } catch (e) {
      if (!/parse entities/i.test(e.message)) { log(e.message); return; }
      return llamar('sendMessage', base).catch((e2) => log(e2.message));
    }
  }
  const boton = (b) => ({ text: b.title, callback_data: b.id.slice(0, 64) });

  return {
    llamar,
    async texto(to, body) { for (let i = 0; i < body.length; i += 4000) await mensaje(to, body.slice(i, i + 4000)); },
    async plantilla() {}, // Telegram no tiene ventana de 24 h: nunca hace falta el ping
    botones: (to, body, botones) => mensaje(to, body, { reply_markup: { inline_keyboard: [botones.slice(0, 3).map(boton)] } }),
    // Telegram no tiene listas: una fila de botones por opción.
    lista: (to, body, _boton, filas) => mensaje(to, body, { reply_markup: { inline_keyboard: filas.slice(0, 10).map((f) => [boton({ ...f, title: f.title.slice(0, 60) })]) } }),
    escribiendo: (to) => (dryRun ? null : llamar('sendChatAction', { chat_id: to, action: 'typing' }).catch(() => {})),
  };
}

// Update de Telegram → { de, chat, entrada: { texto, botonId, audio }, voz, callback } (null si no es para nosotros).
export function normalizar(u) {
  if (u.callback_query) {
    const q = u.callback_query;
    return { de: String(q.from.id), chat: q.message?.chat.id, entrada: { texto: '', botonId: q.data, audio: false }, callback: q };
  }
  const m = u.message;
  if (!m?.from) return null;
  const voz = m.voice || m.audio || null;
  let texto = (m.text || m.caption || '').trim();
  if (/^\/start\b/.test(texto)) texto = 'hola';
  return { de: String(m.from.id), chat: m.chat.id, entrada: { texto, botonId: null, audio: !!voz }, voz };
}

// Tras tocar un botón: quita del mensaje los botones de esa misma decisión (los demás pendientes siguen ahí).
export function tecladoSinGrupo(teclado, data) {
  const grupo = data.slice(0, data.lastIndexOf(':'));
  const filas = (teclado?.inline_keyboard || []).map((f) => f.filter((b) => !b.callback_data?.startsWith(grupo + ':'))).filter((f) => f.length);
  return { inline_keyboard: filas };
}

// Bucle de long polling. onUpdate no debe bloquear: encola el trabajo y vuelve.
export async function escuchar({ tg, estado, onUpdate, log = console.log }) {
  await tg.llamar('deleteWebhook').catch(() => {});
  for (;;) {
    try {
      const ups = await tg.llamar('getUpdates', { offset: estado.data.telegramOffset || 0, timeout: 50, allowed_updates: ['message', 'callback_query'] });
      for (const u of ups) {
        estado.data.telegramOffset = u.update_id + 1;
        estado.guardar();
        try { await onUpdate(u); } catch (e) { log('telegram: error con un update', e?.stack || e); }
      }
    } catch (e) {
      log('telegram: getUpdates falló:', e.message);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

// Descarga el audio de una nota de voz (hasta 20 MB, el límite de la API de bots).
export async function descargarAudio(tg, token, fileId, fetchFn = fetch) {
  const f = await tg.llamar('getFile', { file_id: fileId });
  const r = await fetchFn(`${API()}/file/bot${token}/${f.file_path}`, { signal: AbortSignal.timeout(60_000) });
  if (!r.ok) throw new Error(`descarga de audio: HTTP ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}
