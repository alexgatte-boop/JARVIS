// Fonction Netlify — stocke/lit les données de JARVIS dans Postgres (Neon).
// Accessible via /api/state grâce à la redirection définie dans netlify.toml.

const crypto = require('crypto');
const { neon } = require('@neondatabase/serverless');

const HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};
const reply = (statusCode, obj) => ({ statusCode, headers: HEADERS, body: typeof obj === 'string' ? obj : JSON.stringify(obj) });

// Comparaison à temps constant : empêche de deviner le code caractère par caractère.
function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a || '')).digest();
  const hb = crypto.createHash('sha256').update(String(b || '')).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function parseBody(event) {
  let raw = event.body || '{}';
  if (event.isBase64Encoded) raw = Buffer.from(raw, 'base64').toString('utf8');
  return JSON.parse(raw || '{}');
}

exports.handler = async (event) => {
  const password = process.env.JARVIS_PASSWORD;
  // Sans code configuré, on refuse tout (auparavant : accès ouvert à n'importe qui).
  if (!password) return reply(500, { error: "JARVIS_PASSWORD n'est pas défini dans les réglages Netlify." });
  if (!safeEqual(event.headers['x-jarvis-key'], password)) return reply(401, { error: 'unauthorized' });

  const connectionString = process.env.DATABASE_URL || process.env.NETLIFY_DATABASE_URL;
  if (!connectionString) return reply(500, { error: 'Aucune variable DATABASE_URL trouvée dans les réglages Netlify.' });

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
      const body = parseBody(event);
      if (!body || typeof body !== 'object' || Array.isArray(body)) return reply(400, { error: 'format invalide' });
      const json = JSON.stringify(body);
      if (json.length > 5_000_000) return reply(413, { error: 'données trop volumineuses' });
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
    return reply(500, { error: 'database error' });
  }
};
