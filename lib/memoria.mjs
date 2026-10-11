// jarvis-memoria: archivos + git. El bridge hace pull antes y push después; Claude no hace push nunca.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

export function crearMemoria({ ruta, gitSync, dryRun, log = console.log }) {
  const abs = (rel) => {
    const p = path.resolve(ruta, rel);
    if (!p.startsWith(path.resolve(ruta) + path.sep)) throw new Error(`ruta fuera de la memoria: ${rel}`);
    return p;
  };
  const esRepo = () => fs.existsSync(path.join(ruta, '.git'));
  let candado = Promise.resolve(); // serializa las operaciones git del bridge

  function git(...args) {
    return new Promise((resolve) => {
      const child = spawn('git', args, { cwd: ruta, stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      child.stdout.on('data', (d) => (out += d));
      child.stderr.on('data', (d) => (out += d));
      child.on('close', (code) => resolve({ code, out: out.trim() }));
    });
  }
  const enCandado = (fn) => (candado = candado.then(fn, fn));

  return {
    ruta,
    leer(rel) { const p = abs(rel); return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : ''; },
    escribir(rel, texto) { const p = abs(rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, texto); },
    existe(rel) { return fs.existsSync(abs(rel)); },
    listar(dir) { const p = abs(dir); return fs.existsSync(p) ? fs.readdirSync(p) : []; },
    pull() {
      return enCandado(async () => {
        if (!gitSync || dryRun || !esRepo()) return;
        const r = await git('pull', '--rebase', '--autostash');
        if (r.code !== 0) log('git pull falló', r.out);
      });
    },
    // Commitea lo que haya quedado sin commit (del bridge o de Claude) y hace push.
    guardar(mensaje) {
      return enCandado(async () => {
        if (!esRepo()) return true;
        await git('add', '-A');
        const sinCambios = (await git('diff', '--cached', '--quiet')).code === 0;
        if (!sinCambios) {
          const c = await git('commit', '-q', '-m', mensaje);
          if (c.code !== 0) log('git commit falló', c.out);
        }
        if (!gitSync || dryRun) return true;
        const p = await git('push', '-q');
        if (p.code !== 0) { log('git push falló', p.out); return false; }
        return true;
      });
    },
  };
}
