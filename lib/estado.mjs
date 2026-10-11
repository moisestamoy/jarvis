// state.json: se escribe de forma atómica (temporal + rename) y, si está corrupto al arrancar,
// se aparta como state.json.corrupto-<ts> y se empieza de cero en vez de caerse.
import fs from 'node:fs';

export function crearEstado(file, log = () => {}) {
  let data = {};
  let recuperado = false;
  if (file && fs.existsSync(file)) {
    try {
      data = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('no es un objeto');
    } catch (e) {
      const apartado = `${file}.corrupto-${Date.now()}`;
      try { fs.renameSync(file, apartado); } catch {}
      log(`state.json corrupto (${e.message}); apartado en ${apartado}, arranco con estado vacío`);
      data = {};
      recuperado = true;
    }
  }
  function guardar() {
    if (!file) return;
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, file);
  }
  return { data, guardar, recuperado };
}
