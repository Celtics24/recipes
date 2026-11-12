// Recipes Worker — isolated backend for the recipes site (המתכונים שלי).
// Data (KV namespace binding RECIPES):
//   user:{email}    -> { name, salt, hash, recoveryHash, created }  (password PBKDF2, recovery code SHA-256)
//   rec:{email}     -> [ { id, title, category, link, text, notes, created, updated } ]  (one key per user)
//   sess:{token}    -> email   (KV TTL = session length)
//   rl:{ip}         -> { fails, lockUntil }  (soft lockout for auth endpoints)
//
// Notes:
// - Email is an identifier only, NOT verified ownership (no email sending on
//   this plan). Password reset uses a recovery code shown once at signup.
// - Each user can only read/write her own rec:{email} key (personal recipes).
// - No cookies: Authorization: Bearer <token> => classic CSRF not applicable.
// - CORS allows only https://celtics24.github.io and requires the custom
//   header X-Recipes-Client (forces preflight; cross-origin forms cannot set it).
// - Rate limiting is a soft KV per-IP counter (KV is eventually consistent).

const ALLOWED_ORIGIN = 'https://celtics24.github.io';
const SESSION_TTL_S = 30 * 24 * 60 * 60; // 30 days
const MAX_FAILS = 10;
const LOCK_MS = 15 * 60 * 1000; // 15 min
const PBKDF2_ITERS = 100000;
const CATEGORIES = ['ארוחה', 'קינוחים', 'עוגיות', 'מאפים', 'לניסיון'];
const MAX_RECIPES = 500;

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

const te = new TextEncoder();

function toHex(buf) { return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join(''); }
function fromHex(hex) { return new Uint8Array(hex.match(/.{2}/g).map(b => parseInt(b, 16))); }
function b64url(buf) { return btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }

async function hashPassword(password, saltHex) {
  const key = await crypto.subtle.importKey('raw', te.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: fromHex(saltHex), iterations: PBKDF2_ITERS }, key, 256);
  return toHex(bits);
}

async function sha256(text) { return toHex(await crypto.subtle.digest('SHA-256', te.encode(text))); }

function normalizeEmail(email) { return String(email || '').trim().toLowerCase(); }
function validEmail(email) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 200; }

function cleanStr(v, max) { return String(v == null ? '' : v).slice(0, max); }

