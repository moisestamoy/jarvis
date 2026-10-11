// Reporte de claridad: siempre el mismo formato, 7 bloques en orden, menos de 10 líneas.
// El bridge arma todo con datos; Claude solo elige la prioridad, su porqué y lo que puede esperar.
import { horaLocal } from './tiempo.mjs';

export const BLOQUES = ['💪', '📅', '📊', '👥', '🎯', '⏸️', '🧾'];
const corta = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);
const num = (x, d = 0) => (x == null ? null : Number(x).toFixed(d).replace('.', ','));

export function negocioDe(titulo, negocios) {
  for (const n of negocios) if (new RegExp(n.claves, 'i').test(titulo)) return n.nombre;
  return 'Otros';
}

// Eventos de hoy (los que no han terminado) agrupados por negocio, en el orden de NEGOCIOS.
export function agruparAgenda(eventos, negocios, tz, ahora) {
  const grupos = new Map();
  for (const e of eventos) {
    if (e.todoElDia || new Date(e.fin) <= ahora) continue;
    const n = negocioDe(e.titulo, negocios);
    if (!grupos.has(n)) grupos.set(n, []);
    grupos.get(n).push(`${horaLocal(new Date(e.inicio), tz)} ${e.titulo}`);
  }
  const orden = [...negocios.map((n) => n.nombre), 'Otros'];
  return orden.filter((n) => grupos.has(n)).map((n) => ({ negocio: n, items: grupos.get(n) }));
}

export function lineaCuerpo(w) {
  if (!w) return '💪 Cuerpo: sin datos de WHOOP';
  const p = [];
  if (w.horas != null) p.push(`${num(w.horas, 1)} h dormidas`);
  if (w.recovery != null) p.push(`recovery ${Math.round(w.recovery)}%`);
  if (w.hrv != null) p.push(`HRV ${Math.round(w.hrv)} ms`);
  return `💪 Cuerpo: ${p.join(' · ') || 'sin datos de WHOOP'}`;
}

// datos: { titulo, whoop, agenda: [{negocio, items}], numeros: string|null, acuerdos: [...], prioridad: {texto, porque},
//          puedeEsperar: [], vencidos: [{texto, vence}], abiertos, limite, hoy }
export function renderReporte(d) {
  const agenda = d.agenda.length ? d.agenda.map((g) => `${g.negocio}: ${g.items.join(', ')}`).join(' · ') : 'nada más en el calendario';
  const equipos = d.acuerdos.length
    ? d.acuerdos.slice(0, 4).map((a) => `${a.responsable} (${a.negocio}) ${a.texto}${a.vence < d.hoy ? ' — vencido' : ' — vence hoy'}`).join(' · ') + (d.acuerdos.length > 4 ? ` · +${d.acuerdos.length - 4}` : '')
    : 'sin acuerdos que venzan hoy';
  const cuenta = d.vencidos.length
    ? `${d.vencidos.slice(0, 3).map((c) => `"${c.texto}" (vencía ${c.vence.slice(5)})`).join(', ')}${d.vencidos.length > 3 ? ` y ${d.vencidos.length - 3} más` : ''}`
    : 'nada vencido';
  const lineas = [
    `*${d.titulo}*`,
    lineaCuerpo(d.whoop),
    `📅 Hoy: ${agenda}`,
    `📊 Números del mes: ${d.numeros || 'pendiente de conectar'}`,
    `👥 Equipos: ${equipos}`,
    `🎯 *Prioridad:* ${d.prioridad.texto}${d.prioridad.porque ? ` — ${d.prioridad.porque}` : ''}`,
    `⏸️ Puede esperar: ${d.puedeEsperar.length ? d.puedeEsperar.join(', ') : 'nada en particular'}`,
    `🧾 Cuenta pendiente: ${cuenta} · Abiertos ${d.abiertos}/${d.limite}`,
  ];
  return lineas.map((l) => corta(l, 400)).join('\n');
}

// Respuesta de Claude para la prioridad: JSON { prioridad, porque, compromisoId, puedeEsperar }.
export function leerPrioridad(texto, abiertos) {
  try {
    const j = JSON.parse(texto.slice(texto.indexOf('{'), texto.lastIndexOf('}') + 1));
    if (typeof j.prioridad !== 'string' || !j.prioridad.trim()) throw new Error();
    const id = abiertos.some((c) => c.id === j.compromisoId) ? j.compromisoId : null;
    return {
      texto: corta(j.prioridad.trim(), 140), porque: typeof j.porque === 'string' ? corta(j.porque.trim(), 140) : '',
      compromisoId: id, puedeEsperar: Array.isArray(j.puedeEsperar) ? j.puedeEsperar.filter((x) => typeof x === 'string').slice(0, 4).map((x) => corta(x, 60)) : [],
    };
  } catch { return null; }
}

// Si Claude falla: el compromiso abierto que vence antes.
export function prioridadRespaldo(abiertos) {
  const c = [...abiertos].sort((a, b) => a.vence.localeCompare(b.vence))[0];
  return c
    ? { texto: c.texto, porque: `es lo que vence primero (${c.vence})`, compromisoId: c.id, puedeEsperar: [] }
    : { texto: 'Definir la prioridad del día', porque: 'no hay compromisos abiertos registrados', compromisoId: null, puedeEsperar: [] };
}
