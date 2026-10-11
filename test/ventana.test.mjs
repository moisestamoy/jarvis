import { test } from 'node:test';
import assert from 'node:assert/strict';
import { armar } from '../lib/falsos.mjs';

test('con la ventana de 24 h cerrada manda el ping y acumula; al responder llega todo', async () => {
  const j = armar({ inicio: '2026-10-12T08:00:00Z', estado: { ultimoMensajeAt: new Date('2026-10-10T08:00:00Z').getTime() } });
  await j.tick(); // 09:00 Lisboa: toca el reporte fallback
  assert.deepEqual(j.kapso.salida.map((m) => m.tipo), ['plantilla']);
  assert.equal(j.kapso.salida[0].nombre, 'jarvis_ping');
  assert.ok(j.app.estado.pendientes.length >= 2, 'reporte y botones quedan acumulados');
  await j.escribir('aquí estoy');
  const tipos = j.kapso.salida.map((m) => m.tipo);
  assert.deepEqual(tipos.slice(0, 3), ['plantilla', 'texto', 'botones']);
  assert.match(j.kapso.salida[1].texto, /Reporte de claridad/);
  // el reporte acumulado cuenta para la métrica cuando de verdad llega
  assert.equal(JSON.parse(j.memoria.leer('metricas/2026-10-12.json')).hora_prioridad, '09:00');
});

test('máximo 2 pings por día, separados por al menos 3 horas, nunca en silencio', async () => {
  const j = armar({ inicio: '2026-10-12T08:00:00Z', estado: { ultimoMensajeAt: 0 } });
  const pings = () => j.kapso.salida.filter((m) => m.tipo === 'plantilla').length;
  await j.app.avisar({ tipo: 'texto', texto: 'a' });
  assert.equal(pings(), 1);
  j.reloj.avanzar(60);
  await j.tick();
  assert.equal(pings(), 1, 'no antes de 3 h');
  j.reloj.avanzar(130);
  await j.tick();
  assert.equal(pings(), 2);
  j.reloj.avanzar(240);
  await j.tick();
  assert.equal(pings(), 2, 'tope de 2 por día');
});

test('no hace ping de noche', async () => {
  const j = armar({ inicio: '2026-10-12T23:30:00Z', estado: { ultimoMensajeAt: 0 } });
  await j.app.avisar({ tipo: 'texto', texto: 'a' });
  await j.tick();
  assert.equal(j.kapso.salida.length, 0);
});
