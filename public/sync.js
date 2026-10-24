/* Minhas finanças — sessão, sincronização com o servidor e PWA.
   Carregado depois de app.js. Não mexe nas telas: envolve APP.save e controla quando APP.init roda.

   Modelo: o estado inteiro é um documento JSON versionado no servidor. O aparelho grava sempre
   no localStorage (como antes) e envia ao servidor com If-Match: <versão base>. Se outro aparelho
   gravou antes (409), o usuário escolhe qual versão fica e a outra é baixada como backup. */
(function () {
'use strict';
const APP = window.APP, DATA = window.DATA;
const KEY = 'financas-pf-pj-v1', UIKEY = 'financas-pf-pj-ui-v1', META = 'financas-sync-v1', DEV = 'financas-device';
const $ = s => document.querySelector(s), $$ = s => Array.from(document.querySelectorAll(s));
const gate = $('#gate');

const ls = {
  get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } },
  del: k => { try { localStorage.removeItem(k); } catch (e) { /* ignora */ } },
};

const device = ls.get(DEV) || (() => {
  const id = (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2)).replace(/[^\w-]/g, '');
  ls.set(DEV, id); return id;
})();

const META0 = { userId: null, email: '', base: 0, dirty: false, dirtySince: null, syncedAt: null };
let meta;
try { meta = Object.assign({}, META0, JSON.parse(ls.get(META) || '{}')); } catch (e) { meta = Object.assign({}, META0); }
const saveMeta = () => ls.set(META, JSON.stringify(meta));

let started = false;      // APP.init já rodou
let lastSynced = null;    // JSON exato da última versão confirmada pelo servidor
let pushing = false, again = false, paused = false, timer = 0, retryMs = 0, lastError = '';
let conflictInfo = null;

const current = () => (started && APP.state ? JSON.stringify(APP.state) : ls.get(KEY));
const fmt = ms => new Date(ms).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const stamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');

/* ---------------- rede ---------------- */
function api(method, path, opts) {
  opts = opts || {};
  const headers = Object.assign({ 'X-Device': device }, opts.headers || {});
  let body = opts.body;
  if (opts.json !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(opts.json); }
  return fetch(path, { method, headers, body, credentials: 'same-origin', cache: 'no-store' });
}

