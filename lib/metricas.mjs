// Medición de los 30 días: un JSON por día en metricas/AAAA-MM-DD.json de jarvis-memoria.

export const vacia = (fecha) => ({
  fecha, hora_prioridad: null, prioridad_cumplida: null, consultas_numeros: 0, caos: null, abiertos_fin_dia: null, funciones_usadas: [],
});

export function crearMetricas(memoria) {
  const rel = (fecha) => `metricas/${fecha}.json`;
  function leer(fecha) {
    try { return { ...vacia(fecha), ...JSON.parse(memoria.leer(rel(fecha)) || '{}') }; } catch { return vacia(fecha); }
  }
  const escribir = (m) => memoria.escribir(rel(m.fecha), JSON.stringify(m, null, 2) + '\n');
  return {
    leer,
    registrar(fecha, cambios) { const m = { ...leer(fecha), ...cambios }; escribir(m); return m; },
    incrementar(fecha, clave) { const m = leer(fecha); m[clave] = (m[clave] || 0) + 1; escribir(m); return m; },
    usar(fecha, funcion) {
      const m = leer(fecha);
      if (!m.funciones_usadas.includes(funcion)) { m.funciones_usadas.push(funcion); escribir(m); }
      return m;
    },
    todas() {
      return memoria.listar('metricas').filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().map((f) => leer(f.slice(0, 10)));
    },
  };
}
