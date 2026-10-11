import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extraer, validar, requiereConfirmacion } from '../lib/acciones.mjs';
import { armar } from '../lib/falsos.mjs';

const tz = 'Europe/Lisbon';
const bloque = (a) => `Listo, señor.\n\n\`\`\`jarvis-acciones\n${JSON.stringify(a)}\n\`\`\``;
const responde = (acciones) => async (o) => (o.sesion === 'chat' ? bloque(acciones) : null);
const yaReportado = { dias: { '2026-10-12': { reporte: { at: 1 } } } };

test('extrae el bloque y lo quita del mensaje', () => {
  const r = extraer(bloque([{ tipo: 'cierre.completo' }]));
  assert.equal(r.limpio, 'Listo, señor.');
  assert.deepEqual(r.acciones, [{ tipo: 'cierre.completo' }]);
  assert.equal(extraer('```jarvis-acciones\n{roto\n```').errores.length, 1);
});

test('rechaza invitados, otros calendarios, tipos desconocidos y fechas malas', () => {
  const ok = { tipo: 'calendar.crear', titulo: 'Foco', inicio: '2026-10-12T10:00', fin: '2026-10-12T11:00' };
  assert.equal(validar(ok, { tz }).ok, true);
  assert.match(validar({ ...ok, attendees: ['a@b.com'] }, { tz }).error, /attendees/);
  assert.match(validar({ ...ok, calendarId: 'otro' }, { tz }).error, /calendarId/);
  assert.match(validar({ ...ok, fin: '2026-10-12T09:00' }, { tz }).error, /después/);
  assert.match(validar({ ...ok, inicio: 'mañana' }, { tz }).error, /AAAA/);
  assert.match(validar({ tipo: 'gmail.enviar' }, { tz }).error, /desconocido/);
  assert.match(validar({ tipo: 'zona.cambiar', tz: 'Marte/Base' }, { tz }).error, /zona inválida/);
  assert.equal(validar({ tipo: 'metrica', clave: 'caos', valor: 9 }, { tz }).ok, false);
});

test('borrar siempre confirma; mover solo si hay invitados', () => {
  assert.equal(requiereConfirmacion({ tipo: 'calendar.borrar' }, { invitados: [] }), true);
  assert.equal(requiereConfirmacion({ tipo: 'calendar.mover' }, { invitados: [] }), false);
  assert.equal(requiereConfirmacion({ tipo: 'calendar.mover' }, { invitados: ['Luz'] }), true);
  assert.equal(requiereConfirmacion({ tipo: 'calendar.crear' }, null), false);
});

test('crear un bloque se ejecuta directo y se informa', async () => {
  const j = armar({ estado: yaReportado, claude: undefined });
  j.claude.ejecutar = async (o) => ({ texto: await responde([{ tipo: 'calendar.crear', titulo: 'Foco Fiama', inicio: '2026-10-12T15:00', fin: '2026-10-12T16:00' }])(o) || '{}' });
  await j.escribir('bloquéame 15 a 16 para Fiama');
  assert.equal(j.calendario.llamadas[0][0], 'crear');
  assert.match(j.kapso.salida.at(-1).texto, /Listo, señor\.\n\n✔ Bloque creado: Foco Fiama, 10-12 15:00–16:00/);
});

test('mover un evento con invitados pide "Sí" y solo entonces lo ejecuta', async () => {
  const j = armar({ estado: yaReportado, eventos: [{ id: 'd1', titulo: 'Daily Fiama', inicio: '2026-10-12T10:00:00Z', fin: '2026-10-12T10:30:00Z', invitados: ['Luz', 'Flor'] }] });
  j.claude.ejecutar = async (o) => ({ texto: await responde([{ tipo: 'calendar.mover', eventoId: 'd1', inicio: '2026-10-12T12:00', fin: '2026-10-12T12:30' }])(o) || '{}' });
  await j.escribir('mueve la daily de Fiama a las 12');
  assert.equal(j.calendario.llamadas.length, 0, 'todavía no mueve');
  const pregunta = j.kapso.salida.at(-1);
  assert.equal(pregunta.tipo, 'botones');
  assert.match(pregunta.texto, /Tiene invitados: Luz, Flor/);
  await j.tocar(pregunta.botones[0].id);
  assert.equal(j.calendario.llamadas[0][0], 'mover');
  assert.match(j.kapso.salida.at(-1).texto, /✔ Movido: Daily Fiama/);
});

test('borrar con "No" cancela, y una confirmación vieja caduca a los 30 min', async () => {
  const j = armar({ estado: yaReportado, eventos: [{ id: 'b1', titulo: 'Bloque viejo', inicio: '2026-10-12T15:00:00Z', fin: '2026-10-12T16:00:00Z' }] });
  j.claude.ejecutar = async (o) => ({ texto: await responde([{ tipo: 'calendar.borrar', eventoId: 'b1' }])(o) || '{}' });
  await j.escribir('borra el bloque viejo');
  const [si, no] = j.kapso.salida.at(-1).botones;
  await j.tocar(no.id);
  assert.match(j.kapso.salida.at(-1).texto, /Cancelado/);
  await j.escribir('borra el bloque viejo');
  const si2 = j.kapso.salida.at(-1).botones[0];
  j.reloj.avanzar(31);
  await j.tocar(si2.id);
  assert.match(j.kapso.salida.at(-1).texto, /caducó/);
  assert.equal(j.calendario.llamadas.length, 0);
  assert.ok(si);
});

test('una acción inválida se rechaza y se avisa, sin ejecutar nada', async () => {
  const j = armar({ estado: yaReportado });
  j.claude.ejecutar = async (o) => ({ texto: await responde([{ tipo: 'calendar.crear', titulo: 'Reunión', inicio: '2026-10-12T15:00', fin: '2026-10-12T16:00', invitados: ['luz@x.com'] }])(o) || '{}' });
  await j.escribir('agenda reunión con Luz');
  assert.equal(j.calendario.llamadas.length, 0);
  assert.match(j.kapso.salida.at(-1).texto, /Acción rechazada: campo no permitido: invitados/);
});
