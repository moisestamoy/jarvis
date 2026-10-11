import { test } from 'node:test';
import assert from 'node:assert/strict';
import { armar } from '../lib/falsos.mjs';
import * as C from '../lib/compromisos.mjs';

const conAcciones = (acciones) => async (o) => (o.sesion === 'chat' ? `Anotado, señor.\n\n\`\`\`jarvis-acciones\n${JSON.stringify(acciones)}\n\`\`\`` : null);

test('compromisos.md: ida y vuelta sin perder nada', () => {
  const txt = C.serializar({ cabecera: C.CABECERA.trimEnd(), items: [
    { estado: 'abierto', texto: 'Uno', vence: '2026-10-13', negocio: 'Fiama', id: 'c-0002' },
    { estado: 'hecho', texto: 'Dos', vence: '2026-10-10', negocio: '', id: 'c-0001', cerrado: '2026-10-11' },
  ] });
  const doc = C.parsear(txt);
  assert.equal(doc.items.length, 2);
  assert.equal(C.serializar(doc), txt);
});

test('con 5 abiertos no anota el sexto: muestra la lista para cerrar uno', async () => {
  const j = armar({ estado: { dias: { '2026-10-12': { reporte: { at: 1 } } } } });
  let doc = C.parsear(j.memoria.leer('compromisos.md'));
  for (let i = 1; i <= 5; i++) doc = C.agregar(doc, { texto: `Tarea ${i}`, vence: '2026-10-15' }, 5).doc;
  j.memoria.escribir('compromisos.md', C.serializar(doc));

  j.claude = null;
  const jj = armar({ memoria: j.ruta, estado: j.app.estado, claude: { llamadas: [], ejecutar: async (o) => ({ texto: await conAcciones([{ tipo: 'compromiso.crear', texto: 'Llamar al contador', vence: '2026-10-14' }])(o) || '{}' }) } });
  await jj.escribir('mañana llamo al contador');
  assert.equal(C.abiertos(C.parsear(jj.memoria.leer('compromisos.md'))).length, 5);
  const lista = jj.kapso.salida.find((m) => m.tipo === 'lista');
  assert.ok(lista, 'debe mandar la lista');
  assert.match(lista.texto, /5\/5/);
  assert.equal(lista.filas.length, 10);

  // al cerrar uno, el compromiso en espera se anota solo
  await jj.tocar('c:c-0003:hecho');
  const abiertos = C.abiertos(C.parsear(jj.memoria.leer('compromisos.md')));
  assert.equal(abiertos.length, 5);
  assert.ok(abiertos.some((c) => c.texto === 'Llamar al contador'));
  assert.match(jj.kapso.salida.at(-1).texto, /Ahora sí anoté "Llamar al contador"/);
});

test('el botón ⏳ mueve el compromiso a mañana', async () => {
  const j = armar({ estado: { dias: { '2026-10-12': { reporte: { at: 1 } } } } });
  j.memoria.escribir('compromisos.md', C.serializar(C.agregar(C.parsear(''), { texto: 'X', vence: '2026-10-10' }, 5).doc));
  await j.tocar('c:c-0001:manana');
  assert.equal(C.parsear(j.memoria.leer('compromisos.md')).items[0].vence, '2026-10-13');
});
