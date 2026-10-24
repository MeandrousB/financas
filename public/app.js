/* Minhas finanças — interface (extraído do arquivo único; ver README) */
/* ==========================================================================
   Interface — núcleo: estado, persistência, navegação, gráficos, modais
   ========================================================================== */
(function () {
'use strict';
const KEY = 'financas-pf-pj-v1', UIKEY = 'financas-pf-pj-ui-v1';
const $ = (s, el) => (el || document).querySelector(s);
const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clone = o => JSON.parse(JSON.stringify(o));
const todayIso = () => FE.isoOf(new Date());

const APP = window.APP = { state: null, ctx: null, ui: null, charts: [], pages: {}, $, $$, esc, clone, todayIso };

/* ---------------- persistência ---------------- */
function migrate(s) {
  const d = DATA.defaultState(todayIso());
  for (const k in d) if (s[k] == null) s[k] = d[k];
  for (const k in d.config) if (s.config[k] == null) s.config[k] = d.config[k];
  s.config.pesosSaude = Object.assign({}, FE.PESOS_PADRAO, s.config.pesosSaude || {});
  s.patrimonio = Object.assign({ ativos: [], passivos: [], historico: [], incluirParcelas: true }, s.patrimonio || {});
  s.overrides = s.overrides || {}; s.faturas = s.faturas || {};
  s.carteira = Object.assign({ ativos: [], operacoes: [], cotacoes: {}, seq: 0 }, s.carteira || {});
  if (!s.carteira.cotacoes || Array.isArray(s.carteira.cotacoes)) s.carteira.cotacoes = {};
  // versões antigas: categorias 'PJ' compartilhadas viram categorias próprias de cada empresa
  if (s.categorias.some(c => c.escopo === 'PJ')) {
    const out = [];
    for (const c of s.categorias) {
      if (c.escopo !== 'PJ') { out.push(c); continue; }
      for (const n of ['C1', 'C2']) out.push(Object.assign(clone(c), { id: DATA.uid('cat'), escopo: n }));
    }
    s.categorias = out;
  }
  const VELHO = 'Aporte em consult' + 'ório', NOVO = 'Aporte em empresa';
  const ren = x => { if (x.categoria === VELHO) x.categoria = NOVO; };
  for (const c of s.categorias) if (c.nome === VELHO) c.nome = NOVO;
  s.lancamentos.forEach(ren); s.compromissos.forEach(ren); s.orcamentos.forEach(ren);
  return s;
}
APP.load = function () {
  let st = null;
  try { const raw = localStorage.getItem(KEY); if (raw) st = migrate(JSON.parse(raw)); } catch (e) { console.warn(e); }
  if (!st) st = DATA.demoState(todayIso());
  APP.state = st;
  let ui = {};
  try { ui = JSON.parse(localStorage.getItem(UIKEY) || '{}') || {}; } catch (e) { ui = {}; }
  APP.ui = Object.assign({ mes: FE.ym(todayIso()), nucleo: 'ALL', resp: 'ALL', regime: 'comp', lf: { mes: FE.ym(todayIso()), nucleo: 'ALL', tipo: 'ALL', status: 'ALL', q: '', auto: true }, projN: 12, projNucleo: 'ALL', orcNucleo: 'PF', lastNucleo: 'PF', lastResp: 'P1', cartaoSel: null, cadTab: 'PF|Despesa' }, ui);
  APP.ui.resp = 'ALL';   // uso individual: sem filtro por pessoa
  APP.recompute();
  APP.save();
};
APP.save = function () {
  try { localStorage.setItem(KEY, JSON.stringify(APP.state)); localStorage.setItem(UIKEY, JSON.stringify(APP.ui)); }
  catch (e) { APP.toast('Não foi possível salvar neste navegador: ' + e.message, 'erro'); }
};
APP.saveUI = function () { try { localStorage.setItem(UIKEY, JSON.stringify(APP.ui)); } catch (e) { /* ignora */ } };
APP.recompute = function () { APP.ctx = FE.makeCtx(APP.state, todayIso()); };
APP.commit = function (msg) {
  APP.snapshotPatrimonio();
  APP.recompute();
  APP.save();
  APP.render();
  if (msg) APP.toast(msg);
};
APP.snapshotPatrimonio = function () {
  const p = APP.state.patrimonio, mes = FE.ym(todayIso());
  const at = FE.r2(p.ativos.reduce((s, a) => s + (+a.valor || 0), 0)), pa = FE.r2(p.passivos.reduce((s, a) => s + (+a.valor || 0), 0));
  const h = p.historico.find(x => x.mes === mes);
  if (h) { h.ativos = at; h.passivos = pa; h.exemplo = false; } else if (at || pa) p.historico.push({ mes, ativos: at, passivos: pa });
};
APP.nextSeq = function () { APP.state.seq = (APP.state.seq || 0) + 1; return APP.state.seq; };
APP.uid = p => DATA.uid(p);

/* ---------------- nomes ---------------- */
APP.nomeN = n => FE.nomeN(APP.state, n);
APP.nomeNCurto = n => n === 'PF' ? 'PF' : n === 'C1' ? (FE.semPJ(APP.state.config.nomeC1) || 'Imobiliária') : n === 'C2' ? (FE.semPJ(APP.state.config.nomeC2) || 'Jurídico') : 'Consolidado';
APP.nomeResp = r => r === 'P1' ? APP.state.config.pessoa1 : r === 'P2' ? APP.state.config.pessoa2 : r === 'AMBOS' ? 'Ambos / Família' : r === 'NA' ? 'Não aplicável' : 'Todos';
APP.conta = id => APP.state.contas.find(c => c.id === id);
APP.cartao = id => APP.state.cartoes.find(c => c.id === id);
APP.nomeConta = id => { const c = APP.conta(id); return c ? c.nome + (c.instituicao ? ' (' + c.instituicao + ')' : '') : '—'; };
APP.nomeContaCurto = id => { const c = APP.conta(id); return c ? c.nome : '—'; };

/* ---------------- números ---------------- */
APP.parseValor = function (s) {
  if (typeof s === 'number') return s;
  s = String(s || '').replace(/[R$\s ]/g, '');
  if (!s) return NaN;
  const neg = s.startsWith('-'); s = s.replace(/^-/, '');
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else { const p = s.split('.'); if (p.length > 2 || (p.length === 2 && p[1].length === 3)) s = s.replace(/\./g, ''); }
  const v = parseFloat(s);
  return neg ? -v : v;
};
APP.fmtIn = v => { if (typeof v === 'string') v = APP.parseValor(v); return (v == null || v === '' || isNaN(v)) ? '' : (+v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
APP.sig = v => v > 0.004 ? 'pos' : v < -0.004 ? 'neg' : '';
APP.brlS = v => (v > 0.004 ? '+ ' : v < -0.004 ? '− ' : '') + FE.brl(Math.abs(v));

/* ---------------- ícones ---------------- */
const ICO = {
  ok: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  atencao: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.5l6 11H2z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M8 6.5v3.2M8 11.6v.1" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  alerta: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M8 4.8v3.8M8 11v.1" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
  info: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M8 7.2v4M8 4.9v.1" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  menu: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 5.5h14M3 10h14M3 14.5h14" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
  x: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
  plus: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
};
APP.ICO = ICO;
const NIVEL_LABEL = { ok: 'Bom', atencao: 'Atenção', alerta: 'Alerta', info: 'Informação' };
APP.badge = (nivel, texto) => '<span class="st st-' + nivel + '">' + (ICO[nivel] || '') + '<span>' + esc(texto || NIVEL_LABEL[nivel]) + '</span></span>';
APP.statusLanc = function (l) {
  if (l.tipo === 'Despesa' && l.forma === 'Cartão de crédito' && l.cartaoId) return { txt: 'No cartão', nivel: 'info' };
  const real = l.status === 'Pago' || l.status === 'Recebido';
  if (real) return { txt: l.status, nivel: 'ok' };
  const v = l.vencimento || l.data;
  if (v && v < todayIso()) return { txt: 'Atrasado', nivel: 'alerta' };
  return { txt: 'Pendente', nivel: 'atencao' };
};

/* ---------------- toast ---------------- */
APP.toast = function (msg, tipo) {
  const t = $('#toast'); if (!t) return;
  t.textContent = msg; t.className = 'toast show' + (tipo === 'erro' ? ' erro' : '');
  clearTimeout(APP._tt); APP._tt = setTimeout(() => { t.className = 'toast'; }, 3200);
};

/* ---------------- gráficos ---------------- */
const COL = APP.COL = { ent: '#1a8a5e', sai: '#3d6fbf', pos: '#1a8a5e', neg: '#c2413a', PF: '#6250d6', C1: '#eb6834', C2: '#1baf7a',
  fin: '#104281', fix: '#256abf', parc: '#5598e7', var: '#86b6ef', aporte: '#a3aaa5', grid: '#e8ebe6', axis: '#6b746f', ink: '#1c2420', saldo: '#2b4a3f' };
APP.destroyCharts = function () { for (const c of APP.charts) try { c.destroy(); } catch (e) { /* ignora */ } APP.charts = []; };
const compact = v => { const a = Math.abs(v); if (a >= 1e6) return 'R$ ' + (v / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' mi'; if (a >= 1000) return 'R$ ' + (v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: a >= 10000 ? 0 : 1 }) + ' mil'; return 'R$ ' + Math.round(v); };
APP.compact = compact;
APP.chart = function (id, type, data, opt) {
  const el = document.getElementById(id); if (!el) return null;
  if (!window.Chart) { el.parentElement.innerHTML = '<p class="muted small">Gráfico indisponível: a biblioteca de gráficos não carregou (verifique a conexão).</p>'; return null; }
  opt = opt || {};
  const pctAxis = opt.pct;
  const fmtV = v => pctAxis ? FE.pct(v) : FE.brl(v);
  const horizontal = opt.horizontal;
  const base = {
    responsive: true, maintainAspectRatio: false, animation: { duration: 250 },
    interaction: { mode: type === 'line' ? 'index' : 'nearest', intersect: type !== 'line', axis: horizontal ? 'y' : 'x' },
    indexAxis: horizontal ? 'y' : 'x',
    plugins: {
      legend: { display: opt.legend !== false && data.datasets.length > 1, position: 'bottom', align: 'start', labels: { boxWidth: 10, boxHeight: 10, usePointStyle: true, pointStyle: 'rectRounded', color: COL.axis, padding: 14, font: { size: 12 } } },
      tooltip: { backgroundColor: '#1c2420', titleColor: '#fff', bodyColor: '#e9ece8', padding: 10, cornerRadius: 6, displayColors: data.datasets.length > 1, boxWidth: 8, boxHeight: 8,
        callbacks: { label: c => (data.datasets.length > 1 ? c.dataset.label + ': ' : '') + fmtV(horizontal ? c.parsed.x : c.parsed.y) } },
    },
    scales: {},
  };
  const valAxis = { grid: { color: COL.grid, drawTicks: false }, border: { display: false }, ticks: { color: COL.axis, padding: 6, font: { size: 11 }, maxTicksLimit: 6, callback: v => pctAxis ? (v * 100).toLocaleString('pt-BR', { maximumFractionDigits: 0 }) + '%' : compact(v) } };
  const catAxis = { grid: { display: false }, border: { color: COL.grid }, ticks: { color: COL.axis, font: { size: 11 }, autoSkip: true, maxRotation: 0 } };
  if (opt.stacked) { valAxis.stacked = true; catAxis.stacked = true; }
  if (opt.min != null) valAxis.min = opt.min;
  base.scales[horizontal ? 'x' : 'y'] = valAxis;
  base.scales[horizontal ? 'y' : 'x'] = catAxis;
  const dflt = (ds, d) => { for (const k in d) if (ds[k] === undefined) ds[k] = d[k]; };
  for (const ds of data.datasets) {
    if (type === 'bar') dflt(ds, Object.assign({ borderRadius: opt.stacked ? 0 : 4, borderSkipped: 'start', maxBarThickness: 26, categoryPercentage: 0.72, barPercentage: 0.86 }, opt.stacked ? { borderColor: '#ffffff', borderWidth: { top: 2 } } : {}));
    if (type === 'line') dflt(ds, { borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, pointHitRadius: 12, tension: 0.25, spanGaps: true });
  }
  if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) base.animation = false;
  const c = new Chart(el, { type, data, options: base });
  APP.charts.push(c);
  return c;
};

/* ---------------- modais ---------------- */
APP.modal = function (title, bodyHtml, opts) {
  opts = opts || {};
  const root = $('#modal-root');
  root.innerHTML = '<div class="modal-back" data-close="1"></div><div class="modal' + (opts.wide ? ' wide' : '') + '" role="dialog" aria-modal="true" aria-labelledby="mt"><div class="modal-head"><h2 id="mt">' + esc(title) + '</h2><button class="icon-btn" data-close="1" aria-label="Fechar">' + ICO.x + '</button></div><div class="modal-body">' + bodyHtml + '</div>' + (opts.foot ? '<div class="modal-foot">' + opts.foot + '</div>' : '') + '</div>';
  root.classList.add('open');
  document.body.classList.add('modal-open');
  $$('[data-close]', root).forEach(b => b.addEventListener('click', APP.closeModal));
  setTimeout(() => { const f = $('.modal [autofocus], .modal input:not([type=hidden]), .modal select', root); if (f) f.focus(); }, 30);
  return $('.modal', root);
};
APP.closeModal = function () { const r = $('#modal-root'); r.classList.remove('open'); r.innerHTML = ''; document.body.classList.remove('modal-open'); };
APP.confirm = function (msg, okLabel, onOk, danger) {
  const m = APP.modal('Confirmar', '<p>' + msg + '</p>', { foot: '<button class="btn" data-close="1">Cancelar</button><button class="btn ' + (danger ? 'danger' : 'primary') + '" id="cf-ok">' + esc(okLabel) + '</button>' });
  $('#cf-ok', m.parentElement).addEventListener('click', () => { APP.closeModal(); onOk(); });
  $$('[data-close]', m).forEach(b => b.addEventListener('click', APP.closeModal));
};
document.addEventListener('keydown', e => { if (e.key === 'Escape' && $('#modal-root.open')) APP.closeModal(); });

/* ---------------- campos de formulário ---------------- */
APP.opt = (v, label, sel) => '<option value="' + esc(v) + '"' + (String(sel) === String(v) ? ' selected' : '') + '>' + esc(label) + '</option>';
APP.sel = (name, options, value, attrs) => '<select class="in" name="' + name + '" ' + (attrs || '') + '>' + options.map(o => Array.isArray(o) ? APP.opt(o[0], o[1], value) : APP.opt(o, o, value)).join('') + '</select>';
APP.fld = (label, html, opts) => { opts = opts || {}; return '<label class="fld' + (opts.cls ? ' ' + opts.cls : '') + '"><span class="fl">' + esc(label) + (opts.req ? ' <i class="req" aria-hidden="true">*</i>' : '') + '</span>' + html + (opts.help ? '<span class="help">' + opts.help + '</span>' : '') + '</label>'; };
APP.inp = (name, value, attrs) => '<input class="in" name="' + name + '" value="' + esc(value == null ? '' : value) + '" ' + (attrs || '') + '>';
APP.money = (name, value, attrs) => '<span class="money"><span class="cur">R$</span><input class="in" name="' + name + '" inputmode="decimal" autocomplete="off" value="' + esc(APP.fmtIn(value)) + '" ' + (attrs || '') + '></span>';
APP.seg = (name, options, value) => '<div class="seg" role="radiogroup">' + options.map(o => { const [v, l] = Array.isArray(o) ? o : [o, o]; return '<label class="seg-i' + (String(v) === String(value) ? ' on' : '') + '"><input type="radio" name="' + name + '" value="' + esc(v) + '"' + (String(v) === String(value) ? ' checked' : '') + '><span>' + esc(l) + '</span></label>'; }).join('') + '</div>';
APP.formData = function (el) {
  const o = {};
  $$('[name]', el).forEach(i => {
    if (i.type === 'radio') { if (i.checked) o[i.name] = i.value; }
    else if (i.type === 'checkbox') o[i.name] = i.checked;
    else o[i.name] = i.value;
  });
  return o;
};
APP.bindMoneyBlur = function (root) {
  $$('.money input', root).forEach(i => i.addEventListener('blur', () => { const v = APP.parseValor(i.value); if (!isNaN(v)) i.value = APP.fmtIn(v); }));
};
APP.respOptions = () => [['P1', APP.state.config.pessoa1], ['P2', APP.state.config.pessoa2], ['AMBOS', 'Ambos / Família'], ['NA', 'Não aplicável']];
APP.nucleoOptions = () => [['PF', 'PF (pessoal)'], ['C1', APP.nomeN('C1')], ['C2', APP.nomeN('C2')]];
APP.catsOf = (nucleo, tipo) => APP.state.categorias.filter(c => c.escopo === FE.scopeOf(nucleo) && c.tipo === tipo && !c.inativa);
APP.catObj = (nucleo, tipo, nome) => APP.state.categorias.find(c => c.escopo === FE.scopeOf(nucleo) && c.tipo === tipo && c.nome === nome);

/* ---------------- navegação ---------------- */
APP.PAGES = [
  { id: 'dashboard', nome: 'Dashboard', g: 'Visão geral' },
  { id: 'projecoes', nome: 'Projeções', g: 'Visão geral' },
  { id: 'analises', nome: 'Análises', g: 'Visão geral' },
  { id: 'recomendacoes', nome: 'Recomendações', g: 'Visão geral' },
  { id: 'lancamentos', nome: 'Lançamentos', g: 'Registro' },
  { id: 'compromissos', nome: 'Compromissos fixos', g: 'Registro' },
  { id: 'cartoes', nome: 'Cartões', g: 'Registro' },
  { id: 'contas', nome: 'Contas e saldos', g: 'Registro' },
  { id: 'investimentos', nome: 'Investimentos', g: 'Registro' },
  { id: 'orcamento', nome: 'Orçamento', g: 'Planejamento' },
  { id: 'metas', nome: 'Metas e objetivos', g: 'Planejamento' },
  { id: 'patrimonio', nome: 'Patrimônio', g: 'Planejamento' },
  { id: 'c1', nome: 'C1', g: 'Empresas (PJ)' },
  { id: 'c2', nome: 'C2', g: 'Empresas (PJ)' },
  { id: 'cadastros', nome: 'Cadastros', g: 'Configuração' },
  { id: 'metodologia', nome: 'Metodologia', g: 'Configuração' },
  { id: 'como-usar', nome: 'Como usar', g: 'Configuração' },
];
APP.page = () => { const h = (location.hash || '').replace('#', ''); return APP.PAGES.some(p => p.id === h) ? h : 'dashboard'; };
APP.go = id => { if (location.hash !== '#' + id) location.hash = id; else APP.render(); };
function navHtml() {
  const cur = APP.page(); let g = '', h = '';
  for (const p of APP.PAGES) {
    if (p.g !== g) { if (g) h += '</ul>'; g = p.g; h += '<p class="nav-g">' + esc(g) + '</p><ul>'; }
    const nome = p.id === 'c1' ? APP.nomeNCurto('C1') : p.id === 'c2' ? APP.nomeNCurto('C2') : p.nome;
    h += '<li><a href="#' + p.id + '"' + (p.id === cur ? ' aria-current="page" class="on"' : '') + '>' + esc(nome) + '</a></li>';
  }
  return h + '</ul>';
}
APP.renderNav = function () {
  $('#nav').innerHTML = navHtml();
  $('#brand-name').textContent = APP.state.config.nomeApp || 'Minhas finanças';
  const bs = $('#brand-sub'); if (bs) bs.textContent = 'PF, ' + APP.nomeNCurto('C1') + ' e ' + APP.nomeNCurto('C2');
};
APP.render = function () {
  APP.destroyCharts();
  APP.renderNav();
  const id = APP.page(), main = $('#main');
  const fn = APP.pages[id];
  let html = '';
  if (APP.temExemplos()) html += '<div class="demo-bar">' + ICO.info + '<p><strong>Você está vendo dados de exemplo.</strong> Eles mostram como a planilha funciona e podem ser apagados de uma vez, sem quebrar nada.</p><button class="btn sm" id="rm-demo">Remover exemplos e começar</button></div>';
  try { html += fn ? fn() : ''; }
  catch (e) { console.error(e); html += '<div class="panel"><p class="neg">Erro ao montar esta tela: ' + esc(e.message) + '</p></div>'; }
  main.innerHTML = html;
  main.scrollTop = 0;
  const after = APP.pages[id + ':after'];
  try { if (after) after(); } catch (e) { console.error(e); }
  const rd = $('#rm-demo'); if (rd) rd.addEventListener('click', APP.removerExemplos);
  document.body.classList.remove('nav-open');
  document.title = (APP.PAGES.find(p => p.id === id) || {}).nome + ' — ' + (APP.state.config.nomeApp || 'Minhas finanças');
  if (id === 'c1' || id === 'c2') document.title = APP.nomeN(id.toUpperCase()) + ' — ' + (APP.state.config.nomeApp || 'Minhas finanças');
};
APP.temExemplos = () => { const s = APP.state; return (s.carteira && s.carteira.ativos.some(x => x.exemplo)) || s.lancamentos.some(x => x.exemplo) || s.compromissos.some(x => x.exemplo) || s.contas.some(x => x.exemplo) || s.cartoes.some(x => x.exemplo); };
APP.removerExemplos = function () {
  APP.confirm('Apagar todos os registros de exemplo (lançamentos, compromissos, contas, cartões, orçamento, metas e patrimônio de demonstração)? Suas categorias e configurações continuam.', 'Apagar exemplos', () => {
    const s = APP.state, keep = x => !x.exemplo;
    s.lancamentos = s.lancamentos.filter(keep); s.compromissos = s.compromissos.filter(keep);
    // contas e cartões de exemplo que já recebem registros reais ficam (e deixam de ser exemplo)
    const usados = new Set();
    const cartR = s.carteira, keepAt = new Set(cartR.ativos.filter(keep).map(a => a.id));
    cartR.operacoes = cartR.operacoes.filter(o => keep(o) && keepAt.has(o.ativoId));
    for (const id of Object.keys(cartR.cotacoes)) { if (!keepAt.has(id)) delete cartR.cotacoes[id]; else cartR.cotacoes[id] = cartR.cotacoes[id].filter(keep); }
    cartR.ativos = cartR.ativos.filter(a => keepAt.has(a.id));
    for (const o of cartR.operacoes) if (o.contaId) usados.add(o.contaId);
    for (const x of s.lancamentos.concat(s.compromissos)) { if (x.contaId) usados.add(x.contaId); if (x.contaDestinoId) usados.add(x.contaDestinoId); if (x.cartaoId) usados.add(x.cartaoId); }
    for (const k of s.cartoes) if (usados.has(k.id) && k.contaId) usados.add(k.contaId);
    for (const x of s.contas.concat(s.cartoes)) if (x.exemplo && usados.has(x.id)) x.exemplo = false;
    const compIds = new Set(), cardIds = new Set(s.cartoes.filter(x => x.exemplo).map(x => x.id));
    for (const k of Object.keys(s.overrides)) if (!s.compromissos.some(c => c.id === k.split('|')[0])) compIds.add(k.split('|')[0]);
    s.contas = s.contas.filter(keep); s.cartoes = s.cartoes.filter(keep); s.orcamentos = s.orcamentos.filter(keep); s.metas = s.metas.filter(keep);
    s.patrimonio.ativos = s.patrimonio.ativos.filter(keep); s.patrimonio.passivos = s.patrimonio.passivos.filter(keep); s.patrimonio.historico = s.patrimonio.historico.filter(keep);
    for (const k of Object.keys(s.overrides)) if (compIds.has(k.split('|')[0])) delete s.overrides[k];
    for (const k of Object.keys(s.faturas)) if (cardIds.has(k.split('|')[0])) delete s.faturas[k];
    s.temExemplos = false;
    const cur = FE.ym(todayIso());
    s.config.inicioControle = s.lancamentos.length ? s.lancamentos.map(l => l.competencia || FE.ym(l.data)).sort()[0] : cur;
    APP.ui.mes = cur; APP.ui.lf.mes = cur;
    APP.commit('Exemplos removidos. Comece cadastrando suas contas.');
    APP.go('contas');
  }, true);
};

/* ---------------- filtros globais ---------------- */
APP.anosDisponiveis = function () {
  const first = FE.primeiroMes(APP.state, APP.ctx.ledger), cur = APP.ctx.curM;
  const y0 = Math.min(+first.slice(0, 4), +cur.slice(0, 4)), y1 = +cur.slice(0, 4) + 2;
  const out = []; for (let y = y0; y <= y1; y++) out.push(String(y)); return out;
};
APP.filtroMes = function (key) {
  key = key || 'mes';
  const m = APP.ui[key] || APP.ctx.curM;
  return '<div class="filt-mes"><button class="icon-btn" data-mstep="-1" data-mkey="' + key + '" aria-label="Mês anterior">‹</button>' +
    '<select class="in" data-f="mesNum" data-mkey="' + key + '" aria-label="Mês">' + FE.MESES.map((n, i) => APP.opt(FE.pad(i + 1), n[0].toUpperCase() + n.slice(1), m.slice(5, 7))).join('') + '</select>' +
    '<select class="in" data-f="ano" data-mkey="' + key + '" aria-label="Ano">' + APP.anosDisponiveis().map(y => APP.opt(y, y, m.slice(0, 4))).join('') + '</select>' +
    '<button class="icon-btn" data-mstep="1" data-mkey="' + key + '" aria-label="Próximo mês">›</button>' +
    (m !== APP.ctx.curM ? '<button class="btn sm ghost" data-mhoje="' + key + '">Mês atual</button>' : '') + '</div>';
};
APP.filtroNucleo = function (key, comAll) {
  const v = APP.ui[key] || 'ALL';
  const opts = (comAll === false ? [] : [['ALL', 'Consolidado']]).concat([['PF', 'PF'], ['C1', APP.nomeNCurto('C1')], ['C2', APP.nomeNCurto('C2')]]);
  return '<div class="seg seg-f" role="radiogroup" aria-label="Núcleo">' + opts.map(([k, l]) => '<button type="button" class="seg-i' + (k === v ? ' on' : '') + '" data-fset="' + key + '" data-v="' + k + '">' + esc(l) + '</button>').join('') + '</div>';
};
APP.filtroResp = function (key) {
  const v = APP.ui[key] || 'ALL';
  return '<select class="in" data-fsel="' + key + '" aria-label="Pessoa">' + [['ALL', 'Todas as pessoas'], ['P1', APP.state.config.pessoa1], ['P2', APP.state.config.pessoa2], ['AMBOS', 'Família (ambos)']].map(([k, l]) => APP.opt(k, l, v)).join('') + '</select>';
};
APP.filtroRegime = function () {
  const v = APP.ui.regime;
  return '<div class="seg seg-f" role="radiogroup" aria-label="Regime"><button type="button" class="seg-i' + (v === 'comp' ? ' on' : '') + '" data-fset="regime" data-v="comp" title="Tudo que pertence ao mês, pago ou a pagar">Competência</button><button type="button" class="seg-i' + (v === 'caixa' ? ' on' : '') + '" data-fset="regime" data-v="caixa" title="Só o que já foi pago ou recebido, na data do pagamento">Caixa</button></div>';
};
document.addEventListener('click', e => {
  const b = e.target.closest('[data-mstep]');
  if (b) { const k = b.dataset.mkey; APP.ui[k] = FE.addM(APP.ui[k] || APP.ctx.curM, +b.dataset.mstep); APP.saveUI(); APP.render(); return; }
  const h = e.target.closest('[data-mhoje]');
  if (h) { APP.ui[h.dataset.mhoje] = APP.ctx.curM; APP.saveUI(); APP.render(); return; }
  const s = e.target.closest('[data-fset]');
  if (s) { APP.ui[s.dataset.fset] = s.dataset.v; APP.saveUI(); APP.render(); return; }
  const g = e.target.closest('[data-go]');
  if (g) { e.preventDefault(); APP.go(g.dataset.go); return; }
});
document.addEventListener('change', e => {
  const t = e.target;
  if (t.dataset && (t.dataset.f === 'mesNum' || t.dataset.f === 'ano')) {
    const k = t.dataset.mkey, m = APP.ui[k] || APP.ctx.curM;
    APP.ui[k] = t.dataset.f === 'ano' ? t.value + m.slice(4) : m.slice(0, 5) + t.value;
    APP.saveUI(); APP.render();
  } else if (t.dataset && t.dataset.fsel) { APP.ui[t.dataset.fsel] = t.value; APP.saveUI(); APP.render(); }
});

/* ---------------- exportação ---------------- */
APP.download = function (name, content, mime) {
  const blob = new Blob([content], { type: mime || 'application/octet-stream' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
};
APP.exportJSON = () => APP.download('financas-backup-' + todayIso() + '.json', JSON.stringify(APP.state, null, 1), 'application/json');
APP.exportCSV = function () {
  const s = APP.state, n = v => String(FE.r2(v)).replace('.', ',');
  const q = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  const head = ['ID', 'Data', 'Competência', 'Tipo', 'Núcleo', 'Categoria', 'Subcategoria', 'Descrição', 'Conta', 'Conta destino', 'Forma de pagamento', 'Cartão', 'Parcelas', 'Valor', 'Vencimento', 'Data de pagamento', 'Status', 'Observações', 'Exemplo'];
  const rows = s.lancamentos.slice().sort((a, b) => (a.data < b.data ? -1 : 1)).map(l => [
    'L-' + String(l.seq || 0).padStart(5, '0'), FE.dataBR(l.data), l.competencia, l.tipo, APP.nomeN(l.nucleo), l.categoria, l.subcategoria, l.descricao,
    APP.nomeContaCurto(l.contaId), l.contaDestinoId ? APP.nomeContaCurto(l.contaDestinoId) : '', l.forma, l.cartaoId ? (APP.cartao(l.cartaoId) || {}).nome : '', l.parcelas || '',
    n(l.valor), FE.dataBR(l.vencimento), FE.dataBR(l.dataPagamento), APP.statusLanc(l).txt, l.obs, l.exemplo ? 'sim' : '']);
  const csv = '﻿' + [head].concat(rows).map(r => r.map(q).join(';')).join('\r\n');
  APP.download('lancamentos-' + todayIso() + '.csv', csv, 'text/csv;charset=utf-8');
};
APP.importJSON = function (file) {
  const r = new FileReader();
  r.onload = () => {
    try {
      const st = JSON.parse(r.result);
      if (!st || !Array.isArray(st.lancamentos) || !Array.isArray(st.contas) || !st.config) throw new Error('arquivo não parece um backup desta planilha');
      APP.confirm('Substituir todos os dados atuais pelo backup "' + esc(file.name) + '" (' + st.lancamentos.length + ' lançamentos)?', 'Substituir dados', () => {
        APP.state = migrate(st); APP.commit('Backup importado.');
      }, true);
    } catch (e) { APP.toast('Não foi possível importar: ' + e.message, 'erro'); }
  };
  r.readAsText(file);
};

/* ---------------- inicialização ---------------- */
APP.init = function () {
  APP.load();
  if (window.Chart) {
    Chart.defaults.font.family = "'IBM Plex Sans', system-ui, sans-serif";
    Chart.defaults.color = COL.axis;
  }
  window.addEventListener('hashchange', APP.render);
  $('#menu-btn').addEventListener('click', () => document.body.classList.toggle('nav-open'));
  $('#nav-back').addEventListener('click', () => document.body.classList.remove('nav-open'));
  $('#fab').addEventListener('click', () => APP.openLancamento(null));
  APP.render();
};
})();

/* ==========================================================================
   Interface — formulários (modais)
   ========================================================================== */
(function () {
'use strict';
const A = window.APP, { $, $$, esc, clone } = A;

/* ---------------- LANÇAMENTO ---------------- */
A.openLancamento = function (orig, preset) {
  const s = A.state, today = A.todayIso();
  const editing = orig && !(preset && preset.dup);
  let f = orig ? clone(orig) : { tipo: 'Despesa', data: today, nucleo: A.ui.lastNucleo || 'PF', responsavel: 'P1', forma: 'PIX', parcelas: 1 };
  if (preset) Object.assign(f, preset);
  if (preset && preset.dup) { delete f.id; delete f.seq; f.data = today; f.status = ''; f.competencia = ''; f.dataPagamento = ''; f.vencimento = ''; delete f.exemplo; }
  if (!f.status) f.status = '';
  f._statusAuto = !f.status;
  if (f.tipo === 'Transferência' && editing) f._contraparte = null;

  const contasOf = n => s.contas.filter(c => !n || c.nucleo === n);
  const contaOpts = (list, val, vazio) => (vazio ? [['', vazio]] : []).concat(list.map(c => [c.id, c.nome + ' (' + A.nomeNCurto(c.nucleo) + ')']));
  const statusOpts = t => t === 'Receita' ? [['Recebido', 'Recebido'], ['Pendente', 'Pendente (a receber)']] : [['Pago', t === 'Despesa' ? 'Pago' : 'Feito'], ['Pendente', t === 'Despesa' ? 'Pendente (a pagar)' : 'Agendado']];
  const autoStatus = () => (f.data <= today ? (f.tipo === 'Receita' ? 'Recebido' : 'Pago') : 'Pendente');

  function body() {
    if (f._statusAuto) f.status = autoStatus();
    if (f.tipo === 'Receita' && f.status === 'Pago') f.status = 'Recebido';
    if (f.tipo !== 'Receita' && f.status === 'Recebido') f.status = 'Pago';
    const T = f.tipo;
    let h = '<form class="form" id="lf" novalidate>';
    h += '<div class="tipo-tabs">' + A.seg('tipo', ['Despesa', 'Receita', 'Transferência', 'Investimento'], T) + '</div>';
    h += '<div class="grid2">' + A.fld('Valor', A.money('valor', f.valor, 'required placeholder="0,00"'), { req: 1 }) + A.fld('Data', A.inp('data', f.data, 'type="date" required'), { req: 1 }) + '</div>';
    if (T === 'Receita' || T === 'Despesa') {
      const cats = A.catsOf(f.nucleo, T);
      if (!cats.some(c => c.nome === f.categoria)) f.categoria = (cats[0] || {}).nome || '';
      const cat = cats.find(c => c.nome === f.categoria) || { subs: [] };
      if (!cat.subs.some(x => x.nome === f.subcategoria)) f.subcategoria = (cat.subs[0] || {}).nome || '';
      h += A.fld('Núcleo', A.seg('nucleo', A.nucleoOptions(), f.nucleo));
      h += '<div class="grid2">' + A.fld('Categoria', A.sel('categoria', cats.map(c => c.nome), f.categoria)) + A.fld('Subcategoria', A.sel('subcategoria', cat.subs.map(x => x.nome), f.subcategoria)) + '</div>';
      h += A.fld('Descrição', A.inp('descricao', f.descricao, 'placeholder="Ex.: ' + (T === 'Receita' ? 'Consultas da semana' : 'Supermercado') + '" maxlength="120"'));
      if (cat.transfer) {
        const outros = s.contas.filter(c => (f.nucleo === 'PF') ? c.nucleo !== 'PF' : c.nucleo === 'PF');
        if (f._contraparte == null) f._contraparte = (outros[0] || {}).id || 'EXT';
        const ext = f.nucleo === 'PF' && T === 'Receita' ? [['EXT', 'Outra empresa (fora da planilha)']] : [];
        const lbl = T === 'Receita' ? 'Veio de qual conta?' : 'Foi para qual conta?';
        h += '<div class="note">' + A.ICO.info + '<p>' + (f.nucleo === 'PF' ? 'Pró-labore, lucros e aportes entre a PF e as empresas são <strong>transferências</strong>: entram como renda na PF e como saída na empresa, mas não contam em dobro na visão consolidada.' : 'Pagamentos da empresa para a PF (pró-labore, lucros, retiradas) e aportes da PF são <strong>transferências</strong>: não contam em dobro na visão consolidada.') + '</p></div>';
        h += '<div class="grid2">' + A.fld(T === 'Receita' ? 'Conta que recebeu' : 'Conta que pagou', A.sel('contaId', contaOpts(contasOf(f.nucleo), f.contaId, contasOf(f.nucleo).length ? null : 'Cadastre uma conta'), f.contaId)) + A.fld(lbl, A.sel('_contraparte', ext.concat(contaOpts(outros)), f._contraparte)) + '</div>';
      } else {
        h += '<div class="grid2">' + A.fld('Forma de pagamento', A.sel('forma', (s.config.formas || []).filter(x => T === 'Despesa' || x !== 'Cartão de crédito'), f.forma));
        if (T === 'Despesa' && f.forma === 'Cartão de crédito') {
          const cards = s.cartoes;
          if (!cards.some(c => c.id === f.cartaoId)) f.cartaoId = (cards.find(c => c.nucleo === f.nucleo) || cards[0] || {}).id;
          h += A.fld('Cartão', cards.length ? A.sel('cartaoId', cards.map(c => [c.id, c.nome + ' (' + A.nomeNCurto(c.nucleo) + ')']), f.cartaoId) : '<p class="muted small">Nenhum cartão cadastrado. <a href="#cartoes" data-close="1">Cadastrar cartão</a></p>') + '</div>';
          h += '<div class="grid2">' + A.fld('Parcelas', A.inp('parcelas', f.parcelas || 1, 'type="number" min="1" max="72" step="1"'), { help: parcHelp() }) + '<div></div></div>';
        } else {
          const list = contasOf(f.nucleo).length ? contasOf(f.nucleo) : s.contas;
          if (!list.some(c => c.id === f.contaId)) f.contaId = (list[0] || {}).id || '';
          h += A.fld(T === 'Receita' ? 'Conta que recebeu' : 'Conta que pagou', list.length ? A.sel('contaId', contaOpts(s.contas, f.contaId), f.contaId) : '<p class="muted small">Nenhuma conta cadastrada. <a href="#contas" data-close="1">Cadastrar conta</a></p>', { help: mixHelp() }) + '</div>';
        }
      }
      if (!(f.forma === 'Cartão de crédito' && T === 'Despesa' && !cat.transfer)) h += '<div class="grid2">' + A.fld('Situação', A.sel('status', statusOpts(T), f.status)) + '<div></div></div>';
    } else if (T === 'Transferência') {
      if (!s.contas.some(c => c.id === f.contaId)) f.contaId = (s.contas[0] || {}).id;
      if (!s.contas.some(c => c.id === f.contaDestinoId) || f.contaDestinoId === f.contaId) f.contaDestinoId = (s.contas.find(c => c.id !== f.contaId) || {}).id;
      const co = A.conta(f.contaId), cd = A.conta(f.contaDestinoId);
      h += '<div class="grid2">' + A.fld('Saiu da conta', A.sel('contaId', contaOpts(s.contas), f.contaId)) + A.fld('Entrou na conta', A.sel('contaDestinoId', contaOpts(s.contas), f.contaDestinoId)) + '</div>';
      if (co && cd) {
        const fPJ = co.nucleo !== 'PF', tPJ = cd.nucleo !== 'PF';
        if (fPJ && !tPJ) {
          if (!['Pró-labore', 'Distribuição de lucros', 'Retirada pessoal / Sócio'].includes(f.categoria)) f.categoria = 'Distribuição de lucros';
          h += A.fld('Da empresa para a PF — o que é?', A.seg('categoria', [['Pró-labore', 'Pró-labore'], ['Distribuição de lucros', 'Distribuição de lucros'], ['Retirada pessoal / Sócio', 'Retirada pessoal']], f.categoria), { help: 'Pró-labore conta como custo da empresa. Lucros e retiradas saem depois do resultado.' });
        } else {
          f.categoria = FE.canonKind(co.nucleo, cd.nucleo, f.categoria);
          h += '<p class="classif">Classificação automática: <strong>' + esc(f.categoria) + '</strong>' + (f.categoria === 'Entre contas' ? ' — não altera receitas nem despesas.' : f.categoria === 'Aporte do sócio' ? ' — sai da PF como aporte; na empresa não vira receita.' : ' — movimento entre empresas, eliminado no consolidado.') + (FE.isInvAcc(cd) && !FE.isInvAcc(co) ? ' Como o destino é uma conta de reserva/investimento, conta como valor poupado.' : '') + '</p>';
        }
      }
      h += A.fld('Descrição', A.inp('descricao', f.descricao, 'maxlength="120" placeholder="Ex.: Pró-labore de outubro"'));
      h += '<div class="grid2">' + A.fld('Situação', A.sel('status', statusOpts('Transferência'), f.status)) + '<div></div></div>';
    } else {
      if (!['Aplicação', 'Resgate'].includes(f.categoria)) f.categoria = 'Aplicação';
      const inv = s.contas.filter(FE.isInvAcc), corr = s.contas.filter(c => !FE.isInvAcc(c));
      const ap = f.categoria === 'Aplicação';
      const oList = ap ? corr : inv, dList = ap ? inv : corr;
      if (!oList.some(c => c.id === f.contaId)) f.contaId = (oList[0] || {}).id || '';
      if (!dList.some(c => c.id === f.contaDestinoId)) f.contaDestinoId = (dList[0] || {}).id || '';
      h += A.fld('Operação', A.seg('categoria', [['Aplicação', 'Aplicar (guardar)'], ['Resgate', 'Resgatar']], f.categoria));
      h += '<div class="grid2">' + A.fld('Saiu da conta', A.sel('contaId', contaOpts(oList, f.contaId, oList.length ? null : '—'), f.contaId)) + A.fld('Entrou na conta', A.sel('contaDestinoId', contaOpts(dList, f.contaDestinoId, dList.length ? null : 'Cadastre uma conta de investimento'), f.contaDestinoId)) + '</div>';
      h += '<div class="grid2">' + A.fld('Finalidade', A.sel('subcategoria', s.config.invSubs, f.subcategoria)) + '<div></div></div>';
      h += A.fld('Descrição', A.inp('descricao', f.descricao, 'maxlength="120" placeholder="Ex.: Aplicação mensal"'));
      h += '<input type="hidden" name="status" value="' + esc(f.status) + '">';
    }
    // detalhes
    const abertos = f.competencia || f.vencimento || f.dataPagamento || f.obs || f.natureza;
    h += '<details class="more"' + (abertos ? ' open' : '') + '><summary>Mais detalhes (competência, vencimento, observações)</summary><div class="more-in">';
    h += '<div class="grid3">' + A.fld('Competência (mês)', A.inp('competencia', f.competencia || '', 'type="month"'), { help: 'Mês a que o valor pertence. Vazio = mês da data.' }) +
      A.fld('Vencimento', A.inp('vencimento', f.vencimento || '', 'type="date"')) + A.fld('Data de pagamento', A.inp('dataPagamento', f.dataPagamento || '', 'type="date"'), { help: 'Vazio = a própria data.' }) + '</div>';
    if (T === 'Despesa') h += A.fld('Natureza do gasto', A.sel('natureza', [['', 'Automática (pela subcategoria)'], ['Fixa', 'Custo fixo'], ['Variável', 'Variável'], ['Parcela', 'Parcelamento'], ['Financiamento', 'Financiamento / dívida']], f.natureza || ''));
    h += A.fld('Observações', '<textarea class="in" name="obs" rows="2" maxlength="400">' + esc(f.obs || '') + '</textarea>');
    h += '</div></details></form>';
    return h;
  }
  function parcHelp() {
    const n = Math.max(1, +f.parcelas || 1), v = A.parseValor(f.valor);
    if (n <= 1) return 'À vista no cartão.';
    return isNaN(v) ? n + ' parcelas — informe o valor total da compra.' : n + 'x de ' + FE.brl(v / n) + ' — cada parcela entra num mês; nunca o total de uma vez.';
  }
  function mixHelp() {
    const c = A.conta(f.contaId);
    if (c && c.nucleo !== f.nucleo) return '<span class="warn-t">Conta de outro núcleo: vai ser registrado como ' + (f.nucleo === 'PF' ? 'retirada pessoal da empresa' : 'aporte da PF na empresa') + '.</span>';
    return '';
  }
  const foot = (editing ? '<button class="btn danger ghost" id="lf-del">Excluir</button><span class="sp"></span>' : '<span class="sp"></span>') +
    '<button class="btn" data-close="1">Cancelar</button>' + (editing ? '' : '<button class="btn" id="lf-more">Salvar e lançar outro</button>') + '<button class="btn primary" id="lf-save">Salvar</button>';
  const m = A.modal(editing ? 'Editar lançamento' + (orig.seq ? ' L-' + String(orig.seq).padStart(5, '0') : '') : 'Novo lançamento', body(), { foot });
  const root = m.parentElement;
  let painting = false;
  function paint() { if (painting) return; painting = true; try { const fm = $('#lf', root); if (fm && fm.isConnected) { fm.outerHTML = body(); bind(); } } finally { painting = false; } }
  function read() {
    const d = A.formData($('#lf', root));
    for (const k in d) f[k] = d[k];
  }
  function bind() {
    const fm = $('#lf', root);
    A.bindMoneyBlur(fm);
    fm.addEventListener('change', e => {
      if (painting || !fm.isConnected) return;
      const n = e.target.name;
      read();
      if (n === 'status') f._statusAuto = false;
      if (n === 'tipo') { f.categoria = ''; f.subcategoria = ''; f._contraparte = null; if (f.tipo === 'Receita' && f.forma === 'Cartão de crédito') f.forma = 'PIX'; }
      if (n === 'nucleo') { f.categoria = ''; f.subcategoria = ''; f._contraparte = null; f.contaId = ''; f.cartaoId = ''; if (f.nucleo !== 'PF' && f.responsavel === 'AMBOS') f.responsavel = 'NA'; }
      if (n === 'categoria') { f.subcategoria = ''; f._contraparte = null; }
      if (['tipo', 'nucleo', 'categoria', 'forma', 'contaId', 'contaDestinoId', 'cartaoId', 'data', 'parcelas', '_contraparte'].includes(n)) paint();
    });
    $$('input[name=valor], input[name=parcelas]', fm).forEach(i => i.addEventListener('input', () => { read(); const hp = i.name === 'parcelas' ? i.closest('.fld').querySelector('.help') : $('input[name=parcelas]', fm) && $('input[name=parcelas]', fm).closest('.fld').querySelector('.help'); if (hp) hp.textContent = parcHelp(); }));
    fm.addEventListener('submit', e => { e.preventDefault(); save(false); });
  }
  bind();
  function save(again) {
    read();
    const v = A.parseValor(f.valor);
    if (!(v > 0)) return A.toast('Informe um valor maior que zero.', 'erro');
    if (!f.data) return A.toast('Informe a data.', 'erro');
    const out = { id: editing ? orig.id : A.uid('l'), seq: editing ? orig.seq : A.nextSeq(), criadoEm: editing ? orig.criadoEm : A.todayIso(),
      tipo: f.tipo, data: f.data, competencia: f.competencia || FE.ym(f.data), nucleo: f.nucleo, responsavel: f.responsavel || 'NA',
      categoria: f.categoria, subcategoria: f.subcategoria || '', descricao: (f.descricao || '').trim(), valor: FE.r2(v),
      vencimento: f.vencimento || '', dataPagamento: f.dataPagamento || '', status: f.status, obs: (f.obs || '').trim(), natureza: f.natureza || '' };
    if (editing && orig.exemplo) out.exemplo = true;
    if (f.tipo === 'Receita' || f.tipo === 'Despesa') {
      const cat = A.catObj(f.nucleo, f.tipo, f.categoria);
      if (cat && cat.transfer && f._contraparte && f._contraparte !== 'EXT') {
        if (!f.contaId) return A.toast('Escolha a conta.', 'erro');
        const a = f.contaId, b = f._contraparte;
        Object.assign(out, { tipo: 'Transferência', contaId: f.tipo === 'Despesa' ? a : b, contaDestinoId: f.tipo === 'Despesa' ? b : a, categoria: cat.transfer, forma: 'Transferência bancária' });
        out.nucleo = (A.conta(out.contaId) || {}).nucleo || f.nucleo;
        if (out.status === 'Recebido') out.status = 'Pago';
      } else if (f.tipo === 'Despesa' && f.forma === 'Cartão de crédito') {
        if (!f.cartaoId) return A.toast('Cadastre ou escolha um cartão.', 'erro');
        Object.assign(out, { forma: f.forma, cartaoId: f.cartaoId, parcelas: Math.max(1, Math.round(+f.parcelas || 1)), contaId: '', status: 'Pago' });
      } else {
        if (!f.contaId) return A.toast('Escolha a conta (cadastre uma em Contas e saldos).', 'erro');
        Object.assign(out, { forma: f.forma, contaId: f.contaId });
      }
    } else {
      if (!f.contaId) return A.toast('Escolha a conta de origem.', 'erro');
      if (f.tipo === 'Transferência' && (!f.contaDestinoId || f.contaDestinoId === f.contaId)) return A.toast('Escolha uma conta de destino diferente da origem.', 'erro');
      Object.assign(out, { contaId: f.contaId, contaDestinoId: f.contaDestinoId || '', forma: 'Transferência bancária', nucleo: (A.conta(f.contaId) || {}).nucleo || 'PF' });
      if (out.status === 'Recebido') out.status = 'Pago';
      if (!out.status) out.status = autoStatus();
    }
    const arr = A.state.lancamentos;
    if (editing) arr[arr.findIndex(x => x.id === orig.id)] = out; else arr.push(out);
    if (f.nucleo) A.ui.lastNucleo = f.nucleo;
    if (f.responsavel) A.ui.lastResp = f.responsavel;
    if (out.data < (A.state.config.inicioControle + '-01')) A.state.config.inicioControle = FE.ym(out.data);
    A.closeModal();
    A.commit(editing ? 'Lançamento atualizado.' : 'Lançamento salvo: ' + FE.brl(out.valor) + '.');
    if (again) A.openLancamento(null, { tipo: f.tipo, nucleo: f.nucleo, responsavel: f.responsavel, categoria: f.categoria, subcategoria: f.subcategoria, forma: f.forma, contaId: f.contaId, cartaoId: f.cartaoId, data: f.data });
  }
  $('#lf-save', root).addEventListener('click', () => save(false));
  const more = $('#lf-more', root); if (more) more.addEventListener('click', () => save(true));
  const del = $('#lf-del', root);
  if (del) del.addEventListener('click', () => A.confirm('Excluir este lançamento de ' + FE.brl(orig.valor) + '?' + (orig.parcelas > 1 ? ' Todas as ' + orig.parcelas + ' parcelas saem junto.' : ''), 'Excluir', () => {
    A.state.lancamentos = A.state.lancamentos.filter(x => x.id !== orig.id); A.commit('Lançamento excluído.');
  }, true));
};
A.marcarPago = function (id) {
  const l = A.state.lancamentos.find(x => x.id === id); if (!l) return;
  l.status = l.tipo === 'Receita' ? 'Recebido' : 'Pago';
  if (!l.dataPagamento) l.dataPagamento = A.todayIso() < l.data ? l.data : A.todayIso();
  A.commit((l.tipo === 'Receita' ? 'Recebimento' : 'Pagamento') + ' registrado.');
};

/* ---------------- COMPROMISSO ---------------- */
A.openCompromisso = function (orig) {
  const s = A.state, editing = !!orig;
  let f = orig ? clone(orig) : { tipo: 'Despesa', nucleo: 'PF', responsavel: 'P1', recorrencia: 'Permanente', semFim: true, inicio: A.todayIso(), parcelas: 12 };
  f._pg = f.cartaoId ? 'k:' + f.cartaoId : (f.contaId ? 'c:' + f.contaId : '');
  function body() {
    const T = f.tipo || 'Despesa';
    const cats = A.catsOf(f.nucleo, T);
    if (!cats.some(c => c.nome === f.categoria)) f.categoria = (cats[0] || {}).nome || '';
    const cat = cats.find(c => c.nome === f.categoria) || { subs: [] };
    if (!cat.subs.some(x => x.nome === f.subcategoria)) f.subcategoria = (cat.subs[0] || {}).nome || '';
    const R = f.recorrencia;
    let h = '<form class="form" id="cf" novalidate>';
    h += '<div class="tipo-tabs">' + A.seg('tipo', [['Despesa', 'Despesa recorrente'], ['Receita', 'Receita recorrente']], T) + '</div>';
    h += A.fld('Descrição', A.inp('descricao', f.descricao, 'required maxlength="100" placeholder="Ex.: Financiamento do apartamento"'), { req: 1 });
    h += A.fld('Núcleo', A.seg('nucleo', A.nucleoOptions(), f.nucleo));
    h += '<div class="grid2">' + A.fld('Categoria', A.sel('categoria', cats.map(c => c.nome), f.categoria)) + A.fld('Subcategoria', A.sel('subcategoria', cat.subs.map(x => x.nome), f.subcategoria)) + '</div>';
    h += A.fld('Tipo de recorrência', A.seg('recorrencia', [['Permanente', 'Permanente'], ['Temporária', 'Temporária'], ['Parcelamento', 'Parcelamento']], R),
      { help: R === 'Permanente' ? 'Repete todo mês até você encerrar (aluguel, plano de saúde, contador, pró-labore, honorário mensal de cliente).' : R === 'Temporária' ? 'Repete por um período definido e termina sozinha (ex.: pós-graduação de 18 meses).' : 'Valor total dividido em parcelas (ex.: compra de R$ 12.000 em 12x).' });
    if (R === 'Parcelamento') {
      const vt = A.parseValor(f.valorTotal), n = Math.max(1, +f.parcelas || 1);
      h += '<div class="grid3">' + A.fld('Valor total', A.money('valorTotal', f.valorTotal), { req: 1 }) + A.fld('Nº de parcelas', A.inp('parcelas', f.parcelas, 'type="number" min="1" max="480"'), { req: 1 }) +
        A.fld('Valor da parcela', '<p class="calc" id="cf-parc">' + (vt > 0 ? FE.brl(vt / n) : '—') + '</p>') + '</div>';
      h += '<div class="grid2">' + A.fld('1ª parcela vence em', A.inp('inicio', f.inicio, 'type="date"'), { req: 1 }) + A.fld('Termina em', '<p class="calc" id="cf-fim">' + (f.inicio ? FE.mesBarra(FE.addM(FE.ym(f.inicio), n - 1)) : '—') + '</p>') + '</div>';
    } else {
      h += '<div class="grid2">' + A.fld('Valor mensal', A.money('valor', f.valor), { req: 1 }) + A.fld('1º vencimento', A.inp('inicio', f.inicio, 'type="date"'), { req: 1, help: 'O dia desta data vale para todos os meses.' }) + '</div>';
      if (R === 'Temporária') h += '<div class="grid2">' + A.fld('Quantidade de meses', A.inp('parcelas', f.parcelas, 'type="number" min="1" max="480"')) + A.fld('Termina em', '<p class="calc" id="cf-fim">' + (f.inicio && +f.parcelas ? FE.mesBarra(FE.addM(FE.ym(f.inicio), +f.parcelas - 1)) : '—') + '</p>') + '</div>';
      else h += '<label class="chk"><input type="checkbox" name="semFim"' + (f.semFim !== false ? ' checked' : '') + '> Sem data prevista para encerramento</label>' + (f.semFim === false ? A.fld('Data final (último mês)', A.inp('fim', f.fim || '', 'type="month"')) : '');
    }
    if (cat.transfer) {
      const proprias = s.contas.filter(c => c.nucleo === f.nucleo), outras = s.contas.filter(c => f.nucleo === 'PF' ? c.nucleo !== 'PF' : c.nucleo === 'PF');
      const a = T === 'Despesa' ? 'contaId' : 'contaDestinoId', b = T === 'Despesa' ? 'contaDestinoId' : 'contaId';
      if (!proprias.some(c => c.id === f[a])) f[a] = (proprias[0] || {}).id || '';
      if (!outras.some(c => c.id === f[b])) f[b] = (outras[0] || {}).id || '';
      h += '<div class="grid2">' + A.fld(T === 'Despesa' ? 'Sai da conta' : 'Entra na conta', A.sel(a, proprias.map(c => [c.id, c.nome]), f[a])) + A.fld(T === 'Despesa' ? 'Vai para a conta' : 'Vem da conta', A.sel(b, outras.map(c => [c.id, c.nome + ' (' + A.nomeNCurto(c.nucleo) + ')']), f[b])) + '</div>';
      h += '<p class="classif">Registrado como transferência (' + esc(cat.transfer) + '): renda para quem recebe, saída para quem paga, neutro no consolidado.</p>';
    } else {
      const opts = s.contas.map(c => ['c:' + c.id, 'Conta: ' + c.nome + ' (' + A.nomeNCurto(c.nucleo) + ')']).concat(T === 'Despesa' ? s.cartoes.map(c => ['k:' + c.id, 'Cartão: ' + c.nome]) : []);
      if (!opts.some(o => o[0] === f._pg)) { const pref = s.contas.find(c => c.nucleo === f.nucleo); f._pg = pref ? 'c:' + pref.id : (opts[0] || [''])[0]; }
      h += A.fld(T === 'Despesa' ? 'Pago por' : 'Recebido em', opts.length ? A.sel('_pg', opts, f._pg) : '<p class="muted small">Cadastre uma conta primeiro.</p>');
    }
    if (T === 'Despesa' && !cat.transfer) h += '<div class="grid2">' + A.fld('Natureza', A.sel('natureza', [['', 'Automática'], ['Fixa', 'Custo fixo'], ['Financiamento', 'Financiamento / dívida'], ['Parcela', 'Parcelamento']], f.natureza || ''), { help: 'Financiamentos entram no indicador de endividamento.' }) + '<div></div></div>';
    h += A.fld('Observações', '<textarea class="in" name="obs" rows="2">' + esc(f.obs || '') + '</textarea>');
    return h + '</form>';
  }
  const foot = (editing ? '<button class="btn danger ghost" id="cf-del">Excluir</button><span class="sp"></span>' : '<span class="sp"></span>') + '<button class="btn" data-close="1">Cancelar</button><button class="btn primary" id="cf-save">Salvar compromisso</button>';
  const m = A.modal(editing ? 'Editar compromisso' : 'Novo compromisso fixo', body(), { foot });
  const root = m.parentElement;
  const read = () => { const d = A.formData($('#cf', root)); for (const k in d) f[k] = d[k]; };
  let painting = false;
  function paint() { if (painting) return; painting = true; try { const fm = $('#cf', root); if (fm && fm.isConnected) { fm.outerHTML = body(); bind(); } } finally { painting = false; } }
  function bind() {
    const fm = $('#cf', root); A.bindMoneyBlur(fm);
    fm.addEventListener('change', e => {
      if (painting || !fm.isConnected) return;
      const n = e.target.name; read();
      if (n === 'nucleo' || n === 'tipo') { f.categoria = ''; f.subcategoria = ''; f._pg = ''; f.contaId = ''; f.contaDestinoId = ''; if (f.nucleo !== 'PF' && f.responsavel === 'AMBOS') f.responsavel = 'NA'; }
      if (n === 'categoria') { f.subcategoria = ''; }
      if (['nucleo', 'tipo', 'categoria', 'recorrencia', 'semFim', 'parcelas', 'inicio', 'valorTotal'].includes(n)) paint();
    });
    $$('input[name=valorTotal], input[name=parcelas]', fm).forEach(i => i.addEventListener('input', () => { read(); const p = $('#cf-parc', fm), vt = A.parseValor(f.valorTotal), n = Math.max(1, +f.parcelas || 1); if (p) p.textContent = vt > 0 ? FE.brl(vt / n) : '—'; const fe = $('#cf-fim', fm); if (fe && f.inicio) fe.textContent = FE.mesBarra(FE.addM(FE.ym(f.inicio), n - 1)); }));
  }
  bind();
  $('#cf-save', root).addEventListener('click', () => {
    read();
    if (!f.descricao || !f.descricao.trim()) return A.toast('Dê um nome ao compromisso.', 'erro');
    if (!f.inicio) return A.toast('Informe o primeiro vencimento.', 'erro');
    const out = { id: editing ? orig.id : A.uid('cp'), tipo: f.tipo || 'Despesa', descricao: f.descricao.trim(), nucleo: f.nucleo, responsavel: f.responsavel, categoria: f.categoria, subcategoria: f.subcategoria,
      recorrencia: f.recorrencia, inicio: f.inicio, natureza: f.natureza || '', obs: f.obs || '', encerradoEm: editing ? orig.encerradoEm || '' : '' };
    if (editing && orig.exemplo) out.exemplo = true;
    if (f.recorrencia === 'Parcelamento') {
      const vt = A.parseValor(f.valorTotal), n = Math.round(+f.parcelas);
      if (!(vt > 0) || !(n >= 1)) return A.toast('Informe valor total e número de parcelas.', 'erro');
      Object.assign(out, { valorTotal: FE.r2(vt), parcelas: n, valor: FE.r2(vt / n), semFim: false });
    } else {
      const v = A.parseValor(f.valor);
      if (!(v > 0)) return A.toast('Informe o valor mensal.', 'erro');
      out.valor = FE.r2(v);
      if (f.recorrencia === 'Temporária') { const n = Math.round(+f.parcelas); if (!(n >= 1)) return A.toast('Informe por quantos meses.', 'erro'); out.parcelas = n; out.semFim = false; }
      else { out.semFim = f.semFim !== false; out.fim = out.semFim ? '' : (f.fim || ''); if (!out.semFim && !out.fim) return A.toast('Informe o último mês ou marque "sem data prevista".', 'erro'); }
    }
    const cat = A.catObj(f.nucleo, out.tipo, f.categoria);
    if (cat && cat.transfer) { out.contaId = f.contaId; out.contaDestinoId = f.contaDestinoId; }
    else if (f._pg) { if (f._pg.startsWith('k:')) out.cartaoId = f._pg.slice(2); else out.contaId = f._pg.slice(2); }
    const arr = A.state.compromissos;
    if (editing) arr[arr.findIndex(x => x.id === orig.id)] = out; else arr.push(out);
    A.closeModal(); A.commit(editing ? 'Compromisso atualizado.' : 'Compromisso cadastrado — já aparece nas projeções.');
  });
  const del = $('#cf-del', root);
  if (del) del.addEventListener('click', () => A.confirm('Excluir o compromisso "' + esc(orig.descricao) + '"? Todas as ocorrências (passadas e futuras) somem dos relatórios. Para apenas parar daqui pra frente, use "Encerrar".', 'Excluir', () => {
    A.state.compromissos = A.state.compromissos.filter(x => x.id !== orig.id);
    for (const k of Object.keys(A.state.overrides)) if (k.startsWith(orig.id + '|')) delete A.state.overrides[k];
    A.commit('Compromisso excluído.');
  }, true));
};
A.encerrarCompromisso = function (id) {
  const c = A.state.compromissos.find(x => x.id === id); if (!c) return;
  const ult = A.ctx.curM;
  A.confirm('Encerrar "' + esc(c.descricao) + '"? A última ocorrência fica em ' + FE.mesBarra(ult) + ' e nada mais é projetado depois disso.', 'Encerrar', () => {
    c.encerradoEm = ult; A.commit('Compromisso encerrado.');
  });
};
A.reabrirCompromisso = function (id) { const c = A.state.compromissos.find(x => x.id === id); if (!c) return; c.encerradoEm = ''; A.commit('Compromisso reativado.'); };

/* ajuste de uma ocorrência de compromisso */
A.openAjuste = function (compId, mes) {
  const c = A.state.compromissos.find(x => x.id === compId); if (!c) return;
  const key = compId + '|' + mes, ov = A.state.overrides[key] || {};
  const occ = A.ctx.ledger.items.find(m => m.ref === compId && m.occ === mes && !m.implicit);
  const valorBase = occ ? occ.valor : c.valor;
  const rec = (c.tipo || 'Despesa') === 'Receita';
  const h = '<form class="form" id="af"><p class="muted">' + esc(c.descricao) + ', ' + FE.mesBarra(mes) + (occ && occ.cartaoId ? '. No cartão: a situação segue a fatura.' : '') + '</p>' +
    '<label class="chk"><input type="checkbox" name="pular"' + (ov.pular ? ' checked' : '') + '> Não houve cobrança neste mês</label>' +
    '<div class="grid2">' + A.fld('Valor deste mês', A.money('valor', ov.valor != null ? ov.valor : valorBase)) + A.fld('Situação', A.sel('status', [['', 'Automática (vencido = ' + (rec ? 'recebido' : 'pago') + ')'], [rec ? 'Recebido' : 'Pago', rec ? 'Recebido' : 'Pago'], ['Pendente', 'Pendente']], ov.status || '')) + '</div>' +
    A.fld('Data do pagamento', A.inp('dataPagamento', ov.dataPagamento || '', 'type="date"'), { help: 'Vazio = data do vencimento.' }) + '</form>';
  const m = A.modal('Ajustar ocorrência', h, { foot: (A.state.overrides[key] ? '<button class="btn ghost" id="af-clr">Remover ajuste</button>' : '') + '<span class="sp"></span><button class="btn" data-close="1">Cancelar</button><button class="btn primary" id="af-ok">Salvar ajuste</button>' });
  const root = m.parentElement; A.bindMoneyBlur(root);
  $('#af-ok', root).addEventListener('click', () => {
    const d = A.formData($('#af', root)), v = A.parseValor(d.valor);
    const o = {};
    if (d.pular) o.pular = true;
    if (!isNaN(v) && Math.abs(v - valorBase) > 0.004) o.valor = FE.r2(v);
    if (d.status) o.status = d.status;
    if (d.dataPagamento) o.dataPagamento = d.dataPagamento;
    if (Object.keys(o).length) A.state.overrides[key] = o; else delete A.state.overrides[key];
    A.closeModal(); A.commit('Ocorrência ajustada.');
  });
  const clr = $('#af-clr', root); if (clr) clr.addEventListener('click', () => { delete A.state.overrides[key]; A.closeModal(); A.commit('Ajuste removido.'); });
};

/* ---------------- CONTA ---------------- */
A.openConta = function (orig) {
  const editing = !!orig;
  const f = orig ? clone(orig) : { tipo: 'Conta corrente', nucleo: 'PF', titular: 'P1', saldoInicial: 0, dataSaldo: A.state.config.inicioControle + '-01', reserva: false };
  const h = '<form class="form" id="ctf">' + '<div class="grid2">' + A.fld('Nome da conta', A.inp('nome', f.nome, 'required maxlength="60" placeholder="Ex.: Conta corrente PF"'), { req: 1 }) + A.fld('Instituição', A.inp('instituicao', f.instituicao, 'maxlength="60" placeholder="Banco"')) + '</div>' +
    '<div class="grid2">' + A.fld('Tipo', A.sel('tipo', ['Conta corrente', 'Poupança', 'Investimento', 'Dinheiro', 'Outra'], f.tipo)) + '<div></div></div>' +
    A.fld('Núcleo', A.seg('nucleo', A.nucleoOptions(), f.nucleo)) +
    '<div class="grid2">' + A.fld('Saldo inicial', A.money('saldoInicial', f.saldoInicial)) + A.fld('Data do saldo inicial', A.inp('dataSaldo', f.dataSaldo, 'type="date"'), { help: 'Movimentos a partir desta data alteram o saldo.' }) + '</div>' +
    '<label class="chk"><input type="checkbox" name="reserva"' + (f.reserva ? ' checked' : '') + '> Faz parte da reserva de emergência</label></form>';
  const m = A.modal(editing ? 'Editar conta' : 'Nova conta', h, { foot: (editing ? '<button class="btn danger ghost" id="ct-del">Excluir</button>' : '') + '<span class="sp"></span><button class="btn" data-close="1">Cancelar</button><button class="btn primary" id="ct-ok">Salvar conta</button>' });
  const root = m.parentElement; A.bindMoneyBlur(root);
  $('select[name=tipo]', root).addEventListener('change', e => { const r = $('input[name=reserva]', root); if (['Poupança', 'Investimento'].includes(e.target.value)) r.checked = true; });
  $('#ct-ok', root).addEventListener('click', () => {
    const d = A.formData($('#ctf', root));
    if (!d.nome.trim()) return A.toast('Dê um nome à conta.', 'erro');
    const v = A.parseValor(d.saldoInicial);
    const out = Object.assign(editing ? orig : { id: A.uid('ct') }, { nome: d.nome.trim(), instituicao: d.instituicao.trim(), tipo: d.tipo, titular: f.titular || 'P1', nucleo: d.nucleo, saldoInicial: isNaN(v) ? 0 : FE.r2(v), dataSaldo: d.dataSaldo, reserva: !!d.reserva });
    if (!editing) A.state.contas.push(out);
    A.closeModal(); A.commit(editing ? 'Conta atualizada.' : 'Conta cadastrada.');
  });
  const del = $('#ct-del', root);
  if (del) del.addEventListener('click', () => {
    const uso = A.state.lancamentos.filter(l => l.contaId === orig.id || l.contaDestinoId === orig.id).length + A.state.compromissos.filter(c => c.contaId === orig.id || c.contaDestinoId === orig.id).length + A.state.cartoes.filter(c => c.contaId === orig.id).length;
    if (uso) return A.toast('Esta conta é usada em ' + uso + ' registro(s). Mude esses registros antes de excluir.', 'erro');
    A.confirm('Excluir a conta "' + esc(orig.nome) + '"?', 'Excluir', () => { A.state.contas = A.state.contas.filter(c => c.id !== orig.id); A.commit('Conta excluída.'); }, true);
  });
};

/* ---------------- CARTÃO ---------------- */
A.openCartao = function (orig) {
  const editing = !!orig;
  const f = orig ? clone(orig) : { nucleo: 'PF', titular: 'P1', limite: '', fechamento: 1, vencimento: 10 };
  const contas = A.state.contas.filter(c => !FE.isInvAcc(c));
  const h = '<form class="form" id="kf">' + A.fld('Nome do cartão', A.inp('nome', f.nome, 'maxlength="60" placeholder="Ex.: Cartão pessoal"'), { req: 1 }) +
    '<div class="grid2">' + A.fld('Limite', A.money('limite', f.limite)) + '<div></div></div>' +
    A.fld('Núcleo', A.seg('nucleo', A.nucleoOptions(), f.nucleo), { help: 'Compras de outro núcleo neste cartão viram retirada/aporte do sócio.' }) +
    '<div class="grid3">' + A.fld('Dia do fechamento', A.inp('fechamento', f.fechamento, 'type="number" min="1" max="31"')) + A.fld('Dia do vencimento', A.inp('vencimento', f.vencimento, 'type="number" min="1" max="31"')) +
    A.fld('Fatura paga pela conta', A.sel('contaId', contas.map(c => [c.id, c.nome + ' (' + A.nomeNCurto(c.nucleo) + ')']), f.contaId)) + '</div></form>';
  const m = A.modal(editing ? 'Editar cartão' : 'Novo cartão', h, { foot: (editing ? '<button class="btn danger ghost" id="k-del">Excluir</button>' : '') + '<span class="sp"></span><button class="btn" data-close="1">Cancelar</button><button class="btn primary" id="k-ok">Salvar cartão</button>' });
  const root = m.parentElement; A.bindMoneyBlur(root);
  $('#k-ok', root).addEventListener('click', () => {
    const d = A.formData($('#kf', root));
    if (!d.nome.trim()) return A.toast('Dê um nome ao cartão.', 'erro');
    const fe = Math.round(+d.fechamento), ve = Math.round(+d.vencimento);
    if (!(fe >= 1 && fe <= 31 && ve >= 1 && ve <= 31)) return A.toast('Dias de fechamento e vencimento entre 1 e 31.', 'erro');
    const out = Object.assign(editing ? orig : { id: A.uid('cc') }, { nome: d.nome.trim(), titular: f.titular || 'P1', nucleo: d.nucleo, limite: FE.r2(A.parseValor(d.limite) || 0), fechamento: fe, vencimento: ve, contaId: d.contaId });
    if (!editing) A.state.cartoes.push(out);
    A.ui.cartaoSel = out.id;
    A.closeModal(); A.commit(editing ? 'Cartão atualizado.' : 'Cartão cadastrado.');
  });
  const del = $('#k-del', root);
  if (del) del.addEventListener('click', () => {
    const uso = A.state.lancamentos.filter(l => l.cartaoId === orig.id).length + A.state.compromissos.filter(c => c.cartaoId === orig.id).length;
    if (uso) return A.toast('Este cartão tem ' + uso + ' compra(s)/compromisso(s). Mude ou exclua esses registros antes.', 'erro');
    A.confirm('Excluir o cartão "' + esc(orig.nome) + '"?', 'Excluir', () => { A.state.cartoes = A.state.cartoes.filter(c => c.id !== orig.id); A.commit('Cartão excluído.'); }, true);
  });
};
A.openFatura = function (key) {
  const f = A.ctx.ledger.faturas.get(key); if (!f) return;
  const card = A.cartao(f.cartaoId);
  const contas = A.state.contas.filter(c => !FE.isInvAcc(c));
  const h = '<form class="form" id="ff"><p>Fatura de <strong>' + FE.mesBarra(f.mes) + '</strong> do ' + esc(card.nome) + ': <strong>' + FE.brl(f.total) + '</strong>, vencimento ' + FE.dataBR(f.venc) + '.</p>' +
    '<p class="muted small">Registrar o pagamento aqui baixa todas as compras da fatura. Não lance o pagamento da fatura como despesa — as compras já foram contadas.</p>' +
    '<div class="grid2">' + A.fld('Data do pagamento', A.inp('data', f.data || (A.todayIso() < f.venc ? A.todayIso() : f.venc), 'type="date"')) + A.fld('Pago pela conta', A.sel('contaId', contas.map(c => [c.id, c.nome]), f.contaId)) + '</div></form>';
  const m = A.modal('Pagar fatura', h, { foot: (f.explicit ? '<button class="btn ghost" id="ff-auto">Voltar ao automático</button>' : '') + (f.pago ? '<button class="btn ghost" id="ff-np">Marcar como não paga</button>' : '') + '<span class="sp"></span><button class="btn" data-close="1">Cancelar</button><button class="btn primary" id="ff-ok">Registrar pagamento</button>' });
  const root = m.parentElement;
  $('#ff-ok', root).addEventListener('click', () => { const d = A.formData($('#ff', root)); A.state.faturas[key] = { pago: true, data: d.data, contaId: d.contaId }; A.closeModal(); A.commit('Fatura registrada como paga.'); });
  const np = $('#ff-np', root); if (np) np.addEventListener('click', () => { A.state.faturas[key] = { pago: false }; A.closeModal(); A.commit('Fatura marcada como não paga.'); });
  const au = $('#ff-auto', root); if (au) au.addEventListener('click', () => { delete A.state.faturas[key]; A.closeModal(); A.commit('Fatura voltou ao modo automático.'); });
};

/* ---------------- META ---------------- */
A.openMeta = function (orig) {
  const editing = !!orig;
  const f = orig ? clone(orig) : { nucleo: 'PF', vinculo: '', data: FE.dayIn(FE.addM(A.ctx.curM, 12), 1) };
  const vinc = [['', 'Informo o valor guardado manualmente'], ['RESERVA', 'Saldo das contas de reserva (automático)'], ['CARTEIRA', 'Valor de mercado da carteira de investimentos do núcleo (automático)']].concat(A.state.contas.map(c => [c.id, 'Saldo da conta: ' + c.nome]));
  const h = '<form class="form" id="mf">' + A.fld('Meta', A.inp('nome', f.nome, 'maxlength="80" placeholder="Ex.: Troca de carro"'), { req: 1 }) +
    '<div class="grid2">' + A.fld('Valor alvo', A.money('alvo', f.alvo), { req: 1 }) + A.fld('Data desejada', A.inp('data', f.data, 'type="date"')) + '</div>' +
    '<div class="grid2">' + A.fld('Valor acumulado vem de', A.sel('vinculo', vinc, f.vinculo || '')) + A.fld('Valor já guardado', A.money('acumulado', f.acumulado), { help: 'Usado só no modo manual.' }) + '</div>' +
    A.fld('Núcleo', A.seg('nucleo', A.nucleoOptions(), f.nucleo)) + '</form>';
  const m = A.modal(editing ? 'Editar meta' : 'Nova meta', h, { foot: (editing ? '<button class="btn danger ghost" id="m-del">Excluir</button>' : '') + '<span class="sp"></span><button class="btn" data-close="1">Cancelar</button><button class="btn primary" id="m-ok">Salvar meta</button>' });
  const root = m.parentElement; A.bindMoneyBlur(root);
  $('#m-ok', root).addEventListener('click', () => {
    const d = A.formData($('#mf', root)), alvo = A.parseValor(d.alvo);
    if (!d.nome.trim() || !(alvo > 0)) return A.toast('Informe o nome e o valor alvo.', 'erro');
    const out = Object.assign(editing ? orig : { id: A.uid('mt') }, { nome: d.nome.trim(), alvo: FE.r2(alvo), data: d.data, vinculo: d.vinculo, acumulado: FE.r2(A.parseValor(d.acumulado) || 0), nucleo: d.nucleo });
    if (!editing) A.state.metas.push(out);
    A.closeModal(); A.commit('Meta salva.');
  });
  const del = $('#m-del', root); if (del) del.addEventListener('click', () => A.confirm('Excluir a meta "' + esc(orig.nome) + '"?', 'Excluir', () => { A.state.metas = A.state.metas.filter(x => x.id !== orig.id); A.commit('Meta excluída.'); }, true));
};

/* ---------------- PATRIMÔNIO ---------------- */
A.openBem = function (lado, orig) {
  const editing = !!orig, isA = lado === 'ativos';
  const tipos = isA ? ['Imóveis', 'Veículos', 'Investimentos', 'Saldo bancário', 'Participações', 'Outros'] : ['Financiamentos imobiliários', 'Financiamentos de veículos', 'Empréstimos', 'Parcelamentos', 'Dívidas', 'Outros'];
  const f = orig ? clone(orig) : { tipo: tipos[0] };
  const h = '<form class="form" id="bf">' + A.fld('Descrição', A.inp('descricao', f.descricao, 'maxlength="80"'), { req: 1 }) + '<div class="grid2">' + A.fld('Tipo', A.sel('tipo', tipos, f.tipo)) + A.fld(isA ? 'Valor atual estimado' : 'Saldo devedor atual', A.money('valor', f.valor), { req: 1 }) + '</div>' +
    (isA ? '<p class="muted small">Saldos das contas e as ações da carteira de investimentos já entram automaticamente — não repita aqui.</p>' : '<p class="muted small">Informe o saldo devedor do contrato (o banco informa). Parcelamentos de compras já entram automaticamente.</p>') + '</form>';
  const m = A.modal((editing ? 'Editar ' : 'Novo ') + (isA ? 'ativo' : 'passivo'), h, { foot: (editing ? '<button class="btn danger ghost" id="b-del">Excluir</button>' : '') + '<span class="sp"></span><button class="btn" data-close="1">Cancelar</button><button class="btn primary" id="b-ok">Salvar</button>' });
  const root = m.parentElement; A.bindMoneyBlur(root);
  $('#b-ok', root).addEventListener('click', () => {
    const d = A.formData($('#bf', root)), v = A.parseValor(d.valor);
    if (!d.descricao.trim() || isNaN(v)) return A.toast('Informe descrição e valor.', 'erro');
    const out = Object.assign(editing ? orig : { id: A.uid('pt') }, { descricao: d.descricao.trim(), tipo: d.tipo, valor: FE.r2(v) });
    if (!editing) A.state.patrimonio[lado].push(out);
    A.closeModal(); A.commit('Patrimônio atualizado.');
  });
  const del = $('#b-del', root); if (del) del.addEventListener('click', () => { A.state.patrimonio[lado] = A.state.patrimonio[lado].filter(x => x.id !== orig.id); A.closeModal(); A.commit('Item excluído.'); });
};
})();

/* ==========================================================================
   Telas — Dashboard, Lançamentos, Compromissos, Cartões, Contas, Orçamento, Projeções
   ========================================================================== */
(function () {
'use strict';
const A = window.APP, { $, $$, esc } = A, COL = A.COL;
const P = A.pages;
const head = (title, sub, filters) => '<header class="pg-h"><div class="pg-t"><h1>' + esc(title) + '</h1>' + (sub ? '<p class="sub">' + sub + '</p>' : '') + '</div>' + (filters ? '<div class="filters">' + filters + '</div>' : '') + '</header>';
A.head = head;
const money = (v, cls) => '<span class="num' + (cls ? ' ' + cls : '') + '">' + FE.brl(v) + '</span>';
const empty = (msg, btn) => '<div class="empty"><p>' + msg + '</p>' + (btn || '') + '</div>';
A.empty = empty;
const sumBal = (bal, filt) => FE.r2(A.state.contas.filter(filt).reduce((s, c) => s + (bal[c.id] || 0), 0));

/* ======================= DASHBOARD ======================= */
P.dashboard = function () {
  const ui = A.ui, ctx = A.ctx, st = A.state, mes = ui.mes;
  const view = FE.viewOf(ui.nucleo, ui.resp);
  const map = ctx.agg(ui.nucleo, ui.resp, ui.regime);
  const cur = FE.getM(map, mes), d = FE.der(cur);
  const isPJ = ui.nucleo === 'C1' || ui.nucleo === 'C2';
  const andamento = mes === ctx.curM, futuro = mes > ctx.curM;
  const asOf = mes >= ctx.curM ? ctx.today : FE.monthEnd(mes);
  const bal = FE.balancesAt(st, ctx.ledger, asOf);
  const saldo = sumBal(bal, FE.contaFiltro(view));
  const nomeV = ui.nucleo === 'ALL' ? 'Consolidado (PF + empresas)' : A.nomeN(ui.nucleo);
  const filtros = A.filtroMes('mes') + A.filtroNucleo('nucleo') + A.filtroRegime();
  let h = head('Painel financeiro', esc(nomeV) + (ui.resp !== 'ALL' ? ' — ' + esc(A.nomeResp(ui.resp)) : '') + '. ' + (ui.regime === 'comp' ? 'Competência: tudo o que pertence ao mês, pago ou a pagar.' : 'Caixa: só o que já foi pago ou recebido.'), filtros);

  // ---------- herói ----------
  const quando = andamento ? (ui.regime === 'caixa' ? 'Em ' + FE.mesLongo(mes) + ', até hoje,' : 'Em ' + FE.mesLongo(mes) + ' (mês em andamento)') : 'Em ' + FE.mesLongo(mes) + (futuro ? ' (previsto)' : '');
  let frase;
  if (!cur.n) frase = '<p class="hero-l">Ainda não há movimentos em ' + FE.mesLongo(mes) + (A.state.contas.length ? '.' : '. Comece cadastrando as contas.') + '</p><div class="hero-cta"><button class="btn primary" id="hero-new">' + A.ICO.plus + 'Fazer um lançamento</button>' + (A.state.contas.length ? '' : '<a class="btn" href="#contas">Cadastrar contas</a>') + '</div>';
  else if (isPJ) frase = '<p class="hero-l">' + quando + ', a ' + esc(A.nomeN(ui.nucleo)) + ' faturou <b>' + FE.brl(cur.rec) + '</b> e teve custos de <b>' + FE.brl(cur.sai) + '</b>.</p><p class="hero-l">Resultado operacional: <b class="' + A.sig(d.res) + '">' + A.brlS(d.res) + '</b>' + (d.margem != null ? ', margem de ' + FE.pct(d.margem) + '.' : '.') + '</p>';
  else frase = '<p class="hero-l">' + quando + ' entraram <b>' + FE.brl(cur.ent) + '</b> e saíram <b>' + FE.brl(cur.sai) + '</b>.</p><p class="hero-l">' + (d.res >= 0 ? 'Sobraram <b class="pos">' + FE.brl(d.res) + '</b>' + (d.taxa != null ? ' — ' + FE.pct(d.taxa) + ' do que entrou.' : '.') : 'Faltaram <b class="neg">' + FE.brl(-d.res) + '</b> — as saídas superaram as entradas' + (cur.ent > 0 ? ' em ' + FE.pct(-d.res / cur.ent) : '') + '.') + '</p>';
  const sa = FE.saude(st, ctx.ledger, ctx, mes);
  h += '<section class="hero"><div class="hero-main">' + frase + (cur.n && andamento && ui.regime === 'comp' ? '<p class="hero-note">Inclui ' + FE.brl(cur.despPend) + ' a pagar e ' + FE.brl(cur.recPend) + ' a receber até o fim do mês.</p>' : '') + '</div>' + saudeCard(sa) + '</section>';

  // ---------- faixa de indicadores ----------
  const ren = cur.ent;
  const ofR = v => ren > 0 ? FE.pct(v / ren, 0) + (isPJ ? ' da receita' : ' da renda') : '';
  const row1 = isPJ ? [
    ['Receita bruta', FE.brl(cur.rec), 'líquida de impostos: ' + FE.brl(d.recLiq)],
    ['Custos totais', FE.brl(cur.sai), ofR(cur.sai)],
    ['Resultado operacional', A.brlS(d.res), d.margem != null ? 'margem ' + FE.pct(d.margem) : '', A.sig(d.res)],
    ['Caixa da empresa', FE.brl(saldo), andamento ? 'saldo hoje' : 'saldo no fim do mês'],
    ['Distribuído aos sócios', FE.brl(cur.dist + cur.retir), cur.retir > 0 ? 'inclui ' + FE.brl(cur.retir) + ' de retiradas pessoais' : 'lucros e retiradas'],
    ['Caixa gerado', A.brlS(d.caixaPJ), 'resultado − distribuições', A.sig(d.caixaPJ)],
  ] : [
    ['Entradas totais', FE.brl(cur.ent), cur.rendaPJ > 0 && ui.nucleo === 'PF' ? FE.brl(cur.rendaPJ) + ' vindos das empresas' : (cur.recPend > 0 ? FE.brl(cur.recPend) + ' a receber' : '')],
    ['Saídas totais', FE.brl(cur.sai), ofR(cur.sai)],
    ['Resultado líquido', A.brlS(d.res), '', A.sig(d.res)],
    ['Saldo acumulado', FE.brl(saldo), andamento ? 'em contas, hoje' : 'em contas, fim do mês'],
    ['Investido / reserva', A.brlS(cur.inv), 'aplicações − resgates', A.sig(cur.inv)],
    ['Fluxo de caixa livre', A.brlS(d.fcl), 'resultado − investido', A.sig(d.fcl)],
  ];
  const row2 = [
    ['Custos fixos', FE.brl(cur.b.Fixa), ofR(cur.b.Fixa)],
    ['Custos variáveis', FE.brl(cur.b['Variável']), ofR(cur.b['Variável'])],
    ['Parcelamentos', FE.brl(cur.b.Parcela), ofR(cur.b.Parcela)],
    ['Dívidas / financiamentos', FE.brl(cur.b.Financiamento), ofR(cur.b.Financiamento)],
    [(isPJ ? 'Receita' : 'Renda') + ' comprometida', FE.pct(d.compromet, 0), 'fixos + parcelas + dívidas', d.compromet > 0.6 ? 'neg' : ''],
    [isPJ ? 'Impostos' : 'Taxa de poupança', isPJ ? FE.brl(cur.imp) : FE.pct(d.taxa), isPJ ? ofR(cur.imp) : 'meta: ' + FE.pct(st.config.metaPoupanca, 0), isPJ ? '' : A.sig(d.taxa)],
  ];
  const strip = rows => '<div class="kstrip">' + rows.map(r => '<div class="k"><p class="kl">' + esc(r[0]) + '</p><p class="kv ' + (r[3] || '') + '">' + r[1] + '</p><p class="kn">' + (r[2] || '&nbsp;') + '</p></div>').join('') + '</div>';
  h += '<section class="panel pad0">' + strip(row1) + strip(row2) + '</section>';

  // ---------- composição ----------
  if (cur.ent > 0 || cur.sai > 0) h += composicao(cur, d, isPJ);

  // ---------- diagnóstico + laterais ----------
  const dg = FE.diagnostico(st, ctx.ledger, ctx, ui.nucleo, ui.resp, mes);
  h += '<div class="cols">';
  h += '<section class="panel"><div class="ph"><h2>Diagnóstico</h2><a class="lnk" href="#recomendacoes">Recomendações</a></div>' + (dg.length ? '<ul class="diag">' + dg.slice(0, 7).map(x => '<li>' + A.badge(x.nivel) + '<p>' + esc(x.txt) + '</p></li>').join('') + '</ul>' : '<p class="muted">Sem dados suficientes para diagnóstico neste mês.</p>') + '</section>';
  h += '<div class="stack">';
  // receita prevista x realizada (sempre por competência)
  const comp = FE.getM(ctx.agg(ui.nucleo, ui.resp, 'comp'), mes);
  if (comp.recPrev > 0) {
    const p = comp.recReal / comp.recPrev;
    h += '<section class="panel"><div class="ph"><h2>' + (isPJ ? 'Receita' : 'Entradas') + ' prevista x realizada</h2></div><div class="meter"><span style="width:' + (Math.min(1, p) * 100).toFixed(1) + '%"></span></div><dl class="dl2"><div><dt>Prevista</dt><dd>' + FE.brl(comp.recPrev) + '</dd></div><div><dt>Recebida</dt><dd class="pos">' + FE.brl(comp.recReal) + '</dd></div><div><dt>A receber</dt><dd>' + FE.brl(comp.recPend) + '</dd></div><div><dt>Realizado</dt><dd>' + FE.pct(p, 0) + '</dd></div></dl></section>';
  }
  if (!isPJ) {
    const rs = sa.reserva;
    h += '<section class="panel"><div class="ph"><h2>Reserva de emergência</h2></div>' + (rs.meses != null ? '<p class="big-n">' + FE.num(rs.meses) + ' <small>meses</small></p><p class="muted small">' + FE.brl(rs.total) + ' ÷ ' + FE.brl(rs.essMed) + '/mês de despesas essenciais</p>' + reservaEscala(rs) : '<p class="muted small">Marque em Contas quais contas formam a reserva.</p>') + '</section>';
  }
  const cartD = FE.resumoCarteira(st, ctx.today, view.nucleos);
  if (cartD.rs.some(r => r.aberta)) {
    const alertas = cartD.rs.filter(r => r.aberta && r.saude.nivel === 'alerta').length;
    h += '<section class="panel"><div class="ph"><h2>Investimentos</h2><a class="lnk" href="#investimentos">Carteira</a></div><p class="big-n">' + FE.brl(cartD.tot.valor) + '</p><p class="muted small">Valor de mercado hoje. Retorno total ' + A.brlS(cartD.tot.retorno) + (cartD.pct != null ? ' (' + FE.pct(cartD.pct) + ' sobre o aplicado)' : '') + (cartD.tir != null ? '; ' + FE.pct(cartD.tirM, 2) + ' ao mês, ' + FE.pct(cartD.tir) + ' ao ano (referência ' + FE.pct(+st.config.taxaReferenciaAA || 0) + ')' : '') + '.</p>' + (alertas ? '<p style="margin-top:8px">' + A.badge('alerta', alertas + (alertas > 1 ? ' ativos em alerta' : ' ativo em alerta')) + '</p>' : '') + '</section>';
  }
  const enc = FE.encerramentos(st, ctx.ledger, view, FE.addM(ctx.curM, 12)).filter(e => e.tipo === 'Despesa').slice(0, 4);
  if (enc.length) h += '<section class="panel"><div class="ph"><h2>Compromissos que terminam</h2><a class="lnk" href="#projecoes">Projeções</a></div><ul class="endl">' + enc.map(e => '<li><span>' + esc(e.desc) + '</span><span class="num">' + FE.brl(e.valor) + '/mês</span><span class="muted small">a partir de ' + FE.mesBarra(e.libera) + '</span></li>').join('') + '</ul></section>';
  h += '</div></div>';

  // ---------- gráficos ----------
  h += '<div class="charts">' +
    chartBox('ch-es', isPJ ? 'Receita x custos por mês' : 'Entradas x saídas por mês') +
    chartBox('ch-res', isPJ ? 'Resultado operacional por mês' : 'Resultado mensal') +
    chartBox('ch-cat', 'Despesas por categoria — ' + FE.mesCurto(mes)) +
    chartBox('ch-fv', 'Custos fixos x variáveis') +
    chartBox('ch-nuc', 'PF x ' + A.nomeNCurto('C1') + ' x ' + A.nomeNCurto('C2') + ' — resultado') +
    chartBox('ch-tx', isPJ ? 'Margem operacional' : 'Taxa de poupança') +
    chartBox('ch-saldo', 'Saldo financeiro em contas (fim do mês)') +
    '<section class="panel chart"><div class="ph"><h2>Maiores despesas — ' + FE.mesCurto(mes) + '</h2></div>' + maioresDespesas(cur) + '</section>' +
    '</div>';

  // ---------- resumo do ano ----------
  h += resumoAno(map, mes, isPJ);
  A._dash = { map, mes, isPJ, view };
  return h;
};
function chartBox(id, title) { return '<section class="panel chart"><div class="ph"><h2>' + esc(title) + '</h2></div><div class="cv"><canvas id="' + id + '" role="img" aria-label="' + esc(title) + '"></canvas></div></section>'; }
A.chartBox = chartBox;
function saudeCard(sa) {
  if (sa.score == null) return '<aside class="saude"><p class="saude-l">Saúde financeira</p><p class="muted small">Precisa de pelo menos um mês fechado com lançamentos.</p></aside>';
  const faixas = [[0, 40, 'Crítico'], [40, 55, 'Risco'], [55, 70, 'Atenção'], [70, 85, 'Saudável'], [85, 101, 'Excelente']];
  const piores = sa.comps.filter(c => c.nota != null).sort((a, b) => a.nota - b.nota).slice(0, 2);
  return '<aside class="saude"><p class="saude-l">Saúde financeira</p><p class="saude-n"><span>' + sa.score + '</span><small>/100</small></p><p class="saude-f ' + sa.faixa.nivel + '">' + esc(sa.faixa.nome) + '</p>' +
    '<div class="scale" aria-hidden="true">' + faixas.map(f => '<span class="sc' + (sa.score >= f[0] && sa.score < f[1] ? ' on' : '') + '" style="flex:' + (Math.min(f[1], 100) - f[0]) + '"><i>' + f[2] + '</i></span>').join('') + '<b style="left:' + sa.score + '%"></b></div>' +
    '<p class="saude-p">Puxam a nota para baixo: ' + piores.map(c => esc(c.nome.toLowerCase()) + ' (' + c.nota + ')').join(' e ') + '.</p><a class="lnk" href="#metodologia">Como a nota é calculada</a></aside>';
}
A.saudeCard = saudeCard;
function reservaEscala(rs) {
  const f = A.state.config.faixasReserva, max = f[2] * 1.25, pos = Math.min(rs.meses, max) / max * 100;
  const seg = [[0, f[0], 'Atenção'], [f[0], f[1], 'Razoável'], [f[1], f[2], 'Confortável'], [f[2], max, 'Elevada']];
  return '<div class="scale sm" aria-hidden="true">' + seg.map(s => '<span class="sc' + (rs.meses >= s[0] && rs.meses < s[1] ? ' on' : '') + '" style="flex:' + (s[1] - s[0]) + '"><i>' + s[2] + '</i></span>').join('') + '<b style="left:' + pos + '%"></b></div><p class="muted small">Faixa: ' + esc(rs.faixa.toLowerCase()) + '. Referências ajustáveis em Cadastros.</p>';
}
A.reservaEscala = reservaEscala;
function composicao(cur, d, isPJ) {
  const ent = Math.max(cur.ent, 0.01);
  const parts = [['Financiamentos', cur.b.Financiamento, COL.fin], ['Custos fixos', cur.b.Fixa, COL.fix], ['Parcelamentos', cur.b.Parcela, COL.parc], ['Variáveis', cur.b['Variável'], COL.var]];
  if (cur.b.Aporte > 0) parts.push(['Aportes em empresas', cur.b.Aporte, COL.aporte]);
  const tot = Math.max(cur.ent, cur.sai);
  let bar = '';
  for (const [l, v, c] of parts) if (v > 0) bar += '<span style="flex:' + v + ';background:' + c + '" title="' + esc(l) + ': ' + FE.brl(v) + '"></span>';
  if (d.res > 0) bar += '<span class="sobra" style="flex:' + d.res + '" title="Sobra: ' + FE.brl(d.res) + '"></span>';
  const leg = parts.filter(p => p[1] > 0).map(([l, v, c]) => '<li><i style="background:' + c + '"></i>' + esc(l) + ' <b>' + FE.pct(v / ent, 0) + '</b> <span class="muted">' + FE.brl(v) + '</span></li>').join('') +
    (d.res > 0 ? '<li><i class="sobra"></i>Sobra <b>' + FE.pct(d.res / ent, 0) + '</b> <span class="muted">' + FE.brl(d.res) + '</span></li>' : '<li><i style="background:' + COL.neg + '"></i>Déficit <b>' + FE.pct(-d.res / ent, 0) + '</b> <span class="muted">' + FE.brl(-d.res) + '</span></li>');
  return '<section class="panel"><div class="ph"><h2>Para onde ' + (isPJ ? 'vai a receita' : 'vai o dinheiro que entra') + '</h2><p class="muted small">' + (cur.sai > cur.ent ? 'As saídas passaram as entradas: a barra representa as saídas.' : 'Cada parte em proporção às entradas do mês.') + '</p></div><div class="compbar">' + bar + '</div><ul class="compleg">' + leg + '</ul></section>';
}
function maioresDespesas(cur) {
  const g = {};
  for (const m of cur.items) { const k = (m.desc || m.sub || m.cat) + '|' + m.cat; (g[k] = g[k] || { desc: m.desc || m.sub, cat: m.cat, v: 0, n: 0 }); g[k].v += m.valor; g[k].n++; }
  const arr = Object.values(g).sort((a, b) => b.v - a.v).slice(0, 8);
  if (!arr.length) return '<p class="muted small">Sem despesas no mês.</p>';
  const max = arr[0].v;
  return '<ol class="rank">' + arr.map(x => '<li><div class="rk-t"><span>' + esc(x.desc) + (x.n > 1 ? ' <span class="muted">(' + x.n + ')</span>' : '') + '</span><span class="num">' + FE.brl(x.v) + '</span></div><div class="rk-b"><span style="width:' + (x.v / max * 100).toFixed(1) + '%"></span></div><p class="muted small">' + esc(x.cat) + '</p></li>').join('') + '</ol>';
}
function resumoAno(map, mes, isPJ) {
  const y = mes.slice(0, 4), ini = y + '-01';
  const ms = FE.monthsWithData(map, ini, mes);
  if (!ms.length) return '';
  const Y = FE.sumRange(map, ini, mes), dY = FE.der(Y), n = ms.length;
  const res = ms.map(m => [m, FE.der(map.get(m)).res]).sort((a, b) => b[1] - a[1]);
  const st = A.state, ctx = A.ctx;
  const pl = FE.serieIDPatrimonio(st, ctx.ledger, [FE.addM(ini, -1), mes]);
  const evo = pl[0] != null && pl[1] != null ? A.brlS(pl[1] - pl[0]) + ' <span class="muted small">(' + FE.brl0(pl[0]) + ' → ' + FE.brl0(pl[1]) + ')</span>' : '<span class="muted small">' + (pl[1] != null ? FE.brl0(pl[1]) + ' hoje; sem histórico no início do ano' : 'Sem dados de patrimônio') + '</span>';
  const it = [
    [isPJ ? 'Receita acumulada' : 'Entradas acumuladas', FE.brl(Y.ent)], [isPJ ? 'Custos acumulados' : 'Despesas acumuladas', FE.brl(Y.sai)], ['Resultado acumulado', '<span class="' + A.sig(dY.res) + '">' + A.brlS(dY.res) + '</span>'],
    ['Média mensal de ' + (isPJ ? 'receita' : 'entradas'), FE.brl(Y.ent / n)], ['Média mensal de ' + (isPJ ? 'custos' : 'despesas'), FE.brl(Y.sai / n)], [isPJ ? 'Margem no ano' : 'Taxa de poupança no ano', FE.pct(isPJ ? dY.margem : dY.taxa)],
    ['Melhor mês', FE.mesBarra(res[0][0]) + ' <span class="muted small">' + A.brlS(res[0][1]) + '</span>'], ['Pior mês', FE.mesBarra(res[res.length - 1][0]) + ' <span class="muted small">' + A.brlS(res[res.length - 1][1]) + '</span>'], ['Evolução patrimonial', evo],
    ['Total pago em parcelamentos', FE.brl(Y.b.Parcela)], ['Total pago em financiamentos', FE.brl(Y.b.Financiamento)], [isPJ ? 'Distribuído aos sócios' : 'Total poupado / investido', isPJ ? FE.brl(Y.dist + Y.retir) : FE.brl(Y.inv)],
  ];
  return '<section class="panel"><div class="ph"><h2>Resumo de ' + y + '</h2><p class="muted small">Janeiro a ' + FE.MESES[+mes.slice(5, 7) - 1] + ', ' + n + (n > 1 ? ' meses' : ' mês') + ' com movimento.</p></div><dl class="year">' + it.map(x => '<div><dt>' + esc(x[0]) + '</dt><dd>' + x[1] + '</dd></div>').join('') + '</dl></section>';
}
P['dashboard:after'] = function () {
  const D = A._dash; if (!D) return;
  const b = $('#hero-new'); if (b) b.addEventListener('click', () => A.openLancamento(null));
  const months = FE.mrange(FE.addM(D.mes, -11), D.mes), lab = months.map(FE.mesCurto);
  const g = m => FE.getM(D.map, m);
  A.chart('ch-es', 'bar', { labels: lab, datasets: [{ label: D.isPJ ? 'Receita' : 'Entradas', data: months.map(m => g(m).ent), backgroundColor: COL.ent }, { label: D.isPJ ? 'Custos' : 'Saídas', data: months.map(m => g(m).sai), backgroundColor: COL.sai }] });
  const rs = months.map(m => FE.der(g(m)).res);
  A.chart('ch-res', 'bar', { labels: lab, datasets: [{ label: 'Resultado', data: rs, backgroundColor: rs.map(v => v >= 0 ? COL.pos : COL.neg) }] }, { legend: false });
  const cat = Object.entries(g(D.mes).cat).sort((a, b) => b[1] - a[1]);
  const top = cat.slice(0, 8); if (cat.length > 8) top.push(['Outras', cat.slice(8).reduce((s, x) => s + x[1], 0)]);
  if (top.length) A.chart('ch-cat', 'bar', { labels: top.map(x => x[0]), datasets: [{ label: 'Despesa', data: top.map(x => x[1]), backgroundColor: COL.sai }] }, { horizontal: true, legend: false });
  else $('#ch-cat').parentElement.innerHTML = '<p class="muted small">Sem despesas no mês.</p>';
  A.chart('ch-fv', 'bar', { labels: lab, datasets: [
    { label: 'Financiamentos', data: months.map(m => g(m).b.Financiamento), backgroundColor: COL.fin },
    { label: 'Fixos', data: months.map(m => g(m).b.Fixa), backgroundColor: COL.fix },
    { label: 'Parcelamentos', data: months.map(m => g(m).b.Parcela), backgroundColor: COL.parc },
    { label: 'Variáveis', data: months.map(m => g(m).b['Variável'] + g(m).b.Aporte), backgroundColor: COL.var }] }, { stacked: true });
  const nm = n => A.ctx.agg(n, A.ui.resp, A.ui.regime);
  A.chart('ch-nuc', 'line', { labels: lab, datasets: ['PF', 'C1', 'C2'].map(n => ({ label: n === 'PF' ? 'PF' : A.nomeNCurto(n), data: months.map(m => FE.der(FE.getM(nm(n), m)).res), borderColor: COL[n], backgroundColor: COL[n] })) });
  const tx = months.map(m => { const x = FE.der(g(m)); return D.isPJ ? x.margem : x.taxa; });
  A.chart('ch-tx', 'line', { labels: lab, datasets: [{ label: D.isPJ ? 'Margem' : 'Taxa de poupança', data: tx, borderColor: COL.ent, backgroundColor: COL.ent }] }, { pct: true, legend: false });
  const sal = FE.balanceSeries(A.state, A.ctx.ledger, months, FE.contaFiltro(D.view));
  A.chart('ch-saldo', 'line', { labels: lab, datasets: [{ label: 'Saldo', data: sal, borderColor: COL.saldo, backgroundColor: 'rgba(43,74,63,.08)', fill: true }] }, { legend: false });
};

/* ======================= LANÇAMENTOS ======================= */
P.lancamentos = function () {
  const ui = A.ui, st = A.state, ctx = A.ctx;
  if (!ui.lfMes) ui.lfMes = ctx.curM;
  const lf = ui.lf;
  const todos = !!ui.lfTodos, mes = ui.lfMes;
  const q = (lf.q || '').toLowerCase();
  const rows = [];
  for (const l of st.lancamentos) {
    const comp = l.competencia || FE.ym(l.data);
    if (!todos && comp !== mes) continue;
    if (lf.tipo !== 'ALL' && l.tipo !== lf.tipo) continue;
    if (lf.nucleo !== 'ALL') { const dn = l.contaDestinoId ? (A.conta(l.contaDestinoId) || {}).nucleo : null; if (l.nucleo !== lf.nucleo && dn !== lf.nucleo) continue; }
    const stt = A.statusLanc(l);
    if (lf.status !== 'ALL' && !(lf.status === 'pend' ? (stt.txt === 'Pendente' || stt.txt === 'Atrasado') : lf.status === 'atr' ? stt.txt === 'Atrasado' : (stt.txt === 'Pago' || stt.txt === 'Recebido'))) continue;
    if (q && !((l.descricao || '') + ' ' + l.categoria + ' ' + (l.subcategoria || '') + ' ' + (l.obs || '')).toLowerCase().includes(q)) continue;
    rows.push({ k: 'm', l, data: l.data, comp });
  }
  if (lf.auto && !todos) {
    for (const m of ctx.ledger.items) {
      if (m.implicit || m.comp !== mes || !(m.src === 'comp' || m.src === 'card' || m.src === 'inv')) continue;
      if (m.src === 'card' && m.parcelas === 1) continue;   // compra à vista no cartão: a própria linha do lançamento representa
      const tipo = m.src === 'inv' && m.kind === 'T' ? 'Investimento' : m.kind === 'R' ? 'Receita' : m.kind === 'D' ? 'Despesa' : 'Transferência';
      if (lf.tipo !== 'ALL' && tipo !== lf.tipo) continue;
      if (lf.nucleo !== 'ALL' && m.nucleo !== lf.nucleo && m.to !== lf.nucleo) continue;
      const stt = m.realized ? 'ok' : m.overdue ? 'atr' : 'pend';
      if (lf.status !== 'ALL' && !(lf.status === 'pend' ? stt !== 'ok' : lf.status === 'atr' ? stt === 'atr' : stt === 'ok')) continue;
      if (q && !((m.desc || '') + ' ' + m.cat + ' ' + (m.sub || '')).toLowerCase().includes(q)) continue;
      rows.push({ k: 'a', m, tipo, data: m.data, comp: m.comp });
    }
  }
  rows.sort((a, b) => (a.data < b.data ? 1 : a.data > b.data ? -1 : 0));
  // totais
  // totais do que pesa no período: compra parcelada conta pelas parcelas (linhas automáticas), não pelo total
  let tR = 0, tD = 0, tT = 0;
  for (const r of rows) {
    if (r.k === 'm') {
      const l = r.l, parc = l.forma === 'Cartão de crédito' && l.cartaoId && (+l.parcelas || 1) > 1;
      if (l.tipo === 'Receita') tR += +l.valor; else if (l.tipo === 'Despesa') { if (!parc || todos) tD += +l.valor; } else tT += +l.valor;
    } else { if (r.m.kind === 'R') tR += r.m.valor; else if (r.m.kind === 'D') tD += r.m.valor; else tT += r.m.valor; }
  }
  const lim = ui.lfLim || 250;
  const filtros = (todos ? '' : A.filtroMes('lfMes')) +
    '<label class="chk inline"><input type="checkbox" id="lf-todos"' + (todos ? ' checked' : '') + '> Todos os meses</label>';
  let h = head('Lançamentos', 'A área de alimentação. Cada linha é um movimento. Compromissos fixos e parcelas do cartão aparecem sozinhos (marcados como automáticos).', filtros);
  h += '<div class="toolbar"><button class="btn primary" id="lf-new">' + A.ICO.plus + 'Novo lançamento</button>' +
    '<div class="seg seg-f">' + [['ALL', 'Todos'], ['Receita', 'Receitas'], ['Despesa', 'Despesas'], ['Transferência', 'Transferências'], ['Investimento', 'Investimentos']].map(([k, l]) => '<button class="seg-i' + (lf.tipo === k ? ' on' : '') + '" data-lf="tipo" data-v="' + k + '">' + l + '</button>').join('') + '</div>' +
    A.sel('lf-nuc', [['ALL', 'Todos os núcleos'], ['PF', 'PF'], ['C1', A.nomeNCurto('C1')], ['C2', A.nomeNCurto('C2')]], lf.nucleo, 'data-lfs="nucleo" aria-label="Núcleo"') +
    A.sel('lf-st', [['ALL', 'Qualquer situação'], ['ok', 'Pagos/recebidos'], ['pend', 'Pendentes'], ['atr', 'Atrasados']], lf.status, 'data-lfs="status" aria-label="Situação"') +
    '<input class="in search" type="search" id="lf-q" placeholder="Buscar descrição, categoria…" value="' + esc(lf.q || '') + '">' +
    (todos ? '' : '<label class="chk inline"><input type="checkbox" id="lf-auto"' + (lf.auto ? ' checked' : '') + '> Mostrar automáticos</label>') +
    '<span class="sp"></span><button class="btn ghost sm" id="lf-csv">Exportar CSV</button></div>';
  h += '<p class="legend"><span class="lg-in">Campo que você preenche</span><span class="lg-calc">Calculado automaticamente</span><span class="lg-auto">Automático (compromisso ou parcela)</span><span class="lg-ex">Exemplo</span></p>';
  if (!rows.length) h += empty(st.lancamentos.length ? 'Nenhum lançamento com esses filtros.' : 'Nenhum lançamento ainda.', '<button class="btn primary" data-new="1">Fazer o primeiro lançamento</button>');
  else {
    h += '<div class="tbl-wrap"><table class="tbl lanc"><thead><tr><th>ID</th><th>Data</th><th>Tipo</th><th>Descrição</th><th>Categoria</th><th class="r">Valor</th><th>Situação</th><th>Núcleo</th><th>Conta / cartão</th><th>Forma</th><th>Comp.</th><th>Venc.</th><th>Pgto.</th><th>Obs.</th><th></th></tr></thead><tbody>';
    for (const r of rows.slice(0, lim)) h += r.k === 'm' ? rowManual(r.l) : rowAuto(r.m, r.tipo);
    h += '</tbody><tfoot><tr><td colspan="15"><span>Receitas <b class="pos">' + FE.brl(tR) + '</b></span><span>Despesas <b>' + FE.brl(tD) + '</b></span><span>Transferências e investimentos <b class="muted">' + FE.brl(tT) + '</b></span><span class="muted">' + rows.length + ' linha(s)</span></td></tr></tfoot></table></div>';
    if (rows.length > lim) h += '<p class="center"><button class="btn" id="lf-mais">Mostrar mais ' + Math.min(500, rows.length - lim) + '</button></p>';
  }
  return h;
};
function tipoTag(t) { return '<span class="tt tt-' + ({ Receita: 'r', Despesa: 'd', 'Transferência': 't', Investimento: 'i' }[t] || 'd') + '">' + esc(t) + '</span>'; }
function rowManual(l) {
  const stt = A.statusLanc(l), card = l.forma === 'Cartão de crédito' && l.cartaoId;
  const n = card ? Math.max(1, +l.parcelas || 1) : 1;
  const contaTxt = card ? (A.cartao(l.cartaoId) || {}).nome || 'Cartão' : (l.tipo === 'Transferência' || l.tipo === 'Investimento') ? A.nomeContaCurto(l.contaId) + ' → ' + (l.contaDestinoId ? A.nomeContaCurto(l.contaDestinoId) : 'externo') : A.nomeContaCurto(l.contaId);
  const valCls = l.tipo === 'Receita' ? 'pos' : (l.tipo === 'Despesa' ? '' : 'muted');
  const cat = l.tipo === 'Transferência' ? esc(l.categoria) : esc(l.categoria) + (l.subcategoria ? ' <span class="muted">› ' + esc(l.subcategoria) + '</span>' : '');
  const nuc = l.tipo === 'Transferência' && l.contaDestinoId ? A.nomeNCurto(l.nucleo) + ' → ' + A.nomeNCurto((A.conta(l.contaDestinoId) || {}).nucleo) : A.nomeNCurto(l.nucleo);
  const mix = (l.tipo === 'Receita' || l.tipo === 'Despesa') && ((card && (A.cartao(l.cartaoId) || {}).nucleo !== l.nucleo) || (!card && l.contaId && (A.conta(l.contaId) || {}).nucleo !== l.nucleo));
  return '<tr class="' + (l.exemplo ? 'ex' : '') + '"><td class="mono">L-' + String(l.seq || 0).padStart(5, '0') + (l.exemplo ? ' <span class="exb" title="Registro de exemplo">ex</span>' : '') + '</td><td>' + FE.dataBR(l.data) + '</td><td>' + tipoTag(l.tipo) + '</td><td class="desc">' + esc(l.descricao || '') + (n > 1 ? ' <span class="pill">' + n + 'x de ' + FE.brl(l.valor / n) + '</span>' : '') + (mix ? ' <span class="pill warn" title="Pago por conta de outro núcleo">PF/PJ</span>' : '') + '</td><td>' + cat + '</td><td class="r num ' + valCls + '">' + FE.brl(l.valor) + '</td><td>' + A.badge(stt.nivel, stt.txt) + '</td><td>' + esc(nuc) + '</td><td>' + esc(contaTxt) + '</td><td>' + esc(card ? 'Cartão' : (l.forma || '')) + '</td><td>' + FE.mesCurto(l.competencia || FE.ym(l.data)) + '</td><td>' + FE.dataBR(l.vencimento) + '</td><td>' + FE.dataBR(l.dataPagamento || ((stt.txt === 'Pago' || stt.txt === 'Recebido') ? l.data : '')) + '</td><td>' + (l.obs ? '<span class="obs" title="' + esc(l.obs) + '">nota</span>' : '') + '</td><td class="acts"><button class="lk" data-act="edit" data-id="' + l.id + '">Editar</button>' + (stt.txt === 'Pendente' || stt.txt === 'Atrasado' ? '<button class="lk" data-act="pay" data-id="' + l.id + '">' + (l.tipo === 'Receita' ? 'Recebi' : 'Paguei') + '</button>' : '') + '<button class="lk" data-act="dup" data-id="' + l.id + '">Duplicar</button></td></tr>';
}
function rowAuto(m, tipo) {
  const stt = m.realized ? (m.kind === 'R' ? 'Recebido' : 'Pago') : m.overdue ? 'Atrasado' : 'Pendente';
  const niv = m.realized ? 'ok' : m.overdue ? 'alerta' : 'atencao';
  const card = m.cartaoId ? (A.cartao(m.cartaoId) || {}).nome : null;
  const origem = m.src === 'comp' ? 'Compromisso' + (m.parcelas ? ' ' + m.parcela + '/' + m.parcelas : '') : m.src === 'inv' ? 'Carteira' : 'Parcela ' + m.parcela + '/' + m.parcelas;
  const conta = card ? card + ' (fatura ' + FE.mesCurto(m.faturaMes) + ')' : m.src === 'inv' && m.kind === 'T' ? (m.contaOrig ? A.nomeContaCurto(m.contaOrig) + ' → carteira' : 'carteira → ' + A.nomeContaCurto(m.contaDest)) : m.kind === 'T' ? A.nomeContaCurto(m.contaOrig) + ' → ' + A.nomeContaCurto(m.contaDest) : A.nomeContaCurto(m.contaId);
  const nuc = m.kind === 'T' ? A.nomeNCurto(m.from) + ' → ' + A.nomeNCurto(m.to) : A.nomeNCurto(m.nucleo);
  return '<tr class="auto' + (m.exemplo ? ' ex' : '') + '"><td class="mono muted">auto</td><td>' + FE.dataBR(m.data) + '</td><td>' + tipoTag(tipo) + '</td><td class="desc">' + esc(m.desc || '') + ' <span class="pill auto">' + esc(origem) + '</span></td><td>' + esc(m.kind === 'T' && m.src !== 'inv' ? m.tk : m.cat) + ((m.kind !== 'T' || m.src === 'inv') && m.sub ? ' <span class="muted">› ' + esc(m.sub) + '</span>' : '') + '</td><td class="r num ' + (m.kind === 'R' ? 'pos' : m.kind === 'T' ? 'muted' : '') + '">' + FE.brl(m.valor) + '</td><td>' + A.badge(niv, stt) + '</td><td>' + esc(nuc) + '</td><td>' + esc(conta) + '</td><td>' + (card ? 'Cartão' : m.src === 'inv' ? 'Carteira' : 'Automático') + '</td><td>' + FE.mesCurto(m.comp) + '</td><td>' + FE.dataBR(m.venc) + '</td><td>' + FE.dataBR(m.caixa) + '</td><td></td><td class="acts">' + (m.src === 'comp' ? '<button class="lk" data-act="ajuste" data-id="' + m.ref + '" data-mes="' + m.occ + '">Ajustar</button><button class="lk" data-act="comp" data-id="' + m.ref + '">Compromisso</button>' : m.src === 'inv' ? '<button class="lk" data-act="inv" data-id="' + m.ref + '">Ver operação</button>' : '<button class="lk" data-act="edit" data-id="' + m.ref + '">Ver compra</button>') + '</td></tr>';
}
P['lancamentos:after'] = function () {
  const ui = A.ui, main = $('#main');
  const n = $('#lf-new'); if (n) n.addEventListener('click', () => A.openLancamento(null));
  $$('[data-new]').forEach(b => b.addEventListener('click', () => A.openLancamento(null)));
  $$('[data-lf]').forEach(b => b.addEventListener('click', () => { ui.lf[b.dataset.lf] = b.dataset.v; A.saveUI(); A.render(); }));
  $$('[data-lfs]').forEach(s => s.addEventListener('change', () => { ui.lf[s.dataset.lfs] = s.value; A.saveUI(); A.render(); }));
  const qi = $('#lf-q'); if (qi) { let t; qi.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { ui.lf.q = qi.value; A.saveUI(); A.render(); const q2 = $('#lf-q'); q2.focus(); q2.setSelectionRange(q2.value.length, q2.value.length); }, 300); }); }
  const td = $('#lf-todos'); if (td) td.addEventListener('change', () => { ui.lfTodos = td.checked; A.saveUI(); A.render(); });
  const au = $('#lf-auto'); if (au) au.addEventListener('change', () => { ui.lf.auto = au.checked; A.saveUI(); A.render(); });
  const csv = $('#lf-csv'); if (csv) csv.addEventListener('click', A.exportCSV);
  const mais = $('#lf-mais'); if (mais) mais.addEventListener('click', () => { ui.lfLim = (ui.lfLim || 250) + 500; A.render(); });
  main.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', () => {
    const id = b.dataset.id, act = b.dataset.act, l = A.state.lancamentos.find(x => x.id === id);
    if (act === 'edit' && l) A.openLancamento(l);
    else if (act === 'dup' && l) A.openLancamento(l, { dup: true });
    else if (act === 'pay') A.marcarPago(id);
    else if (act === 'ajuste') A.openAjuste(id, b.dataset.mes);
    else if (act === 'comp') A.openCompromisso(A.state.compromissos.find(c => c.id === id));
    else if (act === 'inv') A.openOperacao(A.state.carteira.operacoes.find(o => o.id === id));
  }));
};

