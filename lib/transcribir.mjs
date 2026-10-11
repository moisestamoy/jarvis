// Audio → texto con ElevenLabs Speech-to-Text. Lo usa Telegram (Kapso ya entrega los audios transcritos).
// La clave queda en el bridge: Claude solo recibe el texto.

export async function transcribir(audio, { key, modelo = 'scribe_v2', nombre = 'audio.ogg', fetchFn = fetch }) {
  if (!key) throw new Error('falta ELEVENLABS_API_KEY para transcribir audios');
  const fd = new FormData();
  fd.append('model_id', modelo);
  fd.append('file', new Blob([audio]), nombre);
  const r = await fetchFn('https://api.elevenlabs.io/v1/speech-to-text', {
    method: 'POST', headers: { 'xi-api-key': key }, body: fd, signal: AbortSignal.timeout(120_000),
  });
  if (!r.ok) throw new Error(`transcripción: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
  return ((await r.json()).text || '').trim();
}