function cleanRecipe(body) {
  const title = cleanStr(body.title, 200).trim();
  const category = cleanStr(body.category, 40);
  let link = cleanStr(body.link, 1000).trim();
  const text = cleanStr(body.text, 20000);
  const notes = cleanStr(body.notes, 5000);
  if (!title) return { error: 'missing' };
  if (!CATEGORIES.includes(category)) return { error: 'bad category' };
  if (link && !/^https?:\/\//i.test(link)) return { error: 'bad link' };
  if (!link && !text.trim()) return { error: 'missing' };
  return { title, category, link, text, notes };
}

async function rateLimited(env, ip) {
  const rec = await env.RECIPES.get('rl:' + ip, 'json');
  return !!(rec && rec.lockUntil && rec.lockUntil > Date.now());
}
async function recordFail(env, ip) {
  const key = 'rl:' + ip;
  const rec = (await env.RECIPES.get(key, 'json')) || { fails: 0, lockUntil: 0 };
  rec.fails = (rec.fails || 0) + 1;
  if (rec.fails >= MAX_FAILS) { rec.lockUntil = Date.now() + LOCK_MS; rec.fails = 0; }
  await env.RECIPES.put(key, JSON.stringify(rec), { expirationTtl: 3600 });
}
async function clearFails(env, ip) { await env.RECIPES.delete('rl:' + ip).catch(() => {}); }

function newSessionToken() { return b64url(crypto.getRandomValues(new Uint8Array(32)).buffer); }

async function authEmail(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return null;
  return await env.RECIPES.get('sess:' + token);
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
      // ---------- auth endpoints (rate limited) ----------
      if (path === '/api/signup' && request.method === 'POST') {
        const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
        if (await rateLimited(env, ip)) return json({ error: 'locked' }, 429, origin);
        const body = await readBody(request);
        const email = normalizeEmail(body && body.email);
        const name = cleanStr(body && body.name, 60).trim();
        const password = String((body && body.password) || '');
        if (!validEmail(email) || !name || password.length < 6 || password.length > 200) {
          return json({ error: 'missing' }, 400, origin);
        }
        if (await env.RECIPES.get('user:' + email)) return json({ error: 'exists' }, 409, origin);
        const salt = toHex(crypto.getRandomValues(new Uint8Array(16)).buffer);
        const recovery = toHex(crypto.getRandomValues(new Uint8Array(6)).buffer).toUpperCase().slice(0, 10);
        const user = {
          name,
          salt,
          hash: await hashPassword(password, salt),
          recoveryHash: await sha256(email + ':' + recovery),
          created: new Date().toISOString(),
        };
        await env.RECIPES.put('user:' + email, JSON.stringify(user));
        await env.RECIPES.put('rec:' + email, JSON.stringify([]));
        await clearFails(env, ip);
        return json({ ok: true, recovery }, 200, origin);
      }

      if (path === '/api/login' && request.method === 'POST') {
        const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
        if (await rateLimited(env, ip)) return json({ error: 'locked' }, 429, origin);
        const body = await readBody(request);
        const email = normalizeEmail(body && body.email);
        const password = String((body && body.password) || '');
        const user = await env.RECIPES.get('user:' + email, 'json');
        const ok = user && (await hashPassword(password, user.salt)) === user.hash;
        if (!ok) {
          await recordFail(env, ip);
          return json({ error: 'wrong' }, 401, origin);
        }
        await clearFails(env, ip);
        const token = newSessionToken();
        await env.RECIPES.put('sess:' + token, email, { expirationTtl: SESSION_TTL_S });
        return json({ token, name: user.name }, 200, origin);
      }

      if (path === '/api/recover' && request.method === 'POST') {
        const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
        if (await rateLimited(env, ip)) return json({ error: 'locked' }, 429, origin);
        const body = await readBody(request);
        const email = normalizeEmail(body && body.email);
        const recovery = cleanStr(body && body.recovery, 40).trim().toUpperCase();
        const password = String((body && body.password) || '');
        const user = await env.RECIPES.get('user:' + email, 'json');
        const ok = user && user.recoveryHash === (await sha256(email + ':' + recovery));
        if (!ok) {
          await recordFail(env, ip);
          return json({ error: 'wrong' }, 401, origin);
        }
        if (password.length < 6 || password.length > 200) return json({ error: 'missing' }, 400, origin);
        user.salt = toHex(crypto.getRandomValues(new Uint8Array(16)).buffer);
        user.hash = await hashPassword(password, user.salt);
        await env.RECIPES.put('user:' + email, JSON.stringify(user));
        await clearFails(env, ip);
        return json({ ok: true }, 200, origin);
      }

      // ---------- authenticated endpoints ----------
      const email = await authEmail(request, env);
      if (!email) return json({ error: 'unauthorized' }, 401, origin);

      if (path === '/api/logout' && request.method === 'POST') {
        const auth = request.headers.get('Authorization') || '';
        await env.RECIPES.delete('sess:' + auth.slice(7)).catch(() => {});
        return json({ ok: true }, 200, origin);
      }

      if (path === '/api/me' && request.method === 'GET') {
        const user = await env.RECIPES.get('user:' + email, 'json');
        if (!user) return json({ error: 'unauthorized' }, 401, origin);
        return json({ name: user.name, email }, 200, origin);
      }

      if (path === '/api/recipes' && request.method === 'GET') {
        const list = (await env.RECIPES.get('rec:' + email, 'json')) || [];
        return json({ recipes: list.slice().reverse() }, 200, origin);
      }

      if (path === '/api/recipes' && request.method === 'POST') {
        const body = await readBody(request);
        const clean = body && cleanRecipe(body);
        if (!clean || clean.error) return json({ error: (clean && clean.error) || 'missing' }, 400, origin);
        const list = (await env.RECIPES.get('rec:' + email, 'json')) || [];
        if (list.length >= MAX_RECIPES) return json({ error: 'full' }, 400, origin);
        const now = new Date().toISOString();
        const recipe = { id: b64url(crypto.getRandomValues(new Uint8Array(9)).buffer), ...clean, created: now, updated: now };
        list.push(recipe);
        await env.RECIPES.put('rec:' + email, JSON.stringify(list));
        return json({ recipe }, 200, origin);
      }

      const m = path.match(/^\/api\/recipes\/([A-Za-z0-9_\-]+)$/);
      if (m && request.method === 'PUT') {
        const body = await readBody(request);
        const clean = body && cleanRecipe(body);
        if (!clean || clean.error) return json({ error: (clean && clean.error) || 'missing' }, 400, origin);
        const list = (await env.RECIPES.get('rec:' + email, 'json')) || [];
        const i = list.findIndex(r => r.id === m[1]);
        if (i < 0) return json({ error: 'not found' }, 404, origin);
        list[i] = { ...list[i], ...clean, updated: new Date().toISOString() };
        await env.RECIPES.put('rec:' + email, JSON.stringify(list));
        return json({ recipe: list[i] }, 200, origin);
      }
      if (m && request.method === 'DELETE') {
        const list = (await env.RECIPES.get('rec:' + email, 'json')) || [];
        const next = list.filter(r => r.id !== m[1]);
        if (next.length === list.length) return json({ error: 'not found' }, 404, origin);
        await env.RECIPES.put('rec:' + email, JSON.stringify(next));
        return json({ ok: true }, 200, origin);
      }

      return json({ error: 'not found' }, 404, origin);
    } catch (e) {
      return json({ error: 'server error' }, 500, origin);
    }
  },
};