/* ======================= COMPROMISSOS ======================= */
P.compromissos = function () {
  const ui = A.ui, st = A.state, ctx = A.ctx;
  const fN = ui.cpNucleo || 'ALL', fS = ui.cpStatus || 'ativos';
  const rc = FE.resumoCompromissos(st, ctx.ledger).filter(r => (fN === 'ALL' || r.c.nucleo === fN) && (fS === 'todos' || (fS === 'ativos' ? r.status !== 'Encerrado' : r.status === 'Encerrado')));
  const all = FE.resumoCompromissos(st, ctx.ledger).filter(r => r.status !== 'Encerrado' && (r.c.tipo || 'Despesa') === 'Despesa' && (fN === 'ALL' || r.c.nucleo === fN));
  const soma = f => FE.r2(all.filter(f).reduce((s, r) => s + r.valorMes, 0));
  const perm = soma(r => r.c.recorrencia === 'Permanente'), temp = soma(r => r.c.recorrencia === 'Temporária'), parc = soma(r => r.c.recorrencia === 'Parcelamento');
  const pc = FE.resumoParceladosCartao(st, ctx.ledger).filter(p => p.restantes > 0 && (fN === 'ALL' || p.nucleo === fN));
  const pcMes = FE.r2(pc.reduce((s, p) => s + p.valorParcela, 0));
  const futuras = FE.parcelasFuturas(st, ctx.ledger, FE.viewOf(fN, 'ALL'));
  let h = head('Compromissos fixos', 'Cadastre uma vez: a planilha lança todo mês, projeta o futuro e avisa quando termina. Ocorrências vencidas são consideradas pagas automaticamente (ajuste em Cadastros).',
    A.filtroNucleo('cpNucleo') + '<select class="in" data-fsel="cpStatus" aria-label="Situação">' + [['ativos', 'Ativos e futuros'], ['encerrados', 'Encerrados'], ['todos', 'Todos']].map(([k, l]) => A.opt(k, l, fS)).join('') + '</select>');
  h += '<section class="panel pad0"><div class="kstrip">' +
    kk('Permanentes', FE.brl(perm) + '<small>/mês</small>', 'sem data para acabar') + kk('Temporários', FE.brl(temp) + '<small>/mês</small>', 'terminam sozinhos') + kk('Parcelamentos', FE.brl(parc + pcMes) + '<small>/mês</small>', 'inclui ' + FE.brl(pcMes) + ' no cartão') +
    kk('Total recorrente', FE.brl(perm + temp + parc + pcMes) + '<small>/mês</small>', 'despesas já contratadas') + kk('Parcelas futuras', FE.brl(futuras.total), futuras.ate ? 'até ' + FE.mesBarra(futuras.ate) : 'nenhuma') + '</div></section>';
  h += '<div class="toolbar"><button class="btn primary" id="cp-new">' + A.ICO.plus + 'Novo compromisso</button></div>';
  if (!rc.length) h += empty('Nenhum compromisso ' + (fS === 'encerrados' ? 'encerrado.' : 'cadastrado ainda. Comece pelos maiores: aluguel, financiamento, plano de saúde; nas empresas, contador, INSS do pró-labore, sistemas e o próprio pró-labore.'), fS === 'encerrados' ? '' : '<button class="btn primary" id="cp-new2">Cadastrar compromisso</button>');
  else {
    h += '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Descrição</th><th>Núcleo</th><th>Categoria</th><th class="r">Valor mensal</th><th>Recorrência</th><th>Início</th><th>Fim</th><th class="r">Parcela</th><th class="r">Pagas</th><th class="r">Restantes</th><th class="r">Valor restante</th><th>Próximo venc.</th><th>Situação</th><th></th></tr></thead><tbody>';
    for (const r of rc.sort((a, b) => b.valorMes - a.valorMes)) {
      const c = r.c, rec = (c.tipo || 'Despesa') === 'Receita';
      const linha = r.finito ? esc(c.descricao) + ' — ' + FE.brl(r.valorMes) + '/mês' + (r.parcelaAtual ? ' — parcela ' + r.parcelaAtual + '/' + r.n : '') + (r.valorRestante > 0 ? ' — faltam ' + FE.brl(r.valorRestante) : '') + ' — termina em ' + FE.mesBarra(r.lastM) : 'Sem data prevista para encerramento';
      const stn = r.status === 'Encerrado' ? 'info' : r.atrasadas ? 'alerta' : r.status === 'Futuro' ? 'atencao' : 'ok';
      h += '<tr class="' + (c.exemplo ? 'ex' : '') + '"><td class="desc"><b>' + esc(c.descricao) + '</b>' + (rec ? ' <span class="pill">receita</span>' : '') + '<p class="muted small">' + linha + '</p></td><td>' + esc(A.nomeNCurto(c.nucleo)) + '</td><td>' + esc(c.categoria) + ' <span class="muted">› ' + esc(c.subcategoria || '') + '</span></td><td class="r num">' + FE.brl(r.valorMes) + '</td><td>' + esc(c.recorrencia) + '</td><td>' + FE.dataBR(c.inicio) + '</td><td>' + (r.finito ? FE.mesBarra(r.lastM) : '<span class="muted">Sem data prevista</span>') + '</td><td class="r">' + (r.finito && r.parcelaAtual ? r.parcelaAtual + '/' + r.n : '—') + '</td><td class="r">' + r.pagas + '</td><td class="r">' + (r.restantes != null ? r.restantes : '—') + '</td><td class="r num">' + (r.valorRestante != null ? FE.brl(r.valorRestante) : '—') + '</td><td>' + (r.prox ? FE.dataBR(r.prox) : '—') + '</td><td>' + A.badge(stn, r.status + (r.atrasadas ? ', ' + r.atrasadas + ' atrasada(s)' : '')) + '</td><td class="acts"><button class="lk" data-cp="edit" data-id="' + c.id + '">Editar</button>' + (r.status === 'Encerrado' && c.encerradoEm ? '<button class="lk" data-cp="reabrir" data-id="' + c.id + '">Reativar</button>' : r.status !== 'Encerrado' ? '<button class="lk" data-cp="end" data-id="' + c.id + '">Encerrar</button>' : '') + '</td></tr>';
    }
    h += '</tbody></table></div>';
  }
  if (pc.length) {
    h += '<section class="panel"><div class="ph"><h2>Parcelamentos no cartão</h2><p class="muted small">Vêm das compras parceladas lançadas com cartão. Para alterar, edite a compra em Lançamentos.</p></div><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Compra</th><th>Cartão</th><th class="r">Parcela</th><th class="r">Valor da parcela</th><th class="r">Restantes</th><th class="r">Valor restante</th><th>Última fatura</th><th></th></tr></thead><tbody>' +
      pc.map(p => '<tr><td class="desc"><b>' + esc(p.l.descricao || p.l.subcategoria) + '</b><p class="muted small">' + esc(p.l.descricao || p.l.subcategoria) + ' — ' + FE.brl(p.valorParcela) + '/mês — parcela ' + p.parcelaAtual + '/' + p.n + ' — faltam ' + FE.brl(p.valorRestante) + ' — termina em ' + FE.mesBarra(p.lastM) + '</p></td><td>' + esc((A.cartao(p.cartaoId) || {}).nome || '') + '</td><td class="r">' + p.parcelaAtual + '/' + p.n + '</td><td class="r num">' + FE.brl(p.valorParcela) + '</td><td class="r">' + p.restantes + '</td><td class="r num">' + FE.brl(p.valorRestante) + '</td><td>' + FE.mesBarra(p.lastM) + '</td><td class="acts"><button class="lk" data-cp="lanc" data-id="' + p.l.id + '">Ver compra</button></td></tr>').join('') + '</tbody></table></div></section>';
  }
  return h;
};
function kk(l, v, n, cls) { return '<div class="k"><p class="kl">' + esc(l) + '</p><p class="kv ' + (cls || '') + '">' + v + '</p><p class="kn">' + (n || '&nbsp;') + '</p></div>'; }
A.kk = kk;
P['compromissos:after'] = function () {
  [$('#cp-new'), $('#cp-new2')].forEach(b => b && b.addEventListener('click', () => A.openCompromisso(null)));
  $$('[data-cp]').forEach(b => b.addEventListener('click', () => {
    const id = b.dataset.id, a = b.dataset.cp;
    if (a === 'edit') A.openCompromisso(A.state.compromissos.find(c => c.id === id));
    else if (a === 'end') A.encerrarCompromisso(id);
    else if (a === 'reabrir') A.reabrirCompromisso(id);
    else if (a === 'lanc') A.openLancamento(A.state.lancamentos.find(l => l.id === id));
  }));
};

