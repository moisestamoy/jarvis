// Fechas y horas en la zona horaria actual de Moisés (dinámica, vive en el estado).

export function zonaValida(tz) {
  if (typeof tz !== 'string' || !tz.includes('/')) return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
}

export function partes(d, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23', weekday: 'short',
  }).formatToParts(d).map((x) => [x.type, x.value]));
  return p;
}

export const fechaLocal = (d, tz) => { const p = partes(d, tz); return `${p.year}-${p.month}-${p.day}`; };
export const horaLocal = (d, tz) => { const p = partes(d, tz); return `${p.hour}:${p.minute}`; };
export const diaIso = (d, tz) => ({ Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 })[partes(d, tz).weekday];

export const minutos = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
export const deMinutos = (n) => { n = ((n % 1440) + 1440) % 1440; return `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`; };
export const restarMin = (hhmm, n) => deMinutos(minutos(hhmm) - n);

// ¿hhmm está en [inicio, fin)? Soporta rangos que cruzan la medianoche (23:00 → 07:00).
export function enRango(hhmm, inicio, fin) {
  const x = minutos(hhmm), a = minutos(inicio), b = minutos(fin);
  if (a === b) return false;
  return a < b ? x >= a && x < b : x >= a || x < b;
}

// Desfase (ms) de la zona respecto a UTC en ese instante.
function desfase(d, tz) {
  const p = partes(d, tz);
  const comoUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return comoUtc - Math.floor(d.getTime() / 1000) * 1000;
}

// 'AAAA-MM-DDTHH:MM' en la zona tz → Date (UTC).
export function localAUtc(local, tz) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!m) return null;
  const ingenuo = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  let t = ingenuo - desfase(new Date(ingenuo), tz);
  t = ingenuo - desfase(new Date(t), tz); // segunda pasada por si cae justo en un cambio de horario
  return new Date(t);
}

export const sumarDias = (fecha, n) => {
  const d = new Date(`${fecha}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export const diasEntre = (a, b) => Math.round((new Date(`${b}T12:00:00Z`) - new Date(`${a}T12:00:00Z`)) / 86400000);

export function semanaIso(fecha) {
  const d = new Date(`${fecha}T12:00:00Z`);
  const dia = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dia + 3);
  const primerJueves = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const semana = 1 + Math.round(((d - primerJueves) / 86400000 - 3 + ((primerJueves.getUTCDay() + 6) % 7)) / 7);
  return `${d.getUTCFullYear()}-W${String(semana).padStart(2, '0')}`;
}

export const fechaLarga = (d, tz) => new Intl.DateTimeFormat('es', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long' }).format(d);
export const fechaCorta = (d, tz) => new Intl.DateTimeFormat('es', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short' }).format(d).replace(/\./g, '');

// Silencio: horario nocturno o cualquier evento del calendario en curso.
// ignorar: regex (texto) de títulos que no silencian (por ejemplo bloques personales).
export function estadoSilencio({ ahora, tz, inicio, fin, eventos = [], ignorar = '' }) {
  const hora = horaLocal(ahora, tz);
  if (enRango(hora, inicio, fin)) return { silencio: true, motivo: 'noche' };
  const re = ignorar ? new RegExp(ignorar, 'i') : null;
  const enCurso = eventos.filter((e) => !e.todoElDia && !e.transparente && new Date(e.inicio) <= ahora && ahora < new Date(e.fin) && !(re && re.test(e.titulo || '')));
  if (enCurso.length) {
    return { silencio: true, motivo: 'reunion', hasta: new Date(Math.max(...enCurso.map((e) => new Date(e.fin).getTime()))), eventos: enCurso.map((e) => e.titulo) };
  }
  return { silencio: false };
}

// Ciudades frecuentes → zona IANA. Sirve para "estoy en Bogotá" y para ubicaciones de eventos.
const CIUDADES = {
  bogota: 'America/Bogota', medellin: 'America/Bogota', cali: 'America/Bogota', cartagena: 'America/Bogota', barranquilla: 'America/Bogota', colombia: 'America/Bogota',
  porto: 'Europe/Lisbon', oporto: 'Europe/Lisbon', lisboa: 'Europe/Lisbon', lisbon: 'Europe/Lisbon', portugal: 'Europe/Lisbon', faro: 'Europe/Lisbon', braga: 'Europe/Lisbon',
  madrid: 'Europe/Madrid', barcelona: 'Europe/Madrid', valencia: 'Europe/Madrid', sevilla: 'Europe/Madrid', espana: 'Europe/Madrid',
  londres: 'Europe/London', london: 'Europe/London', paris: 'Europe/Paris', roma: 'Europe/Rome', milan: 'Europe/Rome', berlin: 'Europe/Berlin', amsterdam: 'Europe/Amsterdam',
  'ciudad de mexico': 'America/Mexico_City', cdmx: 'America/Mexico_City', mexico: 'America/Mexico_City', monterrey: 'America/Monterrey', cancun: 'America/Cancun',
  miami: 'America/New_York', 'nueva york': 'America/New_York', 'new york': 'America/New_York', orlando: 'America/New_York',
  'los angeles': 'America/Los_Angeles', 'san francisco': 'America/Los_Angeles',
  'buenos aires': 'America/Argentina/Buenos_Aires', santiago: 'America/Santiago', lima: 'America/Lima', quito: 'America/Guayaquil',
  caracas: 'America/Caracas', panama: 'America/Panama', 'santo domingo': 'America/Santo_Domingo', 'sao paulo': 'America/Sao_Paulo', dubai: 'Asia/Dubai',
};
const sinTildes = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function zonaDeTexto(texto) {
  if (!texto) return null;
  const t = ` ${sinTildes(texto).replace(/[^a-z\s]/g, ' ')} `;
  // las más largas primero: "nueva york" antes que "york"
  for (const c of Object.keys(CIUDADES).sort((a, b) => b.length - a.length)) {
    if (t.includes(` ${c} `)) return { tz: CIUDADES[c], ciudad: c };
  }
  return null;
}

export const nombreCiudad = (tz) => (tz.split('/').pop() || tz).replace(/_/g, ' ');
