const { neon } = require('@neondatabase/serverless');

function checkAuth(event) {
  const password = process.env.JARVIS_PASSWORD;
  if (!password) return true;
  return event.headers['x-jarvis-key'] === password; }

function parseBody(event) {
  let raw = event.body || '{}';
  if (event.isBase64Encoded) {
    raw = Buffer.from(raw, 'base64').toString('utf8');
  }
  return JSON.parse(raw || '{}');
}

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
        data JSONB NOT NULL DEFAULT '{}',
        updated_at TIMESTAMPTZ DEFAULT now()
      )
    `;

    if (event.httpMethod === 'GET') {
      const rows = await sql`SELECT data FROM jarvis_state WHERE id = 1`;
      if (rows.length === 0) {
        await sql`INSERT INTO jarvis_state (id, data) VALUES (1, '{}')`;
        return { statusCode: 200, body: '{}' };
      }
      return { statusCode: 200, body: JSON.stringify(rows[0].data) };
    }

    if (event.httpMethod === 'PUT') {
      const body = parseBody(event);
      const json = JSON.stringify(body);
      await sql`
        INSERT INTO jarvis_state (id, data, updated_at)
        VALUES (1, ${json}, now())
        ON CONFLICT (id) DO UPDATE SET data = https://mibc-fr-06.mailinblack.com/securelink/?url=http://EXCLUDED.data&key=eyJsYW5nIjoiRlIiLCJ1cmwiOiJodHRwOi8vRVhDTFVERUQuZGF0YSIsInRva2VuIjoiZ0FBQUFBQnFxUjhGUVRoRE40WVN4MDJLel9WOGx4blZHQTItNTkyd29vNnZ0QXh6X0xhV3NPUTA0ZWV4dklVRG5XaDZoaWJwVEE0QkVxMUFObEViUTBwdkViSjFtLVM4ekRreDM0WG5rY0Zib3hCeW9oeGZlZU05RkpkYnBxSDBVV1FwdnFyR0pxS3BxenJKdm04dEU1SE5GV013Qnl2QmVwNHgyRC1uc1NBUjFHYmt5QldVSFc0dERTaHdDVEw2dWttRUE5VTVHWjE2NVI5RzVUMXU5Y0xGaEtibGdqSjc4UDQwVUh1TDd5c1puQ0p6VzN2bF9tZ0NpV1RybjBzRzNWRlVZZjJsbXluV2gwQ2k1ZFdZYkxlLXhpNmZkbHM1TXNuZ1hiblREZkRuMVctTWtSTU5RTU8tMld4REhBc1hoRW4zaFNXZU9QcUQifQ==, updated_at = now()
      `;
      return { statusCode: 200, body: JSON.stringify({ ok: true }) };
    }

    return { statusCode: 405, body: JSON.stringify({ error: 'method not allowed' }) };
  } catch (err) {
    console.error(err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'database error', detail: String(err.message || err) }),
    };
  }
};