/* ======================= CARTÕES ======================= */
P.cartoes = function () {
  const st = A.state, ctx = A.ctx, cards = st.cartoes;
  let h = head('Cartões de crédito', 'Compras no cartão entram mês a mês, parcela por parcela. O pagamento da fatura só baixa essas compras — nunca lance a fatura como despesa.');
  h += '<div class="toolbar"><button class="btn primary" id="k-new">' + A.ICO.plus + 'Novo cartão</button></div>';
  if (!cards.length) return h + empty('Nenhum cartão cadastrado.', '<button class="btn primary" id="k-new2">Cadastrar cartão</button>');
  if (!cards.some(c => c.id === A.ui.cartaoSel)) A.ui.cartaoSel = cards[0].id;
  const fat = [...ctx.ledger.faturas.values()];
  const info = c => {
    const fs = fat.filter(f => f.cartaoId === c.id).sort((a, b) => (a.mes < b.mes ? -1 : 1));
    const abertas = fs.filter(f => !f.pago);
    // limite usado: tudo o que já foi comprado e ainda não foi pago (inclui parcelas futuras); recorrências futuras ainda não usam limite
    let usado = 0;
    for (const f of abertas) for (const it of f.itens) if (it.src !== 'comp' || it.data <= ctx.today) usado += it.valor;
    usado = FE.r2(usado);
    const atual = abertas.find(f => f.venc >= ctx.today) || abertas[0] || fs[fs.length - 1];
    let futuras = 0;
    for (const f of abertas) if (atual && f.mes > atual.mes) for (const it of f.itens) if (it.src === 'card' && it.parcelas > 1) futuras += it.valor;
    return { fs, abertas, usado, atual, futuras: FE.r2(futuras), disp: FE.r2((+c.limite || 0) - usado) };
  };
  h += '<div class="cards-row">' + cards.map(c => {
    const i = info(c), p = c.limite > 0 ? Math.min(1, i.usado / c.limite) : 0;
    return '<button class="card-k' + (c.id === A.ui.cartaoSel ? ' on' : '') + '" data-ksel="' + c.id + '"><span class="ck-n">' + esc(c.nome) + '</span><span class="muted small">' + esc(A.nomeNCurto(c.nucleo)) + ' — fecha dia ' + c.fechamento + ', vence dia ' + c.vencimento + '</span><span class="meter sm"><span style="width:' + (p * 100).toFixed(1) + '%"></span></span><span class="small">' + FE.brl(i.usado) + ' usados de ' + FE.brl(c.limite) + '</span></button>';
  }).join('') + '</div>';
  const c = A.cartao(A.ui.cartaoSel), I = info(c);
  const futParc = I.futuras;
  h += '<section class="panel pad0"><div class="kstrip">' + kk('Fatura atual', I.atual ? FE.brl(I.atual.total) : '—', I.atual ? 'vence ' + FE.dataBR(I.atual.venc) + (I.atual.pago ? ' — paga' : '') : '') +
    kk('Parcelas nas próximas faturas', FE.brl(futParc), 'compras parceladas já feitas') + kk('Limite utilizado', FE.brl(I.usado), c.limite > 0 ? FE.pct(I.usado / c.limite, 0) + ' do limite' : '') + kk('Limite disponível', FE.brl(I.disp), '', I.disp < 0 ? 'neg' : '') + '</div></section>';
  // faturas
  const view = I.fs.filter(f => f.mes >= FE.addM(ctx.curM, -3) && f.mes <= FE.addM(ctx.curM, 8));
  h += '<div class="cols"><section class="panel"><div class="ph"><h2>Faturas</h2><button class="lk" id="k-edit">Editar cartão</button></div>';
  if (!view.length) h += '<p class="muted">Sem faturas no período.</p>';
  else h += '<table class="tbl compact"><thead><tr><th>Fatura</th><th>Vencimento</th><th class="r">Valor</th><th>Situação</th><th></th></tr></thead><tbody>' + view.map(f => {
    const stt = f.pago ? ['ok', 'Paga' + (f.explicit ? '' : ' (auto)')] : f.overdue ? ['alerta', 'Atrasada'] : f.venc >= ctx.today && f === I.atual ? ['atencao', 'Aberta'] : ['info', 'Futura'];
    return '<tr' + (f === I.atual ? ' class="hl"' : '') + '><td>' + FE.mesBarra(f.mes) + '</td><td>' + FE.dataBR(f.venc) + '</td><td class="r num">' + FE.brl(f.total) + '</td><td>' + A.badge(stt[0], stt[1]) + '</td><td class="acts"><button class="lk" data-fat="' + esc(f.key) + '">' + (f.pago ? 'Alterar' : 'Pagar') + '</button><button class="lk" data-fsee="' + esc(f.key) + '">Compras</button></td></tr>';
  }).join('') + '</tbody></table>';
  h += '</section>';
  const sel = (A.ui.faturaSel && ctx.ledger.faturas.get(A.ui.faturaSel) && ctx.ledger.faturas.get(A.ui.faturaSel).cartaoId === c.id) ? ctx.ledger.faturas.get(A.ui.faturaSel) : I.atual;
  h += '<section class="panel"><div class="ph"><h2>Compras da fatura ' + (sel ? FE.mesBarra(sel.mes) : '') + '</h2></div>';
  if (!sel || !sel.itens.length) h += '<p class="muted">Nenhuma compra.</p>';
  else h += '<table class="tbl compact"><thead><tr><th>Data</th><th>Descrição</th><th>Núcleo</th><th class="r">Valor</th></tr></thead><tbody>' + sel.itens.slice().sort((a, b) => (a.data < b.data ? -1 : 1)).map(m => '<tr><td>' + FE.dataBR(m.data) + '</td><td class="desc">' + esc(m.desc || m.sub) + (m.parcelas > 1 ? ' <span class="pill">' + m.parcela + '/' + m.parcelas + '</span>' : '') + (m.src === 'comp' ? ' <span class="pill auto">recorrente</span>' : '') + '</td><td>' + esc(A.nomeNCurto(m.nucleo)) + '</td><td class="r num">' + FE.brl(m.valor) + '</td></tr>').join('') + '</tbody><tfoot><tr><td colspan="3">Total</td><td class="r num"><b>' + FE.brl(sel.total) + '</b></td></tr></tfoot></table>';
  h += '</section></div>';
  const pc = FE.resumoParceladosCartao(st, ctx.ledger).filter(p => p.cartaoId === c.id && p.restantes > 0);
  if (pc.length) h += '<section class="panel"><div class="ph"><h2>Parcelas futuras neste cartão</h2><p class="muted small">Total: ' + FE.brl(pc.reduce((s, p) => s + p.valorRestante, 0)) + '</p></div><ul class="endl">' + pc.map(p => '<li><span>' + esc(p.l.descricao) + ' — parcela ' + p.parcelaAtual + '/' + p.n + '</span><span class="num">' + FE.brl(p.valorRestante) + ' restantes</span><span class="muted small">termina em ' + FE.mesBarra(p.lastM) + '</span></li>').join('') + '</ul></section>';
  return h;
};
P['cartoes:after'] = function () {
  [$('#k-new'), $('#k-new2')].forEach(b => b && b.addEventListener('click', () => A.openCartao(null)));
  const e = $('#k-edit'); if (e) e.addEventListener('click', () => A.openCartao(A.cartao(A.ui.cartaoSel)));
  $$('[data-ksel]').forEach(b => b.addEventListener('click', () => { A.ui.cartaoSel = b.dataset.ksel; A.ui.faturaSel = null; A.saveUI(); A.render(); }));
  $$('[data-fat]').forEach(b => b.addEventListener('click', () => A.openFatura(b.dataset.fat)));
  $$('[data-fsee]').forEach(b => b.addEventListener('click', () => { A.ui.faturaSel = b.dataset.fsee; A.render(); }));
};

