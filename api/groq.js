// /api/groq.js — Vercel Edge Function proxy para Groq API
// La GROQ_KEY vive en Vercel Environment Variables, nunca en el código

export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const groqKey = process.env.GROQ_KEY;
  if (!groqKey) {
    return new Response(JSON.stringify({ error: 'GROQ_KEY not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Leer el path destino desde el header X-Groq-Path
  // e.g. "openai/v1/chat/completions" o "openai/v1/audio/transcriptions"
  const groqPath = req.headers.get('x-groq-path') || 'openai/v1/chat/completions';
  const groqUrl = `https://api.groq.com/${groqPath}`;

  // Clonar headers y reemplazar Authorization
  const contentType = req.headers.get('content-type') || 'application/json';
  const isMultipart = contentType.includes('multipart/form-data');

  const upstreamHeaders = {
    'Authorization': `Bearer ${groqKey}`,
  };
  // Siempre pasar el Content-Type original — para multipart incluye el boundary obligatorio
  upstreamHeaders['Content-Type'] = contentType;

  const body = await req.arrayBuffer();

  const upstream = await fetch(groqUrl, {
    method: 'POST',
    headers: upstreamHeaders,
    body: body,
  });

  const upstreamBody = await upstream.arrayBuffer();

  return new Response(upstreamBody, {
    status: upstream.status,
    headers: {
      'Content-Type': upstream.headers.get('content-type') || 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
