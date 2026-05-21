// api/telegram-webhook.js
// Vercel serverless function — recibe updates del bot de Telegram,
// descarga el audio, lo transcribe con Groq Whisper,
// resume con LLaMA 3.3-70b y guarda la nota en Firestore.

import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

// ── Firebase Admin init (usa variables de entorno de Vercel) ──
function getDb() {
  if (!getApps().length) {
    initializeApp({
      credential: cert({
        projectId:   process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey:  process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      }),
    });
  }
  return getFirestore();
}

const GROQ_KEY       = process.env.GROQ_API_KEY;
const TG_TOKEN       = process.env.TELEGRAM_BOT_TOKEN;
const ALLOWED_CHAT   = process.env.TELEGRAM_ALLOWED_CHAT_ID; // tu chat_id personal
const FIREBASE_UID   = process.env.FIREBASE_USER_UID;        // tu uid de Firebase Auth

export const config = { api: { bodyParser: true } };

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

  // Solo procesar mensajes de voz o audio
  const audio = msg.voice || msg.audio || msg.document;
  if (!audio) {
    await tgSend(chatId, '🎙️ Mandame un audio de voz y lo transcribo.');
    return res.status(200).json({ ok: true });
  }

  try {
    await tgSend(chatId, '⏳ Procesando audio...');

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
    const ext = filePath.split('.').pop() || 'ogg';

    // 3. Transcribir con Groq Whisper
    const formData = new FormData();
    formData.append('file', new Blob([audioBuffer], { type: `audio/${ext}` }), `audio.${ext}`);
    formData.append('model', 'whisper-large-v3-turbo');
    formData.append('language', 'es');
    formData.append('response_format', 'verbose_json');
    formData.append('temperature', '0');

    const whisperResp = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${GROQ_KEY}` },
      body: formData,
    });
    if (!whisperResp.ok) throw new Error('Whisper error: ' + await whisperResp.text());
    const whisperData = await whisperResp.json();
    const transcripcion = whisperData.text || '';
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

    // 5. Guardar nota en Firestore
    const db = getDb();
    const now = Date.now();

    function formatDuration(s) {
      if (!s || !isFinite(s)) return null;
      const m = Math.floor(s / 60), sec = Math.floor(s % 60);
      return m > 0 ? m + 'min' + (sec > 0 ? ' ' + sec + 's' : '') : sec + 's';
    }

    const nota = {
      id:           String(now),
      title:        resumenObj.titulo || 'Audio Telegram',
      date:         new Date().toLocaleDateString('es-AR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }),
      createdAt:    now,
      duration:     formatDuration(durationSecs),
      durationSecs: durationSecs,
      resumen:      resumenObj,
      transcripcion: transcripcion,
      source:       'telegram',
    };

    const userDocRef = db.collection('users').doc(FIREBASE_UID);
    const snap = await userDocRef.get();
    const existing = snap.exists ? (snap.data().notes || []) : [];
    existing.unshift(nota);
    await userDocRef.set({ notes: existing }, { merge: true });

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
    console.error(err);
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