/* ======================= CONTAS ======================= */
P.contas = function () {
  const st = A.state, ctx = A.ctx;
  let h = head('Contas e saldos', 'O saldo atual é calculado: saldo inicial + tudo o que foi pago ou recebido desde a data do saldo inicial. Informe o saldo do banco para conferir.');
  h += '<div class="toolbar"><button class="btn primary" id="ct-new">' + A.ICO.plus + 'Nova conta</button></div>';
  if (!st.contas.length) return h + empty('Nenhuma conta cadastrada. Cadastre ao menos a conta corrente da PF e a conta de cada empresa.', '<button class="btn primary" id="ct-new2">Cadastrar conta</button>');
  const sp = FE.saldoPorNucleo(st, ctx.ledger, ctx.today);
  // previsto até o fim do mês
  const prev = {}; for (const c of st.contas) prev[c.id] = sp.bal[c.id] || 0;
  for (const m of ctx.ledger.items) {
    if (m.realized || m.pmes !== ctx.curM || m.cartaoId) continue;
    if (m.kind === 'R' && m.contaId) prev[m.contaId] += m.valor;
    else if (m.kind === 'D' && m.contaId) prev[m.contaId] -= m.valor;
    else if (m.kind === 'T' && !m.implicit) { if (m.contaOrig) prev[m.contaOrig] -= m.valor; if (m.contaDest) prev[m.contaDest] += m.valor; }
  }
  for (const f of ctx.ledger.faturas.values()) if (!f.pago && FE.ym(f.venc) === ctx.curM && f.contaId && prev[f.contaId] != null) prev[f.contaId] -= f.total;
  h += '<div class="nuc3">' + ['PF', 'C1', 'C2'].map(n => { const o = sp.porNucleo[n]; return '<section class="panel"><p class="kl">' + esc(A.nomeN(n)) + '</p><p class="big-n">' + FE.brl(o.total) + '</p><dl class="dl2"><div><dt>Caixa disponível</dt><dd>' + FE.brl(o.liquido + o.outros) + '</dd></div><div><dt>Reserva / investimentos</dt><dd>' + FE.brl(o.reserva) + '</dd></div></dl></section>'; }).join('') + '</div>';
  h += '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Conta</th><th>Instituição</th><th>Tipo</th><th>Núcleo</th><th class="r">Saldo inicial</th><th>Desde</th><th class="r">Saldo atual</th><th class="r">Previsto fim do mês</th><th>Reserva</th><th class="r">Saldo no banco</th><th class="r">Diferença</th><th></th></tr></thead><tbody>';
  for (const c of st.contas) {
    const s = sp.bal[c.id], dif = c.saldoBanco != null && c.saldoBanco !== '' && s != null ? FE.r2(c.saldoBanco - s) : null;
    h += '<tr class="' + (c.exemplo ? 'ex' : '') + '"><td><b>' + esc(c.nome) + '</b></td><td>' + esc(c.instituicao || '') + '</td><td>' + esc(c.tipo) + '</td><td>' + esc(A.nomeNCurto(c.nucleo)) + '</td><td class="r num">' + FE.brl(c.saldoInicial) + '</td><td>' + FE.dataBR(c.dataSaldo) + '</td><td class="r num ' + (s < 0 ? 'neg' : '') + '"><b>' + (s == null ? '—' : FE.brl(s)) + '</b></td><td class="r num">' + FE.brl(prev[c.id]) + '</td><td>' + (c.reserva ? 'Sim' : '') + '</td>' +
      '<td class="r"><span class="money sm"><span class="cur">R$</span><input class="in" data-sbanco="' + c.id + '" inputmode="decimal" value="' + esc(c.saldoBanco != null && c.saldoBanco !== '' ? A.fmtIn(c.saldoBanco) : '') + '" placeholder="conferir" aria-label="Saldo no banco"></span></td><td class="r num ' + (dif ? (Math.abs(dif) < 0.01 ? 'pos' : 'neg') : '') + '">' + (dif == null ? '' : Math.abs(dif) < 0.01 ? 'Confere' : A.brlS(dif)) + '</td><td class="acts"><button class="lk" data-ct="' + c.id + '">Editar</button></td></tr>';
  }
  h += '</tbody></table></div><p class="muted small">Diferença diferente de zero = algum lançamento faltando, duplicado ou com data/situação errada. Confira os pendentes e as faturas.</p>';
  return h;
};
P['contas:after'] = function () {
  [$('#ct-new'), $('#ct-new2')].forEach(b => b && b.addEventListener('click', () => A.openConta(null)));
  $$('[data-ct]').forEach(b => b.addEventListener('click', () => A.openConta(A.conta(b.dataset.ct))));
  $$('[data-sbanco]').forEach(i => i.addEventListener('change', () => { const c = A.conta(i.dataset.sbanco), v = A.parseValor(i.value); c.saldoBanco = isNaN(v) ? '' : FE.r2(v); A.commit(); }));
};

