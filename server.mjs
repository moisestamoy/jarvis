// JARVIS de Moisés: bridge Telegram o WhatsApp (Kapso) → Claude Code, con HUD de voz en /jarvis.
// Basado en github.com/NikQuila/jarvis (MIT). Sin dependencias: solo Node.
// La lógica vive en lib/app.mjs; aquí se arman los clientes reales y el servidor HTTP.
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { cargarEnv } from './lib/env.mjs';
import { leerConfig, faltantes } from './lib/config.mjs';
import { crearEstado } from './lib/estado.mjs';
import { crearKapso, remitente, leerEntrada } from './lib/kapso.mjs';
import { crearTelegram, normalizar, tecladoSinGrupo, escuchar, descargarAudio } from './lib/telegram.mjs';
import { transcribir } from './lib/transcribir.mjs';
import { crearClaude } from './lib/claude.mjs';
import { crearCalendario, urlLogin } from './lib/calendario.mjs';
import { crearWhoop } from './lib/whoop.mjs';
import { crearMemoria } from './lib/memoria.mjs';
import { crearMetricas } from './lib/metricas.mjs';
import { crearApp } from './lib/app.mjs';
import { horaLocal, fechaLarga } from './lib/tiempo.mjs';

cargarEnv();
const cfg = leerConfig();
const falta = faltantes(cfg);
if (falta.length) { console.error(`falta configuración: ${falta.join(', ')} (ver .env.example)`); process.exit(1); }

const DIR = path.dirname(new URL(import.meta.url).pathname);
const log = (...a) => console.log(new Date().toISOString(), ...a);
const estado = crearEstado(path.join(DIR, 'state.json'), log);
const SISTEMA = fs.readFileSync(process.env.SYSTEM_PROMPT_FILE || path.join(DIR, 'system-prompt.md'), 'utf8');

// El canal: Telegram (por defecto) o WhatsApp vía Kapso. Ambos exponen texto, plantilla, botones y lista.
const tg = cfg.canal === 'telegram' ? crearTelegram({ token: cfg.telegramToken, dryRun: cfg.dryRun, log }) : null;
const chat = tg || crearKapso({ apiKey: cfg.kapsoApiKey, phoneNumberId: cfg.phoneNumberId, dryRun: cfg.dryRun, log });
const claude = crearClaude({ bin: cfg.claudeBin, timeoutMs: cfg.timeoutMs, estado, log });
const calendario = cfg.google.clientId ? crearCalendario({ ...cfg.google, dryRun: cfg.dryRun, log }) : null;
const whoop = crearWhoop({ dir: DIR, tokensFile: cfg.whoop.tokensFile });
const memoria = crearMemoria({ ruta: cfg.memoria, gitSync: cfg.gitSync, dryRun: cfg.dryRun, log });
const metricas = crearMetricas(memoria);

// ---------- conexiones (Google y WHOOP) ----------
// El login solo funciona con un código de un solo uso: así nadie más puede conectar SU cuenta a tu servidor.
// El código sale en los logs al arrancar (si falta conectar) o pidiéndolo por chat: "/conectar google".
const codigos = {};
const base = () => (cfg.google.redirect || cfg.whoop.redirect || 'https://TU-HOST/x').replace(/\/[^/]+\/callback$/, '');
function nuevoCodigo(servicio) {
  codigos[servicio] = crypto.randomBytes(16).toString('hex');
  return `${base()}/${servicio}/login?codigo=${codigos[servicio]}`;
}
async function comandos(texto) {
  const m = /^\/conectar\s+(google|whoop)$/i.exec(texto.trim());
  if (!m) return null;
  const s = m[1].toLowerCase();
  if (s === 'google' && !calendario) return 'Falta GOOGLE_CLIENT_ID en el .env del servidor.';
  if (s === 'whoop' && !cfg.whoop.clientId) return 'Falta WHOOP_CLIENT_ID en el .env del servidor.';
  return `Abra este enlace para conectar ${s === 'google' ? 'Google Calendar' : 'WHOOP'} (sirve una vez):\n${nuevoCodigo(s)}`;
}

const app = crearApp({ cfg, estado, chat, claude, calendario, whoop, memoria, metricas, sistema: SISTEMA, log, comandos });

// ---------- webhook de Kapso ----------
const vistos = new Set();
let avisoRecibido = false;
let temporizadorNoSoportado = null;
const esNoSoportado = (e) => /Unsupported message/i.test(leerEntrada(e.message || {}).texto);

