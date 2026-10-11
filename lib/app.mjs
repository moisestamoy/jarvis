// El cerebro del bridge: qué mandar, cuándo callar, qué ejecutar. Todo lo externo llega como dependencia,
// así se prueba con dobles (test/ y scripts/simular.mjs) y en producción con los clientes reales (server.mjs).
import crypto from 'node:crypto';
import { extraer, validar, requiereConfirmacion, CONFIRMACION_MS } from './acciones.mjs';
import * as C from './compromisos.mjs';
import {
  fechaLocal, horaLocal, diaIso, enRango, restarMin, localAUtc, sumarDias, diasEntre, semanaIso,
  fechaCorta, fechaLarga, estadoSilencio, zonaValida, zonaDeTexto, nombreCiudad,
} from './tiempo.mjs';
import { agruparAgenda, renderReporte, leerPrioridad, prioridadRespaldo } from './reporte.mjs';
import * as T from './textos.mjs';

const VENTANA_MS = 23.5 * 3600_000; // la ventana de WhatsApp es de 24 h; dejamos margen
const SALUDO = /^(hola|holi|buenas|buen d[ií]a|buenos d[ií]as|buenas tardes|hey|ya|arriba|despierto|jarvis|ok)[\s!.,👋☀️]*$/i;
const NIVELES_CAOS = ['Muy en orden', 'En orden', 'Normal', 'Caótico', 'Muy caótico'];
const t = (texto) => ({ tipo: 'texto', texto });
const tresBotones = (p) => [{ id: `${p}:hecho`, title: '✅ Hecho' }, { id: `${p}:manana`, title: '⏳ Mañana' }, { id: `${p}:soltar`, title: '❌ Soltar' }];
const corta = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