async function gzip(str) {
  if (typeof CompressionStream === 'undefined' || str.length < 4096) return null;
  try { return await new Response(new Blob([str]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer(); }
  catch (e) { return null; }
}

async function fetchState() {
  const r = await api('GET', '/api/state');
  if (r.status === 401) { const e = new Error('auth'); e.auth = true; throw e; }
  if (r.status === 204) return { version: 0 };
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return { version: +r.headers.get('X-Version'), updatedAt: +r.headers.get('X-Updated-At') || null, raw: await r.text() };
}

/* ---------------- indicador ---------------- */
const LABEL = {
  ok: 'Sincronizado', saving: 'Salvando…', pending: 'Alterações a enviar', offline: 'Offline, salvo neste aparelho',
  conflict: 'Escolher versão dos dados', auth: 'Entrar para sincronizar', error: 'Erro ao sincronizar',
};
let status = 'ok';
function setStatus(s, detail) {
  status = s;
  const action = s === 'conflict' || s === 'auth' || s === 'error';
  for (const el of $$('[data-sync-status]')) {
    const compact = el.classList.contains('compact');
    el.hidden = false;
    el.className = 'sync-pill' + (compact ? ' compact' : '') + ' is-' + s + (action ? ' is-action' : '');
    el.innerHTML = '<span class="sync-txt">' + LABEL[s] + '</span>';
    el.setAttribute('aria-label', LABEL[s]);
    el.title = detail || (meta.syncedAt ? 'Última sincronização: ' + fmt(meta.syncedAt) : LABEL[s]);
  }
}

/* ---------------- envio ---------------- */
function pushSoon(ms) {
  clearTimeout(timer);
  if (paused) return;
  if (!navigator.onLine) { setStatus('offline'); return; }
  if (status !== 'saving') setStatus('saving');
  timer = setTimeout(push, ms);
}
function retryLater() {
  retryMs = Math.min(retryMs ? retryMs * 2 : 5000, 300000);
  clearTimeout(timer); timer = setTimeout(push, retryMs);
}

async function push() {
  clearTimeout(timer);
  if (paused) return;
  if (pushing) { again = true; return; }
  const raw = current();
  if (raw == null) return;
  if (raw === lastSynced) { if (meta.dirty) { meta.dirty = false; meta.dirtySince = null; saveMeta(); } setStatus('ok'); return; }
  pushing = true; setStatus('saving');
  try {
    const body = await gzip(raw);
    const headers = { 'Content-Type': 'application/json', 'If-Match': String(meta.base) };
    if (body) headers['Content-Encoding'] = 'gzip';
    const r = await api('PUT', '/api/state', { headers, body: body || raw });
    const b = await r.json().catch(() => ({}));
    if (r.ok) {
      meta.base = b.version; meta.syncedAt = Date.now(); lastSynced = raw; retryMs = 0; lastError = '';
      if (current() === raw) { meta.dirty = false; meta.dirtySince = null; setStatus('ok'); } else again = true;
      saveMeta();
    } else if (r.status === 409) {
      paused = true; setStatus('conflict'); openConflict({ version: b.version, updatedAt: b.updatedAt });
    } else if (r.status === 401) {
      paused = true; setStatus('auth'); relogin();
    } else {
      const msg = b.erro || 'O servidor respondeu ' + r.status + '.';
      if (msg !== lastError) APP.toast('Não foi possível sincronizar: ' + msg, 'erro');
      lastError = msg; setStatus('error', msg); retryLater();
    }
  } catch (e) {
    setStatus('offline'); retryLater();
  } finally {
    pushing = false;
    if (again && !paused) { again = false; pushSoon(300); }
  }
}

/* toda gravação do app passa por APP.save (APP.commit → APP.save) */
const _save = APP.save;
APP.save = function () {
  _save.apply(APP, arguments);
  if (!started) return;
  const raw = current();
  if (raw == null || raw === lastSynced) return;
  if (!meta.dirty) { meta.dirty = true; meta.dirtySince = Date.now(); saveMeta(); }
  if (!paused) pushSoon(1200);
};

/* ---------------- dados vindos do servidor ---------------- */
function applyServer(srv, rerender) {
  ls.set(KEY, srv.raw);
  lastSynced = srv.raw;
  Object.assign(meta, { base: srv.version, dirty: false, dirtySince: null, syncedAt: Date.now() }); saveMeta();
  if (rerender && started) { APP.load(); APP.render(); }
}

async function checkRemote() {
  if (!started || paused || pushing) return;
  if (document.querySelector('#modal-root.open')) return;   // não troca os dados com um formulário aberto
  let m;
  try {
    const r = await api('GET', '/api/state/meta');
    if (r.status === 401) { paused = true; setStatus('auth'); return relogin(); }
    if (!r.ok) return;
    m = await r.json();
  } catch (e) { setStatus('offline'); return; }
  if (meta.dirty) {
    if (m.version !== meta.base && m.version > 0) { paused = true; setStatus('conflict'); return openConflict(m); }
    return push();
  }
  if (status === 'offline' || status === 'error') setStatus('ok');
  if (!m.version || m.version === meta.base) return;
  try {
    const srv = await fetchState();
    if (!srv.version || meta.dirty || document.querySelector('#modal-root.open')) return;
    applyServer(srv, true);
    setStatus('ok');
    APP.toast('Dados atualizados com as alterações de outro aparelho.');
  } catch (e) { /* tenta na próxima */ }
}

/* ---------------- conflito ---------------- */
function openConflict(info) {
  paused = true; conflictInfo = info || conflictInfo || {};
  if (!started) return;
  const when = conflictInfo.updatedAt ? fmt(conflictInfo.updatedAt) : 'há pouco';
  const since = meta.dirtySince ? ' (desde ' + fmt(meta.dirtySince) + ')' : '';
  const m = APP.modal('Duas versões dos dados',
    '<p>Outro aparelho salvou uma versão em <b>' + when + '</b>, e este aparelho tem alterações que ainda não subiram' + since + '.</p>' +
    '<p class="muted small cf-note">Escolha qual versão fica. A outra é baixada como backup em JSON antes de ser descartada, e o servidor também guarda a versão substituída.</p>',
    { foot: '<button class="btn" id="cf-srv">Manter a do servidor</button><button class="btn primary" id="cf-loc">Manter a deste aparelho</button>' });
  m.querySelector('#cf-srv').addEventListener('click', () => resolveConflict('server'));
  m.querySelector('#cf-loc').addEventListener('click', () => resolveConflict('local'));
}

async function resolveConflict(which) {
  let srv;
  try { srv = await fetchState(); }
  catch (e) {
    if (e.auth) { APP.closeModal(); return relogin(); }
    return APP.toast('Sem conexão com o servidor. Tente de novo quando estiver online.', 'erro');
  }
  APP.closeModal();
  if (which === 'server' && srv.raw) {
    APP.download('financas-descartado-este-aparelho-' + stamp() + '.json', current() || '', 'application/json');
    paused = false; conflictInfo = null;
    applyServer(srv, true); setStatus('ok');
    APP.toast('Mantida a versão do servidor. A deste aparelho foi baixada como backup.');
    return;
  }
  if (srv.raw) APP.download('financas-descartado-servidor-v' + srv.version + '-' + stamp() + '.json', srv.raw, 'application/json');
  meta.base = srv.version || 0; saveMeta();
  paused = false; conflictInfo = null; lastSynced = null;
  await push();
  if (status === 'ok') APP.toast('Mantida a versão deste aparelho' + (srv.raw ? '. A do servidor foi baixada como backup.' : '.'));
}

/* ---------------- tela de acesso ---------------- */
function showGate(view) { gate.hidden = false; gate.dataset.view = view; }
function hideGate() { gate.hidden = true; }

let loginResolve = null;
function askLogin(msg) {
  return new Promise(res => {
    loginResolve = res;
    const f = $('#gate-login'), info = $('#gate-login-msg');
    info.hidden = !msg; info.textContent = msg || '';
    $('#gate-err').hidden = true;
    if (meta.email && !f.email.value) f.email.value = meta.email;
    showGate('login');
    setTimeout(() => (f.email.value ? f.senha : f.email).focus(), 30);
  });
}

$('#gate-login').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.currentTarget, btn = f.querySelector('button[type=submit]'), err = $('#gate-err');
  const email = f.email.value.trim(), senha = f.senha.value;
  err.hidden = true;
  if (!email || !senha) { err.textContent = 'Preencha e-mail e senha.'; err.hidden = false; return; }
  btn.disabled = true; btn.textContent = 'Entrando…';
  try {
    const r = await api('POST', '/auth/login', { json: { email, senha } });
    const b = await r.json().catch(() => ({}));
    if (!r.ok) { err.textContent = b.erro || 'Não foi possível entrar (erro ' + r.status + ').'; err.hidden = false; f.senha.select(); return; }
    f.senha.value = '';
    const done = loginResolve; loginResolve = null;
    if (done) done(b);
  } catch (e2) {
    err.textContent = 'Sem conexão com o servidor.'; err.hidden = false;
  } finally { btn.disabled = false; btn.textContent = 'Entrar'; }
});

