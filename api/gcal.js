// /api/gcal.js — Crea eventos en Google Calendar
// Usa GCAL_CLIENT_ID, GCAL_CLIENT_SECRET, GCAL_REFRESH_TOKEN de Vercel env vars

export const config = { runtime: 'edge' };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

async function getAccessToken(clientId, clientSecret, refreshToken) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('No access token: ' + JSON.stringify(data));
  return data.access_token;
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: CORS });
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: CORS });
  }

  const clientId     = process.env.GCAL_CLIENT_ID;
  const clientSecret = process.env.GCAL_CLIENT_SECRET;
  const refreshToken = process.env.GCAL_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    return new Response(JSON.stringify({ error: 'Google Calendar no configurado' }), { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  let body;
  try { body = await req.json(); } catch(e) {
    return new Response(JSON.stringify({ error: 'JSON inválido' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  const { title, date, time, description, calendarId } = body;
  if (!title || !date || !time) {
    return new Response(JSON.stringify({ error: 'Faltan campos: title, date, time' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  try {
    const accessToken = await getAccessToken(clientId, clientSecret, refreshToken);

    // Construir start/end en timezone Buenos Aires
    // date: "2026-06-10", time: "15:30"
    const startDateTime = `${date}T${time}:00`;
    const [hh, mm] = time.split(':').map(Number);
    const endH = String(hh + 1).padStart(2, '0');
    const endDateTime = `${date}T${endH}:${String(mm).padStart(2, '0')}:00`;

    const event = {
      summary: title,
      description: description || '',
      start: { dateTime: startDateTime, timeZone: 'America/Argentina/Buenos_Aires' },
      end:   { dateTime: endDateTime,   timeZone: 'America/Argentina/Buenos_Aires' },
    };

    const cal = calendarId || 'jdavidlatorre@mirandabosch.com';
    const gcalRes = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal)}/events`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(event),
      }
    );

    const gcalData = await gcalRes.json();
    if (!gcalRes.ok) {
      return new Response(JSON.stringify({ error: gcalData.error?.message || 'Error Google Calendar' }), { status: gcalRes.status, headers: { ...CORS, 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({ ok: true, eventId: gcalData.id, htmlLink: gcalData.htmlLink }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });

  } catch(e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }
}
