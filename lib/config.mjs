// Toda la configuración sale de variables de entorno (ver .env.example).
import os from 'node:os';
import path from 'node:path';

export const NEGOCIOS_DEFAULT = [
  { id: 'antoecom', nombre: 'AntoEcom', claves: 'anto ?ecom|\\banto\\b' },
  { id: 'imperio-yt', nombre: 'Imperio YT', claves: 'imperio|\\byt\\b' },
  { id: 'fiama', nombre: 'Fiama', claves: 'fiama' },
  { id: 'congruence', nombre: 'Congruence', claves: 'congruence' },
];

const json = (v, def) => { try { return v ? JSON.parse(v) : def; } catch { return def; } };
const lista = (v) => (v || '').split(',').map((x) => x.trim()).filter(Boolean);

export function leerConfig(env = process.env) {
  const home = os.homedir();
  const canal = env.CANAL === 'kapso' ? 'kapso' : 'telegram';
  return {
    canal,
    ventana24h: canal === 'kapso', // solo WhatsApp limita los mensajes por iniciativa propia a 24 h
    telegramToken: env.TELEGRAM_BOT_TOKEN || '',
    kapsoApiKey: env.KAPSO_API_KEY || '',
    webhookSecret: env.KAPSO_WEBHOOK_SECRET || '',
    phoneNumberId: env.KAPSO_PHONE_NUMBER_ID || '',
    // Telegram: tu ID numérico de usuario. WhatsApp: tu número, solo dígitos.
    owner: (canal === 'telegram' ? env.OWNER_TELEGRAM_ID || '' : env.OWNER_PHONE || '').replace(/\D/g, ''),
    ownerName: env.OWNER_NAME || 'Moisés',
    memoria: env.MEMORIA_PATH || path.join(home, 'jarvis-memoria'),
    port: Number(env.PORT || 8787),
    dryRun: env.DRY_RUN === '1',
    gitSync: env.GIT_SYNC !== '0',

    claudeBin: env.CLAUDE_BIN || path.join(home, '.local/bin/claude'),
    modeloChat: env.CLAUDE_MODEL || 'opus',
    modeloFondo: env.CLAUDE_MODEL_FONDO || 'sonnet',
    timeoutMs: Number(env.CLAUDE_TIMEOUT_MS || 10 * 60_000),

    tzDefault: env.TZ_DEFAULT || 'Europe/Lisbon',
    silencioInicio: env.SILENCIO_INICIO || '23:00',
    silencioFin: env.SILENCIO_FIN || '07:00',
    silencioIgnorar: env.SILENCIO_IGNORAR || '',
    reporteFallback: env.REPORTE_FALLBACK || '09:00',
    cierreAntesMin: Number(env.CIERRE_ANTES_MIN || 30),
    revisionDia: Number(env.REVISION_SEMANAL_DIA || 7), // ISO: 7 = domingo
    revisionHora: env.REVISION_SEMANAL_HORA || '18:00',
    recordatorioMin: Number(env.RECORDATORIO_MIN || 5),
    limiteAbiertos: Number(env.LIMITE_ABIERTOS || 5),

    pingTemplate: env.PING_TEMPLATE || 'jarvis_ping',
    pingLang: env.PING_TEMPLATE_LANG || 'es',
    pingMaxDia: Number(env.PING_MAX_DIA || 2),

    negocios: json(env.NEGOCIOS, NEGOCIOS_DEFAULT),
    dailyRegex: env.DAILY_REGEX || 'daily|diaria|stand ?up|sync del equipo',

    google: {
      clientId: env.GOOGLE_CLIENT_ID || '', clientSecret: env.GOOGLE_CLIENT_SECRET || '', redirect: env.GOOGLE_REDIRECT_URI || '',
      tokensFile: path.join(home, '.config/jarvis/google-tokens.json'),
      calendarios: lista(env.AGENDA_CALENDARS), calendarioEscritura: env.CALENDARIO_ESCRITURA || 'primary',
    },
    whoop: { clientId: env.WHOOP_CLIENT_ID || '', redirect: env.WHOOP_REDIRECT_URI || '', tokensFile: path.join(home, '.config/whoop/tokens.json') },
    jarvisToken: env.JARVIS_TOKEN || '',
    elevenKey: env.ELEVENLABS_API_KEY || '', // también transcribe los audios de Telegram
  };
}

// En Telegram, OWNER_TELEGRAM_ID puede faltar al principio: el bot le dice su ID a quien le escriba.
export function faltantes(cfg) {
  const req = ['memoria'];
  if (cfg.canal === 'kapso') req.push('webhookSecret', 'owner', ...(cfg.dryRun ? [] : ['kapsoApiKey', 'phoneNumberId']));
  else req.push('telegramToken');
  return req.filter((k) => !cfg[k]);
}
