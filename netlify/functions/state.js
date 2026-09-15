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
      const body = parseBody(event);
      const json = JSON.stringify(body);
      await sql`
        INSERT INTO jarvis_state (id, data, updated_at)
        VALUES (1, ${json}::jsonb, now())
        ON CONFLICT (id) DO UPDATE SET data = https://mibc-fr-06.mailinblack.com/securelink/?url=http://EXCLUDED.data&key=eyJsYW5nIjoiRlIiLCJ1cmwiOiJodHRwOi8vRVhDTFVERUQuZGF0YSIsInRva2VuIjoiZ0FBQUFBQnFxUmZISExtcUxhVDIxQ29aYXQ2Zk16cW5XQ3hObFpYMklaOTV1QlAzdGpFcUZJRzRvTVkxcnFZeFQ0WFpiLUE3bUhjSm16UEVxLWJsdlY0YldZZXpoamVOdk5EZnhDT1VQWmszZVk4VEpFMmp6YUcyVTQyZ1pfcVk1UDBtakI3dldRSUJhcTNRRnhJaHU3RG5JWXR5bFRMLUxYTF9TNlN4eUtIN2RtRmUyelU0WmxtTGNxT0VYdTRPanowM1FITWotN3NZc295Rjh3WXJFS0xFMkV4Y1RZT3VOYnFlR2tVYlR3bTJrcVhCOFppYkpkWmVfbC1xRlc0eFk0M2sya0cxbU5sck9Pb25OOC1ha1hHUE11akI2M0RLWExYUGV4cmxMODRFZjZ6R1dYZVd4ODdhRDkzQjZCUG56Ni1Pb1JCR1lsQ1YifQ==, updated_at = now()
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
