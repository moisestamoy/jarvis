import { test } from 'node:test';
import assert from 'node:assert/strict';
import { armar } from '../lib/falsos.mjs';
import { zonaDeTexto, localAUtc } from '../lib/tiempo.mjs';

test('reconoce ciudades con y sin tilde', () => {
  assert.equal(zonaDeTexto('Bogotá').tz, 'America/Bogota');
  assert.equal(zonaDeTexto('Hotel en Medellin, Colombia').tz, 'America/Bogota');
  assert.equal(zonaDeTexto('Rua X, Porto').tz, 'Europe/Lisbon');
  assert.equal(zonaDeTexto('Zoom'), null);
});

test('localAUtc respeta la zona', () => {
  assert.equal(localAUtc('2026-10-12T09:00', 'Europe/Lisbon').toISOString(), '2026-10-12T08:00:00.000Z');
  assert.equal(localAUtc('2026-10-12T09:00', 'America/Bogota').toISOString(), '2026-10-12T14:00:00.000Z');
});

test('"/zona America/Bogota" cambia la zona y todos los horarios se recalculan', async () => {
  const j = armar({ inicio: '2026-10-12T13:00:00Z', estado: { dias: { '2026-10-12': { reporte: { at: 1 } } } } });
  await j.escribir('/zona America/Bogota');
  assert.equal(j.app.tz(), 'America/Bogota');
  assert.match(j.kapso.salida.at(-1).texto, /Zona cambiada a America\/Bogota\. Allá son las 08:00/);
  // 23:30 en Lisboa ya no es noche en Bogotá (18:30): no hay silencio nocturno
  j.reloj.ir('2026-10-12T22:30:00Z');
  assert.equal(j.app.silencio().silencio, false);
  // y 23:30 en Bogotá sí
  j.reloj.ir('2026-10-13T04:30:00Z');
  assert.equal(j.app.silencio().motivo, 'noche');
});

test('el reporte fallback sale a las 09:00 de Bogotá después de cambiar la zona', async () => {
  const j = armar({ inicio: '2026-10-12T05:00:00Z', estado: { ultimoMensajeAt: new Date('2026-10-12T05:00:00Z').getTime() } });
  await j.app.cambiarZona('America/Bogota'); // 00:00 en Bogotá
  j.reloj.ir('2026-10-12T08:00:00Z'); // 09:00 Lisboa, 03:00 Bogotá
  await j.tick();
  assert.equal(j.kapso.salida.length, 0);
  j.reloj.ir('2026-10-12T14:00:00Z'); // 09:00 Bogotá
  await j.tick();
  assert.match(j.kapso.salida[0].texto, /Reporte de claridad/);
});

test('"estoy en Bogotá" cambia la zona sin pasar por Claude', async () => {
  const j = armar({ estado: { dias: { '2026-10-12': { reporte: { at: 1 } } } } });
  await j.escribir('estoy en Bogotá');
  assert.equal(j.app.tz(), 'America/Bogota');
  assert.equal(j.claude.llamadas.length, 0);
});

test('detecta el aterrizaje de un vuelo y pregunta con botones', async () => {
  const j = armar({
    inicio: '2026-10-12T12:00:00Z',
    estado: { dias: { '2026-10-12': { reporte: { at: 1 } } }, ultimoMensajeAt: new Date('2026-10-12T11:00:00Z').getTime() },
    eventos: [{ id: 'v1', titulo: 'Vuelo a Bogotá (TP 155)', inicio: '2026-10-12T13:00:00Z', fin: '2026-10-12T22:00:00Z', zonaInicio: 'Europe/Lisbon', zonaFin: 'America/Bogota' }],
  });
  await j.tick();
  assert.equal(j.kapso.salida.length, 0, 'todavía no aterriza');
  j.reloj.ir('2026-10-12T22:05:00Z'); // 23:05 Lisboa: es de noche en Lisboa, se acumula
  await j.tick();
  assert.equal(j.app.estado.pendientes.at(-1).tipo, 'botones');
  await j.tocar('zona:America/Bogota:si');
  assert.equal(j.app.tz(), 'America/Bogota');
  assert.ok(j.kapso.salida.some((m) => /aterrizó en Bogota/.test(m.texto || '')));
});