// comandos(texto): comandos extra del servidor (por ejemplo /conectar google); devuelve el texto de respuesta o null.
export function crearApp({ cfg, estado, chat, claude, calendario, whoop, memoria, metricas, sistema, ahora = () => new Date(), log = console.log, comandos = async () => null }) {
  const s = estado.data;
  s.tz ??= cfg.tzDefault;
  s.pendientes ??= [];
  s.confirmaciones ??= {};
  s.dias ??= {};
  s.ajustes ??= {};
  s.contexto ??= [];
  s.zonasVistas ??= {};
  const guardar = () => estado.guardar();

  const tz = () => s.tz;
  const hoy = () => fechaLocal(ahora(), tz());
  const hora = () => horaLocal(ahora(), tz());
  const hhmm = (iso) => horaLocal(new Date(iso), tz());
  const ajuste = (k) => s.ajustes[k] || cfg[k];
  const horaCierre = () => restarMin(ajuste('silencioInicio'), cfg.cierreAntesMin);
  s.inicio ??= hoy();

  function dia() {
    const f = hoy();
    if (!s.dias[f]) {
      s.dias[f] = {};
      for (const k of Object.keys(s.dias).sort().slice(0, -8)) delete s.dias[k];
    }
    return s.dias[f];
  }
  // Solo WhatsApp tiene ventana de 24 h; en Telegram el bot puede escribir siempre.
  const ventanaAbierta = () => !cfg.ventana24h || ahora().getTime() - (s.ultimoMensajeAt || 0) < VENTANA_MS;
  const eventos = () => s.agenda?.eventos || [];
  const eventosDeHoy = () => eventos().filter((e) => fechaLocal(new Date(e.inicio), tz()) === hoy() || (new Date(e.inicio) < ahora() && ahora() < new Date(e.fin)));
  const silencio = () => estadoSilencio({ ahora: ahora(), tz: tz(), inicio: ajuste('silencioInicio'), fin: ajuste('silencioFin'), eventos: eventos(), ignorar: cfg.silencioIgnorar });
  const deNoche = () => enRango(hora(), ajuste('silencioInicio'), ajuste('silencioFin'));
  const perfilVacio = () => memoria.leer('perfil.md').split('\n').filter((l) => l.trim() && !/^\s*(#|<!--|>)/.test(l)).join('').trim().length < 30;
  const enOnboarding = () => !s.onboardingCompleto && (s.onboardingIniciado || perfilVacio());

  // Una cosa a la vez: conversación, reporte y revisiones nunca pisan la memoria ni el git del otro.
  let cola = Promise.resolve();
  const encolar = (fn) => (cola = cola.then(fn).catch((e) => log('error en la cola:', e?.stack || e)));
  let ocupadoDesde = 0;

  // ---------- envío ----------
  async function enviar(m) {
    const to = cfg.owner;
    if (m.tipo === 'botones') await chat.botones(to, m.texto, m.botones);
    else if (m.tipo === 'lista') await chat.lista(to, m.texto, m.boton, m.filas);
    else await chat.texto(to, m.texto);
    if (m.marca === 'reporte') metricas.registrar(hoy(), { hora_prioridad: hora() });
  }

  // Mensaje por iniciativa de JARVIS: respeta el silencio y la ventana de 24 h. Si no se puede mandar, se acumula.
  async function avisar(mensajes, { caduca = null } = {}) {
    mensajes = [].concat(mensajes);
    const sil = silencio();
    if (!sil.silencio && ventanaAbierta()) {
      for (const m of mensajes) await enviar(m);
      return 'enviado';
    }
    for (const m of mensajes) s.pendientes.push({ ...m, caduca: caduca ? new Date(caduca).getTime() : null, creado: ahora().getTime() });
    guardar();
    if (!sil.silencio) await ping();
    return 'encolado';
  }

  // Plantilla aprobada para reabrir la ventana: máximo PING_MAX_DIA por día, separadas por 3 h, nunca en silencio.
  async function ping() {
    const d = dia();
    if ((d.pings || 0) >= cfg.pingMaxDia) return false;
    if (ahora().getTime() - (s.ultimoPingAt || 0) < 3 * 3600_000) return false;
    d.pings = (d.pings || 0) + 1;
    s.ultimoPingAt = ahora().getTime();
    guardar();
    await chat.plantilla(cfg.owner, cfg.pingTemplate, cfg.pingLang, []);
    log('ping enviado');
    return true;
  }

  async function vaciarPendientes() {
    const ya = ahora().getTime();
    const vivos = s.pendientes.filter((p) => !p.caduca || p.caduca > ya);
    s.pendientes = [];
    guardar();
    if (!vivos.length) return;
    const textos = vivos.filter((p) => p.tipo === 'texto');
    if (textos.length) {
      await enviar({
        tipo: 'texto',
        texto: textos.length > 1 ? `Lo que se acumuló mientras guardaba silencio, señor:\n\n${textos.map((p) => p.texto).join('\n\n')}` : textos[0].texto,
        marca: textos.some((p) => p.marca === 'reporte') ? 'reporte' : undefined,
      });
    }
    for (const m of vivos.filter((p) => p.tipo !== 'texto')) await enviar(m);
  }

  // ---------- agenda ----------
  async function refrescarAgenda(forzar = false) {
    const f = hoy();
    if (!calendario?.conectado()) {
      if (s.agenda?.fecha !== f) { s.agenda = { fecha: f, eventos: [], notificados: {}, at: ahora().getTime() }; guardar(); }
      return;
    }
    if (!forzar && s.agenda?.fecha === f && ahora().getTime() - s.agenda.at < 15 * 60_000) return;
    try {
      const lista = await calendario.listar(localAUtc(`${f}T00:00`, tz()), localAUtc(`${sumarDias(f, 2)}T00:00`, tz()));
      s.agenda = { fecha: f, eventos: lista, notificados: s.agenda?.fecha === f ? s.agenda.notificados : {}, at: ahora().getTime() };
      guardar();
    } catch (e) { log('agenda: no pude refrescar:', e.message); }
  }

  // ---------- memoria ----------
  const leerCompromisos = () => C.parsear(memoria.leer('compromisos.md'));
  const escribirCompromisos = (doc) => memoria.escribir('compromisos.md', C.serializar(doc));

  function acuerdosVencen(f) {
    return cfg.negocios.flatMap((n) => C.acuerdos(memoria.leer(`negocios/${n.id}.md`), n.nombre)).filter((a) => a.abierto && a.vence <= f);
  }
  const acuerdosAbiertos = () => cfg.negocios.flatMap((n) => C.acuerdos(memoria.leer(`negocios/${n.id}.md`), n.nombre)).filter((a) => a.abierto);

  function crearCompromiso({ texto, vence, negocio }) {
    const r = C.agregar(leerCompromisos(), { texto, vence, negocio }, cfg.limiteAbiertos);
    if (r.ok) escribirCompromisos(r.doc);
    return r;
  }

  // accion: hecho | manana | soltar
  function cambiarCompromiso(id, accion) {
    const cambios = accion === 'hecho' ? { estado: 'hecho' } : accion === 'soltar' ? { estado: 'soltado' } : { vence: sumarDias(hoy(), 1) };
    const r = C.actualizar(leerCompromisos(), id, cambios, hoy());
    if (!r.ok) return null;
    escribirCompromisos(r.doc);
    return r.item;
  }

  // Si había un compromiso esperando por el límite y ya hay espacio, se anota.
  function intentarEnEspera() {
    if (!s.compromisoEnEspera) return null;
    const r = crearCompromiso(s.compromisoEnEspera);
    if (!r.ok) return null;
    s.compromisoEnEspera = null;
    guardar();
    return `📌 Ahora sí anoté "${r.item.texto}" para el ${r.item.vence} (${C.abiertos(leerCompromisos()).length}/${cfg.limiteAbiertos}).`;
  }

  function listaLimite(abiertos) {
    return {
      tipo: 'lista',
      texto: `⛔ Tiene ${abiertos.length}/${cfg.limiteAbiertos} compromisos abiertos, señor. Cierre o suelte uno y anoto el nuevo.`,
      boton: 'Elegir',
      filas: abiertos.slice(0, 5).flatMap((c) => [
        { id: `c:${c.id}:hecho`, title: `✅ ${c.texto}`, description: `Hecho · vencía ${c.vence}` },
        { id: `c:${c.id}:soltar`, title: `❌ ${c.texto}`, description: `Soltar · vencía ${c.vence}` },
      ]),
    };
  }

  function listaPendientes(items) {
    return {
      tipo: 'lista', texto: '🧾 Lo que quedó pendiente. Decida con un toque:', boton: 'Decidir',
      filas: items.slice(0, 3).flatMap((c) => [
        { id: `c:${c.id}:hecho`, title: `✅ ${c.texto}`, description: 'Ya está hecho' },
        { id: `c:${c.id}:manana`, title: `⏳ ${c.texto}`, description: 'Pasar a mañana' },
        { id: `c:${c.id}:soltar`, title: `❌ ${c.texto}`, description: 'Soltar' },
      ]),
    };
  }

  // ---------- reporte de claridad ----------
  async function elegirPrioridad(datos, abiertos) {
    const r = await claude.ejecutar({
      prompt: `Datos del bridge (JSON):\n${JSON.stringify(datos)}`, sistema: T.PRIORIDAD,
      modelo: cfg.modeloChat, cwd: memoria.ruta, herramientas: 'lectura',
    });
    return (!r.error && leerPrioridad(r.texto, abiertos)) || prioridadRespaldo(abiertos);
  }

  async function enviarReporte(origen) {
    const d = dia();
    if (d.reporte) return;
    d.reporte = { origen, at: ahora().getTime() };
    guardar();
    await refrescarAgenda();
    const f = hoy();
    const doc = leerCompromisos();
    const abiertos = C.abiertos(doc);
    const vencidos = C.vencidos(doc, f);
    const acuerdos = acuerdosVencen(f);
    const w = await whoop.hoy().catch(() => null);
    const agenda = agruparAgenda(eventosDeHoy(), cfg.negocios, tz(), ahora());
    const prio = await elegirPrioridad({ hoy: f, hora: hora(), agenda, abiertos, vencidos, acuerdosQueVencen: acuerdos }, abiertos);
    const texto = renderReporte({
      titulo: `Reporte de claridad · ${fechaCorta(ahora(), tz())}`, whoop: w, agenda, numeros: null, acuerdos,
      prioridad: prio, puedeEsperar: prio.puedeEsperar, vencidos, abiertos: abiertos.length, limite: cfg.limiteAbiertos, hoy: f,
    });
    d.prioridad = { texto: prio.texto, compromisoId: prio.compromisoId };
    s.contexto.push(`A las ${hora()} le enviaste a Moisés el reporte de claridad de hoy:\n${texto}`);
    guardar();
    metricas.usar(f, 'reporte');
    const mensajes = [{ tipo: 'texto', texto, marca: 'reporte' }, { tipo: 'botones', texto: `🎯 ${prio.texto}`, botones: tresBotones('prio') }];
    if (vencidos.length) mensajes.push(listaPendientes(vencidos));
    if (origen === 'primer_mensaje') for (const m of mensajes) await enviar(m);
    else await avisar(mensajes);
    await memoria.guardar('jarvis: reporte de claridad');
  }

  // ---------- cierre, revisiones ----------
  async function enviarCierre() {
    const f = hoy();
    s.cierreAbierto = { fecha: f, at: ahora().getTime() };
    s.contexto.push(`A las ${hora()} le hiciste a Moisés las preguntas del cierre del día ${f}.`);
    guardar();
    metricas.registrar(f, { abiertos_fin_dia: C.abiertos(leerCompromisos()).length });
    await avisar([
      t('🌙 *Cierre del día*, señor. Tres preguntas; puede responder en un mensaje o en un audio:\n1. ¿Qué logró hoy?\n2. ¿Qué se trabó?\n3. ¿Qué arrastra a mañana?'),
      { tipo: 'lista', texto: 'Y una más: ¿qué tan caótico fue el día?', boton: 'Caos 1-5', filas: NIVELES_CAOS.map((n, i) => ({ id: `caos:${i + 1}`, title: `${i + 1} · ${n}` })) },
    ], { caduca: ahora().getTime() + 3 * 3600_000 });
    await memoria.guardar('jarvis: cierre del día');
  }

  async function tareaEscrita({ prompt, archivo, mensaje }) {
    await memoria.pull();
    const r = await claude.ejecutar({ prompt, sistema, modelo: cfg.modeloChat, cwd: memoria.ruta, herramientas: true });
    if (r.error) { log(`${mensaje}: falló (${r.error})`); return; }
    const { limpio } = extraer(r.texto); // en tareas de fondo no se ejecutan acciones
    await memoria.guardar(`jarvis: ${mensaje}`);
    s.contexto.push(`Le enviaste a Moisés ${mensaje} (guardada en ${archivo}):\n${limpio}`);
    guardar();
    await avisar(t(limpio));
  }

  async function revisionSemanal() {
    const f = hoy();
    const fechas = Array.from({ length: 7 }, (_, i) => sumarDias(f, i - 6));
    const archivo = `revisiones/${semanaIso(f)}.md`;
    const datos = {
      semana: semanaIso(f), fechas, metricas: fechas.map((x) => metricas.leer(x)), whoop: await whoop.semana().catch(() => null),
      compromisos: leerCompromisos().items, acuerdosAbiertos: acuerdosAbiertos(), numeros: 'pendiente de conectar (Fase 2)',
    };
    await tareaEscrita({ prompt: `${T.semanal(archivo)}\n\nDatos (JSON):\n${JSON.stringify(datos)}`, archivo, mensaje: 'la revisión semanal' });
  }

  async function veredicto30() {
    const archivo = 'revisiones/veredicto-30-dias.md';
    await tareaEscrita({ prompt: `${T.VEREDICTO}\n\nInicio: ${s.inicio}. Métricas (JSON):\n${JSON.stringify(metricas.todas())}`, archivo, mensaje: 'el veredicto de 30 días' });
  }

  // ---------- zona horaria ----------
  async function cambiarZona(nueva) {
    const anterior = tz();
    s.tz = nueva;
    s.agenda = null;
    s.contexto.push(`La zona horaria cambió de ${anterior} a ${nueva}.`);
    guardar();
    await refrescarAgenda(true);
    metricas.usar(hoy(), 'zona');
    return `🌍 Zona cambiada a ${nueva}. Allá son las ${hora()}. Silencio ${ajuste('silencioInicio')}–${ajuste('silencioFin')}, ` +
      `reporte ${ajuste('reporteFallback')} y cierre ${horaCierre()} quedan en esa hora.`;
  }

  function comandoZona(texto) {
    const m = /^\/zona\s+(\S.*)$/i.exec(texto.trim());
    if (m) return zonaValida(m[1].trim()) ? m[1].trim() : (zonaDeTexto(m[1])?.tz || 'invalida');
    const e = /^(?:ya\s+)?(?:estoy|llegu[eé]|aterric[eé])\s+(?:en|a)\s+([\p{L} .]{2,30}?)[\s.!]*$/iu.exec(texto.trim());
    return e ? zonaDeTexto(e[1])?.tz || null : null;
  }

  // Vuelos (zona de llegada distinta a la de salida, o "vuelo/flight" en el título) y eventos con ubicación en otra ciudad.
  async function detectarViaje() {
    for (const e of eventos()) {
      if (s.zonasVistas[e.id] || e.todoElDia) continue;
      const vuelo = (e.zonaInicio && e.zonaFin && e.zonaInicio !== e.zonaFin) || /\b(vuelo|flight)\b|✈/i.test(e.titulo);
      let destino = null;
      if (vuelo) destino = zonaValida(e.zonaFin) && e.zonaFin !== e.zonaInicio ? e.zonaFin : zonaDeTexto((/(?:\bto\b|\ba\b|→|->)\s+(.+)$/i.exec(e.titulo) || [])[1] || e.ubicacion)?.tz;
      else if (e.ubicacion) destino = zonaDeTexto(e.ubicacion)?.tz;
      if (!destino) continue;
      const momento = new Date(vuelo ? e.fin : e.inicio);
      if (ahora() < momento || ahora() - momento > 12 * 3600_000) continue;
      s.zonasVistas[e.id] = true;
      guardar();
      if (destino === tz()) continue;
      await avisar({
        tipo: 'botones',
        texto: `🌍 ${vuelo ? 'Veo que aterrizó' : 'Veo que está'} en ${nombreCiudad(destino)} (${corta(e.titulo, 60)}), señor. ¿Cambio la zona horaria a ${destino}?`,
        botones: [{ id: `zona:${destino}:si`, title: 'Sí, cambiar' }, { id: `zona:${destino}:no`, title: 'No' }],
      });
    }
  }

  // ---------- acciones de Claude ----------
  async function ejecutarAcciones(acciones) {
    const out = { lineas: [], mensajes: [] };
    for (const cruda of acciones) {
      const v = validar(cruda, { tz: tz() });
      if (!v.ok) { log('acción rechazada:', v.error, JSON.stringify(cruda).slice(0, 300)); out.lineas.push(`⚠️ Acción rechazada: ${v.error}`); continue; }
      try { await ejecutar(v.accion, out); } catch (e) { log('acción falló:', e.message); out.lineas.push(`⚠️ No pude completar ${v.accion.tipo}: ${e.message}`); }
    }
    return out;
  }

  async function ejecutar(a, out, confirmado = false) {
    const f = hoy();
    if (a.tipo.startsWith('calendar.')) {
      if (!calendario?.conectado()) { out.lineas.push('⚠️ Google Calendar no está conectado todavía.'); return; }
      let evento = null;
      if (a.eventoId) evento = eventos().find((e) => e.id === a.eventoId) || (await calendario.obtener(a.eventoId).catch(() => null));
      if (a.eventoId && !evento && !confirmado) { out.lineas.push(`⚠️ No encontré el evento ${a.eventoId}.`); return; }
      if (!confirmado && requiereConfirmacion(a, evento)) {
        const id = crypto.randomBytes(3).toString('hex');
        const desc = a.tipo === 'calendar.borrar'
          ? `borrar "${evento.titulo}" (${hhmm(evento.inicio)})`
          : `mover "${evento.titulo}" a ${a.inicio.replace('T', ' ')}–${a.fin.slice(11)}`;
        s.confirmaciones[id] = { accion: a, desc, at: ahora().getTime() };
        guardar();
        const otros = evento?.invitados?.length ? ` Tiene invitados: ${evento.invitados.slice(0, 4).join(', ')}${evento.invitados.length > 4 ? '…' : ''}.` : '';
        out.mensajes.push({ tipo: 'botones', texto: `¿Confirmo ${desc}?${otros} (caduca en 30 min)`, botones: [{ id: `acc:${id}:si`, title: 'Sí' }, { id: `acc:${id}:no`, title: 'No' }] });
        return;
      }
      if (a.tipo === 'calendar.crear') {
        await calendario.crear(a, tz());
        out.lineas.push(`✔ Bloque creado: ${a.titulo}, ${a.inicio.slice(5, 10)} ${a.inicio.slice(11)}–${a.fin.slice(11)}`);
      } else if (a.tipo === 'calendar.mover') {
        await calendario.mover(a.eventoId, a, tz());
        out.lineas.push(`✔ Movido: ${evento?.titulo || a.eventoId} → ${a.inicio.slice(5, 10)} ${a.inicio.slice(11)}–${a.fin.slice(11)}`);
      } else if (a.tipo === 'calendar.borrar') {
        await calendario.borrar(a.eventoId);
        out.lineas.push(`✔ Borrado: ${evento?.titulo || a.eventoId}`);
      }
      metricas.usar(f, 'calendario');
      await refrescarAgenda(true);
      return;
    }
    switch (a.tipo) {
      case 'zona.cambiar': out.lineas.push(await cambiarZona(a.tz)); break;
      case 'compromiso.crear': {
        const r = crearCompromiso(a);
        metricas.usar(f, 'compromisos');
        if (r.ok) out.lineas.push(`📌 Anotado: "${r.item.texto}" para el ${r.item.vence} (${C.abiertos(leerCompromisos()).length}/${cfg.limiteAbiertos} abiertos).`);
        else { s.compromisoEnEspera = { texto: a.texto, vence: a.vence, negocio: a.negocio }; guardar(); out.mensajes.push(listaLimite(r.abiertos)); }
        break;
      }
      case 'compromiso.actualizar': {
        const r = C.actualizar(leerCompromisos(), a.id, { ...(a.estado ? { estado: a.estado } : {}), ...(a.vence ? { vence: a.vence } : {}) }, f);
        if (!r.ok) { out.lineas.push(`⚠️ No existe el compromiso ${a.id}.`); break; }
        escribirCompromisos(r.doc);
        const extra = intentarEnEspera();
        if (extra) out.lineas.push(extra);
        break;
      }
      case 'metrica':
        if (a.evento === 'pidio_numeros') metricas.incrementar(f, 'consultas_numeros');
        else metricas.registrar(s.cierreAbierto?.fecha || f, { caos: a.valor });
        break;
      case 'ajuste': s.ajustes[a.clave] = a.valor; guardar(); break;
      case 'cierre.completo': {
        const fecha = s.cierreAbierto?.fecha || f;
        s.cierreAbierto = null;
        guardar();
        metricas.registrar(fecha, { abiertos_fin_dia: C.abiertos(leerCompromisos()).length });
        metricas.usar(fecha, 'cierre');
        break;
      }
      case 'onboarding.completo': s.onboardingCompleto = true; s.onboardingIniciado = false; guardar(); break;
    }
  }

  // ---------- botones ----------
  async function manejarBoton(id) {
    const f = hoy();
    metricas.usar(f, 'botones');
    const [tipo, a, b] = id.split(':');
    if (tipo === 'acc') {
      const c = s.confirmaciones[a];
      delete s.confirmaciones[a];
      guardar();
      if (!c || ahora().getTime() - c.at > CONFIRMACION_MS) return enviar(t('Esa confirmación ya caducó, señor. Pídamelo de nuevo si sigue en pie.'));
      if (b !== 'si') return enviar(t(`Cancelado: no voy a ${c.desc}.`));
      const out = { lineas: [], mensajes: [] };
      try { await ejecutar(c.accion, out, true); } catch (e) { out.lineas.push(`⚠️ No pude: ${e.message}`); }
      s.contexto.push(`Moisés confirmó: ${c.desc}. Resultado: ${out.lineas.join(' ')}`);
      return enviar(t(out.lineas.join('\n') || 'Hecho.'));
    }
    if (tipo === 'prio') {
      const p = dia().prioridad;
      if (!p) return enviar(t('No encuentro la prioridad de hoy, señor.'));
      metricas.registrar(f, { prioridad_cumplida: a === 'hecho' });
      if (p.compromisoId) cambiarCompromiso(p.compromisoId, a);
      s.contexto.push(`Moisés marcó la prioridad del día ("${p.texto}") como: ${a}.`);
      guardar();
      const extra = intentarEnEspera();
      const msg = { hecho: `✅ Prioridad cumplida: ${p.texto}. Bien hecho, señor.`, manana: `⏳ "${p.texto}" pasa a mañana.`, soltar: `❌ Soltada: "${p.texto}". Una cosa menos.` }[a];
      return enviar(t([msg, extra].filter(Boolean).join('\n')));
    }
    if (tipo === 'c') {
      const previo = leerCompromisos().items.find((c) => c.id === a);
      if (!previo) return enviar(t(`No encontré el compromiso ${a}.`));
      if (previo.estado !== 'abierto') return enviar(t(`"${previo.texto}" ya estaba ${previo.estado === 'hecho' ? 'hecho' : 'soltado'}, señor.`));
      const item = cambiarCompromiso(a, b);
      metricas.usar(f, 'compromisos');
      if (b === 'hecho' && dia().prioridad?.compromisoId === a) metricas.registrar(f, { prioridad_cumplida: true });
      const n = C.abiertos(leerCompromisos()).length;
      const msg = { hecho: `✅ Hecho: "${item.texto}".`, manana: `⏳ "${item.texto}" pasa a mañana.`, soltar: `❌ Soltado: "${item.texto}".` }[b];
      const extra = intentarEnEspera();
      s.contexto.push(`Moisés marcó el compromiso ${a} ("${item.texto}") como: ${b}.`);
      guardar();
      return enviar(t([`${msg} Abiertos ${extra ? n + 1 : n}/${cfg.limiteAbiertos}.`, extra].filter(Boolean).join('\n')));
    }
    if (tipo === 'zona') {
      if (b !== 'si' || !zonaValida(a)) return enviar(t(`Entendido, sigo en ${tz()}.`));
      return enviar(t(await cambiarZona(a)));
    }
    if (tipo === 'caos') {
      const n = Number(a);
      metricas.registrar(s.cierreAbierto?.fecha || f, { caos: n });
      return enviar(t(`Anotado: caos ${n}/5 (${NIVELES_CAOS[n - 1].toLowerCase()}).`));
    }
    log('botón desconocido:', id);
  }

  // ---------- conversación ----------
  function datosChat() {
    const ab = C.abiertos(leerCompromisos());
    return {
      ahora: `${fechaLarga(ahora(), tz())}, ${hora()}`, zona: tz(), hoy: hoy(), manana: sumarDias(hoy(), 1),
      agenda: eventos().filter((e) => !e.todoElDia).map((e) => ({
        eventoId: e.id, dia: fechaLocal(new Date(e.inicio), tz()), inicio: hhmm(e.inicio), fin: hhmm(e.fin), titulo: e.titulo,
        conInvitados: (e.invitados || []).length > 0,
      })),
      compromisosAbiertos: ab.map((c) => ({ id: c.id, texto: c.texto, vence: c.vence, negocio: c.negocio })),
      limiteAbiertos: cfg.limiteAbiertos,
      horarios: { silencio: `${ajuste('silencioInicio')}–${ajuste('silencioFin')}`, reporte: ajuste('reporteFallback'), cierre: horaCierre() },
    };
  }

  async function conversar(texto, extra = '') {
    ocupadoDesde = Date.now();
    const aviso = setTimeout(() => chat.texto(cfg.owner, '⏳ En eso, señor…'), 25_000);
    const contexto = s.contexto.splice(0);
    guardar();
    const prompt = (contexto.length ? `[Contexto del sistema — esto no lo escribió Moisés]\n${contexto.join('\n\n')}\n\n` : '') +
      `[Datos del bridge (JSON)]\n${JSON.stringify(datosChat())}\n\n[Mensaje de Moisés]\n${texto}`;
    try {
      const r = await claude.ejecutar({ prompt, sistema: sistema + extra, modelo: cfg.modeloChat, sesion: 'chat', cwd: memoria.ruta, herramientas: true });
      if (r.error) {
        s.contexto.unshift(...contexto);
        guardar();
        await enviar(t(`⚠️ Algo falló del lado de Claude (${r.error}). Inténtelo de nuevo en un momento, señor.`));
        return;
      }
      const { limpio, acciones, errores } = extraer(r.texto);
      const res = await ejecutarAcciones(acciones);
      const ok = await memoria.guardar('jarvis: conversación');
      const partes = [limpio, res.lineas.join('\n'), ...errores.map((e) => `⚠️ ${e}`)];
      if (!ok) partes.push('⚠️ No pude hacer push a jarvis-memoria; quedó solo en el servidor.');
      const cuerpo = partes.filter(Boolean).join('\n\n');
      if (cuerpo) await enviar(t(cuerpo));
      for (const m of res.mensajes) await enviar(m);
    } finally {
      clearTimeout(aviso);
      ocupadoDesde = 0;
    }
  }

  // entradas: [{ texto, botonId, audio }], ya normalizadas por el canal (kapso.mjs o telegram.mjs).
  async function manejarEntrada(entradas) {
    s.ultimoMensajeAt = ahora().getTime();
    guardar();
    try {
      await memoria.pull();
      await refrescarAgenda();
      await vaciarPendientes();
      if (entradas.some((x) => x.audio)) metricas.usar(hoy(), 'audios');
      for (const en of entradas) if (en.botonId) await manejarBoton(en.botonId);
      const texto = entradas.map((x) => x.texto).filter(Boolean).join('\n');
      if (!texto) return;

      if (/^\/(nuevo|reset)$/i.test(texto)) { delete s.sesiones?.chat; guardar(); return enviar(t('Conversación nueva, señor.')); }
      const extraCmd = await comandos(texto);
      if (extraCmd) return enviar(t(extraCmd));
      const z = comandoZona(texto);
      if (z === 'invalida') return enviar(t('No reconozco esa zona, señor. Use el nombre IANA, por ejemplo /zona America/Bogota.'));
      if (z) return enviar(t(z === tz() ? `Ya estamos en ${tz()}, señor.` : await cambiarZona(z)));

      let extra = '';
      if (enOnboarding()) {
        if (!s.onboardingIniciado) { s.onboardingIniciado = true; guardar(); }
        extra += T.ONBOARDING;
      } else if (!dia().reporte && !deNoche()) {
        await enviarReporte('primer_mensaje');
        if (SALUDO.test(texto)) return;
      }
      if (s.cierreAbierto && ahora().getTime() - s.cierreAbierto.at < 12 * 3600_000) extra += T.cierre(s.cierreAbierto.fecha);
      await conversar(texto, extra);
    } finally {
      await memoria.guardar('jarvis: mensaje');
    }
  }

  // ---------- reloj (cada minuto) ----------
  let enTick = false;
  async function tick() {
    if (enTick) return;
    enTick = true;
    try {
      await refrescarAgenda();
      const d = dia();
      const h = hora();
      const sil = silencio();
      const onboarding = enOnboarding();

      if (s.pendientes.length && !sil.silencio) {
        if (ventanaAbierta()) await vaciarPendientes();
        else await ping();
      }
      for (const [id, c] of Object.entries(s.confirmaciones)) if (ahora().getTime() - c.at > CONFIRMACION_MS) delete s.confirmaciones[id];

      // Reporte de respaldo si no escribió: a la hora configurada (o antes, si un evento está por empezar).
      const porEmpezar = eventos().some((e) => !e.todoElDia && new Date(e.inicio) > ahora() && new Date(e.inicio) - ahora() <= cfg.recordatorioMin * 60_000);
      if (!onboarding && !d.reporte && !deNoche() && (h >= ajuste('reporteFallback') || porEmpezar) && h < horaCierre()) {
        encolar(() => enviarReporte('fallback'));
      }
      await recordatorios(d);

      if (!onboarding && !d.cierre && enRango(h, horaCierre(), ajuste('silencioInicio'))) {
        d.cierre = { at: ahora().getTime() };
        guardar();
        encolar(() => enviarCierre());
      }
      if (!onboarding && diaIso(ahora(), tz()) === cfg.revisionDia && h >= cfg.revisionHora && !deNoche() && s.ultimaSemanal !== hoy()) {
        s.ultimaSemanal = hoy();
        guardar();
        encolar(() => revisionSemanal());
      }
      if (!s.veredicto && diasEntre(s.inicio, hoy()) >= 30 && h >= ajuste('reporteFallback') && !deNoche()) {
        s.veredicto = { fecha: hoy() };
        guardar();
        encolar(() => veredicto30());
      }
      await detectarViaje();
    } finally { enTick = false; }
  }

  // Avisos agrupados: todos los eventos que empiezan en los próximos RECORDATORIO_MIN minutos van en un mensaje.
  async function recordatorios(d) {
    const ag = s.agenda;
    if (!ag) return;
    const ya = ahora().getTime();
    const clave = (e) => `${e.id}@${e.inicio}`; // un evento movido se avisa de nuevo
    const proximos = ag.eventos.filter((e) => !e.todoElDia && !ag.notificados[clave(e)] && new Date(e.inicio) - ya > 0 && new Date(e.inicio) - ya <= cfg.recordatorioMin * 60_000);
    if (!proximos.length) return;
    for (const e of proximos) ag.notificados[clave(e)] = true;
    guardar();
    if (deNoche() || !d.reporte) return; // sin reporte todavía: el reporte (que trae la agenda) va primero
    const texto = proximos.map((e) => `⏰ *${hhmm(e.inicio)} ${e.titulo}*${e.meet ? `\n${e.meet}` : ''}`).join('\n');
    // Si llega acumulado (por otra reunión), sirve mientras el bloque siga en curso.
    await avisar(t(texto), { caduca: Math.min(...proximos.map((e) => new Date(e.fin).getTime())) });
  }

  return {
    estado: s, manejarEntrada, tick, encolar, enviarReporte, cambiarZona, refrescarAgenda, silencio, avisar,
    ocupado: () => ocupadoDesde, tz, hoy, eventosDeHoy, horaCierre, ajuste,
  };
}
