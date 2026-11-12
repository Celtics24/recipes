// Recipes Worker - Firebase Auth variant.
// Auth: the site signs users in with Firebase Authentication (email/password
// with verification + password-reset emails on the free Spark plan). The
// client sends its Firebase ID token; this worker verifies it (RS256 against
// Google's public keys, iss/aud/exp checks) and requires email_verified.
// Data (KV namespace binding RECIPES): per-user recipes keyed by Firebase uid.
//   rec:{uid}  -> [ { id, title, category, link, text, notes, created, updated } ]
// CORS allows only https://celtics24.github.io and requires X-Recipes-Client.

const ALLOWED_ORIGIN = 'https://celtics24.github.io';
const CATEGORIES = ['ארוחה', 'קינוחים', 'עוגיות', 'מאפים', 'לניסיון'];
const MAX_RECIPES = 500;
const JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

// Filled at deploy time with the Firebase project id (public, not a secret).
const FIREBASE_PROJECT_ID = 'hametkonim';

function corsHeaders(origin) {
  const h = {
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Recipes-Client',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
  if (origin === ALLOWED_ORIGIN) h['Access-Control-Allow-Origin'] = origin;
  return h;
}
function securityHeaders() {
  return { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store' };
}
function json(body, status, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders(origin), ...securityHeaders() },
  });
}

function unb64url(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return Uint8Array.from(atob(s), c => c.charCodeAt(0));
}
function b64url(buf) { return btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }

async function getJwks() {
  const cache = caches.default;
  const cached = await cache.match(JWKS_URL);
  if (cached) return cached.json();
  const res = await fetch(JWKS_URL);
  if (!res.ok) throw new Error('jwks fetch failed');
  await cache.put(JWKS_URL, res.clone());
  return res.json();
}

async function verifyIdToken(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  let header, payload;
  try {
    header = JSON.parse(new TextDecoder().decode(unb64url(parts[0])));
    payload = JSON.parse(new TextDecoder().decode(unb64url(parts[1])));
  } catch { return null; }
  if (header.alg !== 'RS256' || !header.kid) return null;
  if (payload.iss !== 'https://securetoken.google.com/' + FIREBASE_PROJECT_ID) return null;
  if (payload.aud !== FIREBASE_PROJECT_ID) return null;
  if (typeof payload.exp !== 'number' || payload.exp * 1000 < Date.now()) return null;
  if (payload.email_verified !== true) return null;
  const jwks = await getJwks();
  const jwk = (jwks.keys || []).find(k => k.kid === header.kid);
  if (!jwk) return null;
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, unb64url(parts[2]), new TextEncoder().encode(parts[0] + '.' + parts[1]));
  if (!ok) return null;
  return payload;
}

function cleanStr(v, max) { return String(v == null ? '' : v).slice(0, max); }
function cleanRecipe(body) {
  const title = cleanStr(body.title, 200).trim();
  const category = cleanStr(body.category, 40);
  const link = cleanStr(body.link, 1000).trim();
  const text = cleanStr(body.text, 20000);
  const notes = cleanStr(body.notes, 5000);
  if (!title) return { error: 'missing' };
  if (!CATEGORIES.includes(category)) return { error: 'bad category' };
  if (link && !/^https?:\/\//i.test(link)) return { error: 'bad link' };
  if (!link && !text.trim()) return { error: 'missing' };
  return { title, category, link, text, notes };
}

async function readBody(request) {
  try { return await request.json(); } catch { return null; }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';
    const path = url.pathname;

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: { ...corsHeaders(origin), ...securityHeaders() } });
    }
    if (request.headers.get('X-Recipes-Client') !== '1') {
      return json({ error: 'bad client' }, 400, origin);
    }

    try {
      const auth = request.headers.get('Authorization') || '';
      const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
      const claims = await verifyIdToken(token).catch(() => null);
      if (!claims) return json({ error: 'unauthorized' }, 401, origin);
      const uid = claims.user_id || claims.sub;

      if (path === '/api/me' && request.method === 'GET') {
        return json({ name: cleanStr(claims.name || claims.email || '', 60), email: cleanStr(claims.email || '', 200) }, 200, origin);
      }

      if (path === '/api/recipes' && request.method === 'GET') {
        const list = (await env.RECIPES.get('rec:' + uid, 'json')) || [];
        return json({ recipes: list.slice().reverse() }, 200, origin);
      }

      if (path === '/api/recipes' && request.method === 'POST') {
        const body = await readBody(request);
        const clean = body && cleanRecipe(body);
        if (!clean || clean.error) return json({ error: (clean && clean.error) || 'missing' }, 400, origin);
        const list = (await env.RECIPES.get('rec:' + uid, 'json')) || [];
        if (list.length >= MAX_RECIPES) return json({ error: 'full' }, 400, origin);
        const now = new Date().toISOString();
        const recipe = { id: b64url(crypto.getRandomValues(new Uint8Array(9)).buffer), ...clean, created: now, updated: now };
        list.push(recipe);
        await env.RECIPES.put('rec:' + uid, JSON.stringify(list));
        return json({ recipe }, 200, origin);
      }

      const m = path.match(/^\/api\/recipes\/([A-Za-z0-9_\-]+)$/);
      if (m && request.method === 'PUT') {
        const body = await readBody(request);
        const clean = body && cleanRecipe(body);
        if (!clean || clean.error) return json({ error: (clean && clean.error) || 'missing' }, 400, origin);
        const list = (await env.RECIPES.get('rec:' + uid, 'json')) || [];
        const i = list.findIndex(r => r.id === m[1]);
        if (i < 0) return json({ error: 'not found' }, 404, origin);
        list[i] = { ...list[i], ...clean, updated: new Date().toISOString() };
        await env.RECIPES.put('rec:' + uid, JSON.stringify(list));
        return json({ recipe: list[i] }, 200, origin);
      }
      if (m && request.method === 'DELETE') {
        const list = (await env.RECIPES.get('rec:' + uid, 'json')) || [];
        const next = list.filter(r => r.id !== m[1]);
        if (next.length === list.length) return json({ error: 'not found' }, 404, origin);
        await env.RECIPES.put('rec:' + uid, JSON.stringify(next));
        return json({ ok: true }, 200, origin);
      }

      return json({ error: 'not found' }, 404, origin);
    } catch (e) {
      return json({ error: 'server error' }, 500, origin);
    }
  },
};
