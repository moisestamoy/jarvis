import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { armar } from '../lib/falsos.mjs';

// Cambia la respuesta de Claude sin perder el registro de llamadas.
const responder = (j, fn) => { j.claude.ejecutar = async (o) => { j.claude.llamadas.push(o); return fn(o); }; };
const bloque = (a) => `\n\`\`\`jarvis-acciones\n${JSON.stringify(a)}\n\`\`\``;

test('onboarding: con perfil.md vacío no manda reporte y pregunta; al terminar aplica los ajustes', async () => {
  const j = armar({ perfil: '# Perfil\n\n<!-- vacío -->\n' });
  responder(j, (o) => ({ texto: o.sistema?.includes('MODO ONBOARDING') ? 'Pregunta 1: ¿cuál es su rol, señor?' : 'normal' }));
  await j.escribir('hola');
  assert.ok(!j.kapso.salida.some((m) => /Reporte de claridad/.test(m.texto || '')));
  assert.equal(j.kapso.salida.at(-1).texto, 'Pregunta 1: ¿cuál es su rol, señor?');
  // aunque perfil.md ya tenga texto, el onboarding sigue hasta onboarding.completo
  fs.writeFileSync(`${j.ruta}/perfil.md`, '# Perfil\n\nDirector comercial de tres negocios, cofundador de Congruence.\n');
  await j.escribir('soy director comercial');
  assert.match(j.claude.llamadas.at(-1).sistema, /MODO ONBOARDING/);
  responder(j, () => ({ texto: 'Listo, señor. Mañana recibe su primer reporte.' + bloque([
    { tipo: 'ajuste', clave: 'silencioInicio', valor: '22:30' }, { tipo: 'ajuste', clave: 'reporteFallback', valor: '08:15' }, { tipo: 'onboarding.completo' },
  ]) }));
  await j.escribir('a las 8:15');
  assert.equal(j.app.ajuste('silencioInicio'), '22:30');
  assert.equal(j.app.horaCierre(), '22:00');
  assert.equal(j.app.estado.onboardingCompleto, true);
});

test('revisión semanal: el domingo a las 18:00, con datos de la semana, guardada y enviada', async () => {
  const j = armar({ inicio: '2026-10-18T16:59:00Z', estado: { ultimoMensajeAt: new Date('2026-10-18T12:00:00Z').getTime(), dias: { '2026-10-18': { reporte: { at: 1 } } } } });
  responder(j, (o) => {
    if (o.prompt.includes('revisión semanal')) {
      const archivo = /Guárdala en (\S+)/.exec(o.prompt)[1];
      fs.writeFileSync(`${j.ruta}/${archivo}`, '# Revisión\n');
      return { texto: '*Revisión semanal 2026-W42*\nLogros: …' };
    }
    return { texto: '{}' };
  });
  await j.tick(); // 17:59
  assert.equal(j.kapso.salida.length, 0);
  j.reloj.ir('2026-10-18T17:00:00Z'); // domingo 18:00 Lisboa
  await j.tick();
  assert.match(j.kapso.salida.at(-1).texto, /Revisión semanal 2026-W42/);
  assert.ok(fs.existsSync(`${j.ruta}/revisiones/2026-W42.md`));
  const prompt = j.claude.llamadas.at(-1).prompt;
  assert.match(prompt, /"fechas":\["2026-10-12".*"2026-10-18"\]/);
  await j.tick();
  assert.equal(j.claude.llamadas.length, 1, 'una sola revisión por domingo');
});

test('el HUD no tiene ruta de acciones ni acepta el token por ?k=', () => {
  const s = fs.readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
  const hud = s.slice(s.indexOf('function hud('), s.indexOf('const PRIVACIDAD'));
  assert.ok(!/herramientas:\s*true/.test(s.slice(s.indexOf('// ---------- HUD'), s.indexOf('const PRIVACIDAD'))), 'el HUD nunca usa el agente con herramientas');
  assert.ok(!/searchParams\.get\('k'\)/.test(s), 'la API no lee ?k=');
  assert.ok(!/manejarEntrada|encolar/.test(hud), 'el HUD no pasa por la cola de WhatsApp');
});