/* ======================= ORÇAMENTO ======================= */
P.orcamento = function () {
  const st = A.state, ctx = A.ctx, ui = A.ui;
  if (!['PF', 'C1', 'C2'].includes(ui.orcNucleo)) ui.orcNucleo = 'PF';
  const n = ui.orcNucleo, mes = ui.mes;
  const al = st.config.alertaOrcamento;
  let h = head('Orçamento', 'Limite mensal por categoria, separado por núcleo. Até ' + FE.pct(al[0], 0) + ' do orçado: normal; entre ' + FE.pct(al[0], 0) + ' e ' + FE.pct(al[1], 0) + ': atenção; acima: excedido.', A.filtroMes('mes') + A.filtroNucleo('orcNucleo', false));
  const rows = FE.orcamentoStatus(st, ctx, n, mes);
  const a = FE.getM(ctx.agg(n, 'ALL', 'comp'), mes);
  const tO = rows.reduce((s, r) => s + r.orcado, 0), tR = rows.reduce((s, r) => s + r.realizado, 0);
  h += '<div class="toolbar"><button class="btn" id="or-sug">Sugerir pela média dos últimos 3 meses</button><span class="sp"></span>' + (rows.length ? '<span class="muted small">Orçado ' + FE.brl(tO) + ' — realizado ' + FE.brl(tR) + ' (' + FE.pct(tO ? tR / tO : null, 0) + ')</span>' : '') + '</div>';
  if (!rows.length) h += empty('Nenhuma categoria orçada para ' + esc(A.nomeN(n)) + '.', '');
  else {
    h += '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Categoria</th><th class="r">Orçado</th><th class="r">Realizado</th><th class="r">Diferença</th><th>% utilizado</th><th>Situação</th><th></th></tr></thead><tbody>';
    for (const r of rows.sort((x, y) => y.uso - x.uso)) {
      const niv = r.status === 'Excedido' ? 'alerta' : r.status === 'Atenção' ? 'atencao' : 'ok';
      const p = isFinite(r.uso) ? r.uso : 1;
      h += '<tr><td><b>' + esc(r.categoria) + '</b></td><td class="r"><span class="money sm"><span class="cur">R$</span><input class="in" data-orc="' + r.o.id + '" inputmode="decimal" value="' + A.fmtIn(r.orcado) + '" aria-label="Orçado ' + esc(r.categoria) + '"></span></td><td class="r num">' + FE.brl(r.realizado) + '</td><td class="r num ' + (r.dif < 0 ? 'neg' : '') + '">' + A.brlS(r.dif) + '</td><td><div class="meter sm ' + niv + '"><span style="width:' + Math.min(100, p * 100).toFixed(1) + '%"></span></div><span class="small">' + (isFinite(r.uso) ? FE.pct(r.uso, 0) : '—') + '</span></td><td>' + A.badge(niv, r.status) + '</td><td class="acts"><button class="lk" data-ordel="' + r.o.id + '">Remover</button></td></tr>';
    }
    h += '</tbody></table></div>';
  }
  const usadas = new Set(rows.map(r => r.categoria));
  const cats = A.catsOf(n, 'Despesa').filter(c => !c.transfer && !usadas.has(c.nome));
  h += '<section class="panel"><div class="ph"><h2>Adicionar categoria ao orçamento</h2></div><div class="inline-form">' + A.sel('or-cat', cats.map(c => c.nome), '', 'id="or-cat"') + A.money('or-val', '', 'id="or-val" placeholder="Valor mensal"') + '<button class="btn primary" id="or-add">Adicionar</button></div></section>';
  const sem = Object.entries(a.cat).filter(([k]) => !usadas.has(k)).sort((x, y) => y[1] - x[1]);
  if (sem.length) h += '<section class="panel"><div class="ph"><h2>Gastos sem orçamento em ' + FE.mesCurto(mes) + '</h2></div><ul class="endl">' + sem.map(([k, v]) => '<li><span>' + esc(k) + '</span><span class="num">' + FE.brl(v) + '</span><span></span></li>').join('') + '</ul></section>';
  return h;
};
P['orcamento:after'] = function () {
  const st = A.state, n = A.ui.orcNucleo;
  $$('[data-orc]').forEach(i => i.addEventListener('change', () => { const o = st.orcamentos.find(x => x.id === i.dataset.orc), v = A.parseValor(i.value); if (o && !isNaN(v)) { o.valor = FE.r2(v); A.commit('Orçamento atualizado.'); } }));
  $$('[data-ordel]').forEach(b => b.addEventListener('click', () => { st.orcamentos = st.orcamentos.filter(x => x.id !== b.dataset.ordel); A.commit(); }));
  A.bindMoneyBlur($('#main'));
  const add = $('#or-add'); if (add) add.addEventListener('click', () => {
    const cat = $('#or-cat').value, v = A.parseValor($('#or-val').value);
    if (!cat || !(v > 0)) return A.toast('Escolha a categoria e o valor.', 'erro');
    st.orcamentos.push({ id: A.uid('or'), nucleo: n, categoria: cat, valor: FE.r2(v) }); A.commit('Categoria adicionada ao orçamento.');
  });
  const sug = $('#or-sug'); if (sug) sug.addEventListener('click', () => {
    const map = A.ctx.agg(n, 'ALL', 'comp'), b = FE.addM(A.ctx.curM, -1);
    const S = FE.sumRange(map, FE.addM(b, -2), b), nm = FE.monthsWithData(map, FE.addM(b, -2), b).length || 1;
    let k = 0;
    for (const [cat, v] of Object.entries(S.cat)) {
      if (cat === 'Pró-labore' || cat === 'Aporte em empresa') continue;
      const media = Math.ceil(v / nm / 50) * 50;
      const o = st.orcamentos.find(x => x.nucleo === n && x.categoria === cat);
      if (o) o.valor = media; else st.orcamentos.push({ id: A.uid('or'), nucleo: n, categoria: cat, valor: media });
      k++;
    }
    A.commit(k ? k + ' categorias orçadas pela média (arredondada para cima).' : 'Sem histórico para sugerir.');
  });
};

/* ======================= PROJEÇÕES ======================= */
P.projecoes = function () {
  const st = A.state, ctx = A.ctx, ui = A.ui, N = +ui.projN || 12, nuc = ui.projNucleo || 'ALL';
  const view = FE.viewOf(nuc, 'ALL');
  const pr = FE.projetar(st, ctx.ledger, view, N, ctx.agg(nuc, 'ALL', 'comp'));
  const filt = A.filtroNucleo('projNucleo') + '<div class="seg seg-f">' + [3, 6, 12, 24].map(n => '<button class="seg-i' + (n === N ? ' on' : '') + '" data-fset="projN" data-v="' + n + '">' + n + ' meses</button>').join('') + '</div>';
  let h = head('Projeções', 'Compromissos já assumidos (exatos) e um cenário-base estimado. ' + (pr.mesesBase ? 'Cenário-base: receitas e gastos variáveis = média dos últimos ' + pr.mesesBase + ' meses fechados.' : 'Sem histórico para o cenário-base.'), filt);
  const tot = pr.rows.reduce((s, r) => s + r.total, 0), last = pr.rows[pr.rows.length - 1];
  const fut = FE.parcelasFuturas(st, ctx.ledger, view);
  h += '<section class="panel pad0"><div class="kstrip">' + kk('Comprometido em ' + N + ' meses', FE.brl(tot), 'média ' + FE.brl(tot / N) + '/mês') + kk('Parcelas futuras', FE.brl(fut.total), fut.ate ? 'até ' + FE.mesBarra(fut.ate) : '') +
    kk('Saldo hoje', FE.brl(pr.saldoHoje), 'contas do núcleo') + kk('Saldo projetado', FE.brl(last.saldoProj), 'em ' + FE.mesBarra(last.mes) + ' (estimado)', A.sig(last.saldoProj - pr.saldoHoje) === 'neg' ? 'neg' : '') +
    kk('Resultado projetado', A.brlS(pr.rows.reduce((s, r) => s + r.resProj, 0) / N) + '<small>/mês</small>', 'média estimada', A.sig(pr.rows.reduce((s, r) => s + r.resProj, 0))) + '</div></section>';
  h += '<div class="charts">' + A.chartBox('pj-c', 'Compromissos já assumidos por mês') + A.chartBox('pj-s', 'Saldo projetado (estimado)') + '</div>';
  h += '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Mês</th><th class="r">Custos fixos</th><th class="r">Parcelamentos</th><th class="r">Financiamentos</th><th class="r">Outros compromissos</th><th class="r">Total comprometido</th><th class="r calc-h">Receita estimada</th><th class="r calc-h">Saídas estimadas</th><th class="r calc-h">Resultado estimado</th><th class="r calc-h">Saldo estimado</th></tr></thead><tbody>' +
    pr.rows.map((r, i) => { const prv = i ? pr.rows[i - 1].comprometidoSemVar : null, cai = prv != null && r.comprometidoSemVar < prv - 1; return '<tr><td>' + FE.mesCurto(r.mes) + (cai ? ' <span class="pill ok" title="Compromissos menores que no mês anterior">−' + FE.brl0(prv - r.comprometidoSemVar) + '</span>' : '') + '</td><td class="r num">' + FE.brl(r.fixos) + '</td><td class="r num">' + FE.brl(r.parc) + '</td><td class="r num">' + FE.brl(r.fin) + '</td><td class="r num">' + FE.brl(r.outros) + '</td><td class="r num"><b>' + FE.brl(r.total) + '</b></td><td class="r num muted">' + FE.brl(r.recProj) + '</td><td class="r num muted">' + FE.brl(r.saiProj) + '</td><td class="r num ' + A.sig(r.resProj) + '">' + A.brlS(r.resProj) + '</td><td class="r num">' + FE.brl(r.saldoProj) + '</td></tr>'; }).join('') + '</tbody></table></div>';
  h += '<p class="muted small">"Outros compromissos" = contas avulsas já lançadas como pendentes e compras à vista em faturas futuras. Valores estimados usam a maior entre a média histórica e o que já está agendado para o mês.' + (nuc === 'C1' || nuc === 'C2' ? ' Na empresa, o saldo projetado desconta a distribuição média aos sócios (' + FE.brl(pr.distMed) + '/mês).' : '') + '</p>';
  const enc = FE.encerramentos(st, ctx.ledger, view, FE.addM(ctx.curM, N - 1));
  h += '<div class="cols"><section class="panel"><div class="ph"><h2>Quando os compromissos terminam</h2></div>';
  if (!enc.length) h += '<p class="muted">Nenhum compromisso termina nos próximos ' + N + ' meses.</p>';
  else {
    const porMes = {}; for (const e of enc) if (e.tipo === 'Despesa') (porMes[e.libera] = porMes[e.libera] || []).push(e);
    h += '<ul class="timeline">' + Object.keys(porMes).sort().map(m => { const it = porMes[m], s = it.reduce((x, e) => x + e.valor, 0); return '<li><p class="tl-h">A partir de ' + FE.mesBarra(m) + ' haverá redução prevista de <b class="pos">' + FE.brl(s) + '</b> nos compromissos mensais.</p><ul>' + it.map(e => '<li>' + esc(e.desc) + ' (' + esc(A.nomeNCurto(e.nucleo)) + ') — ' + FE.brl(e.valor) + '/mês, última em ' + FE.mesBarra(e.lastM) + '</li>').join('') + '</ul></li>'; }).join('') + '</ul>';
  }
  h += '</section>';
  const cap = FE.capacidade(st, ctx.ledger, ctx, 'PF');
  h += '<section class="panel"><div class="ph"><h2>Quanto você pode assumir de novos gastos fixos (PF)?</h2></div>' + capHtml(cap) + '</section></div>';
  A._proj = pr;
  return h;
};
function capHtml(cap) {
  if (!cap) return '<p class="muted">Precisa de pelo menos um mês fechado com lançamentos da PF.</p>';
  const lim = A.state.config.limiteComprometimento;
  let h = '<p class="big-n ' + (cap.cap > 0 ? 'pos' : '') + '">' + FE.brl(cap.cap) + '<small>/mês hoje</small></p>';
  h += '<dl class="dl2"><div><dt>Renda média da PF</dt><dd>' + FE.brl(cap.renda) + '</dd></div><div><dt>Limite de comprometimento (' + FE.pct(lim, 0) + ')</dt><dd>' + FE.brl(cap.renda * lim) + '</dd></div><div><dt>Compromissos atuais</dt><dd>' + FE.brl(cap.comprom) + ' (' + FE.pct(cap.comprom / cap.renda, 0) + ')</dd></div><div><dt>Sobra média</dt><dd>' + FE.brl(cap.sobra) + '</dd></div></dl>';
  h += '<p class="small">' + (cap.folgaLimite < 0 ? 'Os compromissos já passam do limite de ' + FE.pct(lim, 0) + ' da renda em ' + FE.brl(-cap.folgaLimite) + '. Assumir algo novo agora pressiona o orçamento.' : 'A capacidade é o menor valor entre a folga até o limite (' + FE.brl(cap.folgaLimite) + ') e a sobra média (' + FE.brl(cap.sobra) + ').') +
    (cap.melhora ? ' A partir de <b>' + FE.mesBarra(cap.melhora.mes) + '</b>, com o fim de parcelas e compromissos, a capacidade sobe para <b>' + FE.brl(cap.capMelhora) + '/mês</b>.' : '') + '</p><p class="muted small">Base: últimos ' + cap.meses + ' meses fechados. O limite é ajustável em Cadastros.</p>';
  return h;
}
A.capHtml = capHtml;
P['projecoes:after'] = function () {
  const pr = A._proj; if (!pr) return;
  const lab = pr.rows.map(r => FE.mesCurto(r.mes));
  A.chart('pj-c', 'bar', { labels: lab, datasets: [
    { label: 'Financiamentos', data: pr.rows.map(r => r.fin), backgroundColor: COL.fin },
    { label: 'Fixos', data: pr.rows.map(r => r.fixos), backgroundColor: COL.fix },
    { label: 'Parcelamentos', data: pr.rows.map(r => r.parc), backgroundColor: COL.parc },
    { label: 'Outros', data: pr.rows.map(r => r.outros), backgroundColor: COL.var }] }, { stacked: true });
  A.chart('pj-s', 'line', { labels: lab, datasets: [{ label: 'Saldo estimado', data: pr.rows.map(r => r.saldoProj), borderColor: COL.saldo, backgroundColor: 'rgba(43,74,63,.08)', fill: true }] }, { legend: false });
};
})();

/* ==========================================================================
   Telas — Empresas, Patrimônio, Metas, Análises, Recomendações,
   Cadastros, Metodologia, Como usar
   ========================================================================== */