function verificar(raw, firma) {
  if (typeof firma !== 'string') return false;
  const a = Buffer.from(crypto.createHmac('sha256', cfg.webhookSecret).update(raw).digest('hex'));
  const b = Buffer.from(firma);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function webhook(req, res) {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const raw = Buffer.concat(chunks);
    if (!verificar(raw, req.headers['x-webhook-signature'])) { res.writeHead(401).end('bad signature'); return; }
    res.writeHead(200).end('ok'); // responder rápido: Kapso reintenta a los 10 s
    const key = req.headers['x-idempotency-key'];
    if (key) { if (vistos.has(key)) return; vistos.add(key); if (vistos.size > 1000) vistos.clear(); }
    if (req.headers['x-webhook-event'] !== 'whatsapp.message.received') return;
    let body;
    try { body = JSON.parse(raw); } catch { return; }
    const eventos = (body.batch ? body.data : [body]).filter((e) => {
      const ok = remitente(e) === cfg.owner;
      if (!ok) log('ignorado: mensaje de un número que no es el dueño');
      return ok;
    });
    if (!eventos.length) return;
    // WhatsApp manda un álbum como un "unsupported" seguido de las fotos: solo se responde si no llega nada más.
    if (eventos.every(esNoSoportado)) {
      clearTimeout(temporizadorNoSoportado);
      temporizadorNoSoportado = setTimeout(() => chat.texto(cfg.owner, 'Me llegó un mensaje que no puedo leer, señor. Mándelo como texto, audio o archivo.'), 30_000);
      return;
    }
    clearTimeout(temporizadorNoSoportado);
    const validos = eventos.filter((e) => !esNoSoportado(e));
    if (app.ocupado() && !avisoRecibido) { avisoRecibido = true; chat.texto(cfg.owner, '📥 Recibido. Termino lo anterior y sigo con esto.'); }
    app.encolar(async () => { avisoRecibido = false; await app.manejarEntrada(validos.map((e) => leerEntrada(e.message || {}))); });
  });
}

// ---------- Telegram ----------
async function updateTelegram(u) {
  const n = normalizar(u);
  if (!n) return;
  if (!cfg.owner) {
    // Primera puesta en marcha: todavía no sabemos quién es el dueño. Le decimos su ID a quien escriba.
    log(`Telegram: mensaje del ID ${n.de}. Si eres tú, pon OWNER_TELEGRAM_ID=${n.de} en el .env y reinicia.`);
    await chat.texto(n.chat, `Tu ID de Telegram es ${n.de}. Ponlo en OWNER_TELEGRAM_ID en el .env del servidor y reinicia JARVIS.`);
    return;
  }
  if (n.de !== cfg.owner || String(n.chat) !== cfg.owner) { log('ignorado: mensaje de Telegram de alguien que no es el dueño'); return; }
  if (n.callback) {
    // Quita el "cargando" del botón y los botones de esa misma decisión, para no tocarlos dos veces.
    tg.llamar('answerCallbackQuery', { callback_query_id: n.callback.id }).catch(() => {});
    if (n.callback.message) {
      tg.llamar('editMessageReplyMarkup', { chat_id: n.chat, message_id: n.callback.message.message_id, reply_markup: tecladoSinGrupo(n.callback.message.reply_markup, n.entrada.botonId) }).catch(() => {});
    }
  } else if (!n.entrada.texto && !n.voz) {
    await chat.texto(cfg.owner, 'Por ahora leo texto y audios, señor.');
    return;
  }
  if (app.ocupado() && !avisoRecibido) { avisoRecibido = true; chat.texto(cfg.owner, '📥 Recibido. Termino lo anterior y sigo con esto.'); }
  app.encolar(async () => {
    avisoRecibido = false;
    if (n.voz) {
      try {
        chat.escribiendo(cfg.owner);
        const audio = await descargarAudio(tg, cfg.telegramToken, n.voz.file_id);
        n.entrada.texto = await transcribir(audio, { key: cfg.elevenKey, modelo: process.env.ELEVENLABS_STT_MODEL });
        n.entrada.duracion = n.voz.duration || 0;
        log(`audio de ${n.entrada.duracion} s transcrito`);
      } catch (e) {
        log('audio:', e.message);
        await chat.texto(cfg.owner, `No pude transcribir el audio (${e.message}). Mándemelo por escrito, señor.`);
        return;
      }
    }
    if (n.entrada.texto) chat.escribiendo(cfg.owner);
    await app.manejarEntrada([n.entrada]);
  });
}

