// Fonction Netlify — récupère les titres d'actualité (local, France, monde) depuis des flux RSS publics.
// Accessible via /api/news (redirection définie dans netlify.toml). Protégée par le même code que /api/state.
// Seuls les flux listés ci-dessous sont interrogés : rien d'autre ne peut être demandé depuis l'appli.

const crypto = require('crypto');

const SECTIONS = [
  { id: 'local', label: 'Local', feeds: [
    { source: 'Actus Limousin', url: 'https://mesinfos.fr/actus-limousin/rss.xml' },
    { source: 'ICI Limousin', url: 'https://www.francebleu.fr/rss/limousin/infos.xml' },
  ]},
  { id: 'france', label: 'France', feeds: [
    { source: 'franceinfo', url: 'https://www.francetvinfo.fr/france.rss' },
    { source: 'franceinfo', url: 'https://www.francetvinfo.fr/titres.rss' },
  ]},
  { id: 'monde', label: 'Monde', feeds: [
    { source: 'franceinfo', url: 'https://www.francetvinfo.fr/monde.rss' },
    { source: 'France 24', url: 'https://www.france24.com/fr/rss' },
  ]},
];
const PER_SECTION = 12;
const TIMEOUT_MS = 6000;

const HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'private, max-age=600',
  'X-Content-Type-Options': 'nosniff',
};
const reply = (statusCode, obj) => ({ statusCode, headers: HEADERS, body: JSON.stringify(obj) });

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a || '')).digest();
  const hb = crypto.createHash('sha256').update(String(b || '')).digest();
  return crypto.timingSafeEqual(ha, hb);
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', laquo: '«', raquo: '»', hellip: '…', eacute: 'é', egrave: 'è', agrave: 'à', ccedil: 'ç' };
function decode(s) {
  return String(s || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m)
    .replace(/\s+/g, ' ')
    .trim();
}
function tag(block, name) {
  const m = block.match(new RegExp('<' + name + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + name + '>', 'i'));
  return m ? m[1] : '';
}
function parseFeed(xml, source) {
  const items = [];
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || [];
  for (const b of blocks) {
    const title = decode(tag(b, 'title'));
    let link = decode(tag(b, 'link'));
    if (!link) { const m = b.match(/<link[^>]*href="([^"]+)"/i); if (m) link = m[1]; }
    if (!link) link = decode(tag(b, 'guid'));
    if (!title || !/^https?:\/\//i.test(link)) continue;
    const date = decode(tag(b, 'pubDate') || tag(b, 'updated') || tag(b, 'published') || tag(b, 'dc:date'));
    const ts = date ? Date.parse(date.replace(/ (\d{2}) (\d{2}:\d{2}:\d{2})/, ' 20$1 $2')) || Date.parse(date) : NaN;
    items.push({ title, link, source, ts: Number.isFinite(ts) ? ts : null });
  }
  return items;
}

async function fetchFeed(feed) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(feed.url, { signal: ctrl.signal, headers: { 'User-Agent': 'JARVIS-perso/1.0 (lecteur RSS personnel)', 'Accept': 'application/rss+xml, application/xml, text/xml' } });
    if (!res.ok) return [];
    const xml = await res.text();
    return parseFeed(xml.slice(0, 2_000_000), feed.source);
  } catch (e) {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

exports.handler = async (event) => {
  const password = process.env.JARVIS_PASSWORD;
  if (!password) return reply(500, { error: "JARVIS_PASSWORD n'est pas défini dans les réglages Netlify." });
  if (!safeEqual(event.headers['x-jarvis-key'], password)) return reply(401, { error: 'unauthorized' });
  if (event.httpMethod !== 'GET') return reply(405, { error: 'method not allowed' });

  const sections = await Promise.all(SECTIONS.map(async (sec) => {
    const lists = await Promise.all(sec.feeds.map(fetchFeed));
    const seen = new Set();
    const items = lists.flat()
      .filter(it => { const k = it.title.toLowerCase(); if (seen.has(k) || seen.has(it.link)) return false; seen.add(k); seen.add(it.link); return true; })
      .sort((a, b) => (b.ts || 0) - (a.ts || 0))
      .slice(0, PER_SECTION);
    return { id: sec.id, label: sec.label, items };
  }));
  return reply(200, { sections, fetchedAt: Date.now() });
};

// Exposé pour les tests
exports._parseFeed = parseFeed;