(function () {
'use strict';
const A = window.APP, { $, $$, esc } = A, COL = A.COL, P = A.pages;
const head = (...a) => A.head(...a), kk = (...a) => A.kk(...a);

/* ======================= CONSULTÓRIOS ======================= */
function pgPJ(n) {
  const st = A.state, ctx = A.ctx, ui = A.ui, mes = ui.mes, cfg = st.config;
  const map = ctx.agg(n, 'ALL', ui.regime), mapC = ctx.agg(n, 'ALL', 'comp');
  const cur = FE.getM(map, mes), d = FE.der(cur);
  const base = mes >= ctx.curM ? FE.addM(ctx.curM, -1) : mes;
  const r3 = [FE.addM(base, -2), base], p3 = [FE.addM(base, -5), FE.addM(base, -3)], r6 = [FE.addM(base, -5), base];
  const S3 = FE.sumRange(mapC, ...r3), SP = FE.sumRange(mapC, ...p3), S6 = FE.sumRange(mapC, ...r6);
  const n3 = FE.monthsWithData(mapC, ...r3).length, np = FE.monthsWithData(mapC, ...p3).length, n6 = FE.monthsWithData(mapC, ...r6).length;
  const sp = FE.saldoPorNucleo(st, ctx.ledger, ctx.today).porNucleo[n];
  let h = head(A.nomeN(n), 'Painel da empresa: receita, custos, margem, caixa e o que vai para a PF. ' + (ui.regime === 'comp' ? 'Por competência.' : 'Por caixa.'), A.filtroMes('mes') + A.filtroRegime());
  if (!cur.n && !n6) return h + A.empty('Ainda não há lançamentos da ' + esc(A.nomeN(n)) + '.', '<button class="btn primary" id="pj-new">Lançar receita da empresa</button>');
  // pendências
  const lim30 = FE.addDays(ctx.today, 30);
  const pend = ctx.ledger.items.filter(m => !m.realized && !m.implicit && (m.cartaoId ? m.venc : (m.venc || m.data)) <= lim30 && ((m.kind !== 'T' && m.nucleo === n) || (m.kind === 'T' && m.from === n)));
  const pagar = pend.filter(m => m.kind === 'D' || (m.kind === 'T' && m.from === n)), receber = pend.filter(m => m.kind === 'R');
  const sPag = FE.r2(pagar.reduce((s, m) => s + m.valor, 0)), sRec = FE.r2(receber.reduce((s, m) => s + m.valor, 0));
  const fix6 = n6 ? (S6.b.Fixa + S6.b.Financiamento + S6.b.Parcela) / n6 : 0;
  h += '<section class="panel pad0"><div class="kstrip">' +
    kk('Receita bruta', FE.brl(cur.rec), 'líquida: ' + FE.brl(d.recLiq)) + kk('Custos fixos', FE.brl(cur.b.Fixa + cur.b.Financiamento), 'com pró-labore') + kk('Custos variáveis', FE.brl(cur.b['Variável'] + cur.b.Parcela), 'com impostos e parcelas') +
    kk('Resultado operacional', A.brlS(d.res), '', A.sig(d.res)) + kk('Margem operacional', FE.pct(d.margem), 'resultado ÷ receita', d.margem != null && d.margem < 0 ? 'neg' : '') + kk('Caixa disponível', FE.brl(sp.total), fix6 > 0 ? FE.num(sp.total / fix6) + ' mês(es) de custos fixos' : '', sp.total < 0 ? 'neg' : '') +
    '</div><div class="kstrip">' + kk('Pró-labore', FE.brl(cur.prolab), 'pago à PF') + kk('Distribuição aos sócios', FE.brl(cur.dist), 'lucros') + kk('Retiradas pessoais', FE.brl(cur.retir), cur.mixN ? cur.mixN + ' pagamento(s) cruzado(s)' : '', cur.retir > 0 ? 'neg' : '') +
    kk('Aportes da PF', FE.brl(cur.apRec), '', cur.apRec > 0 ? 'neg' : '') + kk('Contas a pagar', FE.brl(sPag), pagar.filter(m => m.overdue).length ? pagar.filter(m => m.overdue).length + ' atrasada(s)' : 'próximos 30 dias') + kk('Contas a receber', FE.brl(sRec), receber.filter(m => m.overdue).length ? receber.filter(m => m.overdue).length + ' em atraso' : 'próximos 30 dias') + '</div></section>';
  // indicadores
  const ind = [];
  if (n6) {
    const m6 = FE.der(S6).margem;
    ind.push([m6 > 0.05 ? 'ok' : m6 > 0 ? 'atencao' : 'alerta', 'É lucrativo?', m6 > 0 ? 'Sim: margem operacional média de ' + FE.pct(m6) + ' em ' + n6 + ' meses (resultado de ' + FE.brl(S6.rec - S6.sai) + ').' : 'Não: resultado acumulado de ' + A.brlS(S6.rec - S6.sai) + ' em ' + n6 + ' meses.']);
  }
  if (n3 === 3 && np === 3 && SP.rec > 0 && SP.sai > 0) {
    const gR = S3.rec / SP.rec - 1, gC = S3.sai / SP.sai - 1;
    ind.push([gC - gR > 0.03 ? 'atencao' : 'ok', 'Despesas crescem mais que receitas?', (gC - gR > 0.03 ? 'Sim' : 'Não') + ': custos ' + FE.sinal(gC) + ' e receita ' + FE.sinal(gR) + ' (3 meses x 3 anteriores).']);
  }
  if (n6 && S6.rec > 0) {
    const pf = (S6.b.Fixa + S6.b.Financiamento + S6.b.Parcela) / S6.rec;
    ind.push([pf > 0.6 ? 'alerta' : pf > 0.5 ? 'atencao' : 'ok', 'Custos fixos elevados?', 'Custos fixos (com pró-labore, parcelas e financiamentos) consomem ' + FE.pct(pf, 0) + ' da receita. Referência adotada: até 50% confortável, acima de 60% elevado.']);
  }
  if (fix6 > 0) {
    const mc = sp.total / fix6, ref = +cfg.caixaPJMinMeses || 2;
    ind.push([mc >= ref ? 'ok' : mc >= 1 ? 'atencao' : 'alerta', 'Caixa saudável?', 'O caixa de ' + FE.brl(sp.total) + ' cobre ' + FE.num(mc) + ' mês(es) de custos fixos (' + FE.brl(fix6) + '/mês). Referência: ' + ref + ' meses.']);
  }
  if (n6) {
    const pess = S6.retir + S6.mix, saida = S6.dist + S6.retir, res6 = S6.rec - S6.sai;
    const niv = S6.apRec > 0 || pess > 0 ? 'atencao' : saida > res6 * 1.05 && saida > 0 ? 'atencao' : 'ok';
    ind.push([niv, 'Financia despesas pessoais?', (S6.retir > 0 ? 'Houve ' + FE.brl(S6.retir) + ' em retiradas pessoais (gastos da PF pagos pela empresa). ' : 'Sem retiradas pessoais. ') + (S6.apRec > 0 ? 'A PF aportou ' + FE.brl(S6.apRec) + '. ' : '') + 'Distribuiu ' + FE.brl(saida) + ' aos sócios para um resultado de ' + FE.brl(res6) + ' em ' + n6 + ' meses.']);
  }
  const limR = +cfg.limiteRetencaoLucros || 0, aliqR = +cfg.aliquotaRetencaoLucros || 0.1;
  if (limR > 0 && S6.dist > 0) {
    const acima = FE.mrange(FE.addM(mes, -5), mes).filter(m => FE.getM(mapC, m).dist > limR);
    ind.push([acima.length ? 'atencao' : 'ok', 'Lucros sujeitos a retenção de IR?', acima.length ?
      'Sim, em ' + acima.length + ' dos últimos 6 meses (' + acima.map(FE.mesCurto).join(', ') + ') a distribuição passou de ' + FE.brl(limR) + '. Acima desse valor no mês, pago pela mesma empresa à mesma pessoa física, há retenção de ' + FE.pct(aliqR, 0) + ' de IR na fonte sobre o total (Lei 15.270/2025). Confirme com o contador.' :
      'Não: nenhuma distribuição mensal acima de ' + FE.brl(limR) + ' nos últimos 6 meses (maior: ' + FE.brl(Math.max.apply(null, FE.mrange(FE.addM(mes, -5), mes).map(m => FE.getM(mapC, m).dist))) + '). Acima disso há retenção de ' + FE.pct(aliqR, 0) + ' de IR na fonte (Lei 15.270/2025).']);
  }
  h += '<div class="cols even"><section class="panel"><div class="ph"><h2>Indicadores</h2></div><ul class="diag">' + ind.map(i => '<li>' + A.badge(i[0]) + '<div><p><b>' + esc(i[1]) + '</b></p><p>' + esc(i[2]) + '</p></div></li>').join('') + '</ul></section>';
  // DRE
  const col = (S, k) => { const div = k || 1; const ib = S.impB || {}; return {
    rb: S.rec / div, imp: S.imp / div, rl: (S.rec - S.imp) / div,
    fix: (S.b.Fixa - S.prolab - (ib.Fixa || 0)) / div, vr: (S.b['Variável'] - (ib['Variável'] || 0)) / div, pf: (S.b.Parcela + S.b.Financiamento - (ib.Parcela || 0) - (ib.Financiamento || 0)) / div,
    pl: S.prolab / div, res: (S.rec - S.sai) / div, mg: S.rec > 0 ? (S.rec - S.sai) / S.rec : null, dist: S.dist / div, ret: S.retir / div, ap: S.apRec / div,
    cx: (S.rec - S.sai - S.dist - S.retir - S.tOut + S.apRec + S.tIn) / div }; };
  const C = [col(cur, 1), col(S3, n3 || 1), col(S6, n6 || 1)];
  const L = [['Receita bruta', 'rb', 'b'], ['(−) Impostos sobre a receita', 'imp'], ['= Receita líquida', 'rl', 'b'], ['(−) Custos fixos', 'fix'], ['(−) Custos variáveis', 'vr'], ['(−) Parcelas e financiamentos', 'pf'], ['(−) Pró-labore', 'pl'], ['= Resultado operacional', 'res', 'b s'], ['Margem operacional', 'mg', 'p'], ['(−) Distribuição aos sócios', 'dist'], ['(−) Retiradas pessoais', 'ret'], ['(+) Aportes da PF', 'ap'], ['= Caixa gerado', 'cx', 'b s']];
  h += '<section class="panel"><div class="ph"><h2>Demonstrativo de resultado</h2></div><div class="tbl-wrap"><table class="tbl dre"><thead><tr><th></th><th class="r">' + FE.mesCurto(mes) + '</th><th class="r">Média 3 meses</th><th class="r">Média 6 meses</th></tr></thead><tbody>' +
    L.map(([l, k, f]) => '<tr class="' + (f || '') + '"><td>' + esc(l) + '</td>' + C.map(c => '<td class="r num ' + (f && f.includes('s') ? A.sig(c[k]) : '') + '">' + (f === 'p' ? FE.pct(c[k]) : FE.brl(c[k])) + '</td>').join('') + '</tr>').join('') + '</tbody></table></div><p class="muted small">Médias sobre meses fechados até ' + FE.mesBarra(base) + '.</p></section></div>';
  h += '<div class="charts">' + A.chartBox('pj1', 'Receita x custos por mês') + A.chartBox('pj2', 'Margem operacional por mês') + '</div>';
  // contas a pagar/receber
  const lista = (arr, t) => arr.length ? '<table class="tbl compact"><thead><tr><th>Vencimento</th><th>Descrição</th><th class="r">Valor</th><th></th></tr></thead><tbody>' + arr.sort((a, b) => (a.venc < b.venc ? -1 : 1)).slice(0, 12).map(m => '<tr><td>' + FE.dataBR(m.venc) + '</td><td class="desc">' + esc(m.desc || m.sub || m.cat) + '</td><td class="r num">' + FE.brl(m.valor) + '</td><td>' + (m.overdue ? A.badge('alerta', 'Atrasado') : '') + '</td></tr>').join('') + '</tbody></table>' + (arr.length > 12 ? '<p class="muted small">+ ' + (arr.length - 12) + ' itens</p>' : '') : '<p class="muted">Nada ' + t + '.</p>';
  h += '<div class="cols even"><section class="panel"><div class="ph"><h2>Contas a pagar</h2><p class="muted small">' + FE.brl(sPag) + ', atrasadas e com vencimento nos próximos 30 dias</p></div>' + lista(pagar, 'a pagar') + '</section><section class="panel"><div class="ph"><h2>Contas a receber</h2><p class="muted small">' + FE.brl(sRec) + ', em atraso e previstas para os próximos 30 dias</p></div>' + lista(receber, 'a receber') + '</section></div>';
  A._pj = { n, map, mes };
  return h;
}
function pgPJAfter() {
  const D = A._pj; const b = $('#pj-new'); if (b) b.addEventListener('click', () => A.openLancamento(null, { tipo: 'Receita', nucleo: A.page().toUpperCase(), responsavel: 'NA' }));
  if (!D) return;
  const months = FE.mrange(FE.addM(D.mes, -11), D.mes), lab = months.map(FE.mesCurto), g = m => FE.getM(D.map, m);
  A.chart('pj1', 'bar', { labels: lab, datasets: [{ label: 'Receita', data: months.map(m => g(m).rec), backgroundColor: COL.ent }, { label: 'Custos', data: months.map(m => g(m).sai), backgroundColor: COL.sai }] });
  A.chart('pj2', 'line', { labels: lab, datasets: [{ label: 'Margem', data: months.map(m => FE.der(g(m)).margem), borderColor: COL[D.n], backgroundColor: COL[D.n] }] }, { pct: true, legend: false });
}
P.c1 = () => pgPJ('C1'); P['c1:after'] = pgPJAfter;
P.c2 = () => pgPJ('C2'); P['c2:after'] = pgPJAfter;

/* ======================= PATRIMÔNIO ======================= */
P.patrimonio = function () {
  const st = A.state, ctx = A.ctx, pat = st.patrimonio, p = FE.patrimonio(st, ctx.ledger);
  let h = head('Patrimônio e dívidas', 'Patrimônio líquido = ativos − passivos. Saldos de contas, carteira de investimentos (pela última cotação) e parcelas futuras entram sozinhos; o resto você atualiza quando mudar.');
  h += '<section class="hero slim"><div class="hero-main"><p class="kl">Patrimônio líquido</p><p class="pl-n ' + A.sig(p.pl) + '">' + FE.brl(p.pl) + '</p><p class="muted">' + FE.brl(p.ativos) + ' em ativos − ' + FE.brl(p.passivos) + ' em passivos' + (p.ativos > 0 ? ' (dívidas = ' + FE.pct(p.passivos / p.ativos, 0) + ' dos ativos)' : '') + '</p></div></section>';
  const tbl = (lado, itens, auto) => '<table class="tbl compact"><thead><tr><th>Descrição</th><th>Tipo</th><th class="r">Valor</th><th></th></tr></thead><tbody>' + auto + itens.map(i => '<tr class="' + (i.exemplo ? 'ex' : '') + '"><td>' + esc(i.descricao) + '</td><td>' + esc(i.tipo) + '</td><td class="r num">' + FE.brl(i.valor) + '</td><td class="acts"><button class="lk" data-bem="' + lado + '" data-id="' + i.id + '">Editar</button></td></tr>').join('') + '</tbody></table>';
  const autoA = '<tr class="auto"><td>Saldos em contas <span class="pill auto">automático</span></td><td>Saldo bancário</td><td class="r num">' + FE.brl(p.contasTot) + '</td><td></td></tr>' +
    (st.carteira.ativos.length ? '<tr class="auto"><td>Carteira de investimentos <span class="pill auto">automático</span></td><td>Valor de mercado</td><td class="r num">' + FE.brl(p.carteira) + '</td><td class="acts"><a class="lk" href="#investimentos">Ver</a></td></tr>' : '');
  const autoP = '<tr class="auto"><td>Parcelas futuras de compras e parcelamentos <span class="pill auto">automático</span></td><td>Parcelamentos</td><td class="r num">' + (pat.incluirParcelas !== false ? FE.brl(p.parcelas) : '<span class="muted">não incluído</span>') + '</td><td class="acts"><button class="lk" id="pt-tog">' + (pat.incluirParcelas !== false ? 'Não incluir' : 'Incluir') + '</button></td></tr>';
  h += '<div class="cols even"><section class="panel"><div class="ph"><h2>Ativos</h2><button class="btn sm" data-bnew="ativos">' + A.ICO.plus + 'Ativo</button></div>' + tbl('ativos', pat.ativos, autoA) + '<p class="tot">Total <b>' + FE.brl(p.ativos) + '</b></p></section>' +
    '<section class="panel"><div class="ph"><h2>Passivos</h2><button class="btn sm" data-bnew="passivos">' + A.ICO.plus + 'Passivo</button></div>' + tbl('passivos', pat.passivos, autoP) + '<p class="tot">Total <b>' + FE.brl(p.passivos) + '</b></p><p class="muted small">Financiamentos: informe aqui o saldo devedor do contrato. A parcela mensal fica em Compromissos fixos.</p></section></div>';
  h += '<div class="charts one">' + A.chartBox('pt-ch', 'Evolução do patrimônio líquido') + '</div>';
  return h;
};
P['patrimonio:after'] = function () {
  $$('[data-bnew]').forEach(b => b.addEventListener('click', () => A.openBem(b.dataset.bnew, null)));
  $$('[data-bem]').forEach(b => b.addEventListener('click', () => A.openBem(b.dataset.bem, A.state.patrimonio[b.dataset.bem].find(x => x.id === b.dataset.id))));
  const t = $('#pt-tog'); if (t) t.addEventListener('click', () => { A.state.patrimonio.incluirParcelas = A.state.patrimonio.incluirParcelas === false; A.commit(); });
  const hist = A.state.patrimonio.historico.map(x => x.mes).sort();
  const ini = hist[0] || A.ctx.curM;
  const months = FE.mrange(FE.mdiff(ini, A.ctx.curM) > 23 ? FE.addM(A.ctx.curM, -23) : ini, A.ctx.curM);
  const s = FE.serieIDPatrimonio(A.state, A.ctx.ledger, months);
  if (s.filter(v => v != null).length < 2) { const el = $('#pt-ch'); if (el) el.parentElement.innerHTML = '<p class="muted small">A evolução aparece a partir do segundo mês com patrimônio registrado. A planilha guarda uma fotografia por mês automaticamente.</p>'; return; }
  A.chart('pt-ch', 'line', { labels: months.map(FE.mesCurto), datasets: [{ label: 'Patrimônio líquido', data: s, borderColor: COL.saldo, backgroundColor: 'rgba(43,74,63,.08)', fill: true }] }, { legend: false });
};

/* ======================= METAS ======================= */
P.metas = function () {
  const st = A.state, ctx = A.ctx, mt = FE.metasResumo(st, ctx.ledger);
  const base = FE.addM(ctx.curM, -1), pf = ctx.agg('PF', 'ALL', 'comp');
  const n6 = FE.monthsWithData(pf, FE.addM(base, -5), base).length;
  const sobra = n6 ? FE.der(FE.sumRange(pf, FE.addM(base, -5), base)).res / n6 : null;
  const nec = mt.reduce((s, m) => s + m.aporteMensal, 0);
  let h = head('Metas', 'Quanto falta, em quanto tempo e quanto guardar por mês para chegar lá.');
  h += '<div class="toolbar"><button class="btn primary" id="mt-new">' + A.ICO.plus + 'Nova meta</button><span class="sp"></span>' + (mt.length ? '<span class="small">Aporte necessário total: <b>' + FE.brl(nec) + '/mês</b>' + (sobra != null ? ' — sobra média da PF: <b class="' + (sobra >= nec ? 'pos' : 'neg') + '">' + FE.brl(sobra) + '/mês</b>' : '') + '</span>' : '') + '</div>';
  if (!mt.length) return h + A.empty('Nenhuma meta cadastrada. Exemplos: reserva de emergência, entrada de imóvel, viagem, troca de carro, estrutura do escritório.', '<button class="btn primary" id="mt-new2">Cadastrar meta</button>');
  h += '<div class="metas">' + mt.map(m => '<article class="panel meta' + (m.m.exemplo ? ' ex' : '') + '"><div class="ph"><h2>' + esc(m.m.nome) + '</h2><button class="lk" data-mt="' + m.m.id + '">Editar</button></div><p class="meta-v"><span class="num">' + FE.brl(m.acum) + '</span> <span class="muted">de ' + FE.brl(m.alvo) + '</span></p><div class="meter"><span style="width:' + (m.prog * 100).toFixed(1) + '%"></span></div><p class="small"><b>' + FE.pct(m.prog, 0) + '</b> concluído' + (m.m.vinculo ? ' — acompanha ' + (m.m.vinculo === 'RESERVA' ? 'as contas de reserva' : m.m.vinculo === 'CARTEIRA' ? 'a carteira de investimentos' : 'a conta ' + esc(A.nomeContaCurto(m.m.vinculo))) : '') + '</p><dl class="dl2"><div><dt>Quanto falta</dt><dd>' + FE.brl(m.falta) + '</dd></div><div><dt>Data desejada</dt><dd>' + (m.m.data ? FE.dataBR(m.m.data) : '—') + '</dd></div><div><dt>Meses restantes</dt><dd>' + (m.meses != null ? m.meses : '—') + '</dd></div><div><dt>Aporte mensal necessário</dt><dd class="' + (m.vencida ? 'neg' : '') + '">' + (m.falta <= 0 ? 'Meta atingida' : FE.brl(m.aporteMensal)) + '</dd></div></dl></article>').join('') + '</div>';
  return h;
};
P['metas:after'] = function () {
  [$('#mt-new'), $('#mt-new2')].forEach(b => b && b.addEventListener('click', () => A.openMeta(null)));
  $$('[data-mt]').forEach(b => b.addEventListener('click', () => A.openMeta(A.state.metas.find(x => x.id === b.dataset.mt))));
};

/* ======================= ANÁLISES ======================= */
P.analises = function () {
  const st = A.state, ctx = A.ctx, ui = A.ui, mes = ui.mes;
  const map = ctx.agg(ui.nucleo, ui.resp, 'comp');
  const cmp = FE.comparacoes(map, mes, ctx.curM);
  const c1 = FE.comparacoes(ctx.agg('C1', 'ALL', 'comp'), mes, ctx.curM), c2 = FE.comparacoes(ctx.agg('C2', 'ALL', 'comp'), mes, ctx.curM);
  let h = head('Análises comparativas', 'Visão: ' + esc(ui.nucleo === 'ALL' ? 'consolidado' : A.nomeN(ui.nucleo)) + (ui.resp !== 'ALL' ? ', ' + esc(A.nomeResp(ui.resp)) : '') + ', por competência.' + (mes === ctx.curM ? ' O mês atual ainda está em andamento.' : ''), A.filtroMes('mes') + A.filtroNucleo('nucleo'));
  const metr = [
    ['Entradas', x => x.A.ent, x => x.B.ent, 'v'], ['Saídas', x => x.A.sai, x => x.B.sai, 'v', true], ['Resultado', x => x.dA.res, x => x.dB.res, 'v'],
    ['Custos fixos', x => x.A.b.Fixa + x.A.b.Financiamento, x => x.B.b.Fixa + x.B.b.Financiamento, 'v', true], ['Despesas variáveis', x => x.A.b['Variável'], x => x.B.b['Variável'], 'v', true],
    ['Taxa de poupança', x => x.dA.taxa, x => x.dB.taxa, 'pp'],
  ];
  const cell = (a, b, tipo, inv, temB, nA, nB) => {
    if (!temB) return '<td class="cmp na"><span class="muted small">sem base completa</span></td>';
    if (tipo === 'pp') { const dlt = a != null && b != null ? (a - b) * 100 : null; return '<td class="cmp"><b class="' + (dlt == null ? '' : dlt >= 0 ? 'pos' : 'neg') + '">' + (dlt == null ? '—' : (dlt >= 0 ? '+' : '') + FE.num(dlt) + ' p.p.') + '</b><span class="small muted">' + FE.pct(a) + ' x ' + FE.pct(b) + '</span></td>'; }
    const v = FE.varPct(a, b), good = v == null ? null : inv ? v <= 0 : v >= 0;
    const mult = nA && nA > 1 ? ' (média ' + FE.brl0(a / nA) + ')' : '';
    return '<td class="cmp"><b class="' + (good == null || Math.abs(v) < 0.005 ? '' : good ? 'pos' : 'neg') + '">' + FE.sinal(v) + '</b><span class="small muted">' + FE.brl0(a) + ' x ' + FE.brl0(b) + '</span></td>';
  };
  h += '<div class="tbl-wrap"><table class="tbl cmpt"><thead><tr><th>Indicador</th>' + cmp.map(c => '<th>' + esc(c.nome) + '</th>').join('') + '</tr></thead><tbody>';
  for (const [nome, fa, fb, tipo, inv] of metr) h += '<tr><td><b>' + nome + '</b></td>' + cmp.map(c => cell(fa(c), fb(c), tipo, inv, c.temB && c.temA)).join('') + '</tr>';
  h += '<tr><td><b>Resultado ' + esc(A.nomeNCurto('C1')) + '</b></td>' + c1.map(c => cell(c.dA.res, c.dB.res, 'v', false, c.temB && c.temA)).join('') + '</tr>';
  h += '<tr><td><b>Resultado ' + esc(A.nomeNCurto('C2')) + '</b></td>' + c2.map(c => cell(c.dA.res, c.dB.res, 'v', false, c.temB && c.temA)).join('') + '</tr>';
  h += '</tbody></table></div><p class="muted small">Verde = melhora (mais entrada, menos gasto, mais resultado); vermelho = piora. "Sem base completa" = o período anterior não tem todos os meses lançados.</p>';
  // categorias
  const base = mes >= ctx.curM ? FE.addM(ctx.curM, -1) : mes;
  const cur = FE.getM(map, mes), m3 = FE.sumRange(map, FE.addM(base, -2), base), m6 = FE.sumRange(map, FE.addM(base, -5), base);
  const n3 = FE.monthsWithData(map, FE.addM(base, -2), base).length || 1, n6 = FE.monthsWithData(map, FE.addM(base, -5), base).length || 1;
  const cats = Array.from(new Set(Object.keys(cur.cat).concat(Object.keys(m6.cat)))).map(k => ({ k, a: cur.cat[k] || 0, b3: (m3.cat[k] || 0) / n3, b6: (m6.cat[k] || 0) / n6 })).sort((x, y) => y.b6 - x.b6);
  h += '<div class="cols"><section class="panel"><div class="ph"><h2>Despesas por categoria</h2><p class="muted small">' + FE.mesCurto(mes) + ' x médias de meses fechados</p></div><table class="tbl compact"><thead><tr><th>Categoria</th><th class="r">' + FE.mesCurto(mes) + '</th><th class="r">Média 3m</th><th class="r">Média 6m</th><th class="r">3m x 6m</th></tr></thead><tbody>' +
    cats.map(c => { const v = FE.varPct(c.b3, c.b6); return '<tr><td>' + esc(c.k) + '</td><td class="r num">' + FE.brl(c.a) + '</td><td class="r num">' + FE.brl(c.b3) + '</td><td class="r num">' + FE.brl(c.b6) + '</td><td class="r ' + (v > 0.1 ? 'neg' : v < -0.1 ? 'pos' : '') + '">' + FE.sinal(v) + '</td></tr>'; }).join('') + '</tbody></table></section>';
  h += A.chartBox('an-rr', 'Receita prevista x realizada') + '</div>';
  A._an = { map, mes };
  return h;
};
P['analises:after'] = function () {
  const D = A._an; if (!D) return;
  const months = FE.mrange(FE.addM(D.mes, -11), D.mes), g = m => FE.getM(D.map, m);
  A.chart('an-rr', 'bar', { labels: months.map(FE.mesCurto), datasets: [{ label: 'Prevista', data: months.map(m => g(m).recPrev), backgroundColor: COL.var }, { label: 'Realizada', data: months.map(m => g(m).recReal), backgroundColor: COL.ent }] });
};

/* ======================= RECOMENDAÇÕES ======================= */
P.recomendacoes = function () {
  const st = A.state, ctx = A.ctx, mes = A.ui.mes;
  const rec = FE.recomendacoes(st, ctx.ledger, ctx, mes);
  let h = head('Recomendações', 'Orientações geradas a partir dos números lançados. São boas práticas de gestão, não aconselhamento financeiro profissional — decisões de investimento e tributárias pedem um especialista.', A.filtroMes('mes'));
  if (!rec.length) h += A.empty('Nada a recomendar com os dados atuais. As orientações aparecem quando há pelo menos 3 meses de lançamentos.');
  else h += '<ol class="recs">' + rec.map(r => '<li class="panel rec p' + r.prio + '"><p class="rec-t"><span class="rec-k">' + esc(r.tipo) + '</span>' + (r.prio === 1 ? A.badge('alerta', 'Prioridade alta') : r.prio === 2 ? A.badge('atencao', 'Prioridade média') : A.badge('info', 'Para considerar')) + '</p><h2>' + esc(r.titulo) + '</h2><p>' + esc(r.txt) + '</p>' + (r.efeito ? '<p class="rec-e">' + esc(r.efeito) + '</p>' : '') + '</li>').join('') + '</ol>';
  h += '<section class="panel"><div class="ph"><h2>Quanto dá para assumir de novos gastos fixos?</h2></div>' + A.capHtml(FE.capacidade(st, ctx.ledger, ctx, 'PF')) + '</section>';
  h += '<section class="panel"><div class="ph"><h2>Diagnóstico completo de ' + FE.mesLongo(mes) + '</h2></div><div class="cols even">' + ['ALL', 'PF', 'C1', 'C2'].map(n => { const dg = FE.diagnostico(st, ctx.ledger, ctx, n, 'ALL', mes); return '<div><h3>' + esc(n === 'ALL' ? 'Consolidado' : A.nomeN(n)) + '</h3>' + (dg.length ? '<ul class="diag">' + dg.map(x => '<li>' + A.badge(x.nivel) + '<p>' + esc(x.txt) + '</p></li>').join('') + '</ul>' : '<p class="muted small">Sem dados.</p>') + '</div>'; }).join('') + '</div></section>';
  return h;
};

/* ======================= CADASTROS ======================= */
P.cadastros = function () {
  const st = A.state, cfg = st.config;
  let tab = A.ui.cadTab || 'PF|Despesa'; if (!/^(PF|C1|C2)\|/.test(tab)) tab = 'PF|Despesa';
  let h = head('Cadastros e configurações', 'Nomes, categorias, formas de pagamento e parâmetros. Mudanças aqui valem para toda a planilha.');
  h += '<section class="panel"><div class="ph"><h2>Nomes</h2><p class="muted small">Nos textos as empresas aparecem com "PJ" na frente (ex.: "PJ ' + esc(A.nomeNCurto('C1')) + '"); não precisa digitar o "PJ".</p></div><form id="cad-nomes" class="grid2">' +
    A.fld('Nome da planilha', A.inp('nomeApp', cfg.nomeApp)) + A.fld('Pessoa física', A.inp('nomePF', cfg.nomePF)) +
    A.fld('Empresa 1', A.inp('nomeC1', FE.semPJ(cfg.nomeC1))) + A.fld('Empresa 2', A.inp('nomeC2', FE.semPJ(cfg.nomeC2))) + '</form></section>';
  // categorias
  const tabs = [['PF|Despesa', 'PF — despesas'], ['PF|Receita', 'PF — receitas']].concat(['C1', 'C2'].flatMap(n => [[n + '|Despesa', A.nomeNCurto(n) + ' — despesas'], [n + '|Receita', A.nomeNCurto(n) + ' — receitas']]));
  const [esc0, tipo] = tab.split('|');
  const cats = st.categorias.filter(c => c.escopo === esc0 && c.tipo === tipo);
  const uso = (cat, sub) => st.lancamentos.filter(l => FE.scopeOf(l.nucleo) === esc0 && l.tipo === tipo && l.categoria === cat && (sub == null || l.subcategoria === sub)).length + st.compromissos.filter(c => FE.scopeOf(c.nucleo) === esc0 && (c.tipo || 'Despesa') === tipo && c.categoria === cat && (sub == null || c.subcategoria === sub)).length;
  h += '<section class="panel"><div class="ph"><h2>Categorias e subcategorias</h2><p class="muted small">Cada núcleo tem as suas. Natureza e "essencial" definem como cada gasto entra nos indicadores. Novas categorias aparecem nos formulários e relatórios na hora.</p></div>';
  h += '<div class="seg seg-f tabs">' + tabs.map(([k, l]) => '<button class="seg-i' + (k === tab ? ' on' : '') + '" data-fset="cadTab" data-v="' + k + '">' + l + '</button>').join('') + '</div>';
  h += '<div class="tbl-wrap"><table class="tbl compact cats"><thead><tr><th>Categoria</th><th>Subcategoria</th>' + (tipo === 'Despesa' ? '<th>Natureza padrão</th><th>Essencial</th>' : '') + '<th class="r">Uso</th><th></th></tr></thead><tbody>';
  for (const c of cats) {
    c.subs.forEach((s, i) => {
      h += '<tr' + (i === 0 ? ' class="cat-first"' : '') + '><td>' + (i === 0 ? '<b>' + esc(c.nome) + '</b>' + (c.transfer ? ' <span class="pill">vira transferência</span>' : '') + (c.imp ? ' <span class="pill">imposto</span>' : '') + '<br><button class="lk" data-cat="ren" data-id="' + c.id + '">Renomear</button><button class="lk" data-cat="addsub" data-id="' + c.id + '">+ Subcategoria</button>' + (c.transfer ? '' : '<button class="lk" data-cat="del" data-id="' + c.id + '">Excluir</button>') : '') + '</td><td>' + esc(s.nome) + '</td>' +
        (tipo === 'Despesa' ? '<td>' + (c.transfer ? '<span class="muted small">—</span>' : A.sel('nat', [['Fixa', 'Custo fixo'], ['Variável', 'Variável'], ['Parcela', 'Parcelamento'], ['Financiamento', 'Financiamento / dívida']], s.nat || 'Variável', 'data-subnat="' + c.id + '|' + i + '" aria-label="Natureza"')) + '</td><td>' + (c.transfer ? '' : '<input type="checkbox" data-subess="' + c.id + '|' + i + '"' + (s.ess ? ' checked' : '') + ' aria-label="Essencial">') + '</td>' : '') +
        '<td class="r muted">' + uso(c.nome, s.nome) + '</td><td class="acts"><button class="lk" data-sub="ren" data-id="' + c.id + '|' + i + '">Renomear</button>' + (c.subs.length > 1 ? '<button class="lk" data-sub="del" data-id="' + c.id + '|' + i + '">Excluir</button>' : '') + '</td></tr>';
    });
  }
  h += '</tbody></table></div><div class="inline-form"><input class="in" id="nc-nome" placeholder="Nova categoria"><input class="in" id="nc-sub" placeholder="Primeira subcategoria"><button class="btn primary" id="nc-add" data-esc="' + esc0 + '" data-tipo="' + tipo + '">Adicionar categoria</button></div></section>';
  // formas
  h += '<section class="panel"><div class="ph"><h2>Formas de pagamento</h2></div><div class="chips">' + cfg.formas.map((f, i) => '<span class="chip">' + esc(f) + (f === 'Cartão de crédito' ? '' : '<button class="icon-btn xs" data-fdel="' + i + '" aria-label="Remover ' + esc(f) + '">' + A.ICO.x + '</button>') + '</span>').join('') + '</div><div class="inline-form"><input class="in" id="nf" placeholder="Nova forma de pagamento"><button class="btn" id="nf-add">Adicionar</button></div></section>';
  // parâmetros
  h += '<section class="panel"><div class="ph"><h2>Parâmetros</h2><p class="muted small">Referências usadas nos indicadores, alertas e na saúde financeira. Ajuste à realidade de vocês.</p></div><form id="cad-par" class="grid3">' +
    A.fld('Início do controle', A.inp('inicioControle', cfg.inicioControle, 'type="month"'), { help: 'Compromissos só geram lançamentos a partir deste mês.' }) +
    A.fld('Meta de taxa de poupança', A.inp('metaPoupanca', FE.num(cfg.metaPoupanca * 100, 0), 'inputmode="decimal"') , { help: '% da renda (nota máxima no índice).' }) +
    A.fld('Limite de comprometimento da renda', A.inp('limiteComprometimento', FE.num(cfg.limiteComprometimento * 100, 0), 'inputmode="decimal"'), { help: '% da renda com fixos + parcelas + dívidas.' }) +
    A.fld('Meta de reserva (meses)', A.inp('metaReservaMeses', cfg.metaReservaMeses, 'type="number" min="1" max="36"')) +
    A.fld('Faixas da reserva (meses)', A.inp('faixasReserva', cfg.faixasReserva.join(' / '), 'placeholder="3 / 6 / 12"'), { help: 'Atenção abaixo da 1ª; razoável até a 2ª; confortável até a 3ª.' }) +
    A.fld('Caixa mínimo da empresa (meses de custo fixo)', A.inp('caixaPJMinMeses', cfg.caixaPJMinMeses, 'type="number" min="0" max="12" step="0.5"')) +
    A.fld('Margem de referência das empresas', A.inp('metaMargemPJ', FE.num(cfg.metaMargemPJ * 100, 0), 'inputmode="decimal"'), { help: '% (nota máxima no índice).' }) +
    A.fld('Alertas de orçamento', A.inp('alertaOrcamento', cfg.alertaOrcamento.map(x => FE.num(x * 100, 0)).join(' / '), 'placeholder="80 / 100"'), { help: '% de atenção / % de excedido.' }) +
    A.fld('Taxa de referência dos investimentos (% a.a.)', A.inp('taxaReferenciaAA', FE.num(cfg.taxaReferenciaAA * 100, 2), 'inputmode="decimal"'), { help: 'Ex.: CDI. Padrão: 13,65% (Selic 13,75% desde 16/09/2026, menos 0,10). Atualize quando a Selic mudar.' }) +
    A.fld('Peso máximo de um ativo na carteira (%)', A.inp('limiteConcentracao', FE.num(cfg.limiteConcentracao * 100, 0), 'inputmode="decimal"')) +
    A.fld('Queda desde a máxima: atenção / alerta (%)', A.inp('limitesQueda', cfg.limitesQueda.map(x => FE.num(x * 100, 0)).join(' / '), 'placeholder="15 / 30"')) +
    A.fld('IR: vendas de ações isentas até (R$/mês)', A.money('irIsencaoAcoes', cfg.irIsencaoAcoes), { help: 'Pessoa física, operações comuns.' }) +
    A.fld('IR: alíquotas ações, ETFs, BDRs / FIIs (%)', A.inp('irAliquotas', cfg.irAliquotas.map(x => FE.num(x * 100, 0)).join(' / '), 'placeholder="15 / 20"')) +
    A.fld('Lucros sem retenção de IR (por empresa, por mês)', A.money('limiteRetencaoLucros', cfg.limiteRetencaoLucros), { help: 'Lei 15.270/2025. Zero desliga o alerta.' }) +
    A.fld('Alíquota da retenção sobre lucros', A.inp('aliquotaRetencaoLucros', FE.num(cfg.aliquotaRetencaoLucros * 100, 0), 'inputmode="decimal"'), { help: '% sobre o total distribuído no mês.' }) +
    '<label class="chk"><input type="checkbox" name="baixaAutomatica"' + (cfg.baixaAutomatica ? ' checked' : '') + '> Considerar pagos automaticamente compromissos e faturas vencidos</label></form></section>';
  // dados
  h += '<section class="panel"><div class="ph"><h2>Dados e backup</h2><p class="muted small">Os dados ficam no seu servidor e sincronizam com os aparelhos em que você entrou. O backup em JSON continua útil como cópia fora do servidor.</p></div><div class="toolbar"><button class="btn" id="bk-exp">Baixar backup (JSON)</button><label class="btn">Restaurar backup<input type="file" id="bk-imp" accept="application/json,.json" hidden></label><button class="btn" id="bk-csv">Exportar lançamentos (CSV)</button><span class="sp"></span>' + (A.temExemplos() ? '<button class="btn" id="bk-demo">Remover exemplos</button>' : '<button class="btn ghost" id="bk-load">Carregar dados de exemplo</button>') + '<button class="btn danger ghost" id="bk-zero">Apagar tudo</button></div></section>';
  return h;
};
function renomearEmTudo(escopo, tipo, de, para, sub) {
  const st = A.state, okN = n => FE.scopeOf(n) === escopo;
  for (const l of st.lancamentos) if (okN(l.nucleo) && l.tipo === tipo && l.categoria === de) { if (sub == null) l.categoria = para; else if (l.subcategoria === sub) l.subcategoria = para; }
  for (const c of st.compromissos) if (okN(c.nucleo) && (c.tipo || 'Despesa') === tipo && c.categoria === de) { if (sub == null) c.categoria = para; else if (c.subcategoria === sub) c.subcategoria = para; }
  if (sub == null && tipo === 'Despesa') for (const o of st.orcamentos) if (okN(o.nucleo) && o.categoria === de) o.categoria = para;
}
function pedirNome(titulo, atual, cb) {
  const m = A.modal(titulo, '<form class="form" id="pn">' + A.fld('Nome', A.inp('nome', atual || '', 'maxlength="60" autofocus')) + '</form>', { foot: '<span class="sp"></span><button class="btn" data-close="1">Cancelar</button><button class="btn primary" id="pn-ok">Salvar</button>' });
  const go = () => { const v = $('#pn input', m).value.trim(); if (!v) return; A.closeModal(); cb(v); };
  $('#pn-ok', m.parentElement).addEventListener('click', go);
  $('#pn', m).addEventListener('submit', e => { e.preventDefault(); go(); });
}
P['cadastros:after'] = function () {
  const st = A.state, cfg = st.config;
  $('#cad-nomes').addEventListener('change', e => { let v = e.target.value.trim(); if (e.target.name === 'nomeC1' || e.target.name === 'nomeC2') v = FE.semPJ(v); if (v) { cfg[e.target.name] = v; A.commit('Nome atualizado.'); } });
  $('#cad-par').addEventListener('change', e => {
    const t = e.target, n = t.name, num = s => A.parseValor(String(s).replace('%', ''));
    if (n === 'baixaAutomatica') cfg.baixaAutomatica = t.checked;
    else if (n === 'inicioControle') { if (t.value) cfg.inicioControle = t.value; }
    else if (n === 'irIsencaoAcoes') { const v = A.parseValor(t.value); if (!(v >= 0)) return A.toast('Informe um valor.', 'erro'); cfg.irIsencaoAcoes = FE.r2(v); }
    else if (n === 'taxaReferenciaAA') { const v = num(t.value); if (!(v >= 0 && v <= 100)) return A.toast('Informe um percentual entre 0 e 100.', 'erro'); cfg.taxaReferenciaAA = v / 100; }
    else if (n === 'limiteConcentracao') { const v = num(t.value); if (!(v > 0 && v <= 100)) return A.toast('Informe um percentual entre 1 e 100.', 'erro'); cfg.limiteConcentracao = v / 100; }
    else if (n === 'limitesQueda' || n === 'irAliquotas') { const a = t.value.split('/').map(num); if (a.length !== 2 || a.some(x => isNaN(x) || x < 0 || x > 100)) return A.toast('Use dois percentuais, ex.: 15 / 30.', 'erro'); if (n === 'limitesQueda' && a[0] >= a[1]) return A.toast('O limite de alerta precisa ser maior que o de atenção.', 'erro'); cfg[n] = a.map(x => x / 100); }
    else if (n === 'limiteRetencaoLucros') { const v = A.parseValor(t.value); if (!(v >= 0)) return A.toast('Informe um valor (zero desliga).', 'erro'); cfg.limiteRetencaoLucros = FE.r2(v); }
    else if (['metaPoupanca', 'limiteComprometimento', 'metaMargemPJ', 'aliquotaRetencaoLucros'].includes(n)) { const v = num(t.value); if (!(v >= 0 && v <= 100)) return A.toast('Informe um percentual entre 0 e 100.', 'erro'); cfg[n] = v / 100; }
    else if (n === 'metaReservaMeses' || n === 'caixaPJMinMeses') { const v = num(t.value); if (!(v >= 0)) return; cfg[n] = v; }
    else if (n === 'faixasReserva') { const a = t.value.split('/').map(num); if (a.length !== 3 || a.some(isNaN) || !(a[0] < a[1] && a[1] < a[2])) return A.toast('Use três números crescentes, ex.: 3 / 6 / 12.', 'erro'); cfg.faixasReserva = a; }
    else if (n === 'alertaOrcamento') { const a = t.value.split('/').map(num); if (a.length !== 2 || a.some(isNaN) || a[0] >= a[1]) return A.toast('Use dois percentuais, ex.: 80 / 100.', 'erro'); cfg.alertaOrcamento = a.map(x => x / 100); }
    A.commit('Parâmetro atualizado.');
  });
  const catById = id => st.categorias.find(c => c.id === id);
  $$('[data-cat]').forEach(b => b.addEventListener('click', () => {
    const c = catById(b.dataset.id); if (!c) return;
    if (b.dataset.cat === 'ren') pedirNome('Renomear categoria', c.nome, v => { if (st.categorias.some(x => x !== c && x.escopo === c.escopo && x.tipo === c.tipo && x.nome === v)) return A.toast('Já existe uma categoria com esse nome.', 'erro'); renomearEmTudo(c.escopo, c.tipo, c.nome, v); c.nome = v; A.commit('Categoria renomeada em todos os registros.'); });
    else if (b.dataset.cat === 'addsub') pedirNome('Nova subcategoria em ' + c.nome, '', v => { if (c.subs.some(s => s.nome === v)) return A.toast('Subcategoria já existe.', 'erro'); c.subs.push({ nome: v, nat: c.tipo === 'Despesa' ? 'Variável' : undefined, ess: false }); A.commit('Subcategoria criada.'); });
    else if (b.dataset.cat === 'del') {
      const u = st.lancamentos.filter(l => FE.scopeOf(l.nucleo) === c.escopo && l.tipo === c.tipo && l.categoria === c.nome).length + st.compromissos.filter(x => FE.scopeOf(x.nucleo) === c.escopo && (x.tipo || 'Despesa') === c.tipo && x.categoria === c.nome).length;
      if (u) return A.toast('A categoria tem ' + u + ' registro(s). Renomeie ou mova esses registros antes de excluir.', 'erro');
      A.confirm('Excluir a categoria "' + esc(c.nome) + '"?', 'Excluir', () => { st.categorias = st.categorias.filter(x => x !== c); st.orcamentos = st.orcamentos.filter(o => !(FE.scopeOf(o.nucleo) === c.escopo && o.categoria === c.nome)); A.commit('Categoria excluída.'); }, true);
    }
  }));
  $$('[data-sub]').forEach(b => b.addEventListener('click', () => {
    const [id, i] = b.dataset.id.split('|'), c = catById(id), s = c && c.subs[+i]; if (!s) return;
    if (b.dataset.sub === 'ren') pedirNome('Renomear subcategoria', s.nome, v => { renomearEmTudo(c.escopo, c.tipo, c.nome, v, s.nome); s.nome = v; A.commit('Subcategoria renomeada.'); });
    else {
      const u = st.lancamentos.filter(l => FE.scopeOf(l.nucleo) === c.escopo && l.tipo === c.tipo && l.categoria === c.nome && l.subcategoria === s.nome).length + st.compromissos.filter(x => FE.scopeOf(x.nucleo) === c.escopo && x.categoria === c.nome && x.subcategoria === s.nome).length;
      if (u) return A.toast('Subcategoria usada em ' + u + ' registro(s). Renomeie em vez de excluir.', 'erro');
      c.subs.splice(+i, 1); A.commit('Subcategoria excluída.');
    }
  }));
  $$('[data-subnat]').forEach(s => s.addEventListener('change', () => { const [id, i] = s.dataset.subnat.split('|'); catById(id).subs[+i].nat = s.value; A.commit('Natureza atualizada — indicadores recalculados.'); }));
  $$('[data-subess]').forEach(s => s.addEventListener('change', () => { const [id, i] = s.dataset.subess.split('|'); catById(id).subs[+i].ess = s.checked; A.commit('Atualizado.'); }));
  $('#nc-add').addEventListener('click', e => {
    const nome = $('#nc-nome').value.trim(), sub = $('#nc-sub').value.trim() || 'Geral', b = e.currentTarget;
    if (!nome) return A.toast('Dê um nome à categoria.', 'erro');
    if (st.categorias.some(c => c.escopo === b.dataset.esc && c.tipo === b.dataset.tipo && c.nome === nome)) return A.toast('Já existe.', 'erro');
    st.categorias.push({ id: A.uid('cat'), escopo: b.dataset.esc, tipo: b.dataset.tipo, nome, subs: [{ nome: sub, nat: 'Variável', ess: false }] });
    A.commit('Categoria criada.');
  });
  $$('[data-fdel]').forEach(b => b.addEventListener('click', () => { cfg.formas.splice(+b.dataset.fdel, 1); A.commit(); }));
  $('#nf-add').addEventListener('click', () => { const v = $('#nf').value.trim(); if (v && !cfg.formas.includes(v)) { cfg.formas.push(v); A.commit('Forma de pagamento adicionada.'); } });
  $('#bk-exp').addEventListener('click', A.exportJSON);
  $('#bk-csv').addEventListener('click', A.exportCSV);
  $('#bk-imp').addEventListener('change', e => { const f = e.target.files[0]; if (f) A.importJSON(f); });
  const dm = $('#bk-demo'); if (dm) dm.addEventListener('click', A.removerExemplos);
  const ld = $('#bk-load'); if (ld) ld.addEventListener('click', () => A.confirm('Carregar os dados de exemplo? Isso substitui todos os dados atuais, também no servidor. O servidor guarda a versão anterior, mas baixe um backup antes, se precisar.', 'Carregar exemplos', () => { A.state = DATA.demoState(A.todayIso()); A.commit('Dados de exemplo carregados.'); }, true));
  $('#bk-zero').addEventListener('click', () => A.confirm('Apagar <b>todos</b> os dados (lançamentos, contas, cartões, compromissos, metas, patrimônio e categorias personalizadas)? Não dá para desfazer.', 'Apagar tudo', () => { A.state = DATA.defaultState(A.todayIso()); A.commit('Planilha zerada.'); A.go('como-usar'); }, true));
};

/* ======================= METODOLOGIA ======================= */
P.metodologia = function () {
  const st = A.state, ctx = A.ctx, cfg = st.config;
  const sa = FE.saude(st, ctx.ledger, ctx, ctx.curM);
  let h = head('Metodologia', 'Como cada número é calculado. Nada aqui é caixa-preta: os parâmetros marcados podem ser ajustados.');
  h += '<section class="panel"><div class="ph"><h2>Saúde financeira — nota atual: ' + (sa.score == null ? 'sem dados' : sa.score + ' (' + sa.faixa.nome + ')') + '</h2><p class="muted small">Calculada com os meses fechados até ' + FE.mesBarra(sa.base) + '. Critérios sem dado saem da conta e os pesos restantes são redistribuídos.</p></div>';
  h += '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Critério</th><th>Valor medido</th><th>Como vira nota</th><th class="r">Nota (0–100)</th><th class="r">Peso</th><th class="r">Contribuição</th></tr></thead><tbody>' +
    sa.comps.map(c => '<tr><td><b>' + esc(c.nome) + '</b></td><td>' + esc(c.valor) + '</td><td class="small">' + esc(c.detalhe) + '</td><td class="r">' + (c.nota == null ? '—' : c.nota) + '</td><td class="r"><input class="in xs" type="number" min="0" max="50" data-peso="' + c.key + '" value="' + c.peso + '" aria-label="Peso de ' + esc(c.nome) + '"></td><td class="r">' + (c.contrib == null ? '—' : FE.num(c.contrib)) + '</td></tr>').join('') +
    '</tbody><tfoot><tr><td colspan="4">Nota final = soma das contribuições (média ponderada)</td><td class="r">' + sa.comps.reduce((s, c) => s + c.peso, 0) + '</td><td class="r"><b>' + (sa.score == null ? '—' : sa.score) + '</b></td></tr></tfoot></table></div>';
  h += '<p class="small">Faixas: 85 a 100 excelente; 70 a 84 saudável; 55 a 69 atenção; 40 a 54 risco; abaixo de 40 crítico. <button class="lk" id="peso-reset">Restaurar pesos padrão</button></p>';
  h += '<p class="small muted">Os critérios 1 a 5 medem a PF: sua renda é o que entra na PF, inclusive pró-labore e lucros vindos das empresas. Os critérios 6 a 8 olham o conjunto, porque as empresas são a fonte dessa renda. Assim um custo da empresa não se confunde com gasto pessoal, e uma empresa que distribui mais do que gera aparece no critério 8.</p></section>';
  const sec = (t, body) => '<section class="panel prose"><h2>' + t + '</h2>' + body + '</section>';
  const nPF = esc(A.nomeN('PF')), n1 = esc(A.nomeN('C1')), n2 = esc(A.nomeN('C2'));
  h += '<div class="cols even">';
  h += sec('Núcleos e eliminação de transferências', '<p>Cada lançamento pertence a um núcleo: <b>' + nPF + '</b>, <b>' + n1 + '</b> ou <b>' + n2 + '</b>. Cada núcleo tem categorias próprias (em Cadastros). Dinheiro que passa de um núcleo para outro é <b>transferência</b>:</p><ul><li>Pró-labore: custo fixo da empresa e renda da PF.</li><li>Distribuição de lucros e retiradas: saem da empresa <i>depois</i> do resultado operacional; entram como renda da PF.</li><li>Aporte do sócio: sai da PF; na empresa não é receita.</li><li>Entre empresas: dinheiro que passa de uma PJ para a outra; some no consolidado.</li></ul><p>Na visão <b>consolidada</b> todas as transferências se anulam: entradas = receitas de fora (comissões, honorários, rendimentos…), saídas = gastos com terceiros. Nada é contado duas vezes.</p><p>Se um gasto pessoal é pago com conta ou cartão de uma empresa (ou o contrário), a planilha registra o gasto no núcleo certo e cria uma retirada/aporte implícito — e avisa como mistura PF/PJ.</p>');
  h += sec('Competência e caixa', '<p><b>Competência</b>: o mês a que o valor pertence, pago ou não. Mostra o mês completo, inclusive o que ainda vai vencer. É o padrão do painel.</p><p><b>Caixa</b>: só o que já foi pago/recebido, na data do pagamento. Bate com o extrato.</p><p>Compras no cartão: na competência, cada parcela entra a partir do mês da compra; no caixa, entra no mês de vencimento da fatura. O pagamento da fatura só baixa as compras — não é despesa nova.</p><p>Receita prevista = tudo lançado para o mês; realizada = o que tem situação "recebido". Comissão negociada e ainda não paga entra como prevista na data esperada.</p>');
  h += sec('Natureza dos gastos', '<ul><li><b>Custo fixo</b>: recorrente e difícil de cortar no curto prazo (aluguel, condomínio, plano de saúde, contador, sistemas).</li><li><b>Variável</b>: muda mês a mês (mercado, restaurante, anúncios, custas).</li><li><b>Parcelamento</b>: parcelas com fim definido (cartão parcelado, compromissos parcelados).</li><li><b>Financiamento / dívida</b>: imobiliário, veículo, empréstimos.</li></ul><p>As quatro somam o total de saídas (não se sobrepõem). <b>Renda comprometida</b> = (fixos + parcelamentos + financiamentos) ÷ entradas. <b>Taxa de poupança</b> = resultado ÷ entradas. <b>Fluxo de caixa livre</b> = resultado − valor aplicado em investimentos no mês.</p><p>Investimentos e aplicações não são despesa: mover dinheiro para a reserva não reduz o resultado — aparece em "investido".</p>');
  h += sec('Reserva, projeções e capacidade', '<p><b>Reserva</b> = saldo das contas marcadas como reserva (PF) ÷ média mensal das despesas essenciais dos últimos 6 meses fechados. Essenciais = subcategorias marcadas como essenciais + parcelas + financiamentos. Faixas atuais: menos de ' + cfg.faixasReserva[0] + ' meses atenção; até ' + cfg.faixasReserva[1] + ' razoável; até ' + cfg.faixasReserva[2] + ' confortável; acima, elevada segurança — referências, não regras.</p><p><b>Projeções</b>: compromissos e parcelas são exatos (já contratados). O cenário-base estima receitas e gastos variáveis pela média dos últimos 6 meses fechados, ou pelo que já está agendado, o que for maior. Como comissão oscila muito de um mês para o outro, a média de 6 meses suaviza picos e meses secos — lance as comissões já negociadas com a data prevista para elas entrarem na conta.</p><p><b>Capacidade para novos gastos fixos</b> = menor valor entre (renda média da PF × ' + FE.pct(cfg.limiteComprometimento, 0) + ' − compromissos atuais) e a sobra média mensal da PF.</p>');
  h += sec('Lucros e retenção de IR', '<p>Pela Lei 15.270/2025, desde 2026 lucros e dividendos pagos pela mesma empresa à mesma pessoa física acima de ' + FE.brl(cfg.limiteRetencaoLucros) + ' no mês têm retenção de ' + FE.pct(cfg.aliquotaRetencaoLucros, 0) + ' de IR na fonte sobre o total distribuído naquele mês. A planilha compara a distribuição mensal de cada PJ (por competência) com esse limite e avisa no painel da empresa e nas recomendações.</p><p>Pró-labore não entra nessa conta (é tributado como rendimento do trabalho). O ajuste anual do IR mínimo de altas rendas não é calculado aqui. Limite e alíquota são ajustáveis em Cadastros; o enquadramento final é com o contador.</p>');
  h += sec('Diagnóstico e recomendações', '<p>São regras sobre os números, sem texto pronto: cada frase só aparece quando a condição é verdadeira e sempre traz os valores que a sustentam. Exemplos de gatilhos:</p><ul><li>Subcategoria variável da PF que cresceu 20% ou mais (3 meses x 3 anteriores), com média acima de R$ 400 e peso de pelo menos 3% nos gastos.</li><li>Renda da PF comprometida acima do limite.</li><li>Receita média de uma empresa nos últimos 3 meses 5% ou mais abaixo da média dos 6 anteriores, com custos estáveis (comissão e êxito oscilam; a base de 6 meses evita alarme por um mês fraco).</li><li>Distribuição aos sócios acima do resultado operacional em 6 meses.</li><li>Caixa da empresa abaixo de ' + cfg.caixaPJMinMeses + ' meses de custos fixos.</li><li>Lucros de uma empresa acima de ' + FE.brl(cfg.limiteRetencaoLucros) + ' no mês (retenção de IR).</li><li>Reserva abaixo de ' + cfg.faixasReserva[0] + ' meses; parcelas futuras altas; metas acima da sobra; orçamento estourado em 2 de 3 meses.</li></ul>');
  h += sec('Investimentos', '<p><b>Preço médio</b>: custo ponderado de todas as compras, com as taxas. A venda não muda o preço médio; o resultado da venda = valor líquido recebido − preço médio × quantidade vendida.</p><p><b>Cotação</b>: o preço mais recente registrado — cotação que você informou ou o preço da última compra/venda. Atualizar a cotação acrescenta um ponto ao histórico; nada é apagado.</p><p><b>Retorno total</b> = resultado não realizado (valor de mercado − custo) + ganho realizado nas vendas + proventos. O percentual é sobre o total aplicado em compras.</p><p><b>Retorno por mês (TIR)</b>: a taxa que, aplicada a cada compra, venda e provento na data em que aconteceu, explica o valor de hoje. Por isso não se distorce quando você aporta em datas diferentes. Só aparece depois de 30 dias. O anual é o mensal composto por 12 meses.</p><p><b>Retorno de cada mês</b> (Dietz modificado) = (valor no fim − valor no início − aportes líquidos) ÷ (valor no início + aportes ponderados pelos dias que ficaram aplicados). Proventos contam como resultado.</p><p><b>Comparação com a referência</b> (' + FE.pct(cfg.taxaReferenciaAA, 2) + ' a.a.): quanto o mesmo dinheiro, nas mesmas datas, teria hoje rendendo a referência. A diferença em reais é o que a carteira ganhou ou perdeu a mais.</p><p><b>Saúde do ativo</b>: <i>Saudável</i> com TIR acima da referência e queda desde a máxima registrada abaixo de ' + FE.pct(cfg.limitesQueda[0], 0) + '; <i>Atenção</i> com TIR positiva mas abaixo da referência, ou queda entre ' + FE.pct(cfg.limitesQueda[0], 0) + ' e ' + FE.pct(cfg.limitesQueda[1], 0) + '; <i>Alerta</i> com TIR negativa há 6 meses ou mais, ou queda acima de ' + FE.pct(cfg.limitesQueda[1], 0) + '. Antes de 6 meses (e sem alerta), fica <i>Em formação</i>. Peso acima de ' + FE.pct(cfg.limiteConcentracao, 0) + ' e cotação velha aparecem como aviso, sem mudar o status.</p><p><b>Contas e resultado</b>: compra é transferência da conta para a carteira (não é despesa); venda volta para a conta (não é receita — o ganho aparece na carteira e no patrimônio); provento é receita em Rendimentos. Se a conta for de investimento (ex.: saldo na corretora), comprar não conta de novo como "investido".</p><p><b>IR estimado</b> (PF): ações ' + FE.pct(cfg.irAliquotas[0], 0) + ' sobre o ganho, isento no mês com vendas de ações até ' + FE.brl(cfg.irIsencaoAcoes) + '; ETFs e BDRs ' + FE.pct(cfg.irAliquotas[0], 0) + ' sem isenção; FIIs ' + FE.pct(cfg.irAliquotas[1], 0) + '. Não calcula day trade nem compensação de prejuízos. DARF até o último dia útil do mês seguinte.</p>');
  h += sec('Compromissos fixos', '<p><b>Permanente</b>: lança todo mês até ser encerrado; aparece 24 meses à frente nas projeções. <b>Temporário</b>: termina sozinho após o número de meses. <b>Parcelamento</b>: valor total ÷ parcelas; a última absorve centavos de arredondamento.</p><p>Servem também para receitas fixas, como honorário mensal de cliente. Ocorrências com vencimento passado são consideradas pagas/recebidas automaticamente (se a opção estiver ligada em Cadastros). Use "Ajustar" para mudar o valor de um mês, marcar como pendente ou dizer que não houve cobrança.</p>');
  h += '</div>';
  return h;
};
P['metodologia:after'] = function () {
  $$('[data-peso]').forEach(i => i.addEventListener('change', () => { const v = Math.max(0, Math.min(50, Math.round(+i.value || 0))); A.state.config.pesosSaude[i.dataset.peso] = v; A.commit('Peso atualizado.'); }));
  const r = $('#peso-reset'); if (r) r.addEventListener('click', () => { A.state.config.pesosSaude = Object.assign({}, FE.PESOS_PADRAO); A.commit('Pesos restaurados.'); });
};

/* ======================= COMO USAR ======================= */
P['como-usar'] = function () {
  const n1 = esc(A.nomeN('C1')), n2 = esc(A.nomeN('C2'));
  let h = head('Como usar', 'A rotina cabe em três passos. O resto se atualiza sozinho.');
  h += '<ol class="steps">' +
    '<li class="panel"><h2>Abra a planilha</h2><p>O painel mostra o mês atual: quanto entrou, quanto saiu, quanto sobrou e a saúde financeira — consolidado ou por núcleo (PF, ' + esc(A.nomeNCurto('C1')) + ', ' + esc(A.nomeNCurto('C2')) + '). Os dados ficam no seu servidor e sincronizam entre os aparelhos.</p></li>' +
    '<li class="panel"><h2>Toque em “Lançar”</h2><p>O botão fica no canto da tela, em qualquer página. Escolha <b>Despesa</b> ou <b>Receita</b>, o núcleo, o valor, a categoria e a conta. A data já vem preenchida com hoje.</p></li>' +
    '<li class="panel"><h2>Salve</h2><p>Pronto. Painel, projeções, orçamento, empresas e recomendações recalculam na hora. Não é preciso copiar fórmulas nem criar abas novas — nem virar o ano.</p></li></ol>';
  h += '<div class="cols even"><section class="panel prose"><h2>Uma vez só, no começo</h2><ol><li><b>Contas e saldos</b>: cadastre a conta da PF, a conta de cada PJ, reserva e investimentos, com o saldo de hoje. Marque quais formam a reserva de emergência.</li><li><b>Cartões</b>: nome, núcleo, limite, dia de fechamento e de vencimento.</li><li><b>Compromissos fixos</b>: tudo que se repete. Na PF: aluguel, condomínio, plano de saúde, faculdade/pós, financiamentos. Nas PJs: contador, INSS do pró-labore, sistemas, coworking, anuidades (CRECI, OAB). O pró-labore (PJ → PF) e os honorários mensais fixos de clientes também entram aqui.</li><li><b>Cadastros</b>: confira os nomes das empresas e ajuste as categorias de cada núcleo.</li><li>Se estiver vendo os exemplos, use <b>Remover exemplos e começar</b> no topo.</li></ol></section>' +
    '<section class="panel prose"><h2>Situações comuns</h2><ul><li><b>Comissão de venda fechada, ainda a receber</b>: lance como receita da ' + n1 + ' com a data prevista do pagamento. Fica pendente, aparece em "Contas a receber" e nas projeções. Quando cair, use "Recebi".</li><li><b>Repasse a corretor parceiro</b>: despesa da ' + n1 + ' em "Repasses de comissão".</li><li><b>Honorários de êxito ou sucumbência</b>: receita da ' + n2 + ' na categoria correspondente.</li><li><b>Custas pagas por você e reembolsadas pelo cliente</b>: a custa entra como despesa e o reembolso como receita ("Reembolso de custas"); um anula o outro.</li><li><b>Pró-labore ou lucros</b>: lance como receita da PF na categoria Pró-labore ou Distribuição de lucros e diga de qual conta veio. Vira transferência: não conta em dobro.</li><li><b>Gasto pessoal pago pela empresa</b>: lance como despesa da PF e escolha a conta/cartão da empresa. A planilha registra como retirada do sócio e avisa.</li><li><b>Compra parcelada no cartão</b>: lance o valor total, escolha "Cartão de crédito" e o número de parcelas. Cada parcela cai no mês certo.</li><li><b>Pagamento da fatura</b>: não lance como despesa. Em Cartões, use "Pagar" (ou deixe automático).</li><li><b>Comprar ou vender ações, FIIs, ETFs</b>: em Investimentos. A compra tira o dinheiro da conta e põe a posição no patrimônio; a venda faz o contrário e mostra o resultado. Atualize as cotações quando quiser (há atualização em lote).</li><li><b>Dividendos, JCP, rendimentos de FII</b>: em Investimentos, como Provento. Entram como receita da PF e no retorno do ativo.</li><li><b>Guardar dinheiro em renda fixa / CDB</b>: use o tipo Investimento (aplicar) entre contas. Não é despesa.</li><li><b>Passar dinheiro entre contas</b>: tipo Transferência. Não mexe no resultado.</li><li><b>Valor de um compromisso mudou só neste mês</b>: em Lançamentos, na linha automática, use "Ajustar".</li></ul></section></div>';
  h += '<div class="cols even"><section class="panel prose"><h2>Legenda</h2><p class="legend big"><span class="lg-in">Campo em azul: você preenche</span><span class="lg-calc">Texto normal: calculado automaticamente</span><span class="lg-auto">Linha automática: veio de compromisso ou parcela</span><span class="lg-ex">Marcado "ex": registro de exemplo</span></p><p>Valores em verde indicam sobra ou melhora; em vermelho, déficit ou piora. Avisos sempre vêm com ícone e texto, nunca só com cor.</p></section>' +
    '<section class="panel prose"><h2>Sincronização e backup</h2><p>Os dados ficam no seu servidor e em cada aparelho em que você entrou. Com conexão, cada alteração sobe em poucos segundos; sem conexão, fica salva no aparelho e sobe quando a conexão voltar. Se dois aparelhos alterarem os dados offline, o app pergunta qual versão manter e baixa a outra como backup. O servidor também guarda as versões anteriores.</p><p>Em Cadastros, <b>Baixar backup</b> gera uma cópia em JSON fora do servidor; <b>Restaurar backup</b> substitui os dados atuais (e sincroniza).</p><p>Exportar lançamentos (CSV) gera um arquivo que abre no Excel ou Google Planilhas.</p></section></div>';
  return h;
};
})();

