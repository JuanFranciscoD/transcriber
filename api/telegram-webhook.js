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
    // Comandos
    if (textMsg.startsWith('/')) {
      await tgSend(chatId,
        '🤖 *Tu asistente broker*\n\n' +
        '*Guardar info:*\n' +
        '• 🎤 Audio de voz → transcribo y resumo\n' +
        '• 🎥 Video → extraigo audio y resumo\n' +
        '• 📝 Texto → lo guardo como nota\n\n' +
        '*Consultar:*\n' +
        '• "qué pasó con Laura Rolandi"\n' +
        '• "cuántas operaciones tengo activas"\n' +
        '• "dame el estado de [operación]"\n' +
        '• "busca 3 ambientes en Palermo hasta 200k"\n\n' +
        '_Todo se sincroniza con Transcribeme._',
        'Markdown'
      );
      return res.status(200).json({ ok: true });
    }

    // ── Detectar si es consulta o nota ──
    // Es consulta si empieza con '?' o contiene palabras clave de pregunta
    const consultaPatterns = [
      /^\?/,
      /^(qué|que|como|cómo|cuándo|cuando|cuánto|cuanto|quién|quien|cuál|cual)\b/i,
      /\b(qué pasó|que paso|qué hay|que hay|dame|contame|mostrame|buscá|busca|resumí|resumi|estado de|cómo va|como va|qué tengo|que tengo|operacion(es)?|cliente|propiedad)\b/i,
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
        const esBusqueda = /\b(busca|buscá|encontrá|encontra|mostrá|mostra|recomend|quiero ver|prop(iedades)?)\b/i.test(textMsg);

        // Detectar si menciona un cliente de sus operaciones
        const clienteMencionado = operaciones
          .filter(op => op.lead)
          .map(op => op.lead)
          .find(lead => {
            const nombre = (lead.nombre || lead.slug || '').toLowerCase();
            return nombre.split(' ').some(part => part.length > 3 && textMsg.toLowerCase().includes(part));
          });

        // Extraer parámetros de búsqueda con Groq (rápido, solo si es búsqueda)
        let searchParams = null;
        if (esBusqueda) {
          const parseResp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${GROQ_KEY}` },
            body: JSON.stringify({
              model: 'llama-3.3-70b-versatile',
              max_tokens: 150,
              messages: [{
                role: 'user',
                content: `Extraé los parámetros de búsqueda inmobiliaria de este texto. Devolvé SOLO JSON válido:
{"barrio":"nombre o null","dormitorios":numero_o_null,"modo":"venta o alquiler o null","precio_max":numero_o_null,"moneda":"USD o ARS o null","cliente":"nombre o null"}

Texto: "${textMsg}"

Barrios disponibles: Recoleta, Palermo, Palermo Chico, Retiro, Belgrano, Barrio Norte, Puerto Madero, Palermo Hollywood, Las Cañitas, Palermo Soho, Núñez.`
              }],
            }),
          });
          const parseData = await parseResp.json();
          try {
            const raw = parseData.choices[0].message.content;
            const jm = raw.match(/\{[\s\S]*\}/);
            searchParams = JSON.parse(jm ? jm[0] : raw);
          } catch { searchParams = null; }
        }

        // Buscar propiedades en MB Propy
        if (searchParams || esBusqueda) {
          let propUrl = `${MB_URL}/rest/v1/propiedades?select=id,direccion,barrio,tipo,modo,precio,moneda,dormitorios,sup_cub,broker,telefono&activa=eq.true&limit=6&order=precio.asc`;
          if (searchParams?.barrio) propUrl += `&barrio=ilike.*${encodeURIComponent(searchParams.barrio)}*`;
          if (searchParams?.dormitorios) propUrl += `&dormitorios=eq.${searchParams.dormitorios}`;
          if (searchParams?.modo && searchParams.modo !== 'null') propUrl += `&modo=eq.${searchParams.modo}`;
          if (searchParams?.precio_max) propUrl += `&precio=lte.${searchParams.precio_max}`;
          if (searchParams?.moneda && searchParams.moneda !== 'null') propUrl += `&moneda=eq.${searchParams.moneda}`;

          const propResp = await fetch(propUrl, { headers: mbHeaders });
          const props = await propResp.json();

          if (Array.isArray(props) && props.length > 0) {
            ctxMB += '\nPROPIEDADES MB PROPY ENCONTRADAS:\n';
            props.forEach(p => {
              const precio = p.precio ? `${p.moneda === 'USD' ? 'USD ' : '$'}${Number(p.precio).toLocaleString('es-AR')}` : '';
              const fichaUrl = `https://www.mirandabosch.com/ficha/${Buffer.from(JSON.stringify({ p: String(p.id), b: '33504' })).toString('base64')}`;
              ctxMB += `• ${p.direccion} (${p.barrio}) | ${p.dormitorios || '?'} dorm | ${p.sup_cub || '?'}m² | ${precio} | Broker: ${p.broker || '?'}\n  🔗 ${fichaUrl}\n`;
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
