// compromisos.md con formato fijo, para que el bridge cuente, cierre y arme botones sin ayuda de Claude.
//   - [ ] Texto · vence AAAA-MM-DD · negocio · id:c-0001        (abierto)
//   - [x] Texto · vence AAAA-MM-DD · negocio · id:c-0001 · hecho AAAA-MM-DD
//   - [~] Texto · vence AAAA-MM-DD · negocio · id:c-0001 · soltado AAAA-MM-DD

const LINEA = /^- \[( |x|~)\] (.+?) · vence (\d{4}-\d{2}-\d{2})(?: · ([^·]+?))? · id:(c-\d+)(?: · (hecho|soltado) (\d{4}-\d{2}-\d{2}))?\s*$/;
const ESTADO = { ' ': 'abierto', x: 'hecho', '~': 'soltado' };
const MARCA = { abierto: ' ', hecho: 'x', soltado: '~' };

export const CABECERA = `# Compromisos

Lo que Moisés dijo que haría, con fecha. Este archivo lo mantiene el bridge de JARVIS: no cambies el formato de las líneas.
Formato: \`- [ ] Texto · vence AAAA-MM-DD · negocio · id:c-0001\`. Máximo de abiertos: el límite configurado (5).
`;

export function parsear(texto) {
  const items = [];
  const cabecera = [];
  let enListas = false;
  for (const linea of texto.split('\n')) {
    const m = LINEA.exec(linea.trim());
    if (m) {
      items.push({ estado: ESTADO[m[1]], texto: m[2].trim(), vence: m[3], negocio: (m[4] || '').trim(), id: m[5], cerrado: m[7] || null });
      continue;
    }
    if (/^## (Abiertos|Cerrados)/.test(linea)) { enListas = true; continue; }
    if (!enListas) cabecera.push(linea);
  }
  return { cabecera: cabecera.join('\n').trimEnd() || CABECERA.trimEnd(), items };
}

export function linea(c) {
  return `- [${MARCA[c.estado]}] ${c.texto.replace(/·/g, '-')} · vence ${c.vence}${c.negocio ? ` · ${c.negocio}` : ''} · id:${c.id}` +
    (c.estado !== 'abierto' && c.cerrado ? ` · ${c.estado} ${c.cerrado}` : '');
}

export function serializar({ cabecera, items }) {
  const abiertos = items.filter((c) => c.estado === 'abierto').sort((a, b) => a.vence.localeCompare(b.vence));
  const cerrados = items.filter((c) => c.estado !== 'abierto');
  return `${cabecera}\n\n## Abiertos\n${abiertos.map(linea).join('\n')}${abiertos.length ? '\n' : ''}\n## Cerrados\n${cerrados.map(linea).join('\n')}${cerrados.length ? '\n' : ''}`;
}

export const abiertos = (doc) => doc.items.filter((c) => c.estado === 'abierto');
export const vencidos = (doc, hoy) => abiertos(doc).filter((c) => c.vence < hoy);

function siguienteId(doc) {
  const max = doc.items.reduce((m, c) => Math.max(m, Number(c.id.slice(2))), 0);
  return `c-${String(max + 1).padStart(4, '0')}`;
}

// Devuelve { ok, doc, item } o { ok: false, motivo: 'limite', abiertos }.
export function agregar(doc, { texto, vence, negocio = '' }, limite) {
  const ab = abiertos(doc);
  if (ab.length >= limite) return { ok: false, motivo: 'limite', abiertos: ab };
  const item = { estado: 'abierto', texto: texto.trim(), vence, negocio: negocio.trim(), id: siguienteId(doc), cerrado: null };
  return { ok: true, doc: { ...doc, items: [...doc.items, item] }, item };
}

// cambios: { estado?: 'hecho'|'soltado'|'abierto', vence? }
export function actualizar(doc, id, cambios, hoy) {
  const item = doc.items.find((c) => c.id === id);
  if (!item) return { ok: false, motivo: 'no existe' };
  const nuevo = { ...item, ...cambios };
  if (cambios.estado && cambios.estado !== 'abierto') nuevo.cerrado = hoy;
  if (cambios.estado === 'abierto') nuevo.cerrado = null;
  return { ok: true, doc: { ...doc, items: doc.items.map((c) => (c.id === id ? nuevo : c)) }, item: nuevo };
}

// Acuerdos de los equipos, en negocios/*.md:  - [ ] Texto · vence AAAA-MM-DD · resp: Nombre
const ACUERDO = /^- \[( |x|~)\] (.+?) · vence (\d{4}-\d{2}-\d{2}) · resp: (.+?)\s*$/;
export function acuerdos(texto, negocio) {
  return texto.split('\n').map((l) => ACUERDO.exec(l.trim())).filter(Boolean)
    .map((m) => ({ abierto: m[1] === ' ', texto: m[2].trim(), vence: m[3], responsable: m[4].trim(), negocio }));
}
