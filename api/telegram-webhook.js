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

  console.log('[BOT] Audio recibido. chatId:', chatId, 'FIREBASE_UID:', FIREBASE_UID);
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
    // Telegram voice notes come as .oga — map to ogg which Groq accepts
    const rawExt = filePath.split('.').pop()?.toLowerCase() || 'ogg';
    const ext = rawExt === 'oga' ? 'ogg' : rawExt;
    const mimeMap = { ogg: 'audio/ogg', mp3: 'audio/mpeg', mp4: 'audio/mp4',
                      m4a: 'audio/mp4', wav: 'audio/wav', webm: 'audio/webm',
                      opus: 'audio/ogg', flac: 'audio/flac' };
    const mime = mimeMap[ext] || 'audio/ogg';

    // 3. Transcribir con Groq Whisper
    const formData = new FormData();
    formData.append('file', new Blob([audioBuffer], { type: mime }), `audio.${ext}`);
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
      source:        'telegram',
    };

    // Agregar la nota atómicamente con arrayUnion (no pisa otras notas)
    console.log('[BOT] Guardando nota:', nota.id, nota.title, 'uid:', FIREBASE_UID);
    const userRef = db.collection('users').doc(FIREBASE_UID);
    await userRef.set({
      notes:     FieldValue.arrayUnion(nota),
      updatedAt: now,
    }, { merge: true });
    console.log('[BOT] Nota guardada OK en Firestore');

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
