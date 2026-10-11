import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { envClaude, argsClaude } from '../lib/claude.mjs';
import { crearEstado } from '../lib/estado.mjs';
import { parseEnv } from '../lib/env.mjs';

test('Claude recibe un entorno limpio: ninguna clave del bridge', () => {
  const origen = {
    HOME: '/home/jarvis', PATH: '/usr/bin', LANG: 'es_ES.UTF-8', CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat-x',
    KAPSO_API_KEY: 'k', KAPSO_WEBHOOK_SECRET: 's', WHOOP_CLIENT_SECRET: 'w', ELEVENLABS_API_KEY: 'e', JARVIS_TOKEN: 'j',
    GOOGLE_CLIENT_SECRET: 'g', NUMEROS_SHEET_URL: 'n', ANTHROPIC_API_KEY: 'a', AWS_SECRET_ACCESS_KEY: 'x',
  };
  const env = envClaude(origen);
  assert.deepEqual(Object.keys(env).sort(), ['CLAUDE_CODE_OAUTH_TOKEN', 'DISABLE_AUTOUPDATER', 'ENABLE_CLAUDEAI_MCP_SERVERS', 'HOME', 'LANG', 'PATH']);
  for (const v of ['k', 's', 'w', 'e', 'j', 'g', 'n', 'a', 'x']) assert.ok(!Object.values(env).includes(v));
});

test('sin bypassPermissions, sin WebFetch, sin MCP y con lista blanca', () => {
  const a = argsClaude({ prompt: 'hola', modelo: 'opus', sistema: 'S', sesionId: 'abc' });
  const s = a.join(' ');
  assert.ok(!s.includes('bypassPermissions'));
  assert.ok(a.includes('--restricted'));
  assert.ok(a.includes('--strict-mcp-config'));
  assert.equal(a[a.indexOf('--mcp-config') + 1], '{"mcpServers":{}}');
  assert.equal(a[a.indexOf('--permission-mode') + 1], 'dontAsk');
  assert.ok(!a[a.indexOf('--tools') + 1].includes('WebFetch'));
  assert.ok(a.includes('Edit(./**)') && a.includes('Bash(git commit:*)'));
  assert.ok(!a.some((x) => x === 'Bash' && a.indexOf(x) > a.indexOf('--allowedTools')), 'Bash solo con patrones de git');
  assert.ok(a.slice(a.indexOf('--disallowedTools')).includes('WebFetch'));
  assert.deepEqual(a.slice(-2), ['--resume', 'abc']);
  const lectura = argsClaude({ prompt: 'x', modelo: 'opus', herramientas: 'lectura' });
  assert.equal(lectura[lectura.indexOf('--tools') + 1], 'Read,Glob,Grep');
  const sin = argsClaude({ prompt: 'x', modelo: 'opus', herramientas: false });
  assert.equal(sin[sin.indexOf('--tools') + 1], '');
});

test('state.json se escribe de forma atómica y tolera estar corrupto', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-estado-'));
  const file = path.join(dir, 'state.json');
  fs.writeFileSync(file, '{"tz": "Europe/Lis');
  const e = crearEstado(file);
  assert.equal(e.recuperado, true);
  assert.deepEqual(e.data, {});
  assert.ok(fs.readdirSync(dir).some((f) => f.startsWith('state.json.corrupto-')));
  e.data.tz = 'America/Bogota';
  e.guardar();
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { tz: 'America/Bogota' });
  assert.ok(!fs.readdirSync(dir).some((f) => f.endsWith('.tmp')));
  assert.equal(crearEstado(file).recuperado, false);
});

test('el .env quita comillas y comentarios (whoop.mjs y server.mjs leen igual)', () => {
  const env = parseEnv('A="con comillas"\nB=\'simples\'\nC=valor   # comentario\nD=\n# nada\nE="tiene # adentro"');
  assert.deepEqual(env, { A: 'con comillas', B: 'simples', C: 'valor', D: '', E: 'tiene # adentro' });
});