// ---------- OAuth ----------
async function googleCallback(url, res) {
  if (!codigos.google || url.searchParams.get('state') !== codigos.google) { res.writeHead(400).end('Código inválido o usado.'); return; }
  codigos.google = null;
  await calendario.canjear(url.searchParams.get('code'));
  log('google calendar conectado');
  await app.refrescarAgenda(true);
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end('<h2>Google Calendar conectado ✅</h2><p>Ya puede cerrar esta pestaña.</p>');
}

const WHOOP_SCOPES = 'offline read:recovery read:cycles read:sleep read:workout read:profile read:body_measurement';
async function whoopCallback(url, res) {
  if (!codigos.whoop || url.searchParams.get('state') !== codigos.whoop) { res.writeHead(400).end('Código inválido o usado.'); return; }
  codigos.whoop = null;
  const r = await fetch('https://api.prod.whoop.com/oauth/oauth2/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code: url.searchParams.get('code'), redirect_uri: cfg.whoop.redirect, client_id: cfg.whoop.clientId, client_secret: process.env.WHOOP_CLIENT_SECRET }),
  });
  const t = await r.json();
  if (!t.access_token) { log('whoop: canje falló', JSON.stringify(t).slice(0, 300)); res.writeHead(500).end('WHOOP no entregó token. Revisa los logs.'); return; }
  fs.mkdirSync(path.dirname(cfg.whoop.tokensFile), { recursive: true });
  fs.writeFileSync(cfg.whoop.tokensFile, JSON.stringify({ ...t, obtained_at: Date.now() }, null, 2), { mode: 0o600 });
  log('whoop conectado');
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end('<h2>WHOOP conectado ✅</h2><p>Ya puede cerrar esta pestaña.</p>');
}

function conexiones(req, res, url) {
  const [, servicio, paso] = url.pathname.split('/');
  if (servicio === 'google' && !calendario) { res.writeHead(503).end('Google no configurado'); return; }
  if (servicio === 'whoop' && !cfg.whoop.clientId) { res.writeHead(503).end('WHOOP no configurado'); return; }
  if (paso === 'login') {
    const c = url.searchParams.get('codigo');
    if (!c || c !== codigos[servicio]) { res.writeHead(403).end('Código inválido. Pida uno nuevo por WhatsApp: /conectar ' + servicio); return; }
    const destino = servicio === 'google'
      ? urlLogin(cfg.google, c)
      : `https://api.prod.whoop.com/oauth/oauth2/auth?${new URLSearchParams({ response_type: 'code', client_id: cfg.whoop.clientId, redirect_uri: cfg.whoop.redirect, scope: WHOOP_SCOPES, state: c })}`;
    res.writeHead(302, { Location: destino }).end();
    return;
  }
  if (paso === 'callback') {
    (servicio === 'google' ? googleCallback : whoopCallback)(url, res).catch((e) => { log(`${servicio}: error`, e.message); res.writeHead(500).end('error'); });
    return;
  }
  res.writeHead(404).end();
}

// ---------- HUD /jarvis (solo responde preguntas; las acciones van solo por WhatsApp) ----------
const JARVIS_DIR = path.join(DIR, 'jarvis');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.mp3': 'audio/mpeg' };

// La clave solo vale por header. El ?k= lo lee la página (jarvis-ui) la primera vez para guardarla en el navegador.
function hudAutorizado(req) {
  const a = Buffer.from(String(req.headers['x-jarvis-key'] || '')), b = Buffer.from(cfg.jarvisToken);
  return b.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}

