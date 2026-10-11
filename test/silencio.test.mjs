import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estadoSilencio, enRango } from '../lib/tiempo.mjs';
import { armar } from '../lib/falsos.mjs';

const tz = 'Europe/Lisbon';
const reunion = { titulo: 'Daily Fiama', inicio: '2026-10-12T10:00:00Z', fin: '2026-10-12T10:30:00Z' };

test('el horario nocturno cruza la medianoche', () => {
  assert.equal(enRango('23:30', '23:00', '07:00'), true);
  assert.equal(enRango('03:00', '23:00', '07:00'), true);
  assert.equal(enRango('07:00', '23:00', '07:00'), false);
  assert.equal(enRango('12:00', '23:00', '07:00'), false);
});

test('silencio por noche y por evento en curso', () => {
  const s = (iso, eventos = []) => estadoSilencio({ ahora: new Date(iso), tz, inicio: '23:00', fin: '07:00', eventos });
  assert.equal(s('2026-10-12T22:30:00Z').motivo, 'noche'); // 23:30 Lisboa
  assert.equal(s('2026-10-12T10:10:00Z', [reunion]).motivo, 'reunion');
  assert.equal(s('2026-10-12T10:30:00Z', [reunion]).silencio, false); // terminó justo
  assert.equal(s('2026-10-12T10:10:00Z', [{ ...reunion, todoElDia: true }]).silencio, false);
  const ignorado = estadoSilencio({ ahora: new Date('2026-10-12T10:10:00Z'), tz, inicio: '23:00', fin: '07:00', eventos: [{ ...reunion, titulo: 'Foco personal' }], ignorar: 'foco' });
  assert.equal(ignorado.silencio, false);
});

test('un bloque en curso también es silencio (cualquier evento), salvo que SILENCIO_IGNORAR lo excluya', async () => {
  const eventos = [reunion, { id: 'e2', titulo: 'Bloque: proyección', inicio: '2026-10-12T10:20:00Z', fin: '2026-10-12T11:00:00Z' }];
  const j = armar({ inicio: '2026-10-12T09:00:00Z', eventos });
  await j.escribir('hola');
  j.kapso.salida.length = 0;
  j.reloj.ir('2026-10-12T10:16:00Z');
  await j.tick();
  j.reloj.ir('2026-10-12T10:31:00Z');
  await j.tick();
  assert.equal(j.kapso.salida.length, 0, 'el propio bloque está en curso: silencio');
  assert.equal(j.app.silencio().motivo, 'reunion');
});

test('un aviso durante una reunión se acumula y llega junto al terminar', async () => {
  const j = armar({
    inicio: '2026-10-12T09:00:00Z', env: { SILENCIO_IGNORAR: '^Bloque' },
    eventos: [reunion, { id: 'e2', titulo: 'Bloque: proyección', inicio: '2026-10-12T10:20:00Z', fin: '2026-10-12T11:00:00Z' }],
  });
  await j.escribir('hola'); // abre la ventana y manda el reporte
  j.kapso.salida.length = 0;
  j.reloj.ir('2026-10-12T10:16:00Z'); // en plena daily; el bloque empieza en 4 min
  await j.tick();
  assert.equal(j.kapso.salida.length, 0, 'no debe escribir durante la daily');
  assert.equal(j.app.estado.pendientes.length, 1);
  j.reloj.ir('2026-10-12T10:31:00Z'); // terminó la daily
  await j.tick();
  assert.equal(j.kapso.salida.length, 1);
  assert.match(j.kapso.salida[0].texto, /⏰ \*11:20 Bloque: proyección\*/);
  assert.equal(j.app.estado.pendientes.length, 0);
});

test('varios avisos acumulados se mandan en un solo mensaje', async () => {
  const j = armar({ inicio: '2026-10-12T09:00:00Z', eventos: [reunion] });
  await j.escribir('hola');
  j.kapso.salida.length = 0;
  j.reloj.ir('2026-10-12T10:05:00Z');
  await j.app.avisar({ tipo: 'texto', texto: 'Uno' });
  await j.app.avisar({ tipo: 'texto', texto: 'Dos' });
  assert.equal(j.kapso.salida.length, 0);
  j.reloj.ir('2026-10-12T10:35:00Z');
  await j.tick();
  assert.equal(j.kapso.salida.length, 1);
  assert.match(j.kapso.salida[0].texto, /Lo que se acumuló[\s\S]*Uno\n\nDos/);
});

test('de noche no escribe por iniciativa propia, pero sí responde', async () => {
  const j = armar({ inicio: '2026-10-12T22:30:00Z', estado: { ultimoMensajeAt: new Date('2026-10-12T21:00:00Z').getTime() } });
  await j.app.avisar({ tipo: 'texto', texto: 'algo' });
  await j.tick();
  assert.equal(j.kapso.salida.length, 0);
  await j.escribir('¿mañana a qué hora es la daily?');
  // al escribir él, recibe lo acumulado y la respuesta (sin reporte: es de noche)
  assert.deepEqual(j.kapso.salida.map((m) => m.texto), ['algo', 'Entendido, señor.']);
});

test('el cierre del día llega 30 min antes del silencio, con la lista de caos', async () => {
  const j = armar({ inicio: '2026-10-12T21:29:00Z', estado: { ultimoMensajeAt: new Date('2026-10-12T20:00:00Z').getTime(), dias: { '2026-10-12': { reporte: { at: 1 } } } } });
  await j.tick(); // 22:29
  assert.equal(j.kapso.salida.length, 0);
  j.reloj.ir('2026-10-12T21:30:00Z'); // 22:30
  await j.tick();
  assert.match(j.kapso.salida[0].texto, /Cierre del día[\s\S]*Qué logró[\s\S]*Qué se trabó[\s\S]*Qué arrastra/);
  assert.equal(j.kapso.salida[1].tipo, 'lista');
  await j.tocar('caos:2');
  assert.equal(JSON.parse(j.memoria.leer('metricas/2026-10-12.json')).caos, 2);
  // la respuesta del cierre lleva las instrucciones de cierre al system prompt
  await j.escribir('Logré cerrar la proyección, se trabó Fiama, arrastro el feedback');
  assert.match(j.claude.llamadas.at(-1).sistema, /CIERRE DEL DÍA 2026-10-12/);
});
