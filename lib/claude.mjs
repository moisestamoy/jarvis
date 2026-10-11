// Ejecuta `claude -p` con una lista blanca mínima y un entorno limpio, sin claves del bridge.
import { spawn, spawnSync } from 'node:child_process';

// Lo único que Claude puede hacer, siempre dentro de jarvis-memoria (cwd), por --restricted y por las reglas ./**.
export const HERRAMIENTAS = ['Read', 'Glob', 'Grep', 'Edit', 'Write', 'WebSearch', 'Bash'];
export const PERMITIDAS = [
  'Read(./**)', 'Edit(./**)', 'Write(./**)', 'Glob', 'Grep', 'WebSearch',
  'Bash(git add:*)', 'Bash(git commit:*)', 'Bash(git status:*)', 'Bash(git diff:*)', 'Bash(git log:*)',
];
// Defensa extra: aunque algo cambie en las reglas de arriba, esto queda prohibido.
export const PROHIBIDAS = [
  'WebFetch', 'Bash(curl:*)', 'Bash(wget:*)', 'Bash(git push:*)', 'Bash(git reset:*)', 'Bash(git remote:*)', 'Bash(git config:*)',
  'Read(~/.config/**)', 'Read(~/.ssh/**)', 'Read(~/.claude/**)', 'Read(//etc/**)',
];
// Variables que Claude Code necesita para correr y autenticarse con el plan Max. Nada más.
const ENV_PERMITIDO = ['HOME', 'PATH', 'LANG', 'LC_ALL', 'TZ', 'CLAUDE_CODE_OAUTH_TOKEN'];

export function envClaude(origen = process.env) {
  const env = {};
  for (const k of ENV_PERMITIDO) if (origen[k]) env[k] = origen[k];
  env.ENABLE_CLAUDEAI_MCP_SERVERS = 'false'; // sin conectores de claude.ai: el bridge hace las acciones
  env.DISABLE_AUTOUPDATER = '1';
  return env;
}

// herramientas: true = agente con memoria; 'lectura' = solo leer la memoria; false = sin herramientas.
export function argsClaude({ prompt, modelo, sistema = '', sesionId = null, herramientas = true, restricted = true }) {
  const args = ['-p', prompt, '--output-format', 'json', '--model', modelo,
    '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--permission-mode', 'dontAsk'];
  if (sistema) args.push('--append-system-prompt', sistema);
  if (herramientas === true) {
    if (restricted) args.push('--restricted');
    args.push('--tools', HERRAMIENTAS.join(','), '--allowedTools', ...PERMITIDAS, '--disallowedTools', ...PROHIBIDAS);
  } else if (herramientas === 'lectura') {
    if (restricted) args.push('--restricted');
    args.push('--tools', 'Read,Glob,Grep', '--allowedTools', 'Read(./**)', 'Glob', 'Grep', '--disallowedTools', ...PROHIBIDAS);
  } else {
    args.push('--tools', '');
  }
  if (sesionId) args.push('--resume', sesionId);
  return args;
}

// --restricted es reciente: si el binario instalado no lo conoce, se omite (las reglas ./** siguen aplicando).
export function soportaRestricted(bin) {
  try { return /--restricted/.test(spawnSync(bin, ['--help'], { encoding: 'utf8', timeout: 15000 }).stdout || ''); } catch { return false; }
}

export function crearClaude({ bin, timeoutMs, estado, log = console.log, env = process.env }) {
  const restricted = soportaRestricted(bin);
  if (!restricted) log('aviso: este claude no soporta --restricted; actualízalo (claude update)');
  const entorno = envClaude(env);

  // sesion: nombre de la conversación a continuar ('chat'); null = trabajo de fondo sin memoria de chat.
  function ejecutar({ prompt, sistema, modelo, sesion = null, cwd, herramientas = true }) {
    const sesiones = (estado.data.sesiones ??= {});
    const args = argsClaude({ prompt, modelo, sistema, sesionId: sesion ? sesiones[sesion] : null, herramientas, restricted });
    return new Promise((resolve) => {
      const child = spawn(bin, args, { cwd, env: entorno, stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '', err = '';
      child.stdout.on('data', (d) => (out += d));
      child.stderr.on('data', (d) => (err += d));
      const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
      child.on('close', (code) => {
        clearTimeout(timer);
        try {
          const r = JSON.parse(out);
          if (sesion && r.session_id) { sesiones[sesion] = r.session_id; estado.guardar(); }
          resolve(r.is_error ? { error: r.result || 'error de Claude' } : { texto: r.result || '' });
        } catch {
          log('claude falló', code, err.slice(0, 1500));
          resolve({ error: code === null ? 'tiempo agotado' : 'falló la ejecución' });
        }
      });
    });
  }
  return { ejecutar };
}
