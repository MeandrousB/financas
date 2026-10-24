import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { cfg } from './config.js';
import { db, users, state, gzip, gunzip, dailyBackup } from './db.js';
import {
  hashPassword, checkLogin, startSession, endSession, requireAuth,
  loginRetryAfter, loginFailed, loginSucceeded, clientIp, MIN_PASSWORD, MAX_PASSWORD,
} from './auth.js';

const log = (...a) => console.log(new Date().toISOString(), ...a);

/* ---------- DATA_DIR precisa ser volume persistente em container ---------- */
try {
  const mounts = fs.readFileSync('/proc/self/mountinfo', 'utf8').split('\n').map(l => l.split(' ')[4]);
  const inContainer = fs.existsSync('/.dockerenv') || process.env.NODE_ENV === 'production';
  if (inContainer && !mounts.includes(cfg.dataDir)) {
    log(`ATENÇÃO: ${cfg.dataDir} não é um volume montado. Os dados somem no próximo deploy — configure o armazenamento persistente em ${cfg.dataDir}.`);
  }
} catch { /* fora do Linux: ignora */ }

/* ---------- usuário inicial (uma vez) ---------- */
if (users.count() === 0) {
  if (cfg.initEmail && cfg.initPassword.length >= MIN_PASSWORD) {
    users.create(cfg.initEmail, await hashPassword(cfg.initPassword));
    log(`Usuário ${cfg.initEmail} criado a partir de INIT_EMAIL/INIT_PASSWORD. Remova INIT_PASSWORD do ambiente.`);
  } else {
    log('Nenhum usuário cadastrado. Defina INIT_EMAIL e INIT_PASSWORD (mín. ' + MIN_PASSWORD +
        ' caracteres) ou rode no container: npm run cli -- usuario voce@email.com');
  }
} else if (cfg.initPassword) {
  log('Aviso: INIT_PASSWORD continua definido no ambiente, mas já existe usuário. Pode remover.');
}

/* ---------- service worker: versão = hash do conteúdo de public/ ---------- */
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
}
const files = walk(cfg.publicDir)
  .map(f => path.relative(cfg.publicDir, f).split(path.sep).join('/'))
  .filter(f => f !== 'sw.js' && !f.endsWith('.txt') && !f.startsWith('.'))
  .sort();
const h = createHash('sha256');
for (const f of files) h.update(f).update(fs.readFileSync(path.join(cfg.publicDir, f)));
const SW_VERSION = h.digest('hex').slice(0, 12);
const SW = fs.readFileSync(path.join(cfg.publicDir, 'sw.js'), 'utf8')
  .replace("'__VERSION__'", JSON.stringify(SW_VERSION))
  .replace('__ASSETS__;', JSON.stringify(files.map(f => '/' + f)) + ';');
if (SW.includes('__VERSION__') || SW.includes('__ASSETS__')) throw new Error('sw.js: marcadores não substituídos');

/* ---------- app ---------- */
const app = new Hono();

const CSP = [
  "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:", "font-src 'self'", "connect-src 'self'", "worker-src 'self'",
  "manifest-src 'self'", "object-src 'none'", "base-uri 'none'", "form-action 'self'", "frame-ancestors 'none'",
].join('; ');

app.use('*', async (c, next) => {
  await next();
  const hd = c.res.headers;
  hd.set('Content-Security-Policy', CSP);
  hd.set('X-Content-Type-Options', 'nosniff');
  hd.set('Referrer-Policy', 'no-referrer');
  hd.set('X-Frame-Options', 'DENY');
  hd.set('Cross-Origin-Opener-Policy', 'same-origin');
  hd.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  if (cfg.cookieSecure) hd.set('Strict-Transport-Security', 'max-age=31536000');
});

app.onError((err, c) => { log('erro', c.req.method, c.req.path, err); return c.json({ erro: 'Erro interno.' }, 500); });

app.get('/healthz', c => c.text('ok'));

/* rotas dinâmicas: nada em cache; escrita só da própria origem e só JSON (CSRF) */
const sameOrigin = c => {
  const o = c.req.header('origin');
  if (!o) return false;
  if (cfg.allowedOrigin) return o === cfg.allowedOrigin;
  try { return new URL(o).host === c.req.header('host'); } catch { return false; }
};
for (const p of ['/api/*', '/auth/*']) {
  app.use(p, async (c, next) => {
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
      if (!sameOrigin(c)) return c.json({ erro: 'Origem não permitida.' }, 403);
      if (c.req.method !== 'DELETE' && !/^application\/json\b/i.test(c.req.header('content-type') || '')) {
        return c.json({ erro: 'Envie application/json.' }, 415);
      }
    }
    await next();
    c.res.headers.set('Cache-Control', 'no-store');
  });
}

