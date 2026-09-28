const { neon } = require('@neondatabase/serverless');
const crypto = require('crypto');

const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
};
function reply(statusCode, obj) {
  return { statusCode, headers: JSON_HEADERS, body: typeof obj === 'string' ? obj : JSON.stringify(obj) };
}

function sha(s) { return crypto.createHash('sha256').update(String(s)).digest(); }

// Retourne 'ok', 'denied' ou 'not_configured'.
// IMPORTANT : sans JARVIS_PASSWORD, on REFUSE tout (avant : tout était ouvert).
function checkAuth(event) {
  const password = process.env.JARVIS_PASSWORD;
  if (!password) return 'not_configured';
  const headers = {};
  for (const [k, v] of Object.entries(event.headers || {})) headers[k.toLowerCase()] = v;
  const provided = headers['x-jarvis-key'] || '';
  // comparaison à temps constant (hash des deux côtés => même longueur)
  return crypto.timingSafeEqual(sha(provided), sha(password)) ? 'ok' : 'denied';
}

function parseBody(event) {
  let raw = event.body || '{}';
  if (event.isBase64Encoded) {
    raw = Buffer.from(raw, 'base64').toString('utf8');
  }
  return JSON.parse(raw || '{}');
}

exports.handler = async (event) => {
  const auth = checkAuth(event);
  if (auth === 'not_configured') {
    return reply(500, { error: "JARVIS_PASSWORD n'est pas défini dans les réglages Netlify (Environment variables)." });
  }
  if (auth === 'denied') {
    // petit délai pour ralentir les essais en boucle
    await new Promise((r) => setTimeout(r, 1000));
    return reply(401, { error: 'unauthorized' });
  }

  const connectionString = process.env.DATABASE_URL || process.env.NETLIFY_DATABASE_URL;
  if (!connectionString) {
    return reply(500, { error: "Aucune variable DATABASE_URL trouvée dans les réglages Netlify." });
  }

  const sql = neon(connectionString);

  try {
    await sql`
      CREATE TABLE IF NOT EXISTS jarvis_state (
        id INT PRIMARY KEY DEFAULT 1,
        data JSONB NOT NULL DEFAULT '{}',
        updated_at TIMESTAMPTZ DEFAULT now()
      )
    `;

    if (event.httpMethod === 'GET') {
      const rows = await sql`SELECT data FROM jarvis_state WHERE id = 1`;
      if (rows.length === 0) {
        await sql`INSERT INTO jarvis_state (id, data) VALUES (1, '{}')`;
        return reply(200, '{}');
      }
      return reply(200, rows[0].data);
    }

    if (event.httpMethod === 'PUT') {
      let body;
      try { body = parseBody(event); }
      catch (e) { return reply(400, { error: 'JSON invalide' }); }
      if (body === null || typeof body !== 'object' || Array.isArray(body)) {
        return reply(400, { error: 'objet JSON attendu' });
      }
      const json = JSON.stringify(body);
      await sql`
        INSERT INTO jarvis_state (id, data, updated_at)
        VALUES (1, ${json}, now())
        ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()
      `;
      return reply(200, { ok: true });
    }

    return reply(405, { error: 'method not allowed' });
  } catch (err) {
    console.error(err);
    return reply(500, { error: 'database error', detail: String(err.message || err) });
  }
};
