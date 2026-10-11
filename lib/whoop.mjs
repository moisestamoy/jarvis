// Datos de WHOOP para el bridge: corre whoop.mjs como proceso aparte (con el env del bridge, nunca el de Claude).
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

function correr(dir, args, ms = 15000) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(dir, 'whoop.mjs'), ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    const t = setTimeout(() => child.kill(), ms);
    child.on('close', (code) => { clearTimeout(t); resolve(code === 0 ? out.trim() : null); });
  });
}
const lineasJson = (out) => (out || '').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);

export function crearWhoop({ dir, tokensFile }) {
  const conectado = () => fs.existsSync(tokensFile);
  return {
    conectado,
    // Solo datos: horas dormidas, recovery %, HRV.
    async hoy() {
      if (!conectado()) return null;
      const [rec, slp] = await Promise.all([correr(dir, ['recovery', '1']), correr(dir, ['sleep', '3'])]);
      const r = lineasJson(rec)[0];
      const s = lineasJson(slp).find((x) => !x.nap);
      if (!r && !s) return null;
      return { horas: s?.hours_asleep ?? null, recovery: r?.recovery ?? null, hrv: r?.hrv_ms ?? null, rhr: r?.rhr ?? null, rendimiento: s?.performance ?? null };
    },
    async semana() {
      if (!conectado()) return null;
      const [rec, slp] = await Promise.all([correr(dir, ['recovery', '7']), correr(dir, ['sleep', '10'])]);
      return { recovery: lineasJson(rec), sueno: lineasJson(slp).filter((x) => !x.nap).slice(0, 7) };
    },
  };
}
