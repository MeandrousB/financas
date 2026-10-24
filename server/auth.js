import { scrypt as _scrypt, randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { cfg } from './config.js';
import { users, sessions } from './db.js';

/* ---------- senha: scrypt (node:crypto), parâmetros mínimos recomendados pela OWASP ---------- */
const SCRYPT = { N: 2 ** 17, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };
const KEYLEN = 32;
const scrypt = (pw, salt, o) => new Promise((res, rej) => _scrypt(pw, salt, KEYLEN, o, (e, k) => (e ? rej(e) : res(k))));

export const MIN_PASSWORD = 10;
export const MAX_PASSWORD = 512;

export async function hashPassword(pw) {
  const salt = randomBytes(16);
  const key = await scrypt(String(pw).normalize('NFKC'), salt, SCRYPT);
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), key.toString('base64')].join('$');
}

export async function verifyPassword(pw, stored) {
  const [alg, N, r, p, salt, key] = String(stored).split('$');
  if (alg !== 'scrypt') return false;
  const want = Buffer.from(key, 'base64');
  const got = await scrypt(String(pw).normalize('NFKC'), Buffer.from(salt, 'base64'), { N: +N, r: +r, p: +p, maxmem: SCRYPT.maxmem });
  return got.length === want.length && timingSafeEqual(got, want);
}

// e-mail inexistente custa o mesmo tempo que senha errada
let dummy = null;
const dummyHash = async () => (dummy ??= await hashPassword(randomBytes(12).toString('hex')));

export async function checkLogin(email, password) {
  const u = users.byEmail(email);
  if (!u) { await verifyPassword(password, await dummyHash()); return null; }
  return (await verifyPassword(password, u.pass_hash)) ? u : null;
}

/* ---------- sessões ---------- */
const COOKIE = cfg.cookieSecure ? '__Host-sid' : 'sid';
const DAY = 86400000;
const sha = t => createHash('sha256').update(t).digest('hex');
const cookieOpts = () => ({ httpOnly: true, secure: cfg.cookieSecure, sameSite: 'Lax', path: '/', maxAge: cfg.sessionDays * 86400 });

export function startSession(c, userId) {
  const token = randomBytes(32).toString('base64url');
  sessions.insert(sha(token), userId, Date.now() + cfg.sessionDays * DAY, (c.req.header('user-agent') || '').slice(0, 200));
  setCookie(c, COOKIE, token, cookieOpts());
}

export function endSession(c) {
  const t = getCookie(c, COOKIE);
  if (t) sessions.delete(sha(t));
  deleteCookie(c, COOKIE, { path: '/', secure: cfg.cookieSecure });
}

/** Middleware: exige sessão válida; renova (janela deslizante) no máximo 1x por hora. */
export async function requireAuth(c, next) {
  const t = getCookie(c, COOKIE);
  const s = t && sessions.get(sha(t));
  if (!s || s.expires_at < Date.now()) {
    if (s) sessions.delete(s.token_hash);
    return c.json({ erro: 'Sessão expirada. Entre de novo.' }, 401);
  }
  if (Date.now() - s.last_seen > 3600000) {
    sessions.touch(s.token_hash, Date.now() + cfg.sessionDays * DAY);
    setCookie(c, COOKIE, t, cookieOpts());
  }
  c.set('user', { id: s.user_id, email: s.email });
  await next();
}

/* ---------- limite de tentativas de login (memória; janela de 15 min) ---------- */
const WINDOW = 15 * 60000;
const byIp = new Map();
let global = [];
const prune = (arr, now) => { while (arr.length && arr[0] <= now - WINDOW) arr.shift(); return arr; };

export function loginRetryAfter(ip) {
  const now = Date.now();
  prune(global, now);
  const a = prune(byIp.get(ip) || [], now);
  if (a.length >= cfg.loginMaxFailsPerIp) return Math.ceil((a[0] + WINDOW - now) / 1000);
  if (global.length >= cfg.loginMaxFailsGlobal) return Math.ceil((global[0] + WINDOW - now) / 1000);
  return 0;
}
export function loginFailed(ip) {
  const now = Date.now();
  const a = byIp.get(ip) || [];
  a.push(now); byIp.set(ip, a); global.push(now);
}
export const loginSucceeded = ip => byIp.delete(ip);

setInterval(() => {
  const now = Date.now();
  for (const [ip, a] of byIp) if (!prune(a, now).length) byIp.delete(ip);
  sessions.purge();
}, 10 * 60000).unref();

/* ---------- IP do cliente atrás do proxy ---------- */
export function clientIp(c) {
  if (cfg.trustProxy) {
    const real = c.req.header('x-real-ip');
    if (real) return real.trim();
    const xff = c.req.header('x-forwarded-for');
    if (xff) return xff.split(',').pop().trim();   // último salto = quem falou com o proxy
  }
  return c.env?.incoming?.socket?.remoteAddress || 'desconhecido';
}