/* ---------- login ---------- */
app.post('/auth/login', bodyLimit({ maxSize: 8 * 1024, onError: c => c.json({ erro: 'Requisição grande demais.' }, 413) }), async c => {
  const ip = clientIp(c);
  const wait = loginRetryAfter(ip);
  if (wait) {
    c.header('Retry-After', String(wait));
    return c.json({ erro: `Muitas tentativas. Tente de novo em ${Math.ceil(wait / 60)} min.` }, 429);
  }
  let b = null;
  try { b = await c.req.json(); } catch { /* corpo inválido */ }
  const email = String(b?.email || '').trim();
  const senha = String(b?.senha || '');
  const u = email && senha && senha.length <= MAX_PASSWORD ? await checkLogin(email, senha) : null;
  if (!u) {
    loginFailed(ip);
    log('login recusado', ip, email ? '(e-mail informado)' : '(sem e-mail)');
    return c.json({ erro: 'E-mail ou senha incorretos.' }, 401);
  }
  loginSucceeded(ip);
  startSession(c, u.id);
  log('login ok', ip);
  return c.json({ id: u.id, email: u.email });
});

app.post('/auth/logout', c => { endSession(c); return c.body(null, 204); });

app.get('/api/me', requireAuth, c => c.json(c.get('user')));

/* ---------- estado ---------- */
const metaHeaders = row => ({
  'X-Version': String(row.version), 'X-Updated-At': String(row.updated_at || ''), 'X-Device': row.device || '',
  ETag: `"${row.version}"`,
});

app.get('/api/state/meta', requireAuth, c => {
  const m = state.meta(c.get('user').id);
  return c.json(m ? { version: m.version, updatedAt: m.updated_at, device: m.device, bytes: m.bytes } : { version: 0 });
});

app.get('/api/state', requireAuth, c => {
  const row = state.full(c.get('user').id);
  if (!row) return c.body(null, 204, { 'X-Version': '0' });
  const hd = { ...metaHeaders(row), 'Content-Type': 'application/json; charset=utf-8', Vary: 'Accept-Encoding' };
  if (/\bgzip\b/i.test(c.req.header('accept-encoding') || '')) {
    return c.body(Buffer.from(row.data), 200, { ...hd, 'Content-Encoding': 'gzip' });
  }
  return c.body(gunzip(Buffer.from(row.data)), 200, hd);
});

const looksLikeState = o => !!o && typeof o === 'object' && !Array.isArray(o) && !!o.config && typeof o.config === 'object' &&
  Array.isArray(o.lancamentos) && Array.isArray(o.categorias) && Array.isArray(o.contas);

app.put('/api/state', requireAuth,
  bodyLimit({ maxSize: cfg.maxStateBytes, onError: c => c.json({ erro: 'Dados grandes demais para o limite do servidor (MAX_STATE_MB).' }, 413) }),
  async c => {
    const im = c.req.header('if-match');
    if (im == null) return c.json({ erro: 'Falta o cabeçalho If-Match com a versão base.' }, 428);
    const expected = Number.parseInt(String(im).replace(/^W\//, '').replace(/"/g, ''), 10);
    if (!Number.isInteger(expected) || expected < 0) return c.json({ erro: 'If-Match inválido.' }, 400);

    const enc = (c.req.header('content-encoding') || 'identity').toLowerCase();
    const body = Buffer.from(await c.req.arrayBuffer());
    let json, gz = null;
    try {
      if (enc === 'gzip') { gz = body; json = gunzip(body, cfg.maxStateBytes); }
      else if (enc === 'identity') json = body;
      else return c.json({ erro: 'Content-Encoding não suportado.' }, 415);
    } catch (e) {
      if (e instanceof RangeError) return c.json({ erro: 'Dados grandes demais para o limite do servidor (MAX_STATE_MB).' }, 413);
      return c.json({ erro: 'Corpo gzip inválido.' }, 400);
    }
    let obj;
    try { obj = JSON.parse(json.toString('utf8')); } catch { return c.json({ erro: 'JSON inválido.' }, 400); }
    if (!looksLikeState(obj)) return c.json({ erro: 'O conteúdo não parece os dados do app.' }, 422);

    const device = (c.req.header('x-device') || '').replace(/[^\w-]/g, '').slice(0, 64) || null;
    const r = state.put(c.get('user').id, expected, gz || gzip(json), json.length, device);
    if (r.conflict) {
      return c.json({ erro: 'Outro aparelho salvou uma versão mais nova.', version: r.current.version, updatedAt: r.current.updated_at, device: r.current.device }, 409);
    }
    return c.json(r);
  });

app.all('/api/*', c => c.json({ erro: 'Rota inexistente.' }, 404));

/* ---------- PWA e arquivos estáticos ---------- */
app.get('/sw.js', c => c.body(SW, 200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-cache' }));
app.use('/*', serveStatic({
  root: path.relative(process.cwd(), cfg.publicDir) || '.',
  onFound: (_p, c) => { c.header('Cache-Control', 'no-cache'); },
}));
app.notFound(c => c.text('Não encontrado.', 404));

/* ---------- cópia diária do banco ---------- */
const runBackup = () => { try { log('backup diário:', dailyBackup()); } catch (e) { log('backup falhou', e); } };
setTimeout(runBackup, 15000).unref();
setInterval(runBackup, 6 * 3600000).unref();

/* ---------- start / stop ---------- */
const server = serve({ fetch: app.fetch, port: cfg.port, hostname: '0.0.0.0' }, i => log(`ouvindo na porta ${i.port} (sw ${SW_VERSION})`));
const stop = () => { server.close(() => { db.close(); process.exit(0); }); setTimeout(() => process.exit(0), 5000).unref(); };
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
