// Dobles de prueba: reloj, WhatsApp, calendario, Claude y WHOOP falsos. Los usan test/ y scripts/simular.mjs.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { crearApp } from './app.mjs';
import { crearMemoria } from './memoria.mjs';
import { crearMetricas } from './metricas.mjs';
import { leerConfig } from './config.mjs';
import { localAUtc } from './tiempo.mjs';

const RAIZ = path.dirname(path.dirname(new URL(import.meta.url).pathname));

export function relojFalso(iso) {
  let t = new Date(iso).getTime();
  return { ahora: () => new Date(t), ir: (x) => { t = new Date(x).getTime(); }, avanzar: (min) => { t += min * 60_000; } };
}

export function kapsoFalso(imprimir = null) {
  const salida = [];
  const push = (m) => { salida.push(m); if (imprimir) imprimir(m); };
  return {
    salida,
    texto: async (to, texto) => push({ tipo: 'texto', texto }),
    plantilla: async (to, nombre) => push({ tipo: 'plantilla', nombre }),
    botones: async (to, texto, botones) => push({ tipo: 'botones', texto, botones }),
    lista: async (to, texto, boton, filas) => push({ tipo: 'lista', texto, filas }),
  };
}

export function calendarioFalso(eventos = []) {
  const ev = eventos.map((e) => ({ invitados: [], todoElDia: false, ubicacion: '', zonaInicio: '', zonaFin: '', ...e }));
  const llamadas = [];
  return {
    eventos: ev, llamadas,
    conectado: () => true,
    listar: async (desde, hasta) => ev.filter((e) => new Date(e.fin) > desde && new Date(e.inicio) < hasta),
    obtener: async (id) => ev.find((e) => e.id === id) || null,
    crear: async (a, tz) => {
      llamadas.push(['crear', a]);
      const e = { id: `nuevo-${ev.length + 1}`, titulo: a.titulo, inicio: localAUtc(a.inicio, tz).toISOString(), fin: localAUtc(a.fin, tz).toISOString(), invitados: [], todoElDia: false };
      ev.push(e);
      return e;
    },
    mover: async (id, a, tz) => {
      llamadas.push(['mover', id, a]);
      const e = ev.find((x) => x.id === id);
      if (e) { e.inicio = localAUtc(a.inicio, tz).toISOString(); e.fin = localAUtc(a.fin, tz).toISOString(); }
      return e;
    },
    borrar: async (id) => { llamadas.push(['borrar', id]); const i = ev.findIndex((x) => x.id === id); if (i >= 0) ev.splice(i, 1); },
  };
}

// responder(opts) → texto. Por defecto: elige como prioridad el primer compromiso abierto, y en el chat responde corto.
export function claudeFalso(responder = null) {
  const llamadas = [];
  const porDefecto = (o) => {
    if (o.herramientas === 'lectura') {
      const datos = JSON.parse(o.prompt.slice(o.prompt.indexOf('{')));
      const c = datos.abiertos?.[0];
      return JSON.stringify({ prioridad: c ? c.texto : 'Ordenar la semana', porque: 'es lo que más mueve la meta del mes', compromisoId: c?.id || null, puedeEsperar: ['Revisar correos'] });
    }
    return 'Entendido, señor.';
  };
  return {
    llamadas,
    ejecutar: async (o) => { llamadas.push(o); return { texto: await (responder || porDefecto)(o) ?? porDefecto(o) }; },
  };
}

export const whoopFalso = (datos = { horas: 7.4, recovery: 78, hrv: 84 }) => ({ conectado: () => !!datos, hoy: async () => datos, semana: async () => null });

// Copia memoria-inicial/ a una carpeta temporal (sin git).
export function memoriaTemporal({ perfil = null } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-memoria-'));
  fs.cpSync(path.join(RAIZ, 'memoria-inicial'), dir, { recursive: true });
  if (perfil !== null) fs.writeFileSync(path.join(dir, 'perfil.md'), perfil);
  return dir;
}

export const PERFIL_EJEMPLO = '# Perfil\n\nMoisés, Director Comercial de AntoEcom, Imperio YT y Fiama. Cofundador de Congruence. Vive en Porto.\n';

// Arma la app completa con dobles. opciones: { inicio, eventos, claude, whoop, env, perfil, imprimir }
export function armar(op = {}) {
  const reloj = relojFalso(op.inicio || '2026-10-12T07:30:00Z');
  const cfg = { ...leerConfig({ OWNER_PHONE: '351900000000', DRY_RUN: '1', GIT_SYNC: '0', ...(op.env || {}) }) };
  const ruta = op.memoria || memoriaTemporal({ perfil: op.perfil === undefined ? PERFIL_EJEMPLO : op.perfil });
  cfg.memoria = ruta;
  const memoria = crearMemoria({ ruta, gitSync: false, dryRun: true, log: () => {} });
  const kapso = kapsoFalso(op.imprimir);
  const calendario = calendarioFalso(op.eventos || []);
  const claude = op.claude || claudeFalso();
  const estado = { data: op.estado || {}, guardar() {} };
  const app = crearApp({
    cfg, estado, kapso, claude, calendario, whoop: op.whoop || whoopFalso(), memoria, metricas: crearMetricas(memoria),
    sistema: 'SISTEMA', ahora: reloj.ahora, log: op.log || (() => {}),
  });
  // Mensaje de Moisés (texto, audio o botón) y espera a que la cola termine.
  const escribir = async (texto) => { await app.encolar(() => app.manejarEntrada([{ message: { from: cfg.owner, type: 'text', text: { body: texto } } }])); };
  const tocar = async (id) => { await app.encolar(() => app.manejarEntrada([{ message: { from: cfg.owner, type: 'interactive', interactive: { type: 'button_reply', button_reply: { id, title: id } } } }])); };
  const tick = async () => { await app.tick(); await app.encolar(() => {}); };
  return { app, cfg, reloj, kapso, calendario, claude, memoria, estado, escribir, tocar, tick, ruta };
}
