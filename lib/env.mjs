// Lee el archivo .env del servidor. Lo usan server.mjs y whoop.mjs, así ambos tratan los valores igual.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const ENV_FILE = process.env.JARVIS_ENV_FILE || path.join(os.homedir(), '.config/jarvis/jarvis.env');

// KEY=valor por línea. Quita comillas envolventes y, si el valor no va entre comillas, el comentario " # ...".
export function parseEnv(text) {
  const out = {};
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let v = m[2];
    if (/^"(.*)"$/.test(v) || /^'(.*)'$/.test(v)) v = v.slice(1, -1);
    else v = v.replace(/(^|\s+)#.*$/, '').trim();
    out[m[1]] = v;
  }
  return out;
}

// Carga el archivo en process.env sin pisar lo que ya venga del entorno.
export function cargarEnv(file = ENV_FILE) {
  if (!fs.existsSync(file)) return;
  for (const [k, v] of Object.entries(parseEnv(fs.readFileSync(file, 'utf8')))) {
    if (!(k in process.env)) process.env[k] = v;
  }
}