/* ==========================================================================
   Interface — carteira de investimentos
   ========================================================================== */
(function () {
'use strict';
const A = window.APP, { $, $$, esc, clone } = A, COL = A.COL, P = A.pages, ICO = A.ICO;
const qf = v => (+v || 0).toLocaleString('pt-BR', { maximumFractionDigits: 8 });
const C = () => A.state.carteira;
const ativo = id => C().ativos.find(a => a.id === id);
const pctS = (v, d) => (v == null || !isFinite(v)) ? '—' : (v > 0.00005 ? '+' : '') + FE.pct(v, d == null ? 1 : d);
const sigP = v => (v == null || !isFinite(v)) ? '' : v > 0.00005 ? 'pos' : v < -0.00005 ? 'neg' : '';
const rotulo = a => a.ticker + (a.nome ? ' — ' + a.nome : '') + ((a.nucleo || 'PF') !== 'PF' ? ' · ' + A.nomeNCurto(a.nucleo) : '');
A.qf = qf;

/* ---------------- operação: compra, venda, provento ---------------- */
A.openOperacao = function (orig, preset) {
  const s = A.state, cart = C(), today = A.todayIso(), editing = !!orig;
  const f = orig ? clone(orig) : Object.assign({ tipo: 'Compra', data: today, contaId: A.ui.lastInvConta || '', provTipo: 'Dividendo' }, preset || {});
  f._novo = { ticker: '', nome: '', tipo: 'Ação', nucleo: 'PF' };
  for (const k of ['quantidade', 'preco', 'taxas', 'valor']) if (typeof f[k] === 'number') f[k] = k === 'quantidade' ? qf(f[k]) : A.fmtIn(f[k]);
  // posição antes desta operação (sem ela, se for edição)
  const outras = () => ({ carteira: { operacoes: cart.operacoes.filter(o => !editing || o.id !== orig.id) } });
  const posAntes = () => FE.posicaoEm(FE.opsDo(outras(), f.ativoId, f.data), f.data);
  function ativosOpts() {
    const list = cart.ativos.filter(a => f.tipo === 'Compra' || (editing && a.id === orig.ativoId) ||
      (f.tipo === 'Venda' ? FE.posicaoEm(FE.opsDo(s, a.id, today), today).qtd > 0 : FE.opsDo(s, a.id).length > 0));
    return list.map(a => [a.id, rotulo(a)]).concat(f.tipo === 'Compra' ? [['NOVO', '+ Novo ativo']] : []);
  }
  function calcTxt() {
    const q = A.parseValor(f.quantidade), p = A.parseValor(f.preco), tx = A.parseValor(f.taxas) || 0;
    if (!(q > 0) || !(p > 0)) return 'Informe quantidade e preço para ver o total.';
    if (f.tipo === 'Compra') {
      let t = 'Total da compra: <strong>' + FE.brl(q * p + tx) + '</strong>' + (tx ? ' (custo por unidade com taxas: ' + FE.brl((q * p + tx) / q) + ')' : '') + '.';
      if (f.ativoId && f.ativoId !== 'NOVO') { const pos = posAntes(); if (pos.qtd > 0) t += ' Preço médio: ' + FE.brl(pos.pm) + ' → ' + FE.brl((pos.custo + q * p + tx) / (pos.qtd + q)) + '; posição: ' + qf(pos.qtd) + ' → ' + qf(pos.qtd + q) + '.'; }
      return t;
    }
    const pos = posAntes();
    if (q > pos.qtd + 1e-9) return '<span class="warn-t">Em ' + FE.dataBR(f.data) + ' a posição era de ' + qf(pos.qtd) + ': não dá para vender ' + qf(q) + '.</span>';
    const liq = q * p - tx, g = liq - pos.pm * q;
    return 'Valor líquido da venda: <strong>' + FE.brl(liq) + '</strong>. Preço médio ' + FE.brl(pos.pm) + ' → resultado desta venda: <strong class="' + (g >= 0 ? 'pos' : 'neg') + '">' + A.brlS(g) + '</strong> (' + pctS(pos.pm > 0 ? g / (pos.pm * q) : null) + '). Ficam ' + qf(pos.qtd - q) + '.';
  }
  function body() {
    const T = f.tipo, ao = ativosOpts();
    if (!ao.some(o => o[0] === f.ativoId)) f.ativoId = (ao[0] || [''])[0];
    const novo = f.ativoId === 'NOVO', a = novo ? null : ativo(f.ativoId);
    const nuc = a ? (a.nucleo || 'PF') : f._novo.nucleo;
    if (!s.contas.some(c => c.id === f.contaId)) f.contaId = (s.contas.find(c => c.nucleo === nuc && c.tipo === 'Investimento') || s.contas.find(c => c.nucleo === nuc) || s.contas[0] || {}).id || '';
    let h = '<form class="form" id="opf" novalidate>';
    h += '<div class="tipo-tabs">' + A.seg('tipo', [['Compra', 'Compra'], ['Venda', 'Venda'], ['Provento', 'Provento']], T) + '</div>';
    if (!ao.length) h += '<p class="muted">' + (T === 'Venda' ? 'Nenhum ativo com posição aberta para vender.' : 'Nenhum ativo ainda: registre uma compra primeiro.') + '</p>';
    else h += A.fld('Ativo', A.sel('ativoId', ao, f.ativoId));
    if (novo) {
      h += '<div class="grid2">' + A.fld('Código (ticker)', A.inp('n_ticker', f._novo.ticker, 'maxlength="12" placeholder="Ex.: ITSA4" autocomplete="off"'), { req: 1 }) + A.fld('Tipo de ativo', A.sel('n_tipo', FE.TIPOS_ATIVO, f._novo.tipo)) + '</div>';
      h += '<div class="grid2">' + A.fld('Nome (opcional)', A.inp('n_nome', f._novo.nome, 'maxlength="60" placeholder="Ex.: Itaúsa"')) + A.fld('Núcleo', A.sel('n_nucleo', A.nucleoOptions(), f._novo.nucleo)) + '</div>';
    }
    if (!ao.length && !novo) return h + '</form>';
    if (T === 'Provento') {
      h += '<div class="grid2">' + A.fld('Tipo de provento', A.sel('provTipo', ['Dividendo', 'JCP', 'Rendimento (FII)', 'Outro'], f.provTipo)) + A.fld('Data do pagamento', A.inp('data', f.data, 'type="date"'), { req: 1 }) + '</div>';
      h += '<div class="grid2">' + A.fld('Valor líquido recebido', A.money('valor', f.valor), { req: 1, help: 'O que caiu na conta. JCP já vem com o IR retido.' }) + '<div></div></div>';
    } else {
      h += '<div class="grid2">' + A.fld('Data', A.inp('data', f.data, 'type="date"'), { req: 1 }) + A.fld('Quantidade', A.inp('quantidade', f.quantidade, 'inputmode="decimal" placeholder="Ex.: 100" autocomplete="off"'), { req: 1 }) + '</div>';
      h += '<div class="grid2">' + A.fld(T === 'Compra' ? 'Preço pago por unidade' : 'Preço de venda por unidade', A.money('preco', f.preco), { req: 1 }) + A.fld('Taxas (corretagem, emolumentos)', A.money('taxas', f.taxas), { help: T === 'Compra' ? 'Entram no preço médio.' : 'Saem do valor recebido.' }) + '</div>';
      h += '<p class="classif" id="op-calc">' + calcTxt() + '</p>';
    }
    h += A.fld(T === 'Compra' ? 'Dinheiro saiu da conta' : 'Dinheiro entrou na conta', s.contas.length ? A.sel('contaId', s.contas.map(c => [c.id, c.nome + ' (' + A.nomeNCurto(c.nucleo) + ')']), f.contaId) : '<p class="muted small">Cadastre uma conta em Contas e saldos (pode ser o saldo da corretora).</p>', { help: 'A conta onde o dinheiro realmente estava ou entrou — o saldo da corretora, se você mantém um.' });
    h += A.fld('Observações', '<textarea class="in" name="obs" rows="2" maxlength="300">' + esc(f.obs || '') + '</textarea>');
    return h + '</form>';
  }
  const foot = (editing ? '<button class="btn danger ghost" id="op-del">Excluir</button><span class="sp"></span>' : '<span class="sp"></span>') + '<button class="btn" data-close="1">Cancelar</button>' + (editing ? '' : '<button class="btn" id="op-more">Salvar e lançar outra</button>') + '<button class="btn primary" id="op-save">Salvar</button>';
  const m = A.modal(editing ? 'Editar operação' : 'Nova operação de investimento', body(), { foot });
  const root = m.parentElement;
  let painting = false;
  const read = () => { const d = A.formData($('#opf', root)); for (const k in d) { if (k.startsWith('n_')) f._novo[k.slice(2)] = d[k]; else f[k] = d[k]; } };
  function paint() { if (painting) return; painting = true; try { const fm = $('#opf', root); if (fm && fm.isConnected) { fm.outerHTML = body(); bind(); } } finally { painting = false; } }
  function bind() {
    const fm = $('#opf', root); A.bindMoneyBlur(fm);
    fm.addEventListener('change', e => {
      if (painting || !fm.isConnected) return;
      const n = e.target.name; read();
      if (n === 'n_nucleo' || n === 'ativoId') f.contaId = '';
      if (['tipo', 'ativoId', 'n_nucleo'].includes(n)) paint();
      else { const c = $('#op-calc', fm); if (c) c.innerHTML = calcTxt(); }
    });
    fm.addEventListener('input', e => { if (['quantidade', 'preco', 'taxas'].includes(e.target.name)) { read(); const c = $('#op-calc', fm); if (c) c.innerHTML = calcTxt(); } });
    fm.addEventListener('submit', e => { e.preventDefault(); save(false); });
  }
  bind();
  function save(again) {
    read();
    if (!f.ativoId) return A.toast('Escolha o ativo.', 'erro');
    if (!f.data) return A.toast('Informe a data.', 'erro');
    if (!s.contas.some(c => c.id === f.contaId)) return A.toast('Escolha a conta (cadastre uma em Contas e saldos).', 'erro');
    let ativoId = f.ativoId, novoAtivo = null;
    if (ativoId === 'NOVO') {
      const tk = (f._novo.ticker || '').trim().toUpperCase().replace(/\s+/g, '');
      if (!tk) return A.toast('Informe o código do ativo.', 'erro');
      const ex = cart.ativos.find(a => a.ticker === tk && (a.nucleo || 'PF') === f._novo.nucleo);
      if (ex) ativoId = ex.id;
      else { novoAtivo = { id: A.uid('at'), ticker: tk, nome: (f._novo.nome || '').trim(), tipo: f._novo.tipo, nucleo: f._novo.nucleo }; ativoId = novoAtivo.id; }
    }
    const out = { id: editing ? orig.id : A.uid('op'), seq: editing ? orig.seq : (cart.seq = (cart.seq || 0) + 1), ativoId, tipo: f.tipo, data: f.data, contaId: f.contaId, obs: (f.obs || '').trim() };
    if (editing && orig.exemplo) out.exemplo = true;
    if (f.tipo === 'Provento') {
      const v = A.parseValor(f.valor);
      if (!(v > 0)) return A.toast('Informe o valor recebido.', 'erro');
      out.valor = FE.r2(v); out.provTipo = f.provTipo;
    } else {
      const q = A.parseValor(f.quantidade), p = A.parseValor(f.preco), tx = A.parseValor(f.taxas);
      if (!(q > 0) || !(p > 0)) return A.toast('Informe quantidade e preço maiores que zero.', 'erro');
      if (!isNaN(tx) && tx < 0) return A.toast('Taxas não podem ser negativas.', 'erro');
      out.quantidade = q; out.preco = Math.round(p * 1e6) / 1e6; out.taxas = isNaN(tx) ? 0 : FE.r2(tx);
      if (f.tipo === 'Venda' && !(q * p - out.taxas > 0)) return A.toast('As taxas não podem ser maiores que o valor da venda.', 'erro');
    }
    const novas = cart.operacoes.filter(o => o.id !== out.id).concat([out]);
    for (const id of new Set([ativoId, editing ? orig.ativoId : ativoId])) {
      const prob = FE.validarPosicao(novas.filter(o => o.ativoId === id));
      if (prob) return A.toast('Com isso, em ' + FE.dataBR(prob.data) + ' a posição de ' + (ativo(id) || novoAtivo || {}).ticker + ' ficaria negativa (' + qf(prob.qtd) + '). Confira datas e quantidades.', 'erro');
    }
    if (novoAtivo) cart.ativos.push(novoAtivo);
    cart.operacoes = novas;
    A.ui.lastInvConta = f.contaId;
    const tk = (ativo(ativoId) || {}).ticker;
    A.closeModal();
    A.commit(editing ? 'Operação atualizada.' : (f.tipo === 'Provento' ? 'Provento de ' + tk + ' registrado: ' + FE.brl(out.valor) + '.' : f.tipo + ' de ' + qf(out.quantidade) + ' ' + tk + ' registrada: ' + FE.brl(FE.opValor(out)) + '.'));
    if (again) A.openOperacao(null, { tipo: f.tipo, data: f.data, contaId: f.contaId });
  }
  $('#op-save', root).addEventListener('click', () => save(false));
  const more = $('#op-more', root); if (more) more.addEventListener('click', () => save(true));
  const del = $('#op-del', root); if (del) del.addEventListener('click', () => A.excluirOperacao(orig.id));
};
A.excluirOperacao = function (id) {
  const cart = C(), o = cart.operacoes.find(x => x.id === id); if (!o) return;
  const a = ativo(o.ativoId) || {};
  const prob = FE.validarPosicao(cart.operacoes.filter(x => x.id !== id && x.ativoId === o.ativoId));
  if (prob) return A.toast('Não dá para excluir: sem essa compra, a venda de ' + FE.dataBR(prob.data) + ' ficaria maior que a posição. Ajuste ou exclua a venda antes.', 'erro');
  A.confirm('Excluir ' + o.tipo.toLowerCase() + ' de ' + esc(a.ticker || '') + ' em ' + FE.dataBR(o.data) + ' (' + FE.brl(FE.opValor(o)) + ')? O saldo da conta é recalculado.', 'Excluir', () => {
    cart.operacoes = cart.operacoes.filter(x => x.id !== id); A.commit('Operação excluída.');
  }, true);
};

/* ---------------- cotações ---------------- */
A.addCotacao = function (id, data, preco) {
  const cart = C(); cart.cotacoes = cart.cotacoes || {};
  const arr = cart.cotacoes[id] = (cart.cotacoes[id] || []).filter(q => q.data !== data);
  arr.push({ id: A.uid('cq'), data, preco: Math.round(preco * 1e6) / 1e6 });
  arr.sort((a, b) => (a.data < b.data ? -1 : 1));
};
A.openCotacao = function (id) {
  const s = A.state, a = ativo(id), today = A.todayIso(); if (!a) return;
  const pts = FE.pontosPreco(s, id), ult = pts[pts.length - 1];
  const h = '<form class="form" id="cqf" novalidate><p class="muted">' + (ult ? 'Último preço registrado: <b>' + FE.brl(ult.preco) + '</b> em ' + FE.dataBR(ult.data) + ' (' + esc(ult.origem.toLowerCase()) + ').' : 'Sem preço registrado.') + '</p>' +
    '<div class="grid2">' + A.fld('Data', A.inp('data', today, 'type="date" max="' + today + '"')) + A.fld('Cotação', A.money('preco', '', 'placeholder="0,00"')) + '</div>' +
    '<p class="help">O histórico continua: preço das compras e cotações anteriores não mudam. Outra cotação na mesma data substitui só a daquela data.</p></form>';
  const m = A.modal('Atualizar cotação — ' + a.ticker, h, { foot: '<span class="sp"></span><button class="btn" data-close="1">Cancelar</button><button class="btn primary" id="cq-ok">Salvar cotação</button>' });
  const root = m.parentElement; A.bindMoneyBlur(root);
  const ok = () => {
    const d = A.formData($('#cqf', root)), v = A.parseValor(d.preco);
    if (!(v > 0) || !d.data) return A.toast('Informe data e cotação.', 'erro');
    if (d.data > today) return A.toast('A cotação não pode ter data futura.', 'erro');
    A.addCotacao(id, d.data, v); A.closeModal(); A.commit('Cotação de ' + a.ticker + ': ' + FE.brl(v) + '.');
  };
  $('#cq-ok', root).addEventListener('click', ok);
  $('#cqf', root).addEventListener('submit', e => { e.preventDefault(); ok(); });
  setTimeout(() => { const i = $('input[name=preco]', root); if (i) i.focus(); }, 40);
};
A.openCotacoesLote = function () {
  const s = A.state, today = A.todayIso();
  const rs = FE.resumoCarteira(s, today, null).rs.filter(r => r.aberta).sort((a, b) => (a.a.ticker < b.a.ticker ? -1 : 1));
  if (!rs.length) return A.toast('Nenhuma posição aberta para atualizar.', 'erro');
  const h = '<form class="form" id="clf" novalidate><div class="grid2">' + A.fld('Data das cotações', A.inp('data', today, 'type="date" max="' + today + '"')) + '<div></div></div>' +
    '<table class="tbl compact"><thead><tr><th>Ativo</th><th class="r">Último preço</th><th class="r">Nova cotação</th></tr></thead><tbody>' +
    rs.map(r => '<tr><td><b>' + esc(r.a.ticker) + '</b><p class="muted small">' + esc(r.a.nome || r.a.tipo) + '</p></td><td class="r num">' + FE.brl(r.cot) + '<p class="small ' + (r.diasCot > 35 ? 'warn-t' : 'muted') + '">' + FE.dataBR(r.cotData) + '</p></td><td class="r"><span class="money sm"><span class="cur">R$</span><input class="in" data-lote="' + r.a.id + '" inputmode="decimal" placeholder="—" autocomplete="off" aria-label="Nova cotação de ' + esc(r.a.ticker) + '"></span></td></tr>').join('') +
    '</tbody></table><p class="help">Deixe em branco o que não mudou. Nada do histórico é apagado.</p></form>';
  const m = A.modal('Atualizar cotações', h, { foot: '<span class="sp"></span><button class="btn" data-close="1">Cancelar</button><button class="btn primary" id="cl-ok">Salvar cotações</button>' });
  const root = m.parentElement; A.bindMoneyBlur(root);
  const ok = () => {
    const data = $('#clf input[name=data]', root).value;
    if (!data || data > today) return A.toast('Informe uma data até hoje.', 'erro');
    let n = 0;
    $$('[data-lote]', root).forEach(i => { const v = A.parseValor(i.value); if (v > 0) { A.addCotacao(i.dataset.lote, data, v); n++; } });
    if (!n) return A.toast('Nenhuma cotação preenchida.', 'erro');
    A.closeModal(); A.commit(n + (n > 1 ? ' cotações atualizadas.' : ' cotação atualizada.'));
  };
  $('#cl-ok', root).addEventListener('click', ok);
  $('#clf', root).addEventListener('submit', e => { e.preventDefault(); ok(); });
};

/* ---------------- ativo: editar / excluir ---------------- */
A.openAtivo = function (id) {
  const cart = C(), a = ativo(id); if (!a) return;
  const nOps = cart.operacoes.filter(o => o.ativoId === id).length, nCot = ((cart.cotacoes || {})[id] || []).length;
  const h = '<form class="form" id="atf" novalidate><div class="grid2">' + A.fld('Código (ticker)', A.inp('ticker', a.ticker, 'maxlength="12"'), { req: 1 }) + A.fld('Tipo de ativo', A.sel('tipo', FE.TIPOS_ATIVO, a.tipo)) + '</div>' +
    '<div class="grid2">' + A.fld('Nome', A.inp('nome', a.nome || '', 'maxlength="60"')) + A.fld('Núcleo', A.sel('nucleo', A.nucleoOptions(), a.nucleo || 'PF')) + '</div>' +
    '<p class="help">O tipo define a regra de IR estimada nas vendas (ações têm isenção mensal; ETFs, BDRs e FIIs não).</p></form>';
  const m = A.modal('Editar ativo', h, { foot: '<button class="btn danger ghost" id="at-del">Excluir ativo</button><span class="sp"></span><button class="btn" data-close="1">Cancelar</button><button class="btn primary" id="at-ok">Salvar</button>' });
  const root = m.parentElement;
  $('#at-ok', root).addEventListener('click', () => {
    const d = A.formData($('#atf', root)), tk = (d.ticker || '').trim().toUpperCase().replace(/\s+/g, '');
    if (!tk) return A.toast('Informe o código.', 'erro');
    if (cart.ativos.some(x => x !== a && x.ticker === tk && (x.nucleo || 'PF') === d.nucleo)) return A.toast('Já existe ' + tk + ' nesse núcleo.', 'erro');
    Object.assign(a, { ticker: tk, nome: d.nome.trim(), tipo: d.tipo, nucleo: d.nucleo });
    A.closeModal(); A.commit('Ativo atualizado.');
  });
  $('#at-del', root).addEventListener('click', () => A.confirm('Excluir ' + esc(a.ticker) + (nOps ? ' com ' + nOps + ' operação(ões)' : '') + (nCot ? ' e ' + nCot + ' cotação(ões)' : '') + '? Os saldos das contas e o patrimônio são recalculados. Não dá para desfazer (só pelo backup).', 'Excluir ativo', () => {
    cart.ativos = cart.ativos.filter(x => x.id !== id); cart.operacoes = cart.operacoes.filter(o => o.ativoId !== id);
    if (cart.cotacoes) delete cart.cotacoes[id];
    A.commit('Ativo excluído.');
  }, true));
};

/* ---------------- detalhe do ativo ---------------- */
A.openAtivoDetalhe = function (id) {
  const s = A.state, today = A.todayIso(), cfg = s.config;
  const R = FE.resumoCarteira(s, today, null), r = R.rs.find(x => x.a.id === id);
  if (!r) return A.openAtivo(id);
  const a = r.a, sd = r.saude, ref = +cfg.taxaReferenciaAA || 0;
  const vg = FE.ganhosPorVenda(s);
  let h = '<p class="muted">' + esc(a.nome || '') + (a.nome ? ' · ' : '') + esc(a.tipo) + ' · ' + esc(A.nomeN(a.nucleo || 'PF')) + (r.inicio ? ' · desde ' + FE.dataBR(r.inicio) : '') + '</p>';
  h += '<p style="margin:10px 0">' + A.badge(sd.nivel, sd.status) + '</p>';
  const it = [
    ['Quantidade', qf(r.pos.qtd)], ['Preço médio', FE.brl(r.pos.pm)],
    ['Cotação', FE.brl(r.cot) + ' <span class="muted small">' + FE.dataBR(r.cotData) + '</span>'], ['Valor de mercado', FE.brl(r.valor)],
    ['Custo da posição', FE.brl(r.pos.custo)], ['Resultado não realizado', '<span class="' + A.sig(r.naoReal) + '">' + A.brlS(r.naoReal) + ' (' + pctS(r.naoRealPct) + ')</span>'],
    ['Ganho realizado (vendas)', '<span class="' + A.sig(r.pos.realizado) + '">' + A.brlS(r.pos.realizado) + '</span>'], ['Proventos recebidos', FE.brl(r.pos.prov)],
    ['Total aplicado (compras)', FE.brl(r.pos.aplicado)], ['Retorno total', '<span class="' + A.sig(r.retorno) + '">' + A.brlS(r.retorno) + ' (' + pctS(r.pct) + ')</span>'],
    ['Retorno por mês (TIR)', r.tir == null ? '— <span class="muted small">menos de 30 dias</span>' : '<span class="' + sigP(r.tirM) + '">' + pctS(r.tirM, 2) + '</span> <span class="muted small">' + pctS(r.tir) + ' ao ano</span>'],
    ['Na referência (' + FE.pct(ref) + ' a.a.) teria', FE.brl(r.valRef) + ' <span class="' + A.sig(r.vsRef) + ' small">' + A.brlS(r.vsRef) + '</span>'],
  ];
  h += '<dl class="dl2">' + it.map(x => '<div><dt>' + esc(x[0]) + '</dt><dd>' + x[1] + '</dd></div>').join('') + '</dl>';
  if (sd.itens.length) h += '<h3 style="margin-top:16px">Saúde do ativo</h3><ul class="diag">' + sd.itens.map(x => '<li>' + A.badge(x.nivel) + '<p>' + esc(x.txt) + '</p></li>').join('') + '</ul>';
  h += '<h3 style="margin-top:16px">Histórico de preço</h3><div class="cv"><canvas id="inv-det-ch" role="img" aria-label="Histórico de preço de ' + esc(a.ticker) + '"></canvas></div>';
  const rm = FE.retornosMensais(s, [a], today).slice(-12).reverse();
  if (rm.length) h += '<h3 style="margin-top:16px">Retorno mês a mês</h3><div class="tbl-wrap" style="border:0"><table class="tbl compact"><thead><tr><th>Mês</th><th class="r">Valor no início</th><th class="r">Aportes − retiradas</th><th class="r">Valor no fim</th><th class="r">Resultado</th><th class="r">Retorno</th></tr></thead><tbody>' +
    rm.map(x => '<tr><td>' + FE.mesCurto(x.mes) + '</td><td class="r num">' + FE.brl(x.vIni) + '</td><td class="r num">' + A.brlS(x.fluxo) + '</td><td class="r num">' + FE.brl(x.vFim) + '</td><td class="r num ' + A.sig(x.ganho) + '">' + A.brlS(x.ganho) + '</td><td class="r num ' + sigP(x.ret) + '">' + pctS(x.ret, 2) + '</td></tr>').join('') + '</tbody></table></div><p class="help">Proventos contam como resultado do mês. Mês sem cotação nova usa o último preço conhecido.</p>';
  h += '<h3 style="margin-top:16px">Operações</h3><table class="tbl compact"><thead><tr><th>Data</th><th>Operação</th><th class="r">Qtd.</th><th class="r">Preço</th><th class="r">Valor</th><th class="r">Resultado</th><th></th></tr></thead><tbody>' +
    r.ops.slice().reverse().map(o => { const g = vg.get(o.id); return '<tr><td>' + FE.dataBR(o.data) + '</td><td>' + esc(o.tipo === 'Provento' ? (o.provTipo || 'Provento') : o.tipo) + '</td><td class="r num">' + (o.tipo === 'Provento' ? '' : qf(o.quantidade)) + '</td><td class="r num">' + (o.tipo === 'Provento' ? '' : FE.brl(o.preco)) + '</td><td class="r num">' + FE.brl(FE.opValor(o)) + '</td><td class="r num ' + (g ? A.sig(g.ganho) : '') + '">' + (g ? A.brlS(g.ganho) : '') + '</td><td class="acts"><button class="lk" data-dop="' + o.id + '">Editar</button></td></tr>'; }).join('') + '</tbody></table>';
  const cots = ((C().cotacoes || {})[id] || []).slice().reverse();
  if (cots.length) h += '<details class="more" style="margin-top:12px"><summary>Cotações registradas (' + cots.length + ')</summary><table class="tbl compact"><tbody>' + cots.map(q => '<tr><td>' + FE.dataBR(q.data) + '</td><td class="r num">' + FE.brl(q.preco) + '</td><td class="acts"><button class="lk" data-dcq="' + q.id + '">Excluir</button></td></tr>').join('') + '</tbody></table></details>';
  const foot = '<button class="btn ghost" id="dt-edit">Editar ativo</button><span class="sp"></span><button class="btn" id="dt-cot">Atualizar cotação</button>' + (r.aberta ? '<button class="btn" id="dt-sell">Vender</button>' : '') + '<button class="btn primary" id="dt-buy">Comprar</button>';
  const m = A.modal(a.ticker, h, { wide: true, foot });
  const root = m.parentElement;
  $('#dt-edit', root).addEventListener('click', () => { A.closeModal(); A.openAtivo(id); });
  $('#dt-cot', root).addEventListener('click', () => { A.closeModal(); A.openCotacao(id); });
  $('#dt-buy', root).addEventListener('click', () => { A.closeModal(); A.openOperacao(null, { tipo: 'Compra', ativoId: id }); });
  const sell = $('#dt-sell', root); if (sell) sell.addEventListener('click', () => { A.closeModal(); A.openOperacao(null, { tipo: 'Venda', ativoId: id }); });
  $$('[data-dop]', root).forEach(b => b.addEventListener('click', () => { const o = C().operacoes.find(x => x.id === b.dataset.dop); A.closeModal(); A.openOperacao(o); }));
  $$('[data-dcq]', root).forEach(b => b.addEventListener('click', () => {
    const arr = C().cotacoes[id] || [], q = arr.find(x => x.id === b.dataset.dcq);
    A.confirm('Excluir a cotação de ' + FE.dataBR(q.data) + ' (' + FE.brl(q.preco) + ')? Compras, vendas e outras cotações continuam.', 'Excluir', () => { C().cotacoes[id] = arr.filter(x => x.id !== q.id); A.commit('Cotação excluída.'); A.openAtivoDetalhe(id); }, true);
  }));
  // gráfico: cotação x preço médio em cada ponto do histórico
  const pts = r.pts.filter(p => !r.inicio || p.data >= r.inicio);
  if (pts.length) A.chart('inv-det-ch', 'line', { labels: pts.map(p => FE.dataBR(p.data).slice(0, 6) + p.data.slice(2, 4)), datasets: [
    { label: 'Preço', data: pts.map(p => p.preco), borderColor: COL.saldo, backgroundColor: COL.saldo },
    { label: 'Preço médio', data: pts.map(p => { const x = FE.posicaoEm(r.ops, p.data); return x.qtd > 0 ? FE.r2(x.pm) : null; }), borderColor: COL.parc, backgroundColor: COL.parc, borderDash: [5, 4], tension: 0 },
  ] });
};

/* ---------------- página ---------------- */
P.investimentos = function () {
  const st = A.state, ctx = A.ctx, ui = A.ui, cfg = st.config, cart = C();
  const temPJ = cart.ativos.some(a => (a.nucleo || 'PF') !== 'PF');
  const nuc = temPJ ? (ui.invNucleo || 'ALL') : 'ALL';
  const R = FE.resumoCarteira(st, ctx.today, nuc === 'ALL' ? null : [nuc]);
  const ref = +cfg.taxaReferenciaAA || 0;
  let h = A.head('Investimentos', 'Ações, FIIs, ETFs e BDRs. Cada compra guarda o preço pago naquele dia; a cotação você atualiza quando quiser, sem apagar o histórico. Compra e venda movimentam a conta escolhida; a posição entra no patrimônio pelo valor de mercado.', temPJ ? A.filtroNucleo('invNucleo') : '');
  h += '<div class="toolbar"><button class="btn primary" data-inv="Compra">' + ICO.plus + 'Compra</button><button class="btn" data-inv="Venda">Venda</button><button class="btn" data-inv="Provento">Provento</button><button class="btn" id="inv-cot">Atualizar cotações</button><span class="sp"></span><button class="btn ghost sm" id="inv-csv">Exportar operações (CSV)</button></div>';
  if (!R.rs.length) { A._inv = null; return h + A.empty('Nenhuma operação ainda. Registre a primeira compra: código do ativo, data, quantidade e preço pago. O dinheiro sai da conta escolhida e a posição passa a fazer parte do patrimônio.', '<button class="btn primary" data-inv="Compra">Registrar compra</button>'); }
  const T = R.tot, abertas = R.rs.filter(r => r.aberta), fechadas = R.rs.filter(r => !r.aberta);
  const desat = abertas.filter(r => r.diasCot != null && r.diasCot > 35).length;
  const lc = +cfg.limiteConcentracao || 0.25, conc = abertas.filter(r => r.peso > lc);
  h += '<section class="panel pad0"><div class="kstrip">' +
    A.kk('Valor de mercado', FE.brl(T.valor), abertas.length + (abertas.length === 1 ? ' posição aberta' : ' posições abertas')) +
    A.kk('Custo das posições', FE.brl(T.custo), 'preço médio × quantidade') +
    A.kk('Resultado não realizado', A.brlS(T.naoReal), T.custo > 0 ? pctS(T.naoReal / T.custo) + ' sobre o custo' : '', A.sig(T.naoReal)) +
    A.kk('Ganho realizado', A.brlS(T.realizado), 'nas vendas', A.sig(T.realizado)) +
    A.kk('Proventos', FE.brl(T.prov), FE.brl(T.prov12) + ' nos últimos 12 meses') +
    A.kk('Retorno total', A.brlS(T.retorno), R.pct != null ? pctS(R.pct) + ' sobre ' + FE.brl(T.aplicado) + ' aplicados' : '', A.sig(T.retorno)) +
    '</div><div class="kstrip">' +
    A.kk('Retorno por mês (TIR)', R.tirM == null ? '—' : pctS(R.tirM, 2), R.tir == null ? 'menos de 30 dias de histórico' : 'pesa data e valor de cada aporte', sigP(R.tirM)) +
    A.kk('Retorno ao ano (TIR)', R.tir == null ? '—' : pctS(R.tir), 'referência: ' + FE.pct(ref) + ' a.a.', R.tir == null ? '' : R.tir >= ref ? 'pos' : 'neg') +
    A.kk('Na referência teria', FE.brl(R.valRef), 'mesmo dinheiro, mesmas datas') +
    A.kk('Diferença vs referência', A.brlS(R.vsRef), R.vsRef >= 0 ? 'a carteira rendeu mais' : 'a carteira rendeu menos', A.sig(R.vsRef)) +
    A.kk('Cotações', desat ? desat + ' desatualizada(s)' : 'em dia', desat ? 'mais de 35 dias sem atualizar' : 'todas com até 35 dias', desat ? 'neg' : '') +
    '</div></section>';
  if (conc.length || desat) h += '<div class="note">' + ICO.info + '<p>' + (conc.length ? conc.map(r => esc(r.a.ticker) + ' (' + FE.pct(r.peso) + ')').join(', ') + (conc.length > 1 ? ' passam' : ' passa') + ' de ' + FE.pct(lc, 0) + ' da carteira — concentração alta. ' : '') + (desat ? 'Há cotações com mais de 35 dias: atualize para os números refletirem o preço de hoje.' : '') + '</p></div>';
  if (abertas.length) {
    h += '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Ativo</th><th class="r">Quantidade</th><th class="r">Preço médio</th><th class="r">Cotação</th><th class="r">Valor de mercado</th><th class="r">Resultado</th><th class="r">Proventos</th><th class="r">Retorno total</th><th class="r">Por mês</th><th class="r">Por ano</th><th class="r">Peso</th><th>Saúde</th><th></th></tr></thead><tbody>';
    for (const r of abertas.sort((x, y) => y.valor - x.valor)) {
      const a = r.a, velha = r.diasCot != null && r.diasCot > 35;
      h += '<tr><td class="desc"><b>' + esc(a.ticker) + '</b> <span class="pill">' + esc(a.tipo) + '</span>' + (a.exemplo ? ' <span class="exb" title="Registro de exemplo">ex</span>' : '') + '<p class="muted small">' + esc(a.nome || '') + ((a.nucleo || 'PF') !== 'PF' ? ' · ' + esc(A.nomeNCurto(a.nucleo)) : '') + '</p></td>' +
        '<td class="r num">' + qf(r.pos.qtd) + '</td><td class="r num">' + FE.brl(r.pos.pm) + '</td>' +
        '<td class="r num">' + FE.brl(r.cot) + '<p class="small ' + (velha ? 'warn-t' : 'muted') + '">' + FE.dataBR(r.cotData) + '</p></td>' +
        '<td class="r num"><b>' + FE.brl(r.valor) + '</b></td>' +
        '<td class="r num ' + A.sig(r.naoReal) + '">' + A.brlS(r.naoReal) + '<p class="small">' + pctS(r.naoRealPct) + '</p></td>' +
        '<td class="r num">' + FE.brl(r.pos.prov) + '</td>' +
        '<td class="r num ' + A.sig(r.retorno) + '">' + A.brlS(r.retorno) + '<p class="small">' + pctS(r.pct) + '</p></td>' +
        '<td class="r num ' + sigP(r.tirM) + '">' + (r.tirM == null ? '—' : pctS(r.tirM, 2)) + '</td><td class="r num ' + sigP(r.tir) + '">' + (r.tir == null ? '—' : pctS(r.tir)) + '</td>' +
        '<td class="r num">' + FE.pct(r.peso) + '</td><td>' + A.badge(r.saude.nivel, r.saude.status) + '</td>' +
        '<td class="acts"><button class="lk" data-det="' + a.id + '">Detalhes</button><button class="lk" data-cot="' + a.id + '">Cotação</button><button class="lk" data-buy="' + a.id + '">Comprar</button><button class="lk" data-sell="' + a.id + '">Vender</button></td></tr>';
    }
    h += '</tbody><tfoot><tr><td colspan="13"><span>Valor de mercado <b>' + FE.brl(T.valor) + '</b></span><span>Custo <b>' + FE.brl(T.custo) + '</b></span><span>Resultado não realizado <b class="' + A.sig(T.naoReal) + '">' + A.brlS(T.naoReal) + '</b></span></td></tr></tfoot></table></div>';
  }
  h += '<div class="charts">' + A.chartBox('inv-evo', 'Valor de mercado x custo (fim de cada mês)') + A.chartBox('inv-ret', 'Retorno da carteira mês a mês') + '</div>';
  // retorno mensal da carteira + IR
  const rm = FE.retornosMensais(st, R.rs.map(r => r.a), ctx.today);
  const ir = FE.irVendas(st, ctx.today).filter(x => x.mes >= FE.addM(ctx.curM, -11));
  const al = cfg.irAliquotas || [0.15, 0.20], isen = +cfg.irIsencaoAcoes || 0;
  h += '<div class="cols even"><section class="panel"><div class="ph"><h2>Retorno mês a mês</h2><p class="muted small">Toda a carteira' + (nuc !== 'ALL' ? ' da ' + esc(A.nomeN(nuc)) : '') + '. Proventos contam como resultado; mês sem cotação nova usa o último preço.</p></div><div class="tbl-wrap"><table class="tbl compact"><thead><tr><th>Mês</th><th class="r">Início</th><th class="r">Aportes − retiradas</th><th class="r">Fim</th><th class="r">Resultado</th><th class="r">Retorno</th></tr></thead><tbody>' +
    rm.slice(-12).reverse().map(x => '<tr><td>' + FE.mesCurto(x.mes) + (x.mes === ctx.curM ? ' <span class="muted small">até hoje</span>' : '') + '</td><td class="r num">' + FE.brl(x.vIni) + '</td><td class="r num">' + A.brlS(x.fluxo) + '</td><td class="r num">' + FE.brl(x.vFim) + '</td><td class="r num ' + A.sig(x.ganho) + '">' + A.brlS(x.ganho) + '</td><td class="r num ' + sigP(x.ret) + '">' + pctS(x.ret, 2) + '</td></tr>').join('') + '</tbody></table></div></section>';
  h += '<section class="panel"><div class="ph"><h2>Vendas e IR estimado (PF)</h2><p class="muted small">Ações: ' + FE.pct(al[0], 0) + ' sobre o ganho, isento no mês em que as vendas de ações somam até ' + FE.brl(isen) + '. ETFs e BDRs: ' + FE.pct(al[0], 0) + ' sem isenção. FIIs: ' + FE.pct(al[1], 0) + '. Sem day trade e sem compensar prejuízo de meses anteriores. Confirme com o contador.</p></div>';
  if (!ir.length) h += '<p class="muted">Nenhuma venda nos últimos 12 meses.</p>';
  else h += '<div class="tbl-wrap"><table class="tbl compact"><thead><tr><th>Mês</th><th class="r">Vendas de ações</th><th class="r">Resultado ações</th><th>Ações</th><th class="r">ETF/BDR</th><th class="r">FII</th><th class="r">IR estimado</th><th>DARF até</th></tr></thead><tbody>' +
    ir.map(x => '<tr><td>' + FE.mesCurto(x.mes) + '</td><td class="r num">' + FE.brl(x.vendasAcoes) + '</td><td class="r num ' + A.sig(x.ganhoAcoes) + '">' + A.brlS(x.ganhoAcoes) + '</td><td>' + (x.vendasAcoes > 0 ? (x.isento ? A.badge('ok', 'Isento') : A.badge('atencao', 'Tributável')) : '—') + '</td><td class="r num">' + (x.ganho15 ? A.brlS(x.ganho15) : '—') + '</td><td class="r num">' + (x.ganhoFii ? A.brlS(x.ganhoFii) : '—') + '</td><td class="r num"><b>' + FE.brl(x.ir) + '</b></td><td>' + (x.ir > 0 ? 'último dia útil de ' + FE.mesBarra(x.venc) : '—') + '</td></tr>').join('') + '</tbody></table></div>';
  h += '</section></div>';
  if (abertas.length > 1) h += '<div class="charts one">' + A.chartBox('inv-aloc', 'Alocação por ativo (valor de mercado)') + '</div>';
  if (fechadas.length) {
    h += '<section class="panel"><div class="ph"><h2>Posições encerradas</h2><p class="muted small">Vendidas por completo. Saíram do patrimônio; o dinheiro voltou para a conta.</p></div><div class="tbl-wrap"><table class="tbl compact"><thead><tr><th>Ativo</th><th>Período</th><th class="r">Aplicado</th><th class="r">Recebido nas vendas</th><th class="r">Proventos</th><th class="r">Resultado</th><th class="r">Por mês</th><th class="r">Vs referência</th><th></th></tr></thead><tbody>' +
      fechadas.map(r => '<tr><td><b>' + esc(r.a.ticker) + '</b> <span class="muted small">' + esc(r.a.tipo) + '</span></td><td>' + FE.dataBR(r.inicio) + ' a ' + FE.dataBR(r.fim) + '</td><td class="r num">' + FE.brl(r.pos.aplicado) + '</td><td class="r num">' + FE.brl(r.pos.recebido) + '</td><td class="r num">' + FE.brl(r.pos.prov) + '</td><td class="r num ' + A.sig(r.retorno) + '">' + A.brlS(r.retorno) + ' <span class="small">(' + pctS(r.pct) + ')</span></td><td class="r num ' + sigP(r.tirM) + '">' + (r.tirM == null ? '—' : pctS(r.tirM, 2)) + '</td><td class="r num ' + A.sig(r.vsRef) + '">' + A.brlS(r.vsRef) + '</td><td class="acts"><button class="lk" data-det="' + r.a.id + '">Detalhes</button></td></tr>').join('') + '</tbody></table></div></section>';
  }
  // operações
  const vg = FE.ganhosPorVenda(st);
  const ops = cart.operacoes.filter(o => { const a = ativo(o.ativoId); return a && (nuc === 'ALL' || (a.nucleo || 'PF') === nuc); })
    .sort((a, b) => (a.data < b.data ? 1 : a.data > b.data ? -1 : (b.seq || 0) - (a.seq || 0)));
  const lim = ui.invOpsTodas ? ops.length : 30;
  h += '<section class="panel"><div class="ph"><h2>Operações</h2><p class="muted small">' + ops.length + ' registro(s). A compra é uma transferência da conta para a carteira (não é despesa); a venda volta para a conta (não é receita: o ganho fica na carteira e no patrimônio); provento entra como receita de rendimentos.</p></div><div class="tbl-wrap"><table class="tbl compact"><thead><tr><th>Data</th><th>Operação</th><th>Ativo</th><th class="r">Qtd.</th><th class="r">Preço</th><th class="r">Taxas</th><th class="r">Valor</th><th>Conta</th><th class="r">Resultado da venda</th><th></th></tr></thead><tbody>' +
    ops.slice(0, lim).map(o => { const a = ativo(o.ativoId), g = vg.get(o.id), fut = o.data > ctx.today; return '<tr><td>' + FE.dataBR(o.data) + (fut ? ' <span class="pill warn">futura</span>' : '') + '</td><td><span class="tt ' + (o.tipo === 'Compra' ? 'tt-i' : o.tipo === 'Venda' ? 'tt-t' : 'tt-r') + '">' + esc(o.tipo === 'Provento' ? (o.provTipo || 'Provento') : o.tipo) + '</span></td><td><b>' + esc(a.ticker) + '</b>' + (o.exemplo ? ' <span class="exb">ex</span>' : '') + '</td><td class="r num">' + (o.tipo === 'Provento' ? '' : qf(o.quantidade)) + '</td><td class="r num">' + (o.tipo === 'Provento' ? '' : FE.brl(o.preco)) + '</td><td class="r num">' + (+o.taxas ? FE.brl(o.taxas) : '') + '</td><td class="r num">' + FE.brl(FE.opValor(o)) + '</td><td>' + esc(A.nomeContaCurto(o.contaId)) + '</td><td class="r num ' + (g ? A.sig(g.ganho) : '') + '">' + (g ? A.brlS(g.ganho) : '') + '</td><td class="acts"><button class="lk" data-opedit="' + o.id + '">Editar</button><button class="lk" data-opdel="' + o.id + '">Excluir</button></td></tr>'; }).join('') +
    '</tbody></table></div>' + (ops.length > lim ? '<p class="center"><button class="btn sm" id="inv-todas">Mostrar todas</button></p>' : '') + '</section>';
  A._inv = { R, rm, nucleos: nuc === 'ALL' ? null : [nuc], abertas };
  return h;
};
P['investimentos:after'] = function () {
  $$('[data-inv]').forEach(b => b.addEventListener('click', () => A.openOperacao(null, { tipo: b.dataset.inv })));
  const cot = $('#inv-cot'); if (cot) cot.addEventListener('click', A.openCotacoesLote);
  const csv = $('#inv-csv'); if (csv) csv.addEventListener('click', A.exportOperacoesCSV);
  const tod = $('#inv-todas'); if (tod) tod.addEventListener('click', () => { A.ui.invOpsTodas = true; A.render(); });
  $$('[data-det]').forEach(b => b.addEventListener('click', () => A.openAtivoDetalhe(b.dataset.det)));
  $$('[data-cot]').forEach(b => b.addEventListener('click', () => A.openCotacao(b.dataset.cot)));
  $$('[data-buy]').forEach(b => b.addEventListener('click', () => A.openOperacao(null, { tipo: 'Compra', ativoId: b.dataset.buy })));
  $$('[data-sell]').forEach(b => b.addEventListener('click', () => A.openOperacao(null, { tipo: 'Venda', ativoId: b.dataset.sell })));
  $$('[data-opedit]').forEach(b => b.addEventListener('click', () => A.openOperacao(C().operacoes.find(o => o.id === b.dataset.opedit))));
  $$('[data-opdel]').forEach(b => b.addEventListener('click', () => A.excluirOperacao(b.dataset.opdel)));
  const D = A._inv; if (!D) return;
  const rows = D.rm.slice(-24), lab = rows.map(x => FE.mesCurto(x.mes));
  A.chart('inv-evo', 'line', { labels: lab, datasets: [
    { label: 'Valor de mercado', data: rows.map(x => x.vFim), borderColor: COL.saldo, backgroundColor: 'rgba(43,74,63,.08)', fill: true },
    { label: 'Custo', data: rows.map(x => x.custo), borderColor: COL.parc, backgroundColor: COL.parc, borderDash: [5, 4] }] });
  const r12 = D.rm.slice(-12);
  A.chart('inv-ret', 'bar', { labels: r12.map(x => FE.mesCurto(x.mes)), datasets: [{ label: 'Retorno', data: r12.map(x => x.ret), backgroundColor: r12.map(x => (x.ret || 0) >= 0 ? COL.pos : COL.neg) }] }, { pct: true, legend: false });
  if (D.abertas.length > 1) {
    const ab = D.abertas.slice().sort((a, b) => b.valor - a.valor);
    A.chart('inv-aloc', 'bar', { labels: ab.map(r => r.a.ticker), datasets: [{ label: 'Valor de mercado', data: ab.map(r => r.valor), backgroundColor: COL.sai }] }, { horizontal: true, legend: false });
  }
};
A.exportOperacoesCSV = function () {
  const s = A.state, cart = C(), vg = FE.ganhosPorVenda(s);
  const n = v => (v == null || v === '' ? '' : String(v).replace('.', ',')), q = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  const head = ['Data', 'Operação', 'Ativo', 'Tipo de ativo', 'Núcleo', 'Quantidade', 'Preço', 'Taxas', 'Valor líquido', 'Resultado da venda', 'Conta', 'Observações', 'Exemplo'];
  const rows = cart.operacoes.slice().sort((a, b) => (a.data < b.data ? -1 : 1)).map(o => {
    const a = ativo(o.ativoId) || {}, g = vg.get(o.id);
    return [FE.dataBR(o.data), o.tipo === 'Provento' ? (o.provTipo || 'Provento') : o.tipo, a.ticker, a.tipo, A.nomeN(a.nucleo || 'PF'), o.tipo === 'Provento' ? '' : n(o.quantidade), o.tipo === 'Provento' ? '' : n(o.preco), n(o.taxas || ''), n(FE.opValor(o)), g ? n(g.ganho) : '', A.nomeContaCurto(o.contaId), o.obs, o.exemplo ? 'sim' : ''];
  });
  A.download('investimentos-' + A.todayIso() + '.csv', '﻿' + [head].concat(rows).map(r => r.map(q).join(';')).join('\r\n'), 'text/csv;charset=utf-8');
};
})();
