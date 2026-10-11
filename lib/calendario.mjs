// Google Calendar directo desde el bridge (OAuth propio). Claude nunca toca el calendario:
// propone acciones y el bridge las valida y ejecuta aquí.
import fs from 'node:fs';
import path from 'node:path';

const API = 'https://www.googleapis.com/calendar/v3';
export const SCOPE = 'https://www.googleapis.com/auth/calendar.events';

export function urlLogin({ clientId, redirect }, state) {
  const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  u.search = new URLSearchParams({ client_id: clientId, redirect_uri: redirect, response_type: 'code', scope: SCOPE, access_type: 'offline', prompt: 'consent', state });
  return u.toString();
}

// Evento de Google → forma interna.
export function normalizar(e, calendario) {
  const yo = (e.attendees || []).find((a) => a.self);
  return {
    id: e.id, calendario,
    titulo: e.summary || '(sin título)',
    inicio: e.start?.dateTime || e.start?.date, fin: e.end?.dateTime || e.end?.date,
    todoElDia: !e.start?.dateTime,
    zonaInicio: e.start?.timeZone || '', zonaFin: e.end?.timeZone || '',
    descripcion: (e.description || '').replace(/<[^>]+>/g, ' ').slice(0, 1500),
    ubicacion: e.location || '',
    invitados: (e.attendees || []).filter((a) => !a.self && !a.resource).map((a) => a.displayName || a.email).slice(0, 12),
    link: e.htmlLink || '', meet: e.hangoutLink || '',
    rechazado: yo?.responseStatus === 'declined',
    transparente: e.transparency === 'transparent',
  };
}

export function crearCalendario({ clientId, clientSecret, redirect, tokensFile, calendarios = [], calendarioEscritura = 'primary', dryRun, log = console.log }) {
  const conectado = () => fs.existsSync(tokensFile);

  async function canjear(code) {
    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirect, client_id: clientId, client_secret: clientSecret }),
    });
    const t = await r.json();
    if (!t.refresh_token) throw new Error('Google no entregó refresh_token: ' + JSON.stringify(t).slice(0, 200));
    guardarTokens({ ...t, obtenido: Date.now() });
  }
  function guardarTokens(t) {
    fs.mkdirSync(path.dirname(tokensFile), { recursive: true });
    fs.writeFileSync(tokensFile + '.tmp', JSON.stringify(t, null, 2), { mode: 0o600 });
    fs.renameSync(tokensFile + '.tmp', tokensFile);
  }
  async function token() {
    if (!conectado()) throw new Error('Google Calendar no está conectado');
    let t = JSON.parse(fs.readFileSync(tokensFile, 'utf8'));
    if (Date.now() < t.obtenido + (t.expires_in - 120) * 1000) return t.access_token;
    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: t.refresh_token, client_id: clientId, client_secret: clientSecret }),
    });
    const n = await r.json();
    if (!n.access_token) throw new Error('refresh de Google falló: ' + JSON.stringify(n).slice(0, 200));
    t = { ...t, ...n, obtenido: Date.now() };
    guardarTokens(t);
    return t.access_token;
  }
  async function api(metodo, ruta, body) {
    const r = await fetch(API + ruta, {
      method: metodo, signal: AbortSignal.timeout(15000),
      headers: { Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!r.ok) throw new Error(`Google ${metodo} ${ruta} → ${r.status} ${(await r.text()).slice(0, 200)}`);
    return r.status === 204 ? null : r.json();
  }
  const enc = encodeURIComponent;

  return {
    conectado, canjear,
    async listar(desde, hasta) {
      const ids = calendarios.length ? calendarios : ['primary'];
      const vistos = new Set(), out = [];
      for (const id of ids) {
        const q = new URLSearchParams({ timeMin: desde.toISOString(), timeMax: hasta.toISOString(), singleEvents: 'true', orderBy: 'startTime', maxResults: '100' });
        const d = await api('GET', `/calendars/${enc(id)}/events?${q}`);
        for (const e of d.items || []) {
          if (e.status === 'cancelled' || vistos.has(e.iCalUID || e.id)) continue;
          vistos.add(e.iCalUID || e.id);
          const n = normalizar(e, id);
          if (!n.rechazado) out.push(n);
        }
      }
      return out.sort((a, b) => new Date(a.inicio) - new Date(b.inicio));
    },
    async obtener(id) { return normalizar(await api('GET', `/calendars/${enc(calendarioEscritura)}/events/${enc(id)}`), calendarioEscritura); },
    // inicio/fin: 'AAAA-MM-DDTHH:MM' en la zona tz. Nunca se agregan invitados (sendUpdates=none).
    async crear({ titulo, inicio, fin, descripcion = '' }, tz) {
      const body = { summary: titulo, description: descripcion, start: { dateTime: `${inicio}:00`, timeZone: tz }, end: { dateTime: `${fin}:00`, timeZone: tz } };
      if (dryRun) { log('DRY_RUN calendario: crear', JSON.stringify(body)); return { id: 'dry-' + Date.now(), titulo, inicio, fin }; }
      return normalizar(await api('POST', `/calendars/${enc(calendarioEscritura)}/events?sendUpdates=none`, body), calendarioEscritura);
    },
    async mover(id, { inicio, fin }, tz) {
      const body = { start: { dateTime: `${inicio}:00`, timeZone: tz }, end: { dateTime: `${fin}:00`, timeZone: tz } };
      if (dryRun) { log('DRY_RUN calendario: mover', id, JSON.stringify(body)); return { id }; }
      return normalizar(await api('PATCH', `/calendars/${enc(calendarioEscritura)}/events/${enc(id)}?sendUpdates=none`, body), calendarioEscritura);
    },
    async borrar(id) {
      if (dryRun) { log('DRY_RUN calendario: borrar', id); return; }
      await api('DELETE', `/calendars/${enc(calendarioEscritura)}/events/${enc(id)}?sendUpdates=none`);
    },
  };
}