function adoptUser(me) {
  if (meta.userId && meta.userId !== me.id) {   // outra conta neste aparelho: não mistura dados
    if (meta.dirty && ls.get(KEY)) APP.download('financas-nao-enviado-' + stamp() + '.json', ls.get(KEY), 'application/json');
    ls.del(KEY); meta = Object.assign({}, META0);
  }
  meta.userId = me.id; meta.email = me.email; saveMeta();
  $('#sync-email').textContent = me.email;
  $('#sync-logout').hidden = false;
}

async function relogin() {
  const me = await askLogin('Sua sessão expirou. Entre de novo para continuar sincronizando. O que está neste aparelho continua salvo.');
  if (me.id !== meta.userId) { adoptUser(me); location.reload(); return; }
  hideGate();
  paused = !!conflictInfo;
  if (conflictInfo) { setStatus('conflict'); openConflict(); } else push();
}

function startApp(st) {
  hideGate();
  if (!started) { started = true; APP.init(); bindLifecycle(); }
  setStatus(st);
}

/* primeiro uso: servidor sem dados */
function showInicio() {
  const local = ls.get(KEY), btn = $('#gate-local');
  btn.hidden = true;
  if (local) {
    try { const st = JSON.parse(local); btn.hidden = false; $('#gate-local-info').textContent = (st.lancamentos || []).length + ' lançamentos salvos aqui.'; }
    catch (e) { /* cópia local ilegível: não oferece */ }
  }
  showGate('inicio');
}
function begin(raw) {
  if (raw == null) ls.del(KEY); else ls.set(KEY, raw);
  lastSynced = null;
  Object.assign(meta, { base: 0, dirty: true, dirtySince: Date.now() }); saveMeta();
  startApp('saving');
  pushSoon(0);
}
$('#gate-zero').addEventListener('click', () => begin(JSON.stringify(DATA.defaultState(APP.todayIso()))));
$('#gate-demo').addEventListener('click', () => begin(null));   // APP.load gera o exemplo
$('#gate-local').addEventListener('click', () => begin(ls.get(KEY)));
$('#gate-import').addEventListener('change', e => {
  const file = e.target.files[0], err = $('#gate-inicio-err');
  if (!file) return;
  err.hidden = true;
  const r = new FileReader();
  r.onload = () => {
    try {
      const st = JSON.parse(r.result);
      if (!st || !Array.isArray(st.lancamentos) || !Array.isArray(st.contas) || !Array.isArray(st.categorias) || !st.config) throw new Error('o arquivo não parece um backup desta planilha');
      begin(r.result);
      APP.toast('Backup importado: ' + st.lancamentos.length + ' lançamentos.');
    } catch (x) { err.textContent = 'Não foi possível importar: ' + x.message + '.'; err.hidden = false; }
    e.target.value = '';
  };
  r.readAsText(file);
});
$('#gate-retry').addEventListener('click', () => boot());

