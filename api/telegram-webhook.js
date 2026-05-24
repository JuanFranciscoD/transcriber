// api/telegram-webhook.js
// Vercel serverless function — recibe updates del bot de Telegram,
// descarga el audio, lo transcribe con Groq Whisper,
// resume con LLaMA 3.3-70b y guarda la nota en Firestore.

import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

// ── Firebase Admin init ──
const FIREBASE_PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC6rcu3FvA9JRv0
ulGq8+ABq3FK5DigDsl6+PVYOEamAeB2B0zxel0zoEZw0BcOsMSE0Dr8inHgcHsg
r9knHD7U34TqSMYPlS+nAI0Y1TUpAlrJat5AKRfZfix8EJiSwtNuggiJ6lDPrnPU
tEBB67Zfu1ChXcJiAtuK1xvhL3WmHqwhTISiih6h29cSuPGLtgsmA0CkNHI8ywGh
fTNnl3o5CiabM1u/zT5+vYrVrVlhIn7irFkuZJgYedLgTIX+bqsLmfl0wQ5yVdTB
LAXhQKIW6rkKqr4DOvog+NSIYbdb0A1WN8ZAKQITNeyQaF+wXuLuqxqJ5vj8e26b
SHjtTGsvAgMBAAECggEAS3GtoOL+WFfFApTCKKrC3yngcXnmgJk5SB+RWAP2WWTs
yAaPTBA91n1xumn+x4sdAOf+zs1M1H3g5QbsZef+ZJ2o495hXS7XwVBxtZWFFHvF
IR21kIyK/PUHGWTDpJxkQob+2G4AFs7UNSRby8htPic/oNd5lY6+F1B0Df/WNjoC
cJnnbpH1u6RWlGRLFM25VQmpdNxEysc0suftT4BkR9PSZDS0QLfVEO7OfsZgUm6i
n3AOLngxw2zq/46g1N4EqUScHDqN5UEFa7a0/Cxu7d3VF77mo6NXF7a/BfebBj/x
2Sy4CCA5jV0smUw8bK5K0wwPgshzrCGg//OMJL7yIQKBgQDeiqeLB0iMFL0i+ADu
tkeGL3tSlINEUE80m6hliHLM1bafGYBGshxoLMiaTvMDdOWp8/gVCx4QoZmo0VRD
LvCzd1lFNm5lEB0uLg3BAF8RsS/T7FG6lGaG7CApyo+W55il1fEP16ItLPkZcQga
y5iDSsbKsWnWSA2c1iY6XeGcNwKBgQDWvtSHZP//t5Hu6+QIY/N+7KSrmKyLFsKs
WjRzo+WQVNitzQ9140wRIwqxQpPqFjwMX3l3DOzesHmvzgpotD8be85eDtH+WFqI
Bk9rw4rVrTpap6fXZEtxxAhKlRWaAix2R0h1weQqJyTaytpdvpHqBITPwCHUvMRz
KxlttKNcyQKBgGkDqRhUMYnY53+u5FHBNnM9yMYpSuBbvWSn54kyIGpEl07wq7Ww
qvMF3wviIY8KBK50cCcN/fv/JhGh5k9lwTQPJ9MfYmzSc9Ks7NScpkAlCtrIc7DG
ArO8jVjrO2MMmt323TCKov8Kb+nvitGKLcgW60QPAFCb48CU1alJUAN1AoGBAK7Q
xKS/5OLgJo2wPH9UFroBnQAQFo5X5fx2pnJpPw1i9M1vvKFEev0MYLzyrQUIOrP7
2R7AR+f1E+q5OaII8cLG47WQLQT4GiLXuDnLAq92CKYaC7l9bSlc4z8L5HzuPhG/
b85lG//ww8DVGDTuWUx/hzq0dxX+4ZG7yUSUo9R5AoGBAMBcEAiJIH2K9nNMlxUV
0Cn5npaRv0b7b4qhoqfTEvn/6mIAKnIjnbRydbB9koNlEiA2PO6E8NOj41njuMIJ
gdm0fNHAbyKG1IyZ2OiMUjvxdxy+tFKdAzYbgDEo0bLBsRC4rSerNZ6MFqv+DExa
HWzuV0US7su/stQDtsXU8xSN
-----END PRIVATE KEY-----`;

function getDb() {
  if (!getApps().length) {
    initializeApp({
      credential: cert({
        projectId:   'transcriber-f783f',
        clientEmail: 'firebase-adminsdk-fbsvc@transcriber-f783f.iam.gserviceaccount.com',
        privateKey:  FIREBASE_PRIVATE_KEY,
      }),
    });
  }
  return getFirestore();
}

const GROQ_KEY       = process.env.GROQ_API_KEY;
const TG_TOKEN       = process.env.TELEGRAM_BOT_TOKEN;
const ALLOWED_CHAT   = process.env.TELEGRAM_ALLOWED_CHAT_ID; // tu chat_id personal
const FIREBASE_UID   = process.env.FIREBASE_USER_UID;        // tu uid de Firebase Auth

export const config = { api: { bodyParser: true }, maxDuration: 60 };

// ── Registrar comandos del bot en Telegram ──
async function registerCommands(token) {
  await fetch(`https://api.telegram.org/bot${token}/setMyCommands`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      commands: [
        { command: 'ops',     description: '📋 Ver todas las operaciones activas' },
        { command: 'hoy',     description: '☀️ Brief del día: ops, visitas y notas' },
        { command: 'nuevas',  description: '🆕 Propiedades nuevas en MB Propy (7 días)' },
        { command: 'bajas',   description: '📉 Propiedades con precio actualizado' },
        { command: 'buscar',  description: '🔍 Buscar propiedades paso a paso' },
        { command: 'crearop',       description: '➕ Crear nueva operación desde el bot' },
        { command: 'agendarvisita', description: '🗓 Agendar visita a operación existente' },
        { command: 'nota',    description: '📝 Forzar guardar texto como nota' },
        { command: 'ayuda',   description: '❓ Ver todos los comandos disponibles' },
      ],
    }),
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(200).json({ ok: true });

  const update = req.body;
  const msg = update.message || update.channel_post;
  if (!msg) return res.status(200).json({ ok: true });

  const chatId = String(msg.chat.id);

  // Solo procesar mensajes de tu chat personal
  if (ALLOWED_CHAT && chatId !== ALLOWED_CHAT) {
    await tgSend(chatId, '⛔ No autorizado.');
    return res.status(200).json({ ok: true });
  }

  const audio = msg.voice || msg.audio || msg.video_note || msg.video || msg.document;
  const textMsg = msg.text;

  // Manejar mensajes de texto
  if (!audio && textMsg) {
    // ── Comandos ──
    if (textMsg.startsWith('/')) {
      const db = getDb();
      const userRef = db.collection('users').doc(FIREBASE_UID);
      const MB_URL = 'https://hyxsdeeoyecdslrtqrmo.supabase.co';
      const MB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh5eHNkZWVveWVjZHNscnRxcm1vIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU0ODczNzYsImV4cCI6MjA5MTA2MzM3Nn0.YT76TJzSbxgjkNAdpIsRd5AGW9bC6PaTkyEFwOK7OTo';
      const mbH = { 'apikey': MB_KEY, 'Authorization': `Bearer ${MB_KEY}` };
      const cmd = textMsg.split(' ')[0].toLowerCase().replace('/','').split('@')[0];

      // Registrar comandos la primera vez que se usa /ayuda o /start
      if (cmd === 'start' || cmd === 'ayuda') {
        await registerCommands(TG_TOKEN);
      }

      // /ayuda
      if (cmd === 'ayuda' || cmd === 'start' || cmd === 'help') {
        await tgSend(chatId,
          '🤖 *Asistente Broker — Comandos*\n\n' +
          '*Operaciones*\n' +
          '`/ops` — todas las ops activas\n' +
          '`/hoy` — brief del día\n\n' +
          '*MB Propy*\n' +
          '`/nuevas` — propiedades de los últimos 7 días\n' +
          '`/bajas` — props con precio actualizado\n' +
          '`/buscar` — búsqueda guiada paso a paso\n\n' +
          '*Notas*\n' +
          '`/nota [texto]` — guardar como nota directamente\n\n' +
          '*Lenguaje natural*\n' +
          '"qué pasó con Sofia Sandstede"\n' +
          '"busca 3 dorm en Palermo hasta 400k"\n' +
          '"propiedades de Gloria Ayerza"\n' +
          '"PHs en Recoleta de más de 80m²"\n\n' +
          '_Todo se sincroniza con Transcribeme._',
          'Markdown'
        );
        return res.status(200).json({ ok: true });
      }

      // /ops
      if (cmd === 'ops') {
        const snap = await userRef.get();
        const operaciones = snap.exists ? (snap.data().operaciones || []) : [];
        if (!operaciones.length) {
          await tgSend(chatId, '📋 No tenés operaciones activas.');
          return res.status(200).json({ ok: true });
        }
        const stageEmoji = { contacto:'📞', visita:'🏠', negociacion:'🤝', reserva:'📑', escritura:'✅', archivada:'📦' };
        let txt = '📋 *Operaciones activas*\n\n';
        operaciones.filter(o => o.stage !== 'archivada').forEach(op => {
          const em = stageEmoji[op.stage] || '•';
          txt += `${em} *${op.titulo || 'Sin título'}*\n`;
          if (op.lead) txt += `  👤 ${op.lead.nombre || op.lead.slug}\n`;
          if (op.prop) txt += `  🏢 ${op.prop.direccion}\n`;
          txt += `  Etapa: ${op.stage}\n\n`;
        });
        await tgSend(chatId, txt.trim(), 'Markdown');
        return res.status(200).json({ ok: true });
      }

      // /hoy
      if (cmd === 'hoy') {
        const snap = await userRef.get();
        const data = snap.exists ? snap.data() : {};
        const operaciones = data.operaciones || [];
        const notes = data.notes || [];
        const hoy = new Date().toLocaleDateString('es-AR', { weekday:'long', day:'numeric', month:'long' });
        let txt = `☀️ *Brief del día — ${hoy}*\n\n`;

        // Ops activas
        const opsActivas = operaciones.filter(o => o.stage !== 'archivada');
        txt += `📋 *${opsActivas.length} operaciones activas*\n`;
        opsActivas.slice(0, 5).forEach(op => {
          txt += `• ${op.titulo || 'Sin título'} (${op.stage})`;
          if (op.lead) txt += ` — ${op.lead.nombre || op.lead.slug}`;
          txt += '\n';
        });

        // Visitas próximas
        const visitas = [];
        operaciones.forEach(op => {
          (op.visitas || []).forEach(v => {
            if (v.fecha) visitas.push({ ...v, opTitulo: op.titulo });
          });
        });
        if (visitas.length) {
          txt += `\n🏠 *Visitas programadas*\n`;
          visitas.slice(0, 5).forEach(v => {
            txt += `• ${v.fecha}${v.hora ? ' ' + v.hora : ''} — ${v.opTitulo || ''}\n`;
          });
        }

        // Últimas notas
        const recientes = notes.slice(0, 3);
        if (recientes.length) {
          txt += `\n📝 *Notas recientes*\n`;
          recientes.forEach(n => txt += `• ${n.title} (${n.date})\n`);
        }

        await tgSend(chatId, txt.trim(), 'Markdown');
        return res.status(200).json({ ok: true });
      }

      // /nuevas
      if (cmd === 'nuevas') {
        const hace7dias = new Date(Date.now() - 7 * 86400000).toISOString().slice(0,10);
        const url = `${MB_URL}/rest/v1/propiedades?select=id,direccion,barrio,tipo,modo,precio,moneda,dormitorios,sup_cub,broker&activa=eq.true&modo=neq.ghost&created_at=gte.${hace7dias}&order=created_at.desc&limit=8`;
        const resp = await fetch(url, { headers: mbH });
        const props = await resp.json();
        if (!Array.isArray(props) || !props.length) {
          await tgSend(chatId, '🆕 No hay propiedades nuevas en los últimos 7 días.');
          return res.status(200).json({ ok: true });
        }
        let txt = '🆕 *Propiedades nuevas (7 días)*\n\n';
        props.forEach(p => {
          const precio = p.precio ? `${p.moneda === 'USD' ? 'USD ' : '$'}${Number(p.precio).toLocaleString('es-AR')}` : '';
          const ficha = `https://www.mirandabosch.com/ficha/${Buffer.from(JSON.stringify({p:String(p.id),b:'33504'})).toString('base64')}`;
          txt += `• *${p.tipo || 'Prop'}* ${p.direccion} (${p.barrio})\n  ${p.dormitorios != null ? p.dormitorios+' dorm | ' : ''}${p.sup_cub || '?'}m² | ${precio} | 🔑 ${p.broker || '?'}\n  🔗 ${ficha}\n\n`;
        });
        await tgSend(chatId, txt.trim(), 'Markdown');
        return res.status(200).json({ ok: true });
      }

      // /bajas
      if (cmd === 'bajas') {
        const hace30dias = new Date(Date.now() - 30 * 86400000).toISOString().slice(0,10);
        const url = `${MB_URL}/rest/v1/propiedades?select=id,direccion,barrio,tipo,modo,precio,moneda,dormitorios,sup_cub,broker,updated_at&activa=eq.true&modo=neq.ghost&updated_at=gte.${hace30dias}&order=updated_at.desc&limit=8`;
        const resp = await fetch(url, { headers: mbH });
        const props = await resp.json();
        if (!Array.isArray(props) || !props.length) {
          await tgSend(chatId, '📉 No hay propiedades modificadas en los últimos 30 días.');
          return res.status(200).json({ ok: true });
        }
        let txt = '📉 *Propiedades actualizadas recientemente*\n_(posible baja de precio)_\n\n';
        props.forEach(p => {
          const precio = p.precio ? `${p.moneda === 'USD' ? 'USD ' : '$'}${Number(p.precio).toLocaleString('es-AR')}` : '';
          const ficha = `https://www.mirandabosch.com/ficha/${Buffer.from(JSON.stringify({p:String(p.id),b:'33504'})).toString('base64')}`;
          const mod = p.updated_at ? p.updated_at.slice(0,10) : '';
          txt += `• *${p.tipo || 'Prop'}* ${p.direccion} (${p.barrio})\n  ${p.dormitorios != null ? p.dormitorios+' dorm | ' : ''}${precio} | mod: ${mod} | 🔑 ${p.broker || '?'}\n  🔗 ${ficha}\n\n`;
        });
        await tgSend(chatId, txt.trim(), 'Markdown');
        return res.status(200).json({ ok: true });
      }

      // /nota [texto]
      if (cmd === 'nota') {
        const textoNota = textMsg.replace(/^\/nota\s*/i, '').trim();
        if (!textoNota) {
          await tgSend(chatId, '📝 Escribí el texto después del comando:\n`/nota Reunión con el cliente mañana a las 10`', 'Markdown');
          return res.status(200).json({ ok: true });
        }
        // Guardar directamente como nota sin pasar por detección de consulta
        const llamaResp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${GROQ_KEY}` },
          body: JSON.stringify({
            model: 'llama-3.3-70b-versatile', max_tokens: 512,
            messages: [{ role: 'user', content: 'Analizá este texto y generá un resumen estructurado en JSON.\n\nTexto:\n' + textoNota + '\n\nDevolvé SOLO un JSON válido con este formato exacto:\n{\n  "titulo": "título descriptivo corto (máx 5 palabras)",\n  "secciones": [\n    { "titulo": "Nombre de sección", "puntos": ["punto 1", "punto 2"] }\n  ]\n}' }],
          }),
        });
        const ld = await llamaResp.json();
        let resumenObj;
        try { const jm = ld.choices[0].message.content.match(/\{[\s\S]*\}/); resumenObj = JSON.parse(jm ? jm[0] : '{}'); }
        catch { resumenObj = { titulo: 'Nota', secciones: [{ titulo: 'Contenido', puntos: [textoNota] }] }; }
        const now = Date.now();
        const nota = { id: String(now), title: resumenObj.titulo || 'Nota', date: new Date().toLocaleDateString('es-AR', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' }), createdAt: now, duration: null, durationSecs: null, resumen: resumenObj, transcripcion: textoNota, source: 'telegram' };
        const snap2 = await userRef.get();
        const existing = snap2.exists ? (snap2.data().notes || []) : [];
        await userRef.set({ notes: [nota, ...existing], updatedAt: now, lastBotUpdate: now }, { merge: true });
        await tgSend(chatId, `✅ *${resumenObj.titulo}*\n_Guardado en Transcribeme_`, 'Markdown');
        return res.status(200).json({ ok: true });
      }

      // /agendarvisita — flujo guiado para agendar visita a op existente
      if (cmd === 'agendarvisita') {
        const snap = await userRef.get();
        const operaciones = snap.exists ? (snap.data().operaciones || []) : [];
        const opsActivas = operaciones.filter(o => o.stage !== 'archivada');
        if (!opsActivas.length) {
          await tgSend(chatId, '📋 No tenés operaciones activas. Usá `/crearop` para crear una.', 'Markdown');
          return res.status(200).json({ ok: true });
        }
        // Listar ops para elegir
        let txt = '🗓 *Agendar visita*\n\n¿A qué operación?\n\n';
        opsActivas.slice(0, 8).forEach((op, i) => {
          txt += `*${i+1}.* ${op.titulo}`;
          if (op.lead) txt += ` — ${op.lead.nombre || op.lead.slug}`;
          txt += '\n';
        });
        txt += '\n_Respondé con el número_';
        await userRef.set({ botAgendarState: { step: 'elegir_op', ops: opsActivas.slice(0,8).map(o => ({ id: o.id, titulo: o.titulo, lead: o.lead, prop: o.prop, props: o.props || [] })) } }, { merge: true });
        await tgSend(chatId, txt, 'Markdown');
        return res.status(200).json({ ok: true });
      }

      // /crearop — flujo guiado para crear operación
      if (cmd === 'crearop') {
        await userRef.set({ botCrearOpState: { step: 'titulo', data: {} } }, { merge: true });
        await tgSend(chatId,
          '➕ *Nueva operación*\n\n¿Cómo se llama la operación?\n\n_Ej: "Rolandi — Recoleta" o "Familia Pérez"_',
          'Markdown'
        );
        return res.status(200).json({ ok: true });
      }

      // /buscar — flujo guiado con estado en Firestore
      if (cmd === 'buscar') {
        await userRef.set({ botBuscarState: { step: 'barrio', params: {} } }, { merge: true });
        await tgSend(chatId,
          '🔍 *Búsqueda guiada de propiedades*\n\n' +
          '¿En qué barrio?\n\n' +
          '_Escribí el barrio o "cualquiera" para todos_',
          'Markdown'
        );
        return res.status(200).json({ ok: true });
      }

      // Comando desconocido
      await tgSend(chatId, '❓ Comando no reconocido. Usá `/ayuda` para ver los disponibles.', 'Markdown');
      return res.status(200).json({ ok: true });
    }

    // ── Flujo guiado /agendarvisita (estado activo) ──
    {
      const userRefAV = getDb().collection('users').doc(FIREBASE_UID);
      const snapAV = await userRefAV.get();
      const agendarState = snapAV.exists ? snapAV.data().botAgendarState : null;

      if (agendarState && agendarState.step) {
        const step = agendarState.step;
        const av = agendarState;

        if (/^\/cancelar|^\/cancel/i.test(textMsg)) {
          await userRefAV.set({ botAgendarState: null }, { merge: true });
          await tgSend(chatId, '❌ Cancelado.');
          return res.status(200).json({ ok: true });
        }

        // Paso 1: elegir operación
        if (step === 'elegir_op') {
          const num = parseInt(textMsg.trim());
          const ops = av.ops || [];
          const opElegida = !isNaN(num) && ops[num-1] ? ops[num-1] : null;
          if (!opElegida) {
            await tgSend(chatId, '❓ Elegí un número de la lista.');
            return res.status(200).json({ ok: true });
          }
          // Armar lista de propiedades de esa op
          const todasProps = [];
          if (opElegida.prop) todasProps.push(opElegida.prop);
          (opElegida.props || []).forEach(p => todasProps.push(p));

          if (todasProps.length === 0) {
            // Sin propiedades → preguntar propiedad libre o buscar
            await userRefAV.set({ botAgendarState: { step: 'prop_texto', opId: opElegida.id, opTitulo: opElegida.titulo } }, { merge: true });
            await tgSend(chatId, `✅ *${opElegida.titulo}*\n\n¿Para qué propiedad?\n_Escribí dirección o "saltar"_`, 'Markdown');
          } else if (todasProps.length === 1) {
            // Una sola prop → ir directo a fecha
            await userRefAV.set({ botAgendarState: { step: 'fecha', opId: opElegida.id, opTitulo: opElegida.titulo, prop: todasProps[0] } }, { merge: true });
            await tgSend(chatId, `✅ *${opElegida.titulo}*\n🏢 ${todasProps[0].direccion}\n\n¿Qué fecha y hora?\n_Ej: "lunes 1 a las 10", "02/06 11:30"_`, 'Markdown');
          } else {
            // Múltiples props → elegir cuál
            let txt = `✅ *${opElegida.titulo}*\n\n¿Para qué propiedad?\n\n`;
            todasProps.forEach((p, i) => { txt += `*${i+1}.* ${p.direccion} (${p.barrio || ''})\n`; });
            txt += `\n_Número o "saltar"_`;
            await userRefAV.set({ botAgendarState: { step: 'elegir_prop_av', opId: opElegida.id, opTitulo: opElegida.titulo, props: todasProps } }, { merge: true });
            await tgSend(chatId, txt, 'Markdown');
          }
          return res.status(200).json({ ok: true });
        }

        // Paso 2a: elegir prop de lista
        if (step === 'elegir_prop_av') {
          const num = parseInt(textMsg.trim());
          const props = av.props || [];
          const propElegida = !isNaN(num) && props[num-1] ? props[num-1] : null;
          await userRefAV.set({ botAgendarState: { step: 'fecha', opId: av.opId, opTitulo: av.opTitulo, prop: propElegida } }, { merge: true });
          await tgSend(chatId,
            (propElegida ? `✅ ${propElegida.direccion}\n\n` : '') +
            '¿Qué fecha y hora?\n_Ej: "lunes 1 a las 10", "02/06 11:30"_', 'Markdown');
          return res.status(200).json({ ok: true });
        }

        // Paso 2b: prop texto libre
        if (step === 'prop_texto') {
          const propTexto = !/saltar|skip/i.test(textMsg) ? textMsg.trim() : null;
          await userRefAV.set({ botAgendarState: { step: 'fecha', opId: av.opId, opTitulo: av.opTitulo, prop: propTexto ? { direccion: propTexto } : null } }, { merge: true });
          await tgSend(chatId, '¿Qué fecha y hora?\n_Ej: "lunes 1 a las 10", "02/06 11:30"_', 'Markdown');
          return res.status(200).json({ ok: true });
        }

        // Paso 3: fecha → guardar visita
        if (step === 'fecha') {
          // Parsear fecha con Groq
          let visitaObj = null;
          try {
            const hoyStr = new Date().toLocaleDateString('es-AR', { weekday:'long', day:'numeric', month:'long', year:'numeric', timeZone:'America/Argentina/Buenos_Aires' });
            const pr = await fetch('https://api.groq.com/openai/v1/chat/completions', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${GROQ_KEY}` },
              body: JSON.stringify({ model: 'llama-3.3-70b-versatile', max_tokens: 100,
                messages: [{ role: 'user', content: `Hoy es ${hoyStr}. Devolvé SOLO JSON: {"iso":"YYYY-MM-DDTHH:MM:00","fecha":"DD/MM/YYYY","hora":"HH:MM"}. Si no hay hora usá "10:00". Texto: "${textMsg}"` }] }),
            });
            const pd = await pr.json();
            const jm = (pd.choices?.[0]?.message?.content || '').match(/\{[\s\S]*?\}/);
            if (jm) {
              const parsed = JSON.parse(jm[0]);
              const dt = new Date(parsed.iso);
              if (!isNaN(dt.getTime())) {
                visitaObj = { id: String(Date.now()), fecha: parsed.fecha, hora: parsed.hora, datetime: parsed.iso, propId: av.prop?.id ? String(av.prop.id) : null, broker: av.prop?.broker || '', confirmada: false, createdAt: Date.now() };
              }
            }
          } catch(e) { console.log('[BOT] agendarvisita fecha error:', e.message); }

          // Fallback manual
          if (!visitaObj) {
            const ahora = new Date();
            const diaM = textMsg.match(/\b(\d{1,2})\b/);
            const horaM = textMsg.match(/las?\s+(\d{1,2})(?::(\d{2}))?/i) || textMsg.match(/(\d{1,2}):(\d{2})/);
            let dt = new Date(ahora);
            if (diaM) { dt.setDate(parseInt(diaM[1])); if (dt < ahora) dt.setMonth(dt.getMonth()+1); }
            if (horaM) dt.setHours(parseInt(horaM[1]), parseInt(horaM[2]||'0'), 0, 0); else dt.setHours(10,0,0,0);
            const iso = `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}T${String(dt.getHours()).padStart(2,'0')}:${String(dt.getMinutes()).padStart(2,'0')}:00`;
            visitaObj = { id: String(Date.now()), fecha: `${String(dt.getDate()).padStart(2,'0')}/${String(dt.getMonth()+1).padStart(2,'0')}/${dt.getFullYear()}`, hora: `${String(dt.getHours()).padStart(2,'0')}:${String(dt.getMinutes()).padStart(2,'0')}`, datetime: iso, propId: av.prop?.id ? String(av.prop.id) : null, broker: av.prop?.broker || '', confirmada: false, createdAt: Date.now() };
          }

          // Crear evento GCal
          let gcalLinkAV = null;
          try {
            const gcalR = await fetch('https://transcribeme.vercel.app/api/gcal', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ title: `Visita: ${av.opTitulo}`, date: visitaObj.datetime.slice(0,10), time: visitaObj.datetime.slice(11,16), description: av.prop?.direccion ? `Propiedad: ${av.prop.direccion}` : '' }),
            });
            const gd = await gcalR.json();
            if (gd.ok) { gcalLinkAV = gd.htmlLink; visitaObj.gcalLink = gcalLinkAV; }
          } catch(e) { console.log('[BOT] gcal agendarvisita error:', e.message); }

          // Guardar en Firestore — leer ops frescas y agregar visita a la op correcta
          const snapFresh = await userRefAV.get();
          const allOps = snapFresh.exists ? (snapFresh.data().operaciones || []) : [];
          const opIdx = allOps.findIndex(o => o.id === av.opId);
          if (opIdx >= 0) {
            if (!allOps[opIdx].visitas) allOps[opIdx].visitas = [];
            allOps[opIdx].visitas.push(visitaObj);
            // Timeline entry
            if (!allOps[opIdx].timeline) allOps[opIdx].timeline = [];
            allOps[opIdx].timeline.push({ id: visitaObj.id, type: 'visita', label: `Visita agendada — ${visitaObj.fecha} ${visitaObj.hora}`, date: new Date().toLocaleDateString('es-AR', { day:'numeric', month:'short' }), createdAt: Date.now() });
          }
          await userRefAV.set({ operaciones: allOps, updatedAt: Date.now(), lastBotUpdate: Date.now(), botAgendarState: null }, { merge: true });

          let confirm = `✅ *Visita agendada*\n\n📋 ${av.opTitulo}\n`;
          if (av.prop?.direccion) confirm += `🏢 ${av.prop.direccion}\n`;
          confirm += `🗓 ${visitaObj.fecha} ${visitaObj.hora}\n`;
          if (gcalLinkAV) confirm += `📅 [Ver en Google Calendar](${gcalLinkAV})\n`;
          confirm += `\n_Guardado en Transcribeme_`;
          await tgSend(chatId, confirm, 'Markdown');
          return res.status(200).json({ ok: true });
        }
      }
    }

    // ── Flujo guiado /crearop (estado activo) ──
    {
      const userRef3 = getDb().collection('users').doc(FIREBASE_UID);
      const snap3 = await userRef3.get();
      const crearOpState = snap3.exists ? snap3.data().botCrearOpState : null;

      if (crearOpState && crearOpState.step) {
        const step = crearOpState.step;
        const data = crearOpState.data || {};
        const MB_URL3 = 'https://hyxsdeeoyecdslrtqrmo.supabase.co';
        const MB_KEY3 = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh5eHNkZWVveWVjZHNscnRxcm1vIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU0ODczNzYsImV4cCI6MjA5MTA2MzM3Nn0.YT76TJzSbxgjkNAdpIsRd5AGW9bC6PaTkyEFwOK7OTo';
        const mbH3 = { 'apikey': MB_KEY3, 'Authorization': `Bearer ${MB_KEY3}` };

        // Cancelar en cualquier paso
        if (/^\/cancelar|^\/cancel/i.test(textMsg)) {
          await userRef3.set({ botCrearOpState: null }, { merge: true });
          await tgSend(chatId, '❌ Creación de operación cancelada.');
          return res.status(200).json({ ok: true });
        }

        // Paso 1: título
        if (step === 'titulo') {
          data.titulo = textMsg.trim();
          await userRef3.set({ botCrearOpState: { step: 'cliente', data } }, { merge: true });
          await tgSend(chatId,
            `✅ Título: *${data.titulo}*\n\n¿Nombre del cliente?\n\n_Ej: "Sofia Sandstede" — o "saltar" si no tenés todavía_`,
            'Markdown'
          );
          return res.status(200).json({ ok: true });
        }

        // Paso 2: cliente
        if (step === 'cliente') {
          if (!/saltar|skip|no|ninguno/i.test(textMsg)) {
            data.clienteNombre = textMsg.trim();
          }
          await userRef3.set({ botCrearOpState: { step: 'propiedad', data } }, { merge: true });
          await tgSend(chatId,
            (data.clienteNombre ? `✅ Cliente: *${data.clienteNombre}*\n\n` : '⏭ Sin cliente por ahora.\n\n') +
            '¿Dirección o nombre de la propiedad?\n\n_Ej: "Arroyo 1160" o "saltar"_',
            'Markdown'
          );
          return res.status(200).json({ ok: true });
        }

        // Paso 3: propiedad (busca en MB Propy si escribe algo)
        if (step === 'propiedad') {
          if (!/saltar|skip|no|ninguno/i.test(textMsg)) {
            // Buscar en MB Propy por dirección
            const busqProp = encodeURIComponent(textMsg.trim());
            const propUrl3 = `${MB_URL3}/rest/v1/propiedades?select=id,direccion,barrio,tipo,modo,precio,moneda,dormitorios,broker&activa=eq.true&direccion=ilike.*${busqProp}*&limit=4`;
            const propResp3 = await fetch(propUrl3, { headers: mbH3 });
            const propResults = await propResp3.json();

            if (Array.isArray(propResults) && propResults.length > 0) {
              // Guardar resultados en state para que elija
              data.propOptions = propResults;
              await userRef3.set({ botCrearOpState: { step: 'elegir_prop', data } }, { merge: true });
              let txt = `🏢 Encontré ${propResults.length} propiedad/es:\n\n`;
              propResults.forEach((p, i) => {
                const precio = p.precio ? `${p.moneda === 'USD' ? 'USD ' : '$'}${Number(p.precio).toLocaleString('es-AR')}` : '';
                txt += `*${i+1}.* ${p.direccion} (${p.barrio}) | ${p.dormitorios != null ? p.dormitorios+' dorm | ' : ''}${precio}\n`;
              });
              txt += '\n_Respondé con el número (1, 2...) o "saltar"_';
              await tgSend(chatId, txt, 'Markdown');
              return res.status(200).json({ ok: true });
            } else {
              // No encontró, guardar texto libre como nombre de prop
              data.propTexto = textMsg.trim();
            }
          }
          await userRef3.set({ botCrearOpState: { step: 'etapa', data } }, { merge: true });
          await tgSend(chatId,
            (data.prop ? `✅ Propiedad: *${data.prop.direccion}*\n\n` : data.propTexto ? `✅ Propiedad: *${data.propTexto}*\n\n` : '⏭ Sin propiedad por ahora.\n\n') +
            '¿Etapa de la operación?\n\n`contacto` · `visita` · `negociacion` · `reserva`',
            'Markdown'
          );
          return res.status(200).json({ ok: true });
        }

        // Paso 3b: elegir prop de la lista
        if (step === 'elegir_prop') {
          const numEl = parseInt(textMsg.trim());
          if (!isNaN(numEl) && data.propOptions && data.propOptions[numEl-1]) {
            data.prop = data.propOptions[numEl-1];
          } else if (!/saltar|skip/i.test(textMsg)) {
            data.propTexto = textMsg.trim();
          }
          delete data.propOptions;
          await userRef3.set({ botCrearOpState: { step: 'etapa', data } }, { merge: true });
          await tgSend(chatId,
            (data.prop ? `✅ Propiedad: *${data.prop.direccion}*\n\n` : data.propTexto ? `✅ Propiedad: *${data.propTexto}*\n\n` : '⏭ Sin propiedad.\n\n') +
            '¿Etapa de la operación?\n\n`contacto` · `visita` · `negociacion` · `reserva`',
            'Markdown'
          );
          return res.status(200).json({ ok: true });
        }

        // Paso 4: etapa → preguntar visita
        if (step === 'etapa') {
          const etapaMap = { contacto:'contacto', visita:'visita', negoci:'negociacion', reserva:'reserva', escritura:'escritura' };
          let etapa = 'contacto';
          for (const [k, v] of Object.entries(etapaMap)) {
            if (textMsg.toLowerCase().includes(k)) { etapa = v; break; }
          }
          data.etapa = etapa;
          await userRef3.set({ botCrearOpState: { step: 'visita', data } }, { merge: true });
          await tgSend(chatId,
            `✅ Etapa: *${etapa}*\n\n🏠 ¿Agendamos una visita?\n\nEscribí fecha y hora:\n_Ej: "15/06 10:30" o "lunes 15 a las 11" — o "saltar"_`,
            'Markdown'
          );
          return res.status(200).json({ ok: true });
        }

        // Paso 5: visita → guardar operación
        if (step === 'visita') {
          let visitaObj = null;
          if (!/saltar|skip|no|sin visita/i.test(textMsg)) {
            // Parsear fecha/hora con Groq — pedir ISO directo para evitar ambigüedad
            try {
              const ahora = new Date();
              // Fecha actual en Buenos Aires para que Groq resuelva "sábado 30", "mañana", etc.
              const hoyStr = ahora.toLocaleDateString('es-AR', { weekday:'long', day:'numeric', month:'long', year:'numeric', timeZone:'America/Argentina/Buenos_Aires' });
              const parseResp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${GROQ_KEY}` },
                body: JSON.stringify({
                  model: 'llama-3.3-70b-versatile', max_tokens: 100,
                  messages: [{ role: 'user', content:
                    `Hoy es ${hoyStr}. Resolvé la fecha relativa y devolvé SOLO JSON sin texto extra:\n` +
                    `{"iso":"YYYY-MM-DDTHH:MM:00","fecha":"DD/MM/YYYY","hora":"HH:MM"}\n` +
                    `Si no hay hora usá "10:00". Texto: "${textMsg}"`
                  }],
                }),
              });
              const pd = await parseResp.json();
              const raw = pd.choices?.[0]?.message?.content || '';
              console.log('[BOT] Groq fecha raw:', raw);
              const jm = raw.match(/\{[\s\S]*?\}/);
              if (jm) {
                const parsed = JSON.parse(jm[0]);
                console.log('[BOT] Groq fecha parsed:', JSON.stringify(parsed));
                // Validar que el ISO es una fecha real
                const dt = new Date(parsed.iso);
                if (parsed.iso && !isNaN(dt.getTime())) {
                  visitaObj = {
                    id: String(Date.now()),
                    fecha: parsed.fecha || parsed.iso.slice(0,10).split('-').reverse().join('/'),
                    hora: parsed.hora || parsed.iso.slice(11,16),
                    datetime: parsed.iso,
                    propId: data.prop ? String(data.prop.id) : null,
                    broker: data.prop?.broker || '',
                    confirmada: false,
                    createdAt: Date.now(),
                  };
                }
              }
            } catch(e) { console.log('[BOT] Groq fecha error:', e.message); }

            // Fallback: intentar parsear manualmente "30/05", "30 a las 11", etc.
            if (!visitaObj) {
              const ahora = new Date();
              // Intentar extraer día y hora del texto
              const diaMatch = textMsg.match(/\b(\d{1,2})\b/);
              const horaMatch = textMsg.match(/(\d{1,2})(?::(\d{2}))?\s*(?:hs|h|:|am|pm)?$/i) ||
                                textMsg.match(/las?\s+(\d{1,2})(?::(\d{2}))?/i);
              let dt = new Date(ahora);
              if (diaMatch) {
                dt.setDate(parseInt(diaMatch[1]));
                if (dt < ahora) dt.setMonth(dt.getMonth() + 1); // mes siguiente si ya pasó
              }
              if (horaMatch) {
                dt.setHours(parseInt(horaMatch[1]), parseInt(horaMatch[2] || '0'), 0, 0);
              } else {
                dt.setHours(10, 0, 0, 0);
              }
              const isoStr = `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}T${String(dt.getHours()).padStart(2,'0')}:${String(dt.getMinutes()).padStart(2,'0')}:00`;
              visitaObj = {
                id: String(Date.now()),
                fecha: `${String(dt.getDate()).padStart(2,'0')}/${String(dt.getMonth()+1).padStart(2,'0')}/${dt.getFullYear()}`,
                hora: `${String(dt.getHours()).padStart(2,'0')}:${String(dt.getMinutes()).padStart(2,'0')}`,
                datetime: isoStr,
                propId: data.prop ? String(data.prop.id) : null,
                broker: data.prop?.broker || '',
                confirmada: false,
                createdAt: Date.now(),
              };
              console.log('[BOT] Fallback fecha manual:', isoStr);
            }
          }

          // ── Crear evento en Google Calendar si hay visita ──
          let gcalLink = null;
          if (visitaObj) {
            try {
              const gcalBody = {
                title: `Visita: ${data.titulo}${data.clienteNombre ? ' — ' + data.clienteNombre : ''}`,
                date: visitaObj.datetime.slice(0, 10),   // "YYYY-MM-DD"
                time: visitaObj.datetime.slice(11, 16),  // "HH:MM"
                description: [
                  data.clienteNombre ? `Cliente: ${data.clienteNombre}` : '',
                  data.prop ? `Propiedad: ${data.prop.direccion}${data.prop.barrio ? ', ' + data.prop.barrio : ''}` : '',
                  data.prop?.broker ? `Broker: ${data.prop.broker}` : '',
                  `Creado desde Transcribeme bot`,
                ].filter(Boolean).join('\n'),
              };
              const gcalResp = await fetch('https://transcribeme.vercel.app/api/gcal', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(gcalBody),
              });
              const gcalData = await gcalResp.json();
              if (gcalData.ok && gcalData.htmlLink) {
                gcalLink = gcalData.htmlLink;
                visitaObj.gcalLink = gcalLink;
                console.log('[BOT] GCal evento creado:', gcalLink);
              } else {
                console.log('[BOT] GCal error:', JSON.stringify(gcalData));
              }
            } catch(e) {
              console.log('[BOT] GCal excepción:', e.message);
            }
          }

          // Construir operación completa
          const now = Date.now();
          const timelineItems = [{
            id: String(now),
            type: 'stage',
            stage: data.etapa,
            label: 'Operación creada desde bot',
            date: new Date().toLocaleDateString('es-AR', { day:'numeric', month:'short' }),
            createdAt: now,
          }];
          if (visitaObj) {
            timelineItems.push({
              id: visitaObj.id,
              type: 'visita',
              label: `Visita agendada — ${visitaObj.fecha}${visitaObj.hora ? ' ' + visitaObj.hora : ''}`,
              date: new Date().toLocaleDateString('es-AR', { day:'numeric', month:'short' }),
              createdAt: now,
            });
          }

          const nuevaOp = {
            id: 'op_' + now,
            titulo: data.titulo,
            stage: data.etapa,
            createdAt: now,
            updatedAt: now,
            source: 'telegram',
            lead: data.clienteNombre ? { nombre: data.clienteNombre, slug: data.clienteNombre.toLowerCase().replace(/\s+/g,'-') } : null,
            prop: data.prop || (data.propTexto ? { direccion: data.propTexto, id: null } : null),
            props: [],
            visitas: visitaObj ? [visitaObj] : [],
            timeline: timelineItems,
          };

          // Guardar en Firestore — un solo get fresco + un solo write
          const snap4 = await userRef3.get();
          const existingOps = snap4.exists ? (snap4.data().operaciones || []) : [];
          await userRef3.set({
            operaciones: [nuevaOp, ...existingOps],
            updatedAt: now,
            lastBotUpdate: now,
            botCrearOpState: null,
          }, { merge: true });

          let confirm = `✅ *Operación creada*\n\n`;
          confirm += `📋 *${data.titulo}*\n`;
          if (data.clienteNombre) confirm += `👤 ${data.clienteNombre}\n`;
          if (data.prop) confirm += `🏢 ${data.prop.direccion}${data.prop.barrio ? ' (' + data.prop.barrio + ')' : ''}\n`;
          else if (data.propTexto) confirm += `🏢 ${data.propTexto}\n`;
          confirm += `📍 Etapa: ${data.etapa}\n`;
          if (visitaObj) {
            confirm += `🗓 Visita: ${visitaObj.fecha}${visitaObj.hora ? ' ' + visitaObj.hora : ''}\n`;
            if (gcalLink) confirm += `📅 [Ver en Google Calendar](${gcalLink})\n`;
          }
          confirm += `\n_Ya aparece en Transcribeme_`;
          await tgSend(chatId, confirm, 'Markdown');
          return res.status(200).json({ ok: true });
        }
      }
    }

    // ── Flujo guiado /buscar (estado activo) ──
    {
      const db2 = getDb();
      const userRef2 = db2.collection('users').doc(FIREBASE_UID);
      const snap0 = await userRef2.get();
      const buscarState = snap0.exists ? snap0.data().botBuscarState : null;

      if (buscarState && buscarState.step) {
        const step = buscarState.step;
        const params = buscarState.params || {};
        const MB_URL2 = 'https://hyxsdeeoyecdslrtqrmo.supabase.co';
        const MB_KEY2 = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh5eHNkZWVveWVjZHNscnRxcm1vIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU0ODczNzYsImV4cCI6MjA5MTA2MzM3Nn0.YT76TJzSbxgjkNAdpIsRd5AGW9bC6PaTkyEFwOK7OTo';
        const mbH2 = { 'apikey': MB_KEY2, 'Authorization': `Bearer ${MB_KEY2}` };

        if (step === 'barrio') {
          if (!/cualquiera|todos|todo|no importa|skip/i.test(textMsg)) params.barrio = textMsg.trim();
          await userRef2.set({ botBuscarState: { step: 'tipo', params } }, { merge: true });
          await tgSend(chatId,
            '¿Qué tipo de propiedad?\n\n' +
            '`depto` · `PH` · `casa` · `loft` · `duplex` · `oficina`\n\n' +
            '_O "cualquiera"_', 'Markdown');
          return res.status(200).json({ ok: true });
        }

        if (step === 'tipo') {
          const tipoMap2 = { 'depto|departamento|dpto': 'Departamento', 'ph': 'PH', 'casa': 'Casa', 'loft': 'Loft', 'duplex|dúplex': 'Dúplex', 'oficina': 'Oficinas' };
          for (const [pat, val] of Object.entries(tipoMap2)) {
            if (new RegExp(`\\b(${pat})\\b`, 'i').test(textMsg)) { params.tipo = val; break; }
          }
          await userRef2.set({ botBuscarState: { step: 'modo', params } }, { merge: true });
          await tgSend(chatId, '¿Venta o alquiler?\n\n`venta` · `alquiler` · `cualquiera`', 'Markdown');
          return res.status(200).json({ ok: true });
        }

        if (step === 'modo') {
          if (/venta|vender|compra/i.test(textMsg)) params.modo = 'venta';
          else if (/alquiler|alquilar/i.test(textMsg)) params.modo = 'alquiler';
          await userRef2.set({ botBuscarState: { step: 'dorm', params } }, { merge: true });
          await tgSend(chatId, '¿Cuántos dormitorios?\n\n`1` · `2` · `3` · `4` · `cualquiera`', 'Markdown');
          return res.status(200).json({ ok: true });
        }

        if (step === 'dorm') {
          const ambM = textMsg.match(/(\d)\s*amb/i);
          const dormM = textMsg.match(/\b(\d)\b/);
          if (ambM) params.dormitorios = parseInt(ambM[1]) - 1;
          else if (dormM && !/cualquiera|todos/i.test(textMsg)) params.dormitorios = parseInt(dormM[1]);
          await userRef2.set({ botBuscarState: { step: 'precio', params } }, { merge: true });
          await tgSend(chatId, '¿Precio máximo en USD?\n\n_Ej: `300000` o `300k` — o "sin límite"_', 'Markdown');
          return res.status(200).json({ ok: true });
        }

        if (step === 'precio') {
          const pm = textMsg.match(/(\d[\d.,]*)\s*(k)?/i);
          if (pm && !/sin|no|cualquiera|skip/i.test(textMsg)) {
            params.precio_max = parseFloat(pm[1].replace(/\./g,'').replace(',','.')) * (/k/i.test(pm[2]||'') ? 1000 : 1);
            params.moneda = 'USD';
          }
          // Limpiar estado y ejecutar búsqueda
          await userRef2.set({ botBuscarState: null }, { merge: true });

          let url = `${MB_URL2}/rest/v1/propiedades?select=id,direccion,barrio,tipo,modo,precio,moneda,dormitorios,sup_cub,broker&activa=eq.true&limit=8&order=precio.asc`;
          if (params.modo) url += `&modo=eq.${params.modo}`; else url += `&modo=neq.ghost`;
          if (params.barrio) url += `&barrio=ilike.*${encodeURIComponent(params.barrio)}*`;
          if (params.tipo) url += `&tipo=eq.${encodeURIComponent(params.tipo)}`;
          if (params.dormitorios != null) url += `&dormitorios=eq.${params.dormitorios}`;
          if (params.precio_max) url += `&precio=lte.${params.precio_max}&moneda=eq.USD`;

          const resp2 = await fetch(url, { headers: mbH2 });
          const props2 = await resp2.json();

          if (!Array.isArray(props2) || !props2.length) {
            await tgSend(chatId, '😕 No encontré propiedades con esos filtros. Intentá ampliar la búsqueda.');
            return res.status(200).json({ ok: true });
          }
          let txt = `🔍 *${props2.length} propiedades encontradas*\n\n`;
          props2.forEach(p => {
            const precio = p.precio ? `${p.moneda === 'USD' ? 'USD ' : '$'}${Number(p.precio).toLocaleString('es-AR')}` : '';
            const ficha = `https://www.mirandabosch.com/ficha/${Buffer.from(JSON.stringify({p:String(p.id),b:'33504'})).toString('base64')}`;
            txt += `• *${p.tipo || ''}* ${p.direccion} (${p.barrio})\n  ${p.dormitorios != null ? p.dormitorios+' dorm | ' : ''}${p.sup_cub||'?'}m² | ${precio} | 🔑 ${p.broker||'?'}\n  🔗 ${ficha}\n\n`;
          });
          await tgSend(chatId, txt.trim(), 'Markdown');
          return res.status(200).json({ ok: true });
        }
      }
    }

    // ── Detectar si es consulta o nota ──
    // Sin tildes para tolerar cualquier input, más amplio
    const consultaPatterns = [
      /^\?/,
      /^(que|como|cuando|cuanto|quien|cual|quiero)\b/i,
      /\b(que paso|que hay|dame|contame|mostrame|busca|buscar|encontra|encontrar|recomienda|recomenda|recomendame|resumi|estado de|como va|que tengo|operaciones?|cliente|propiedad|props?|depto|departamentos?|ambientes?)\b/i,
    ];
    const esConsulta = consultaPatterns.some(p => p.test(textMsg.trim()));

    if (esConsulta) {
      console.log('[BOT] Consulta detectada:', textMsg);
      try {
        // ── 1. Leer Firebase ──
        const db = getDb();
        const userRef = db.collection('users').doc(FIREBASE_UID);
        const snap = await userRef.get();
        const userData = snap.exists ? snap.data() : {};
        const notes = userData.notes || [];
        const operaciones = userData.operaciones || [];

        // ── 2. Contexto Firebase ──
        const ctxOps = operaciones.slice(0, 20).map(op => {
          const opNotes = notes.filter(n => n.opId === op.id);
          const ultimaNota = opNotes[0];
          const diasSinActividad = ultimaNota
            ? Math.floor((Date.now() - ultimaNota.createdAt) / 86400000)
            : null;
          return [
            `OP: "${op.titulo}" | Etapa: ${op.stage}`,
            op.lead ? `  Cliente: ${op.lead.nombre || op.lead.slug}` : '',
            op.prop ? `  Propiedad: ${op.prop.direccion}${op.prop.broker ? ' (broker: ' + op.prop.broker + ')' : ''}` : '',
            op.visitas && op.visitas.length ? `  Visitas: ${op.visitas.length} programada/s` : '',
            ultimaNota ? `  Última nota (hace ${diasSinActividad}d): "${ultimaNota.title}"` : '  Sin notas',
          ].filter(Boolean).join('\n');
        }).join('\n\n');

        const ctxNotas = notes.slice(0, 8).map(n =>
          `NOTA: "${n.title}" | ${n.date}${n.opId ? ' | Op: ' + (operaciones.find(o => o.id === n.opId) || {}).titulo : ''}`
        ).join('\n');

        // ── 3. MB Propy: búsqueda de propiedades + favoritos de clientes ──
        const MB_URL = 'https://hyxsdeeoyecdslrtqrmo.supabase.co';
        const MB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh5eHNkZWVveWVjZHNscnRxcm1vIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU0ODczNzYsImV4cCI6MjA5MTA2MzM3Nn0.YT76TJzSbxgjkNAdpIsRd5AGW9bC6PaTkyEFwOK7OTo';
        const mbHeaders = { 'apikey': MB_KEY, 'Authorization': `Bearer ${MB_KEY}` };

        let ctxMB = '';

        // Detectar si pide búsqueda de propiedades
        const esBusqueda = /\b(busca|buscar|encontra|encontrar|mostrame|mostrar|recomend\w*|quiero ver|props?|propiedades?|depto|departamentos?|ambientes?|broker|bajaron|precio|modificadas?|nuevas?)\b/i.test(textMsg);
        console.log('[BOT] esBusqueda:', esBusqueda, '| msg:', textMsg);

        // Detectar si menciona un cliente de sus operaciones
        // Normaliza texto quitando tildes para comparar
        const normalize = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
        const msgNorm = normalize(textMsg);
        const clienteMencionado = operaciones
          .filter(op => op.lead)
          .map(op => op.lead)
          .find(lead => {
            const nombre = normalize(lead.nombre || lead.slug || '');
            // Match si cualquier parte del nombre (>3 chars) aparece en el mensaje
            return nombre.split(' ').some(part => part.length > 3 && msgNorm.includes(part));
          });

        // ── Extracción de parámetros de búsqueda ──
        let searchParams = null;
        if (esBusqueda) {
          const barrios = ['Recoleta','Palermo Chico','Palermo Soho','Palermo Hollywood','Palermo','Retiro','Belgrano','Barrio Norte','Puerto Madero','Las Cañitas','Núñez','Nunez','Colegiales','Coghlan','Villa Crespo','San Telmo','Almagro','Caballito','Flores','Villa Urquiza'];
          const msgLow = normalize(textMsg);

          // Barrio
          const barrioMatch = barrios.find(b => msgLow.includes(normalize(b)));

          // Dormitorios: "3 ambientes" = 2 dorm, "2 dorm/dormitorios" = 2 dorm directo
          const ambMatch = textMsg.match(/(\d)\s*ambientes?/i);
          const dormMatch = textMsg.match(/(\d)\s*(dormitorios?|dorms?|cuartos?|habitaciones?)/i);
          const dormNum = dormMatch ? parseInt(dormMatch[1])
                        : ambMatch  ? parseInt(ambMatch[1]) - 1
                        : null;

          // Modo
          const modoMatch = /\b(alquiler|alquilar|rent|alquila)\b/i.test(textMsg) ? 'alquiler'
                          : /\b(venta|vender|compra|comprar)\b/i.test(textMsg) ? 'venta' : null;

          // Precio (USD o ARS)
          const precioMaxMatch = textMsg.match(/(?:hasta|max|maximo|menos de)\s*(\d[\d.,]*)\s*(k|mil)?\s*(usd|dolar|dolares|dólar|u\$s|\$u)?/i);
          const precioMinMatch = textMsg.match(/(?:desde|mas de|más de|minimo|mínimo)\s*(\d[\d.,]*)\s*(k|mil)?\s*(usd|dolar|dolares|dólar|u\$s|\$u)?/i);
          const parsePrecio = (m) => {
            if (!m) return null;
            const n = parseFloat(m[1].replace(/\./g,'').replace(',','.'));
            const mult = /k|mil/i.test(m[2] || '') ? 1000 : 1;
            return n * mult;
          };
          const precioMax = parsePrecio(precioMaxMatch);
          const precioMin = parsePrecio(precioMinMatch);
          const esUSD = /usd|dolar|dólar|u\$s|\$u/i.test(textMsg);
          const esARS = /\bpesos?\b|\bars\b/i.test(textMsg);
          const moneda = esUSD ? 'USD' : esARS ? 'ARS' : (precioMax || precioMin) ? 'USD' : null;

          // Superficie
          const supMinMatch = textMsg.match(/(?:mas de|más de|desde|minimo|mínimo|al menos)\s*(\d+)\s*m/i);
          const supMin = supMinMatch ? parseInt(supMinMatch[1]) : null;

          // Tipo de propiedad
          const tipoMap = {
            'departamento|depto|dpto': 'Departamento',
            'ph|planta baja': 'PH',
            'casa': 'Casa',
            'loft': 'Loft',
            'duplex|dúplex': 'Dúplex',
            'triplex|tríplex': 'Triplex',
            'oficina|oficinas': 'Oficinas',
            'local|locales': 'Locales Comerciales',
            'cochera|cocheras': 'Cocheras',
            'semipiso': 'Semipiso',
            'piso': 'Piso',
          };
          let tipoMatch = null;
          for (const [pat, val] of Object.entries(tipoMap)) {
            if (new RegExp(`\\b(${pat})\\b`, 'i').test(textMsg)) { tipoMatch = val; break; }
          }

          // Broker mencionado (busca nombre parcial en lista de brokers MB)
          const brokersMB = ['Gloria Ayerza','Mario Muñoz','Agustín Diez','Agustina Flaks','Ana Garay','Federico Arias','Juan David La Torre','Luciana Iglesias','Marina Padilla','Sofia Lalanne','Tini Solanet','Victoria Kelsey','Malala Bullrich','Fernanda Patrón','Carolina Miranda','Sebastián Miranda'];
          const brokerMatch = brokersMB.find(b => msgLow.includes(normalize(b.split(' ')[0])) || msgLow.includes(normalize(b.split(' ').slice(-1)[0])));

          // Propiedades con precio reducido recientemente (updated_at últimos 30 días)
          const esBajaPrecio = /\b(bajo|bajaron|bajó|reduc|rebaj|modificad|actualiz|nuevo precio|precio nuevo|precio bajo)\b/i.test(textMsg);

          searchParams = { barrio: barrioMatch || null, dormitorios: dormNum, modo: modoMatch, precio_max: precioMax, precio_min: precioMin, moneda, sup_min: supMin, tipo: tipoMatch, broker: brokerMatch || null, baja_precio: esBajaPrecio };
          console.log('[BOT] searchParams:', JSON.stringify(searchParams));
        }

        // ── Buscar propiedades en MB Propy ──
        if (esBusqueda) {
          let propUrl = `${MB_URL}/rest/v1/propiedades?select=id,direccion,barrio,tipo,modo,precio,moneda,dormitorios,sup_cub,broker,telefono,updated_at&activa=eq.true&limit=8`;

          // Modo / ghost
          if (searchParams?.modo) propUrl += `&modo=eq.${searchParams.modo}`;
          else propUrl += `&modo=neq.ghost`;

          // Filtros
          if (searchParams?.barrio) propUrl += `&barrio=ilike.*${encodeURIComponent(searchParams.barrio)}*`;
          if (searchParams?.dormitorios != null) propUrl += `&dormitorios=eq.${searchParams.dormitorios}`;
          if (searchParams?.tipo) propUrl += `&tipo=eq.${encodeURIComponent(searchParams.tipo)}`;
          if (searchParams?.broker) propUrl += `&broker=ilike.*${encodeURIComponent(searchParams.broker.split(' ')[0])}*`;
          if (searchParams?.precio_max && searchParams?.moneda) propUrl += `&precio=lte.${searchParams.precio_max}&moneda=eq.${searchParams.moneda}`;
          if (searchParams?.precio_min && searchParams?.moneda) propUrl += `&precio=gte.${searchParams.precio_min}`;
          if (searchParams?.sup_min) propUrl += `&sup_cub=gte.${searchParams.sup_min}`;

          // Baja de precio: ordenar por updated_at desc para ver las más recientes modificadas
          if (searchParams?.baja_precio) propUrl += `&order=updated_at.desc`;
          else propUrl += `&order=precio.asc`;

          console.log('[BOT] propUrl:', propUrl);
          const propResp = await fetch(propUrl, { headers: mbHeaders });
          const props = await propResp.json();
          console.log('[BOT] props result:', Array.isArray(props) ? props.length + ' props' : JSON.stringify(props).slice(0,200));

          if (Array.isArray(props) && props.length > 0) {
            const label = searchParams?.baja_precio
              ? '\nPROPIEDADES ACTUALIZADAS RECIENTEMENTE (posible baja de precio):\n'
              : searchParams?.broker
              ? `\nPROPIEDADES DE ${searchParams.broker.toUpperCase()}:\n`
              : '\nPROPIEDADES MB PROPY ENCONTRADAS:\n';
            ctxMB += label;
            props.forEach(p => {
              const precio = p.precio ? `${p.moneda === 'USD' ? 'USD ' : '$'}${Number(p.precio).toLocaleString('es-AR')}` : '';
              const fichaUrl = `https://www.mirandabosch.com/ficha/${Buffer.from(JSON.stringify({ p: String(p.id), b: '33504' })).toString('base64')}`;
              const updStr = searchParams?.baja_precio && p.updated_at ? ` | mod: ${p.updated_at.slice(0,10)}` : '';
              ctxMB += `• ${p.tipo || ''} ${p.direccion} (${p.barrio}) | ${p.dormitorios != null ? p.dormitorios + ' dorm' : '?'} | ${p.sup_cub || '?'}m² | ${precio}${updStr} | 🔑 ${p.broker || '?'}\n  🔗 ${fichaUrl}\n`;
            });
          } else {
            ctxMB += '\nBúsqueda en MB Propy: no se encontraron propiedades con esos filtros.\n';
          }
        }

        // Si hay cliente mencionado, traer sus favoritos de MB Propy
        if (clienteMencionado) {
          const clienteNombre = clienteMencionado.nombre || clienteMencionado.slug;
          const favResp = await fetch(
            `${MB_URL}/rest/v1/favoritos?select=propiedad_id,origen&cliente=eq.${encodeURIComponent(clienteNombre)}&limit=20`,
            { headers: mbHeaders }
          );
          const favs = await favResp.json();

          if (Array.isArray(favs) && favs.length > 0) {
            const favBroker = favs.filter(f => f.origen === 'broker').map(f => f.propiedad_id);
            const favCliente = favs.filter(f => f.origen === 'cliente').map(f => f.propiedad_id);
            const todosIds = [...new Set([...favBroker, ...favCliente])];

            const propsResp = await fetch(
              `${MB_URL}/rest/v1/propiedades?select=id,direccion,barrio,dormitorios,precio,moneda,sup_cub,broker&id=in.(${todosIds.join(',')})`,
              { headers: mbHeaders }
            );
            const propsCliente = await propsResp.json();

            if (Array.isArray(propsCliente) && propsCliente.length > 0) {
              ctxMB += `\nPROPIEDADES DE ${clienteNombre.toUpperCase()} EN MB PROPY:\n`;
              propsCliente.forEach(p => {
                const precio = p.precio ? `${p.moneda === 'USD' ? 'USD ' : '$'}${Number(p.precio).toLocaleString('es-AR')}` : '';
                const tag = favBroker.includes(p.id) && favCliente.includes(p.id)
                  ? '⭐ broker+cliente'
                  : favCliente.includes(p.id) ? '❤️ le gustó' : '📋 selección broker';
                const fichaUrl = `https://www.mirandabosch.com/ficha/${Buffer.from(JSON.stringify({ p: String(p.id), b: '33504' })).toString('base64')}`;
                ctxMB += `• ${tag} ${p.direccion} (${p.barrio}) | ${p.dormitorios || '?'} dorm | ${precio}\n  🔗 ${fichaUrl}\n`;
              });
            }
          } else {
            ctxMB += `\n${clienteMencionado.nombre || clienteMencionado.slug} no tiene propiedades guardadas en MB Propy todavía.\n`;
          }
        }

        // ── 4. Llamar a Groq con todo el contexto ──
        const systemPrompt =
          'Sos el asistente broker de Juan David La Torre, broker inmobiliario de Miranda Bosch en Buenos Aires. ' +
          'Tenés acceso a sus operaciones, notas y a la base de datos de MB Propy con propiedades reales. ' +
          'Cuando respondés búsquedas o recomendaciones, siempre incluí los links de ficha. ' +
          'Respondés de forma concisa, en español rioplatense, con emojis moderados. ' +
          'Nunca inventés datos. Si hay links, ponelos en línea separada para que Telegram los muestre bien.';

        const userPrompt = [
          'OPERACIONES ACTIVAS:\n' + (ctxOps || 'Sin operaciones.'),
          'ÚLTIMAS NOTAS:\n' + (ctxNotas || 'Sin notas.'),
          ctxMB ? 'DATOS MB PROPY:\n' + ctxMB : '',
          'PREGUNTA DE JUAN DAVID:\n' + textMsg,
        ].filter(Boolean).join('\n\n');

        const groqResp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${GROQ_KEY}` },
          body: JSON.stringify({
            model: 'llama-3.3-70b-versatile',
            max_tokens: 800,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user',   content: userPrompt },
            ],
          }),
        });
        const groqData = await groqResp.json();
        const respuesta = groqData.choices?.[0]?.message?.content || 'No pude generar una respuesta.';
        await tgSend(chatId, respuesta, 'Markdown');
      } catch (err) {
        console.error('[BOT] Error en consulta:', err.message);
        await tgSend(chatId, '❌ Error procesando la consulta: ' + err.message);
      }
      return res.status(200).json({ ok: true });
    }

    // Guardar texto como nota
    console.log('[BOT] Texto recibido, guardando como nota. chars:', textMsg.length);
    try {
      const llamaResp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${GROQ_KEY}` },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          max_tokens: 512,
          messages: [{
            role: 'user',
            content:
              'Analizá este texto y generá un resumen estructurado en JSON.\n\n' +
              'Texto:\n' + textMsg + '\n\n' +
              'Devolvé SOLO un JSON válido con este formato exacto:\n' +
              '{\n  "titulo": "título descriptivo corto (máx 5 palabras)",\n' +
              '  "secciones": [\n    { "titulo": "Nombre de sección", "puntos": ["punto 1", "punto 2"] }\n  ]\n}',
          }],
        }),
      });
      const llamaData = await llamaResp.json();
      const rawText = llamaData.choices[0].message.content;
      let resumenObj;
      try {
        const jm = rawText.match(/\{[\s\S]*\}/);
        resumenObj = JSON.parse(jm ? jm[0] : rawText);
      } catch {
        resumenObj = { titulo: 'Nota de texto', secciones: [{ titulo: 'Contenido', puntos: [textMsg] }] };
      }

      const db = getDb();
      const now = Date.now();
      const nota = {
        id: String(now),
        title: resumenObj.titulo || 'Nota de texto',
        date: new Date().toLocaleDateString('es-AR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }),
        createdAt: now,
        duration: null,
        durationSecs: null,
        resumen: resumenObj,
        transcripcion: textMsg,
        source: 'telegram',
      };

      const userRef = db.collection('users').doc(FIREBASE_UID);
      const snap2 = await userRef.get();
      const existing = snap2.exists ? (snap2.data().notes || []) : [];
      const newNotes = [nota, ...existing.filter(n => n.id !== nota.id)];
      await userRef.set({ notes: newNotes, updatedAt: now, lastBotUpdate: now }, { merge: true });

      await tgSend(chatId, `✅ *${resumenObj.titulo}*\n\n_Guardado en Transcribeme_`, 'Markdown');
    } catch (err) {
      console.error('[BOT] Error guardando texto:', err.message);
      await tgSend(chatId, '❌ Error guardando el texto: ' + err.message);
    }
    return res.status(200).json({ ok: true });
  }

  if (!audio) {
    await tgSend(chatId, '🎙️ Mandame un audio de voz o un mensaje de texto y lo guardo como nota.');
    return res.status(200).json({ ok: true });
  }

  console.log('[BOT] Audio recibido. chatId:', chatId, 'FIREBASE_UID:', FIREBASE_UID, 'GROQ_KEY:', GROQ_KEY ? 'OK' : 'MISSING', 'TG_TOKEN:', TG_TOKEN ? 'OK' : 'MISSING');

  try {
    console.log('[BOT] Iniciando procesamiento...');

    // 1. Obtener URL del archivo en Telegram
    const fileRes = await fetch(
      `https://api.telegram.org/bot${TG_TOKEN}/getFile?file_id=${audio.file_id}`
    );
    const fileData = await fileRes.json();
    const filePath = fileData.result.file_path;
    const audioUrl = `https://api.telegram.org/file/bot${TG_TOKEN}/${filePath}`;

    // 2. Descargar el audio
    const audioResp = await fetch(audioUrl);
    const audioBuffer = await audioResp.arrayBuffer();
    // Telegram voice notes come as .oga — map to ogg which Groq accepts
    const rawExt = filePath.split('.').pop()?.toLowerCase() || 'ogg';
    const ext = rawExt === 'oga' ? 'ogg' : rawExt;
    const mimeMap = { ogg: 'audio/ogg', mp3: 'audio/mpeg', mp4: 'video/mp4',
                      m4a: 'audio/mp4', wav: 'audio/wav', webm: 'video/webm',
                      mov: 'video/quicktime', opus: 'audio/ogg', flac: 'audio/flac' };
    const isVideo = msg.video || msg.video_note;
    const mime = mimeMap[ext] || 'audio/ogg';

    // 3. Transcribir con Groq Whisper
    const formData = new FormData();
    formData.append('file', new Blob([audioBuffer], { type: mime }), `audio.${ext}`);
    formData.append('model', 'whisper-large-v3-turbo');
    formData.append('language', 'es');
    formData.append('response_format', 'verbose_json');
    formData.append('temperature', '0');

    console.log('[BOT] Descargando audio, ext:', ext, 'mime:', mime, 'size:', audioBuffer.byteLength);
    const whisperResp = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${GROQ_KEY}` },
      body: formData,
    });
    console.log('[BOT] Whisper status:', whisperResp.status);
    if (!whisperResp.ok) throw new Error('Whisper error: ' + await whisperResp.text());
    const whisperData = await whisperResp.json();
    const transcripcion = whisperData.text || '';
    console.log('[BOT] Transcripcion OK, chars:', transcripcion.length);
    const durationSecs  = whisperData.duration || null;

    // 4. Resumir con LLaMA
    const llamaResp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${GROQ_KEY}` },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        max_tokens: 1024,
        messages: [{
          role: 'user',
          content:
            'Analizá esta transcripción de audio y generá un resumen ejecutivo estructurado en JSON.\n\n' +
            'Transcripción:\n' + transcripcion + '\n\n' +
            'Devolvé SOLO un JSON válido con este formato exacto:\n' +
            '{\n  "titulo": "título descriptivo corto (máx 5 palabras)",\n' +
            '  "secciones": [\n    { "titulo": "Nombre de sección", "puntos": ["punto 1", "punto 2"] }\n  ]\n}',
        }],
      }),
    });
    console.log('[BOT] LLaMA status:', llamaResp.status);
    if (!llamaResp.ok) throw new Error('LLaMA error: ' + await llamaResp.text());
    const llamaData = await llamaResp.json();
    const rawText   = llamaData.choices[0].message.content;
    const llamaTokens = llamaData.usage?.total_tokens || 0;

    let resumenObj;
    try {
      const jm = rawText.match(/\{[\s\S]*\}/);
      resumenObj = JSON.parse(jm ? jm[0] : rawText);
    } catch {
      resumenObj = { titulo: 'Audio Telegram', secciones: [{ titulo: 'Transcripción', puntos: [transcripcion] }] };
    }

    // 5. Guardar nota en Firestore (mismo formato que la app)
    const db = getDb();
    const now = Date.now();

    function formatDuration(s) {
      if (!s || !isFinite(s)) return null;
      const m = Math.floor(s / 60), sec = Math.floor(s % 60);
      return m > 0 ? m + 'min' + (sec > 0 ? ' ' + sec + 's' : '') : sec + 's';
    }

    const nota = {
      id:            String(now),
      title:         resumenObj.titulo || 'Audio Telegram',
      date:          new Date().toLocaleDateString('es-AR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }),
      createdAt:     now,
      duration:      formatDuration(durationSecs),
      durationSecs:  durationSecs,
      resumen:       resumenObj,
      transcripcion: transcripcion,
      source:        isVideo ? 'telegram-video' : 'telegram',
    };

    // Guardar nota: read-modify-write para garantizar que onSnapshot detecte el cambio
    console.log('[BOT] Guardando nota:', nota.id, nota.title, 'uid:', FIREBASE_UID);
    const userRef = db.collection('users').doc(FIREBASE_UID);
    const snap2 = await userRef.get();
    const existing = snap2.exists ? (snap2.data().notes || []) : [];
    // Insertar al inicio, sin duplicados
    const alreadyExists = existing.some(n => n.id === nota.id);
    const newNotes = alreadyExists ? existing : [nota, ...existing];
    await userRef.set({
      notes:     newNotes,
      updatedAt: now,
      lastBotUpdate: now,
    }, { merge: true });
    console.log('[BOT] Nota guardada OK en Firestore, total notas:', newNotes.length);

    // 6. Actualizar usage
    await db.collection('users').doc(FIREBASE_UID)
      .collection('meta').doc('usage')
      .set({
        whisperMins:  FieldValue.increment(durationSecs ? durationSecs / 60 : 0),
        llamaTokens:  FieldValue.increment(llamaTokens),
        calls:        FieldValue.increment(1),
        lastUpdated:  now,
      }, { merge: true });

    // 7. Responder en Telegram con resumen
    const resumenTexto = resumenObj.secciones
      .map(s => `*${s.titulo}*\n` + (s.puntos || []).map(p => `• ${p}`).join('\n'))
      .join('\n\n');

    await tgSend(chatId,
      `✅ *${resumenObj.titulo}*\n\n${resumenTexto}\n\n_Guardado en Transcribeme_`,
      'Markdown'
    );

  } catch (err) {
    console.error('[BOT] ERROR:', err.message, err.stack);
    await tgSend(chatId, '❌ Error procesando el audio: ' + err.message);
  }

  return res.status(200).json({ ok: true });
}

async function tgSend(chatId, text, parseMode) {
  const body = { chat_id: chatId, text };
  if (parseMode) body.parse_mode = parseMode;
  await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}
