#!/usr/bin/env node
// Simulador local de JARVIS: tus mensajes y toques de botón, con reloj, calendario y WhatsApp falsos.
// No manda nada ni toca tu calendario.
//   node scripts/simular.mjs                    → modo interactivo
//   node scripts/simular.mjs scripts/demo.txt   → corre un guion (una orden por línea)
//   SIM_CLAUDE=real node scripts/simular.mjs    → usa tu Claude Code de verdad (sobre una memoria temporal)
//
// Órdenes:  texto libre = mensaje tuyo · /boton <id> · /hora 2026-10-12T09:00 (hora local) · /avanzar <min>
//           /tick · /estado · /memoria <archivo> · /salir
import fs from 'node:fs';
import readline from 'node:readline';
import { armar, claudeFalso, memoriaTemporal, PERFIL_EJEMPLO } from '../lib/falsos.mjs';
import { crearClaude } from '../lib/claude.mjs';
import { localAUtc, horaLocal } from '../lib/tiempo.mjs';
import * as C from '../lib/compromisos.mjs';

const RAIZ = new URL('..', import.meta.url).pathname;
const gris = (s) => `\x1b[90m${s}\x1b[0m`;
const azul = (s) => `\x1b[36m${s}\x1b[0m`;

function imprimir(m) {
  const cab = azul('JARVIS ▸');
  if (m.tipo === 'texto') console.log(`${cab} ${m.texto.replace(/\n/g, '\n         ')}\n`);
  else if (m.tipo === 'plantilla') console.log(`${cab} ${gris(`[plantilla ${m.nombre}: la ventana de 24 h está cerrada]`)}\n`);
  else if (m.tipo === 'botones') console.log(`${cab} ${m.texto}\n         ${m.botones.map((b) => `[${b.title}] ${gris('/boton ' + b.id)}`).join('\n         ')}\n`);
  else if (m.tipo === 'lista') console.log(`${cab} ${m.texto}\n         ${m.filas.map((f) => `· ${f.title} ${gris('/boton ' + f.id)}`).join('\n         ')}\n`);
}

// Un lunes típico (horas en Lisboa = UTC+1 en octubre).
const eventos = [
  { id: 'd-anto', titulo: 'Daily AntoEcom', inicio: '2026-10-12T08:30:00Z', fin: '2026-10-12T09:00:00Z', invitados: ['Luz', 'Flor'] },
  { id: 'd-fiama', titulo: 'Daily Fiama', inicio: '2026-10-12T10:00:00Z', fin: '2026-10-12T10:30:00Z', invitados: ['Equipo Fiama'] },
  { id: 'b-proy', titulo: 'Bloque: proyección noviembre', inicio: '2026-10-12T14:00:00Z', fin: '2026-10-12T15:00:00Z' },
  { id: 's-yt', titulo: 'Sync Imperio YT', inicio: '2026-10-12T16:00:00Z', fin: '2026-10-12T16:45:00Z', invitados: ['Emmanuel'] },
];

const ruta = memoriaTemporal({ perfil: process.env.SIM_ONBOARDING === '1' ? '' : PERFIL_EJEMPLO });
let doc = C.parsear(fs.readFileSync(`${ruta}/compromisos.md`, 'utf8'));
doc = C.agregar(doc, { texto: 'Cerrar proyección de noviembre', vence: '2026-10-12', negocio: 'AntoEcom' }, 5).doc;
doc = C.agregar(doc, { texto: 'Feedback a Flor sobre el guion', vence: '2026-10-10', negocio: 'AntoEcom' }, 5).doc;
fs.writeFileSync(`${ruta}/compromisos.md`, C.serializar(doc));
fs.appendFileSync(`${ruta}/negocios/fiama.md`, '- [ ] Subir el informe de stock · vence 2026-10-12 · resp: Carla\n');

const estadoSim = { data: {}, guardar() {} };
const claude = process.env.SIM_CLAUDE === 'real'
  ? crearClaude({ bin: process.env.CLAUDE_BIN || 'claude', timeoutMs: 5 * 60_000, estado: estadoSim, log: (...a) => console.log(gris(a.join(' '))) })
  : claudeFalso();
const j = armar({ inicio: '2026-10-12T07:20:00Z', eventos, memoria: ruta, estado: estadoSim.data, claude, imprimir });
estadoSim.guardar = () => {};
if (process.env.SIM_CLAUDE === 'real') j.app.estado.sesiones = {};
const sistema = fs.readFileSync(`${RAIZ}/system-prompt.md`, 'utf8');
if (process.env.SIM_CLAUDE === 'real') console.log(gris(`Claude real. Memoria temporal: ${ruta}. System prompt: ${sistema.length} caracteres.`));

const relojTexto = () => `${horaLocal(j.reloj.ahora(), j.app.tz())} ${j.app.tz()}`;
console.log(gris(`Simulador de JARVIS · lunes 12 oct, ${relojTexto()} · memoria temporal: ${ruta}`));
console.log(gris('Escribe como si fueras Moisés. /boton <id> para tocar un botón, /hora 2026-10-12T22:30, /avanzar 30, /estado, /salir.\n'));

async function orden(linea) {
  linea = linea.trim();
  if (!linea || linea.startsWith('#')) return;
  console.log(`${gris(relojTexto())}  TÚ ▸ ${linea}`);
  const [cmd, ...resto] = linea.split(' ');
  const arg = resto.join(' ');
  if (cmd === '/salir') process.exit(0);
  if (cmd === '/boton') return j.tocar(arg);
  if (cmd === '/hora') { j.reloj.ir(localAUtc(arg, j.app.tz())); return j.tick(); }
  if (cmd === '/avanzar') {
    for (let i = 0; i < Number(arg); i++) { j.reloj.avanzar(1); await j.tick(); }
    return;
  }
  if (cmd === '/tick') return j.tick();
  if (cmd === '/estado') {
    const s = j.app.estado;
    const ab = C.abiertos(C.parsear(j.memoria.leer('compromisos.md')));
    console.log(gris(JSON.stringify({ zona: s.tz, silencio: j.app.silencio(), pendientes: s.pendientes.length, abiertos: ab.map((c) => `${c.id} ${c.texto} (${c.vence})`), ajustes: s.ajustes }, null, 2)) + '\n');
    return;
  }
  if (cmd === '/memoria') { console.log(gris(j.memoria.leer(arg) || '(vacío)') + '\n'); return; }
  return j.escribir(linea);
}

if (process.argv[2]) {
  for (const l of fs.readFileSync(process.argv[2], 'utf8').split('\n')) await orden(l);
  process.exit(0);
}
const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: '' });
rl.on('line', (l) => { rl.pause(); orden(l).catch((e) => console.error(e)).finally(() => rl.resume()); });
