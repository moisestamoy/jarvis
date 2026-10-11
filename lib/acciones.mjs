// Claude propone acciones en un bloque ```jarvis-acciones [...] ```; el bridge lo quita del mensaje,
// valida cada acción contra su esquema y decide si necesita confirmación antes de ejecutarla.
import { zonaValida, localAUtc } from './tiempo.mjs';

const BLOQUE = /```jarvis-acciones\s*\n?([\s\S]*?)```/g;

export function extraer(texto) {
  const acciones = [];
  const errores = [];
  const limpio = texto.replace(BLOQUE, (_, json) => {
    try {
      const v = JSON.parse(json.trim());
      acciones.push(...(Array.isArray(v) ? v : [v]));
    } catch (e) { errores.push(`bloque jarvis-acciones inválido: ${e.message}`); }
    return '';
  }).replace(/\n{3,}/g, '\n\n').trim();
  return { limpio, acciones, errores };
}

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const LOCAL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
// Nada de invitados ni de otros calendarios: si aparecen, la acción se rechaza entera.
const CLAVES_PROHIBIDAS = ['attendees', 'invitados', 'calendarId', 'calendario', 'calendar', 'guests', 'email', 'to', 'destinatario'];
const AJUSTES = ['silencioInicio', 'silencioFin', 'reporteFallback'];

const texto = (v, max) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;

function validarRango(a, tz) {
  if (!LOCAL.test(a.inicio || '') || !LOCAL.test(a.fin || '')) return 'inicio y fin deben ser AAAA-MM-DDTHH:MM';
  const i = localAUtc(a.inicio, tz), f = localAUtc(a.fin, tz);
  if (!(f > i)) return 'fin debe ser después de inicio';
  if (f - i > 12 * 3600_000) return 'un bloque no puede durar más de 12 horas';
  return null;
}

// → { ok: true, accion } | { ok: false, error }
export function validar(a, { tz }) {
  if (!a || typeof a !== 'object' || Array.isArray(a)) return { ok: false, error: 'acción no es un objeto' };
  const prohibida = CLAVES_PROHIBIDAS.find((k) => k in a);
  if (prohibida) return { ok: false, error: `campo no permitido: ${prohibida}` };
  const e = (error) => ({ ok: false, error: `${a.tipo}: ${error}` });
  switch (a.tipo) {
    case 'calendar.crear': {
      if (!texto(a.titulo, 200)) return e('falta titulo');
      const err = validarRango(a, tz); if (err) return e(err);
      return { ok: true, accion: { tipo: a.tipo, titulo: a.titulo.trim(), inicio: a.inicio, fin: a.fin, descripcion: typeof a.descripcion === 'string' ? a.descripcion.slice(0, 1000) : '' } };
    }
    case 'calendar.mover': {
      if (!texto(a.eventoId, 300)) return e('falta eventoId');
      const err = validarRango(a, tz); if (err) return e(err);
      return { ok: true, accion: { tipo: a.tipo, eventoId: a.eventoId, inicio: a.inicio, fin: a.fin } };
    }
    case 'calendar.borrar':
      if (!texto(a.eventoId, 300)) return e('falta eventoId');
      return { ok: true, accion: { tipo: a.tipo, eventoId: a.eventoId } };
    case 'zona.cambiar':
      if (!zonaValida(a.tz)) return e(`zona inválida: ${a.tz}`);
      return { ok: true, accion: { tipo: a.tipo, tz: a.tz } };
    case 'compromiso.crear':
      if (!texto(a.texto, 200)) return e('falta texto');
      if (!FECHA.test(a.vence || '')) return e('vence debe ser AAAA-MM-DD');
      return { ok: true, accion: { tipo: a.tipo, texto: a.texto, vence: a.vence, negocio: typeof a.negocio === 'string' ? a.negocio.slice(0, 40) : '' } };
    case 'compromiso.actualizar': {
      if (!/^c-\d+$/.test(a.id || '')) return e('id inválido');
      if (a.estado && !['hecho', 'soltado', 'abierto'].includes(a.estado)) return e('estado inválido');
      if (a.vence && !FECHA.test(a.vence)) return e('vence debe ser AAAA-MM-DD');
      if (!a.estado && !a.vence) return e('nada que cambiar');
      return { ok: true, accion: { tipo: a.tipo, id: a.id, ...(a.estado ? { estado: a.estado } : {}), ...(a.vence ? { vence: a.vence } : {}) } };
    }
    case 'metrica':
      if (a.evento === 'pidio_numeros') return { ok: true, accion: { tipo: a.tipo, evento: a.evento } };
      if (a.clave === 'caos' && Number.isInteger(a.valor) && a.valor >= 1 && a.valor <= 5) return { ok: true, accion: { tipo: a.tipo, clave: 'caos', valor: a.valor } };
      return e('métrica no reconocida');
    case 'ajuste':
      if (!AJUSTES.includes(a.clave) || !HHMM.test(a.valor || '')) return e(`ajuste inválido (claves: ${AJUSTES.join(', ')}; valor HH:MM)`);
      return { ok: true, accion: { tipo: a.tipo, clave: a.clave, valor: a.valor } };
    case 'cierre.completo':
    case 'onboarding.completo':
      return { ok: true, accion: { tipo: a.tipo } };
    default:
      return { ok: false, error: `tipo desconocido: ${a.tipo}` };
  }
}

// Borrar siempre pide "sí"; mover también si el evento tiene otros invitados (o si no se pudo verificar).
export function requiereConfirmacion(accion, evento) {
  if (accion.tipo === 'calendar.borrar') return true;
  if (accion.tipo === 'calendar.mover') return !evento || (evento.invitados || []).length > 0;
  return false;
}

export const CONFIRMACION_MS = 30 * 60_000;
