import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crearTelegram, normalizar, tecladoSinGrupo } from '../lib/telegram.mjs';
import { transcribir } from '../lib/transcribir.mjs';
import { armar } from '../lib/falsos.mjs';

// fetch falso que registra las llamadas a la API de Telegram
function fetchFalso(respuestas = {}) {
  const llamadas = [];
  const fn = async (url, init) => {
    const metodo = url.split('/').pop();
    const body = init?.body && typeof init.body === 'string' ? JSON.parse(init.body) : init?.body;
    llamadas.push({ metodo, body });
    const r = (respuestas[metodo] || (() => ({ ok: true, result: {} })))(body);
    return { ok: true, status: 200, json: async () => r };
  };
  return { fn, llamadas };
}

test('normaliza mensajes, /start, audios y toques de botón', () => {
  assert.deepEqual(normalizar({ message: { from: { id: 7 }, chat: { id: 7 }, text: 'hola' } }).entrada, { texto: 'hola', botonId: null, audio: false });
  assert.equal(normalizar({ message: { from: { id: 7 }, chat: { id: 7 }, text: '/start' } }).entrada.texto, 'hola');
  const voz = normalizar({ message: { from: { id: 7 }, chat: { id: 7 }, voice: { file_id: 'f1', duration: 95 } } });
  assert.equal(voz.entrada.audio, true);
  assert.equal(voz.voz.file_id, 'f1');
  const b = normalizar({ callback_query: { id: 'q', from: { id: 7 }, data: 'prio:hecho', message: { chat: { id: 7 }, message_id: 3 } } });
  assert.deepEqual(b.entrada, { texto: '', botonId: 'prio:hecho', audio: false });
  assert.equal(b.de, '7');
});

test('al tocar un botón se quitan solo los de esa decisión', () => {
  const teclado = { inline_keyboard: [
    [{ text: '✅ A', callback_data: 'c:c-0001:hecho' }], [{ text: '⏳ A', callback_data: 'c:c-0001:manana' }],
    [{ text: '✅ B', callback_data: 'c:c-0002:hecho' }],
  ] };
  assert.deepEqual(tecladoSinGrupo(teclado, 'c:c-0001:hecho').inline_keyboard, [[{ text: '✅ B', callback_data: 'c:c-0002:hecho' }]]);
  const prio = { inline_keyboard: [[{ callback_data: 'prio:hecho' }, { callback_data: 'prio:manana' }]] };
  assert.deepEqual(tecladoSinGrupo(prio, 'prio:manana').inline_keyboard, []);
});

test('botones y listas se mandan como teclado inline; si el Markdown falla, va en texto plano', async () => {
  const f = fetchFalso({ sendMessage: (b) => (b.parse_mode ? { ok: false, description: "Bad Request: can't parse entities" } : { ok: true, result: {} }) });
  const tg = crearTelegram({ token: 'T', dryRun: false, fetchFn: f.fn, log: () => {} });
  await tg.botones(7, '🎯 Algo', [{ id: 'prio:hecho', title: '✅ Hecho' }, { id: 'prio:manana', title: '⏳ Mañana' }]);
  assert.equal(f.llamadas.length, 2, 'reintento sin parse_mode');
  assert.equal(f.llamadas[1].body.parse_mode, undefined);
  assert.deepEqual(f.llamadas[1].body.reply_markup.inline_keyboard, [[{ text: '✅ Hecho', callback_data: 'prio:hecho' }, { text: '⏳ Mañana', callback_data: 'prio:manana' }]]);
  await tg.lista(7, 'Elija', 'x', [{ id: 'caos:1', title: '1 · Muy en orden' }, { id: 'caos:2', title: '2 · En orden' }]);
  assert.equal(f.llamadas.at(-1).body.reply_markup.inline_keyboard.length, 2);
  const antes = f.llamadas.length;
  await tg.plantilla();
  assert.equal(f.llamadas.length, antes, 'Telegram nunca manda plantillas');
});

test('en Telegram no hay ventana de 24 h: escribe aunque lleves días sin hablarle, y nunca hace ping', async () => {
  const j = armar({ inicio: '2026-10-12T08:00:00Z', env: { CANAL: 'telegram', OWNER_TELEGRAM_ID: '7' }, estado: { ultimoMensajeAt: 0 } });
  await j.tick(); // 09:00 Lisboa: reporte de respaldo
  assert.match(j.kapso.salida[0].texto, /Reporte de claridad/);
  assert.ok(!j.kapso.salida.some((m) => m.tipo === 'plantilla'));
});

test('transcribe con ElevenLabs scribe_v2 sin exponer la clave a Claude', async () => {
  let pedido;
  const fetchFn = async (url, init) => { pedido = { url, init }; return { ok: true, json: async () => ({ text: ' hola jarvis ' }) }; };
  assert.equal(await transcribir(Buffer.from('ogg'), { key: 'K', fetchFn }), 'hola jarvis');
  assert.equal(pedido.url, 'https://api.elevenlabs.io/v1/speech-to-text');
  assert.equal(pedido.init.headers['xi-api-key'], 'K');
  assert.equal(pedido.init.body.get('model_id'), 'scribe_v2');
  await assert.rejects(transcribir(Buffer.from('x'), { key: '' }), /ELEVENLABS_API_KEY/);
});