/* ---------------- sair ---------------- */
$('#sync-logout').addEventListener('click', () => {
  const go = async () => {
    try { await api('POST', '/auth/logout', { json: {} }); } catch (e) { /* sem rede: a cópia local sai mesmo assim */ }
    ls.del(KEY); ls.del(UIKEY); ls.del(META);
    location.replace('/');
  };
  if (meta.dirty) APP.confirm('Há alterações que ainda não subiram para o servidor. Sair agora apaga essas alterações deste aparelho.', 'Sair mesmo assim', go, true);
  else APP.confirm('Sair neste aparelho? Os dados continuam no servidor; a cópia local é apagada.', 'Sair', go);
});

/* ---------------- ciclo de vida ---------------- */
function bindLifecycle() {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { if (meta.dirty && !paused) push(); }
    else checkRemote();
  });
  window.addEventListener('online', () => { retryMs = 0; if (meta.dirty && !paused) push(); else checkRemote(); });
  window.addEventListener('offline', () => { if (status !== 'conflict' && status !== 'auth') setStatus('offline'); });
  setInterval(() => { if (document.visibilityState === 'visible') checkRemote(); }, 60000);
  for (const el of $$('[data-sync-status]')) {
    el.addEventListener('click', () => {
      if (status === 'conflict') openConflict();
      else if (status === 'auth') relogin();
      else if (status === 'error' || status === 'offline' || status === 'pending') { retryMs = 0; push(); }
    });
  }
}

/* ---------------- service worker ---------------- */
let swDone = false;
function registerSW() {
  if (swDone || !('serviceWorker' in navigator)) return;
  swDone = true;
  let updating = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (updating) location.reload(); });
  navigator.serviceWorker.register('/sw.js').then(reg => {
    const offer = w => {
      $('#update-bar').hidden = false;
      $('#update-go').onclick = () => { updating = true; $('#update-go').disabled = true; w.postMessage({ type: 'SKIP_WAITING' }); };
    };
    if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      if (w) w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) offer(w); });
    });
    setInterval(() => reg.update().catch(() => {}), 3600000);
  }).catch(e => console.warn('Service worker não registrado:', e));
}

/* ---------------- início ---------------- */
async function boot() {
  registerSW();
  showGate('carregando');
  let me;
  try {
    const r = await api('GET', '/api/me');
    if (r.status === 401) me = await askLogin();
    else if (r.ok) me = await r.json();
    else throw new Error('HTTP ' + r.status);
  } catch (e) {
    // sem rede ou servidor fora do ar: abre com a cópia deste aparelho, se houver
    if (ls.get(KEY) && meta.userId) {
      lastSynced = meta.dirty ? null : ls.get(KEY);
      $('#sync-email').textContent = meta.email; $('#sync-logout').hidden = false;
      return startApp('offline');
    }
    return showGate('offline');
  }
  adoptUser(me);
  await initialSync();
}

async function initialSync() {
  let srv;
  try { srv = await fetchState(); }
  catch (e) {
    if (e.auth) { adoptUser(await askLogin('Sua sessão expirou. Entre de novo.')); return initialSync(); }
    if (ls.get(KEY)) { lastSynced = meta.dirty ? null : ls.get(KEY); return startApp('offline'); }
    return showGate('offline');
  }
  const local = ls.get(KEY);
  if (!srv.version) return showInicio();
  if (!local || !meta.dirty) { applyServer(srv, false); return startApp('ok'); }
  if (meta.base === srv.version) { startApp('saving'); return pushSoon(0); }   // alterações offline sobre a versão atual
  paused = true;                                                              // alterações offline e o servidor andou
  startApp('conflict');
  openConflict({ version: srv.version, updatedAt: srv.updatedAt });
}

boot();
})();