function estaticoHud(url, res) {
  const rel = decodeURIComponent(url.pathname.replace(/^\/jarvis\/?/, '')) || 'index.html';
  const file = path.normalize(path.join(JARVIS_DIR, rel));
  if (!file.startsWith(JARVIS_DIR + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
}

let cacheHud = { at: 0, valor: null };
async function estadoHud() {
  if (Date.now() - cacheHud.at < 60_000 && cacheHud.valor) return cacheHud.valor;
  const tz = app.tz();
  const w = await whoop.hoy().catch(() => null);
  const valor = {
    now: new Date().toISOString(), owner: cfg.ownerName, tz,
    ui: { wakeLine: process.env.JARVIS_WAKE_LINE || 'Buenos días, JARVIS.', revenueTitle: 'NEGOCIOS' },
    agenda: app.eventosDeHoy().filter((e) => !e.todoElDia).map((e) => ({
      time: horaLocal(new Date(e.inicio), tz), start: e.inicio, end: e.fin, title: e.titulo, description: e.descripcion || '',
      calendar: e.calendario || '', link: e.link || '', location: e.ubicacion || '', meet: e.meet || '', attendees: e.invitados || [],
    })),
    whoop: w && { recovery: w.recovery, hrv: w.hrv, rhr: w.rhr, sleepHours: w.horas, sleepPerf: w.rendimiento },
    revenue: null, companies: [], // Fase 3: números de los tres negocios
  };
  cacheHud = { at: Date.now(), valor };
  return valor;
}

const VOZ = 'Eres J.A.R.V.I.S., el asistente de Moisés, hablando en voz alta por el HUD. Calmado, preciso, con un toque de ironía; lo tratas de "señor". ' +
  'Español neutral con tuteo. Sin markdown, sin emojis, sin listas: es para decirlo en voz alta. Usa solo los datos dados. ' +
  'No ejecutas acciones desde aquí: si te pide hacer algo, dile en una frase que te lo pida por WhatsApp. WHOOP solo informa: no recomiendes nada a partir de esos datos. ' +
  'No nombres personas externas ni clientes: di "una reunión".';
const historialHud = [];
async function datosVoz() {
  const s = await estadoHud();
  return { ahora: `${fechaLarga(new Date(), app.tz())}, ${horaLocal(new Date(), app.tz())}`, whoop: s.whoop, agenda: s.agenda.map((e) => ({ hora: e.time, titulo: e.title, yaPaso: new Date(e.end) < new Date() })) };
}
async function preguntaHud(texto) {
  const historia = historialHud.map((x) => `Él: ${x.q}\nTú: ${x.a}`).join('\n');
  const r = await claude.ejecutar({
    prompt: `${VOZ} Responde en 1 a 3 frases cortas.\n\nDatos (JSON): ${JSON.stringify(await datosVoz())}\n\n${historia ? `Conversación reciente:\n${historia}\n\n` : ''}Él: ${texto}`,
    modelo: cfg.modeloChat, cwd: DIR, herramientas: false,
  });
  const a = r.error ? 'Se me cruzaron los cables, señor. ¿Me lo repites?' : r.texto.trim();
  historialHud.push({ q: texto, a });
  while (historialHud.length > 6) historialHud.shift();
  return a;
}
let briefing = { at: 0, texto: '', pendiente: null };
function briefingHud() {
  if (briefing.pendiente) return briefing.pendiente;
  if (Date.now() - briefing.at < 5 * 60_000 && briefing.texto) return Promise.resolve(briefing.texto);
  briefing.pendiente = (async () => {
    const r = await claude.ejecutar({
      prompt: `${VOZ} Te acaba de saludar. Cuéntale el día en máximo 5 frases y 60 palabras: primero el sueño y el recovery (solo los datos), ` +
        `luego lo que queda de la agenda (agrupa, no leas todo) y cierra con una frase breve. Horas como se dicen ("a las cuatro").\n\nDatos (JSON): ${JSON.stringify(await datosVoz())}`,
      modelo: cfg.modeloChat, cwd: DIR, herramientas: false,
    });
    briefing.texto = r.error ? 'Buenos días, señor. Sistemas en línea.' : r.texto.trim();
    briefing.at = Date.now();
    return briefing.texto;
  })().finally(() => { briefing.pendiente = null; });
  return briefing.pendiente;
}

const ELEVEN = { key: process.env.ELEVENLABS_API_KEY || '', voz: process.env.ELEVENLABS_VOICE_ID || '', modelo: process.env.ELEVENLABS_MODEL || 'eleven_v4', rapido: process.env.ELEVENLABS_FAST_MODEL || 'eleven_v4_turbo' };
const EDGE = { voz: process.env.EDGE_TTS_VOICE || '', bin: process.env.EDGE_TTS_BIN || path.join(os.homedir(), '.local/bin/edge-tts') };
const cacheTts = new Map();
async function tts(texto, rapido) {
  if (cacheTts.has(texto)) return cacheTts.get(texto);
  let buf;
  if (ELEVEN.key && ELEVEN.voz) {
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${ELEVEN.voz}?output_format=mp3_44100_128`, {
      method: 'POST', headers: { 'xi-api-key': ELEVEN.key, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
      body: JSON.stringify({ text: texto, model_id: rapido ? ELEVEN.rapido : ELEVEN.modelo, voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.3, use_speaker_boost: true } }),
    });
    if (!r.ok) throw new Error(`elevenlabs ${r.status}`);
    buf = Buffer.from(await r.arrayBuffer());
  } else {
    const file = path.join(os.tmpdir(), `jarvis-tts-${crypto.randomUUID()}.mp3`);
    await new Promise((ok, mal) => {
      const c = spawn(EDGE.bin, ['--voice', EDGE.voz, '--text', texto, '--write-media', file], { stdio: 'ignore' });
      c.on('close', (code) => (code === 0 ? ok() : mal(new Error('edge-tts ' + code))));
    });
    buf = fs.readFileSync(file);
    fs.rmSync(file, { force: true });
  }
  cacheTts.set(texto, buf);
  if (cacheTts.size > 30) cacheTts.delete(cacheTts.keys().next().value);
  return buf;
}

function leerJson(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks))); } catch { resolve({}); } });
  });
}
const json = (res, code, obj) => res.writeHead(code, { 'Content-Type': 'application/json' }).end(JSON.stringify(obj));

// Nada de esto pasa por la cola de WhatsApp: un trabajo largo allá no bloquea al HUD.
function hud(req, res, url) {
  if (!url.pathname.startsWith('/jarvis/api/')) return estaticoHud(url, res);
  if (!hudAutorizado(req)) { res.writeHead(401).end('unauthorized'); return; }
  const ruta = url.pathname.slice('/jarvis/api/'.length);
  const fallo = (e) => { log('hud:', e.message); json(res, 500, {}); };
  if (req.method === 'GET' && ruta === 'state') return void estadoHud().then((s) => json(res, 200, s)).catch(fallo);
  if (req.method === 'GET' && ruta === 'briefing') return void briefingHud().then((text) => json(res, 200, { text })).catch(fallo);
  if (req.method === 'POST' && ruta === 'ask') {
    return void leerJson(req).then(async (b) => {
      const texto = String(b.text || '').slice(0, 2000).trim();
      if (!texto) return json(res, 400, {});
      json(res, 200, { reply: await preguntaHud(texto) });
    }).catch(fallo);
  }
  if (req.method === 'POST' && ruta === 'tts') {
    if (!(ELEVEN.key && ELEVEN.voz) && !EDGE.voz) { res.writeHead(501).end('sin voz'); return; }
    return void leerJson(req).then(async ({ text, fast }) => {
      const texto = String(text || '').slice(0, 1500).trim();
      if (!texto) { res.writeHead(400).end(); return; }
      const mp3 = await tts(texto, !!fast);
      res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Content-Length': mp3.length, 'Cache-Control': 'no-store' }).end(mp3);
    }).catch((e) => { log('tts:', e.message); res.writeHead(502).end(); });
  }
  res.writeHead(404).end();
}

const PRIVACIDAD = `<!doctype html><meta charset="utf-8"><title>Privacidad</title>
<h1>Política de privacidad — asistente personal</h1>
<p>Asistente privado de un solo usuario; no se ofrece al público.</p>
<p>Los datos de servicios conectados (calendario, WHOOP) se usan solo para responderle a su dueño. No se venden ni se comparten.</p>
<p>Los tokens se guardan en el servidor privado del dueño y se pueden revocar en cualquier momento desde cada servicio.</p>`;

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'GET' && url.pathname === '/health') return void res.end('ok');
  if (req.method === 'GET' && url.pathname === '/privacy') return void res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(PRIVACIDAD);
  if (url.pathname === '/jarvis') return void res.writeHead(302, { Location: '/jarvis/' + url.search }).end();
  if (url.pathname.startsWith('/jarvis/')) return hud(req, res, url);
  if (req.method === 'GET' && /^\/(google|whoop)\//.test(url.pathname)) return conexiones(req, res, url);
  if (req.method === 'POST' && url.pathname === '/webhook' && cfg.canal === 'kapso') return webhook(req, res);
  res.writeHead(404).end();
}).listen(cfg.port, '127.0.0.1', () => {
  log(`escuchando en 127.0.0.1:${cfg.port}${cfg.dryRun ? ' (DRY_RUN)' : ''} · memoria: ${cfg.memoria} · zona: ${app.tz()}`);
  if (tg) {
    if (!cfg.owner) log('OWNER_TELEGRAM_ID vacío: escríbele al bot y te dirá tu ID.');
    escuchar({ tg, estado, onUpdate: updateTelegram, log });
  }
  if (estado.recuperado) log('aviso: state.json estaba corrupto y se reinició');
  if (calendario && !calendario.conectado()) log(`Google Calendar sin conectar. Abre: ${nuevoCodigo('google')}`);
  if (cfg.whoop.clientId && !whoop.conectado()) log(`WHOOP sin conectar. Abre: ${nuevoCodigo('whoop')}`);
  if (process.env.RECORDATORIOS !== '0') {
    setInterval(() => app.tick().catch((e) => log('tick:', e?.stack || e)), 60_000);
    app.tick().catch((e) => log('tick:', e?.stack || e));
  }
});
