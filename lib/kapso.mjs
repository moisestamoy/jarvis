// WhatsApp vía Kapso (API de Meta). Texto, plantilla aprobada, botones y listas interactivas.
// Con DRY_RUN no se manda nada: cada mensaje queda en `salida` y se imprime en consola.

const URL_BASE = 'https://api.kapso.ai/meta/whatsapp/v24.0';

export function crearKapso({ apiKey, phoneNumberId, dryRun, log = console.log }) {
  const salida = [];

  async function post(payload) {
    if (dryRun) { salida.push(payload); log('DRY_RUN →', resumir(payload)); return true; }
    const res = await fetch(`${URL_BASE}/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: { 'X-API-Key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', ...payload }),
    });
    if (!res.ok) { log('kapso: envío falló', res.status, (await res.text()).slice(0, 300)); return false; }
    return true;
  }

  return {
    salida,
    async texto(to, body) {
      // WhatsApp corta en 4096 caracteres
      for (let i = 0; i < body.length; i += 4000) await post({ to, type: 'text', text: { body: body.slice(i, i + 4000) } });
    },
    // Fuera de la ventana de 24 h solo se permiten plantillas aprobadas.
    plantilla(to, name, lang, params = []) {
      const components = params.length ? [{ type: 'body', parameters: params.map((text) => ({ type: 'text', text })) }] : [];
      return post({ to, type: 'template', template: { name, language: { code: lang }, components } });
    },
    // Máximo 3 botones, títulos de hasta 20 caracteres, cuerpo de hasta 1024.
    botones(to, body, botones) {
      return post({
        to, type: 'interactive',
        interactive: {
          type: 'button', body: { text: body.slice(0, 1024) },
          action: { buttons: botones.slice(0, 3).map((b) => ({ type: 'reply', reply: { id: b.id, title: b.title.slice(0, 20) } })) },
        },
      });
    },
    // Lista: hasta 10 filas, título de fila de hasta 24 caracteres y descripción de hasta 72.
    lista(to, body, boton, filas) {
      return post({
        to, type: 'interactive',
        interactive: {
          type: 'list', body: { text: body.slice(0, 1024) },
          action: {
            button: boton.slice(0, 20),
            sections: [{ title: 'Opciones', rows: filas.slice(0, 10).map((f) => ({ id: f.id, title: f.title.slice(0, 24), ...(f.description ? { description: f.description.slice(0, 72) } : {}) })) }],
          },
        },
      });
    },
  };
}

function resumir(p) {
  if (p.type === 'text') return `[texto a ${p.to}]\n${p.text.body}`;
  if (p.type === 'template') return `[plantilla ${p.template.name} a ${p.to}]`;
  if (p.interactive?.type === 'button') return `[botones a ${p.to}] ${p.interactive.body.text}\n  ${p.interactive.action.buttons.map((b) => `(${b.reply.title} → ${b.reply.id})`).join(' ')}`;
  if (p.interactive?.type === 'list') return `[lista a ${p.to}] ${p.interactive.body.text}\n${p.interactive.action.sections[0].rows.map((r) => `  · ${r.title} → ${r.id}`).join('\n')}`;
  return JSON.stringify(p);
}

// Mensaje entrante → { texto, botonId, audio }. Soporta respuestas de botón, de lista y de plantilla.
export function leerEntrada(msg = {}) {
  const botonId = msg.interactive?.button_reply?.id || msg.interactive?.list_reply?.id || msg.button?.payload || null;
  const texto = (msg.kapso?.transcript?.text || msg.kapso?.transcript || msg.text?.body || msg.kapso?.content || '').toString().trim();
  return { texto: botonId ? '' : texto, botonId, audio: msg.type === 'audio' || !!msg.kapso?.transcript };
}

export const remitente = (e) => (e.message?.from || e.conversation?.phone_number || '').replace(/\D/g, '');
