import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderReporte, BLOQUES, agruparAgenda } from '../lib/reporte.mjs';
import { armar } from '../lib/falsos.mjs';
import { NEGOCIOS_DEFAULT } from '../lib/config.mjs';

const base = {
  titulo: 'Reporte de claridad · lun 12 oct', whoop: { horas: 7.4, recovery: 78, hrv: 84 },
  agenda: [{ negocio: 'AntoEcom', items: ['09:30 Daily AntoEcom'] }, { negocio: 'Fiama', items: ['11:00 Daily Fiama'] }],
  numeros: null, acuerdos: [{ texto: 'Lanzar campaña', vence: '2026-10-11', responsable: 'Luz', negocio: 'AntoEcom' }],
  prioridad: { texto: 'Cerrar proyección de noviembre', porque: 'bloquea al equipo' }, puedeEsperar: ['Revisar correos'],
  vencidos: [{ texto: 'Mandar feedback a Flor', vence: '2026-10-11' }], abiertos: 4, limite: 5, hoy: '2026-10-12',
};

test('el reporte tiene menos de 10 líneas y los 7 bloques en orden', () => {
  const lineas = renderReporte(base).split('\n');
  assert.ok(lineas.length < 10, `tiene ${lineas.length} líneas`);
  const cuerpo = lineas.slice(1);
  assert.equal(cuerpo.length, 7);
  BLOQUES.forEach((emoji, i) => assert.ok(cuerpo[i].startsWith(emoji), `línea ${i + 1} debería empezar con ${emoji}: ${cuerpo[i]}`));
});

test('el reporte muestra los datos de cada bloque', () => {
  const r = renderReporte(base);
  assert.match(r, /7,4 h dormidas · recovery 78% · HRV 84 ms/);
  assert.match(r, /AntoEcom: 09:30 Daily AntoEcom · Fiama: 11:00 Daily Fiama/);
  assert.match(r, /Números del mes: pendiente de conectar/);
  assert.match(r, /Luz \(AntoEcom\) Lanzar campaña — vencido/);
  assert.match(r, /Prioridad:\* Cerrar proyección de noviembre — bloquea al equipo/);
  assert.match(r, /Abiertos 4\/5/);
});

test('sin datos sigue teniendo los 7 bloques', () => {
  const lineas = renderReporte({ ...base, whoop: null, agenda: [], acuerdos: [], vencidos: [], puedeEsperar: [] }).split('\n');
  assert.equal(lineas.length, 8);
  assert.match(lineas[1], /sin datos de WHOOP/);
});

test('la agenda se agrupa por negocio y omite lo que ya terminó', () => {
  const ahora = new Date('2026-10-12T10:00:00Z');
  const ev = [
    { titulo: 'Daily Fiama', inicio: '2026-10-12T10:30:00Z', fin: '2026-10-12T11:00:00Z' },
    { titulo: 'Daily AntoEcom', inicio: '2026-10-12T08:00:00Z', fin: '2026-10-12T08:30:00Z' },
    { titulo: 'Sync Imperio YT', inicio: '2026-10-12T14:00:00Z', fin: '2026-10-12T15:00:00Z' },
    { titulo: 'Dentista', inicio: '2026-10-12T16:00:00Z', fin: '2026-10-12T17:00:00Z' },
  ];
  const g = agruparAgenda(ev, NEGOCIOS_DEFAULT, 'Europe/Lisbon', ahora);
  assert.deepEqual(g.map((x) => x.negocio), ['Imperio YT', 'Fiama', 'Otros']);
  assert.deepEqual(g[1].items, ['11:30 Daily Fiama']);
});

test('el primer mensaje del día dispara el reporte con botones; un saludo no gasta una conversación', async () => {
  const j = armar({ eventos: [{ id: 'e1', titulo: 'Daily AntoEcom', inicio: '2026-10-12T09:00:00Z', fin: '2026-10-12T09:30:00Z' }] });
  await j.escribir('buenos días');
  const [reporte, botones] = j.kapso.salida;
  assert.equal(reporte.tipo, 'texto');
  assert.match(reporte.texto, /^\*Reporte de claridad/);
  assert.match(reporte.texto, /AntoEcom: 10:00 Daily AntoEcom/);
  assert.equal(botones.tipo, 'botones');
  assert.deepEqual(botones.botones.map((b) => b.id), ['prio:hecho', 'prio:manana', 'prio:soltar']);
  assert.equal(j.claude.llamadas.filter((l) => l.sesion === 'chat').length, 0);
  // métrica: hora en que supo su prioridad
  const m = JSON.parse(j.memoria.leer('metricas/2026-10-12.json'));
  assert.equal(m.hora_prioridad, '08:30');
  // un segundo mensaje ya no repite el reporte
  await j.escribir('¿qué tengo a las 10?');
  assert.equal(j.kapso.salida.filter((m) => m.texto?.startsWith('*Reporte')).length, 1);
});

test('si no escribe, el reporte llega a la hora fallback', async () => {
  const j = armar({ estado: { ultimoMensajeAt: new Date('2026-10-12T06:00:00Z').getTime() } });
  await j.tick(); // 08:30 Lisboa
  assert.equal(j.kapso.salida.length, 0);
  j.reloj.ir('2026-10-12T08:00:00Z'); // 09:00 Lisboa
  await j.tick();
  assert.match(j.kapso.salida[0].texto, /^\*Reporte de claridad/);
});

test('el botón ✅ de la prioridad cierra el compromiso y lo registra', async () => {
  const j = armar();
  j.memoria.escribir('compromisos.md', '# Compromisos\n\n## Abiertos\n- [ ] Cerrar proyección · vence 2026-10-12 · AntoEcom · id:c-0001\n\n## Cerrados\n');
  await j.escribir('hola');
  await j.tocar('prio:hecho');
  assert.match(j.memoria.leer('compromisos.md'), /- \[x\] Cerrar proyección .* id:c-0001 · hecho 2026-10-12/);
  assert.equal(JSON.parse(j.memoria.leer('metricas/2026-10-12.json')).prioridad_cumplida, true);
});
