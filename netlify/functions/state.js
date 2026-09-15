const { neon } = require('@neondatabase/serverless');

function checkAuth(event) {
  const password = process.env.JARVIS_PASSWORD;
  if (!password) return true;
  return event.headers['x-jarvis-key'] === password; }

exports.handler = async (event) => {
  if (!checkAuth(event)) {
    return { statusCode: 401, body: JSON.stringify({ error: 'unauthorized' }) };
  }

  const connectionString = process.env.DATABASE_URL || process.env.NETLIFY_DATABASE_URL;
  if (!connectionString) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Aucune variable DATABASE_URL trouvée dans les réglages Netlify." }),
    };
  }

  const sql = neon(connectionString);

  try {
    await sql`
      CREATE TABLE IF NOT EXISTS jarvis_state (
        id INT PRIMARY KEY DEFAULT 1,
        data JSONB NOT NULL DEFAULT '{}'::jsonb,
        updated_at TIMESTAMPTZ DEFAULT now()
      )
    `;

    if (event.httpMethod === 'GET') {
      const rows = await sql`SELECT data FROM jarvis_state WHERE id = 1`;
      if (rows.length === 0) {
        await sql`INSERT INTO jarvis_state (id, data) VALUES (1, '{}'::jsonb)`;
        return { statusCode: 200, body: '{}' };
      }
      return { statusCode: 200, body: JSON.stringify(rows[0].data) };
    }

    if (event.httpMethod === 'PUT') {
      const body = JSON.parse(event.body || '{}');
      const json = JSON.stringify(body);
      await sql`
        INSERT INTO jarvis_state (id, data, updated_at)
        VALUES (1, ${json}::jsonb, now())
        ON CONFLICT (id) DO UPDATE SET data = https://mibc-fr-06.mailinblack.com/securelink/?url=http://EXCLUDED.data&key=eyJsYW5nIjoiRlIiLCJ1cmwiOiJodHRwOi8vRVhDTFVERUQuZGF0YSIsInRva2VuIjoiZ0FBQUFBQnFxUUwxTnRua3VDZmVNN1FOLWZfXzJkZjM0d0l0bEx3emlEcU43a2k5NFpuV3U1OGJKNlRkaXRibk9EcmRUblFTcFd6c01oNFU2OXFYbnJXUHB3NjIxSHJnYWhxdHVFX2tLbGo1NEFGTnQ2ZjVqQ2RZT2Y5U0hYRnhwTk1Xem5GYlpURGIzejJFZWRvUmFYUXBvYXZ0UnQwVDFHYTI3UE8tS0o5VEVOSkJLV1hPUjlVZmVuRUtMWjZzWXVickxmMGhGcGxRclZ2ck9qVkhzelpYR3pydDJDVUN0QWIxYkJSMnM1MmtFUUJ6bVdnUmwxbE1lclJ2cGNoeEVuRDFFRkpyVVdhQmc0THBXVmVwb2ZlOTdvYm55MlNReGJabURQV1E0cUlobmxSUzJ4Q1VQa3duWjFvaFhidEtqb2hMS3A2LW9NXzYifQ==, updated_at = now()
      `;
      return { statusCode: 200, body: JSON.stringify({ ok: true }) };
    }

    return { statusCode: 405, body: JSON.stringify({ error: 'method not allowed' }) };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'database error', detail: String(err.message || err) }),
    };
  }
};
