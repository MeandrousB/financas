/* Minhas finanças — motor de cálculo e dados padrão (extraído do arquivo único; ver README) */
/* ==========================================================================
   Motor de cálculo — funções puras, sem DOM. Exposto como window.FE (e
   module.exports no Node, para testes).
   ========================================================================== */
(function (root) {
'use strict';

/* ---------- datas e meses (strings ISO: 'AAAA-MM-DD' e 'AAAA-MM') ---------- */
const pad = n => String(n).padStart(2, '0');
const isoOf = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const ym = iso => (iso ? String(iso).slice(0, 7) : null);
function addM(m, n) { let y = +m.slice(0, 4), mo = +m.slice(5, 7) - 1 + n; y += Math.floor(mo / 12); mo = ((mo % 12) + 12) % 12; return y + '-' + pad(mo + 1); }
const mdiff = (a, b) => (+b.slice(0, 4) - +a.slice(0, 4)) * 12 + (+b.slice(5, 7) - +a.slice(5, 7));
const lastDay = m => new Date(+m.slice(0, 4), +m.slice(5, 7), 0).getDate();
const dayIn = (m, d) => m + '-' + pad(Math.max(1, Math.min(+d || 1, lastDay(m))));
const monthEnd = m => dayIn(m, 31);
function addDays(iso, n) { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return isoOf(d); }
function mrange(a, b) { const out = []; if (!/^\d{4}-\d{2}$/.test(a || '') || !/^\d{4}-\d{2}$/.test(b || '')) return out; for (let m = a; m <= b; m = addM(m, 1)) out.push(m); return out; }
const r2 = v => Math.round((+v || 0) * 100) / 100;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* ---------- formatação pt-BR ---------- */
const NF = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const NF0 = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 0, maximumFractionDigits: 0 });
const brl = v => NF.format(+v || 0).replace(/ /g, ' ');
const brl0 = v => NF0.format(Math.round(+v || 0)).replace(/ /g, ' ');
const pct = (v, d = 1) => (v == null || !isFinite(v)) ? '—' : (v * 100).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d }) + '%';
const num = (v, d = 1) => (v == null || !isFinite(v)) ? '—' : (+v).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const MES3 = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const mesLongo = m => m ? MESES[+m.slice(5, 7) - 1] + ' de ' + m.slice(0, 4) : '—';
const mesCurto = m => m ? MES3[+m.slice(5, 7) - 1] + '/' + m.slice(2, 4) : '—';
const mesBarra = m => m ? MESES[+m.slice(5, 7) - 1] + '/' + m.slice(0, 4) : '—';
const dataBR = iso => iso ? iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4) : '';

/* ---------- constantes de domínio ---------- */
const NUCLEOS = ['PF', 'C1', 'C2'];
const NATUREZAS = ['Fixa', 'Variável', 'Parcela', 'Financiamento'];
const NAT_LABEL = { Fixa: 'Custo fixo', 'Variável': 'Variável', Parcela: 'Parcelamento', Financiamento: 'Financiamento / dívida', Aporte: 'Aporte em empresa' };
const TKINDS = ['Entre contas', 'Pró-labore', 'Distribuição de lucros', 'Retirada pessoal / Sócio', 'Aporte do sócio', 'Entre empresas'];
const INV_TIPOS = ['Poupança', 'Investimento'];
const LIQ_TIPOS = ['Conta corrente', 'Dinheiro'];
const RESP = { P1: 'Pessoa 1', P2: 'Pessoa 2', AMBOS: 'Ambos / Família', NA: 'Não aplicável' };

function canonKind(from, to, k) {
  if (from === to) return 'Entre contas';
  const fPJ = from !== 'PF', tPJ = to !== 'PF';
  if (fPJ && !tPJ) {
    if (k === 'Pró-labore') return 'Pró-labore';
    if (k === 'Distribuição de lucros' || k === 'Distribuição aos sócios') return 'Distribuição de lucros';
    return 'Retirada pessoal / Sócio';
  }
  if (!fPJ && tPJ) return 'Aporte do sócio';
  return 'Entre empresas';
}
const scopeOf = n => (n === 'C1' || n === 'C2' ? n : 'PF');   // cada núcleo tem suas próprias categorias

/* ---------- índice de cadastros ---------- */
function buildIndex(state) {
  const contas = new Map(state.contas.map(c => [c.id, c]));
  const cartoes = new Map(state.cartoes.map(c => [c.id, c]));
  const cats = new Map();
  for (const c of state.categorias) cats.set(c.escopo + '|' + c.tipo + '|' + c.nome, c);
  return { contas, cartoes, cats };
}
function subInfo(idx, nucleo, tipo, cat, sub) {
  const c = idx.cats.get(scopeOf(nucleo) + '|' + tipo + '|' + cat);
  if (!c) return { nat: tipo === 'Despesa' ? 'Variável' : null, ess: false, imp: false, transfer: null };
  const s = (c.subs || []).find(x => x.nome === sub) || {};
  return { nat: s.nat || c.nat || 'Variável', ess: !!(s.ess != null ? s.ess : c.ess), imp: !!(c.imp || s.imp), transfer: c.transfer || null };
}
const isInvAcc = a => !!a && (INV_TIPOS.includes(a.tipo) || !!a.reserva);

/* ---------- cartão: em qual fatura cai uma compra ---------- */
function faturaVenc(card, iso) {
  const m = ym(iso), d = +iso.slice(8, 10);
  const fech = +card.fechamento || 1, venc = +card.vencimento || 10;
  const closeM = d < fech ? m : addM(m, 1);            // compras no dia do fechamento vão para a próxima
  return venc > fech ? closeM : addM(closeM, 1);       // mês de vencimento da fatura
}

/* ==========================================================================
   LEDGER — transforma lançamentos, compromissos e compras no cartão em
   movimentos normalizados (um por evento financeiro).
   kind: R receita · D despesa · T transferência (inclui investimento)
   ========================================================================== */
function buildLedger(state, today) {
  const idx = buildIndex(state), cfg = state.config || {};
  const curM = ym(today), horizon = addM(curM, 24), ini = cfg.inicioControle || '1900-01';
  const L = [], faturas = new Map();
  const ovs = state.overrides || {}, fx = state.faturas || {};

  function fatStatus(card, mes) {
    const key = card.id + '|' + mes;
    if (faturas.has(key)) return faturas.get(key);
    const venc = dayIn(mes, card.vencimento), ex = fx[key];
    let pago, data, contaId = (ex && ex.contaId) || card.contaId, explicit = false;
    if (ex && ex.pago != null) { pago = !!ex.pago; data = pago ? (ex.data || venc) : null; explicit = true; }
    else { pago = !!cfg.baixaAutomatica && venc < today; data = pago ? venc : null; }
    const f = { key, cartaoId: card.id, mes, venc, pago, data, contaId, explicit, total: 0, itens: [], overdue: !pago && venc < today };
    faturas.set(key, f);
    return f;
  }
  const payerOf = (contaId, cartaoId, fb) => {
    if (cartaoId && idx.cartoes.get(cartaoId)) return idx.cartoes.get(cartaoId).nucleo;
    if (contaId && idx.contas.get(contaId)) return idx.contas.get(contaId).nucleo;
    return fb;
  };

  function push(m) {
    m.valor = r2(m.valor);
    m.overdue = !m.realized && !!m.venc && m.venc < today;
    m.pmes = m.realized ? ym(m.caixa) : ym(m.venc || m.data);
    L.push(m);
    if ((m.kind === 'R' || m.kind === 'D') && m.payer && m.payer !== m.nucleo) {
      const from = m.kind === 'D' ? m.payer : m.nucleo, to = m.kind === 'D' ? m.nucleo : m.payer;
      L.push({ id: m.id + '~x', src: m.src, ref: m.ref, kind: 'T', implicit: true, from, to, nucleo: from,
        tk: canonKind(from, to, null), valor: m.valor, comp: m.comp, data: m.data, venc: m.venc, caixa: m.caixa,
        realized: m.realized, overdue: m.overdue, pmes: m.pmes, resp: m.resp, desc: m.desc, cat: m.cat, sub: m.sub,
        exemplo: m.exemplo, inv: 0 });
    }
  }
  function pushCard(base, card, dateIso, comp, fm) {
    const f = fatStatus(card, fm);
    const m = Object.assign({}, base, { cartaoId: card.id, faturaMes: fm, comp, data: dateIso, venc: f.venc,
      realized: f.pago, caixa: f.data, payer: card.nucleo });
    f.total = r2(f.total + (m.kind === 'D' ? m.valor : -m.valor));
    f.itens.push(m);
    push(m);
  }

  /* ----- lançamentos manuais ----- */
  for (const l of state.lancamentos) {
    const valor = r2(l.valor);
    if (!(valor > 0) || !l.data) continue;
    const comp = l.competencia || ym(l.data);
    const resp = l.responsavel || 'NA';
    if (l.tipo === 'Receita' || l.tipo === 'Despesa') {
      const si = subInfo(idx, l.nucleo, l.tipo, l.categoria, l.subcategoria);
      const kind = l.tipo === 'Receita' ? 'R' : 'D';
      const base = { src: 'manual', ref: l.id, kind, nucleo: l.nucleo, resp, cat: l.categoria, sub: l.subcategoria,
        desc: l.descricao, exemplo: !!l.exemplo, ess: si.ess, imp: si.imp, nat: kind === 'D' ? (l.natureza || si.nat) : null };
      const card = l.forma === 'Cartão de crédito' && l.cartaoId ? idx.cartoes.get(l.cartaoId) : null;
      if (kind === 'D' && card) {
        const n = Math.max(1, Math.round(+l.parcelas || 1));
        const pv = r2(valor / n);
        const fm0 = faturaVenc(card, l.data), m0 = ym(l.data), day = +l.data.slice(8, 10);
        for (let k = 0; k < n; k++) {
          const comp_k = n === 1 ? comp : addM(m0, k), fm = addM(fm0, k);
          if (comp_k < ini && fm < ini) continue;
          if (fm > horizon) break;
          const v = k === n - 1 ? r2(valor - pv * (n - 1)) : pv;
          pushCard(Object.assign({}, base, { id: l.id + '#' + (k + 1), src: 'card', parcela: k + 1, parcelas: n, valor: v,
            nat: n > 1 && base.nat !== 'Financiamento' ? 'Parcela' : base.nat }), card, k === 0 ? l.data : dayIn(addM(m0, k), day), comp_k, fm);
        }
        continue;
      }
      const realized = l.status === 'Pago' || l.status === 'Recebido';
      push(Object.assign(base, { id: l.id, valor, comp, data: l.data, venc: l.vencimento || l.data, realized,
        caixa: realized ? (l.dataPagamento || l.data) : null, contaId: l.contaId, payer: payerOf(l.contaId, null, l.nucleo) }));
    } else {
      const co = idx.contas.get(l.contaId), cd = idx.contas.get(l.contaDestinoId);
      const from = co ? co.nucleo : (l.nucleo || 'PF'), to = cd ? cd.nucleo : from;
      let inv = 0;
      if (co && cd) inv = (isInvAcc(cd) ? 1 : 0) - (isInvAcc(co) ? 1 : 0);
      else if (l.tipo === 'Investimento') inv = l.categoria === 'Resgate' ? -1 : 1;
      const realized = l.status ? (l.status === 'Pago' || l.status === 'Recebido') : l.data <= today;
      push({ id: l.id, src: 'manual', ref: l.id, kind: 'T', implicit: false, from, to, nucleo: from,
        tk: canonKind(from, to, l.categoria), tipoOrig: l.tipo, cat: l.categoria, sub: l.subcategoria, desc: l.descricao,
        resp, valor, comp, data: l.data, venc: l.vencimento || l.data, realized, caixa: realized ? (l.dataPagamento || l.data) : null,
        contaOrig: co ? co.id : null, contaDest: cd ? cd.id : null, inv, exemplo: !!l.exemplo });
    }
  }

  /* ----- compromissos fixos / recorrentes ----- */
  for (const c of state.compromissos) {
    if (!c.inicio) continue;
    const sm = ym(c.inicio), day = +c.inicio.slice(8, 10);
    const n = compN(c);
    let last = n === Infinity ? horizon : addM(sm, n - 1);
    if (c.encerradoEm && c.encerradoEm < last) last = c.encerradoEm;
    const tipo = c.tipo || 'Despesa';
    const si = subInfo(idx, c.nucleo, tipo, c.categoria, c.subcategoria);
    const parcV = c.recorrencia === 'Parcelamento' && +c.valorTotal > 0 ? r2(+c.valorTotal / n) : r2(c.valor);
    const nat = tipo === 'Despesa' ? (c.natureza || (si.nat === 'Financiamento' ? 'Financiamento' : c.recorrencia === 'Parcelamento' ? 'Parcela' : 'Fixa')) : null;
    const card = c.cartaoId ? idx.cartoes.get(c.cartaoId) : null;
    let i = 0;
    for (let m = sm; m <= last && m <= horizon; m = addM(m, 1), i++) {
      if (m < ini) continue;
      const ov = ovs[c.id + '|' + m] || {};
      if (ov.pular) continue;
      let valor = ov.valor != null && ov.valor !== '' ? r2(ov.valor) : parcV;
      if (ov.valor == null && c.recorrencia === 'Parcelamento' && +c.valorTotal > 0 && i === n - 1) valor = r2(+c.valorTotal - parcV * (n - 1));
      const data = dayIn(m, day);
      const base = { id: c.id + '@' + m, src: 'comp', ref: c.id, occ: m, comp: m, parcela: i + 1, parcelas: n === Infinity ? null : n,
        nucleo: c.nucleo, resp: c.responsavel || 'NA', cat: c.categoria, sub: c.subcategoria, desc: c.descricao,
        exemplo: !!c.exemplo, ess: si.ess, imp: si.imp, nat, valor };
      const autoReal = ov.status ? (ov.status === 'Pago' || ov.status === 'Recebido') : (!!cfg.baixaAutomatica && data < today);
      if (si.transfer) {
        const co = idx.contas.get(c.contaId), cd = idx.contas.get(c.contaDestinoId);
        const other = c.nucleo === 'PF' ? 'C1' : 'PF';
        const from = co ? co.nucleo : (tipo === 'Receita' ? other : c.nucleo);
        const to = cd ? cd.nucleo : (tipo === 'Receita' ? c.nucleo : other);
        push(Object.assign(base, { kind: 'T', implicit: false, from, to, nucleo: from, tk: canonKind(from, to, si.transfer),
          data, venc: data, realized: autoReal, caixa: autoReal ? (ov.dataPagamento || data) : null,
          contaOrig: co ? co.id : null, contaDest: cd ? cd.id : null, inv: 0 }));
        continue;
      }
      base.kind = tipo === 'Receita' ? 'R' : 'D';
      if (card && base.kind === 'D') { pushCard(base, card, data, m, faturaVenc(card, data)); continue; }
      push(Object.assign(base, { data, venc: data, realized: autoReal, caixa: autoReal ? (ov.dataPagamento || data) : null,
        contaId: c.contaId, payer: payerOf(c.contaId, null, c.nucleo) }));
    }
  }

  /* ----- carteira de investimentos: compra e venda movem a conta; provento é receita ----- */
  const cart = state.carteira || {}, atvMap = new Map((cart.ativos || []).map(a => [a.id, a]));
  for (const o of cart.operacoes || []) {
    const a = atvMap.get(o.ativoId); if (!a || !o.data) continue;
    const v = opValor(o); if (!(v > 0)) continue;
    const nuc = a.nucleo || 'PF', ct = idx.contas.get(o.contaId), cn = ct ? ct.nucleo : nuc, realized = o.data <= today;
    const base = { id: o.id, src: 'inv', ref: o.id, opTipo: o.tipo, ticker: a.ticker, resp: 'P1', exemplo: !!o.exemplo, valor: v,
      comp: ym(o.data), data: o.data, venc: o.data, realized, caixa: realized ? o.data : null };
    if (o.tipo === 'Provento') {
      const pf = nuc === 'PF';
      push(Object.assign(base, { kind: 'R', nucleo: nuc, cat: pf ? 'Rendimentos' : 'Receitas extraordinárias', sub: pf ? 'Juros e dividendos' : 'Rendimentos financeiros',
        desc: (o.provTipo || 'Provento') + ' ' + a.ticker, ess: false, imp: false, nat: null, contaId: ct ? ct.id : null, payer: cn }));
    } else if (o.tipo === 'Compra') {
      push(Object.assign(base, { kind: 'T', implicit: false, from: cn, to: nuc, nucleo: cn, tk: canonKind(cn, nuc, null), cat: 'Compra de ativos', sub: a.ticker,
        desc: 'Compra ' + a.ticker, contaOrig: ct ? ct.id : null, contaDest: null, inv: 1 - (isInvAcc(ct) ? 1 : 0) }));
    } else if (o.tipo === 'Venda') {
      push(Object.assign(base, { kind: 'T', implicit: false, from: nuc, to: cn, nucleo: nuc, tk: canonKind(nuc, cn, null), cat: 'Venda de ativos', sub: a.ticker,
        desc: 'Venda ' + a.ticker, contaOrig: null, contaDest: ct ? ct.id : null, inv: (isInvAcc(ct) ? 1 : 0) - 1 }));
    }
  }

  L.sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : 0));
  return { items: L, faturas, idx, today, curM, horizon, ini, state };
}

function compN(c) {
  const sm = ym(c.inicio);
  if (c.recorrencia === 'Parcelamento') return Math.max(1, Math.round(+c.parcelas || 1));
  if (c.recorrencia === 'Temporária') return +c.parcelas > 0 ? Math.round(+c.parcelas) : (c.fim ? Math.max(1, mdiff(sm, c.fim) + 1) : 1);
  if (c.fim && !c.semFim) return Math.max(1, mdiff(sm, c.fim) + 1);
  return Infinity;
}

/* ==========================================================================
   AGREGAÇÃO por visão (núcleos + responsável) e mês.
   regime 'comp' = competência (tudo do mês, pago ou não);
   regime 'caixa' = só o que foi efetivamente pago/recebido, na data do caixa.
   ========================================================================== */
function blank() {
  return { ent: 0, sai: 0, rec: 0, rendaPJ: 0, b: { Fixa: 0, 'Variável': 0, Parcela: 0, Financiamento: 0, Aporte: 0 },
    imp: 0, ess: 0, inv: 0, dist: 0, retir: 0, tOut: 0, tIn: 0, apRec: 0, prolab: 0,
    recPrev: 0, recReal: 0, recPend: 0, despPend: 0, saiAuto: 0, mix: 0, mixN: 0,
    cat: {}, catE: {}, sub: {}, subVar: {}, impB: {}, items: [], n: 0 };
}
const addTo = (o, k, v) => { o[k] = r2((o[k] || 0) + v); };

function viewOf(nucleo, resp) { return { nucleos: nucleo === 'ALL' || !nucleo ? NUCLEOS.slice() : [nucleo], resp: resp || 'ALL', key: (nucleo || 'ALL') + '/' + (resp || 'ALL') }; }

function aggregate(ledger, view, regime) {
  const map = new Map();
  const get = k => { let x = map.get(k); if (!x) { x = blank(); map.set(k, x); } return x; };
  const inV = n => view.nucleos.includes(n);
  for (const m of ledger.items) {
    if (view.resp !== 'ALL' && m.resp !== view.resp) continue;
    const k = regime === 'caixa' ? (m.realized ? ym(m.caixa) : null) : m.comp;
    if (!k) continue;
    const v = m.valor;
    if (m.kind === 'R') {
      if (!inV(m.nucleo)) continue;
      const a = get(k); a.n++;
      a.ent += v; a.rec += v; addTo(a.catE, m.cat, v); a.recPrev += v;
      if (m.realized) a.recReal += v; else a.recPend += v;
    } else if (m.kind === 'D') {
      if (!inV(m.nucleo)) continue;
      const a = get(k); a.n++;
      a.sai += v; a.b[m.nat] = (a.b[m.nat] || 0) + v; addTo(a.cat, m.cat, v); addTo(a.sub, m.cat + ' › ' + (m.sub || '—'), v);
      if (m.nat === 'Variável') addTo(a.subVar, m.cat + ' › ' + (m.sub || '—'), v);
      if (m.imp) { a.imp += v; addTo(a.impB, m.nat, v); }
      if (m.ess || m.nat === 'Financiamento' || m.nat === 'Parcela') a.ess += v;
      if (!m.realized) a.despPend += v;
      if (m.src === 'comp' || (m.src === 'card' && m.parcelas > 1)) a.saiAuto += v;
      a.items.push(m);
    } else {
      const fi = inV(m.from), ti = inV(m.to);
      if (!fi && !ti) continue;
      const a = get(k); a.n++;
      if (m.implicit) { a.mix += v; a.mixN++; }
      if (fi && !ti) {
        if (m.from === 'PF') {
          a.sai += v; a.b.Aporte += v; addTo(a.cat, 'Aporte em empresa', v);
          if (!m.realized) a.despPend += v;
          if (m.src === 'comp') a.saiAuto += v;
        } else if (m.tk === 'Pró-labore') {
          a.sai += v; a.b.Fixa += v; a.prolab += v; addTo(a.cat, 'Pró-labore', v); addTo(a.sub, 'Pró-labore › ' + (m.sub || 'Pró-labore'), v);
          if (!m.realized) a.despPend += v;
          if (m.src === 'comp') a.saiAuto += v;
          a.items.push(m);
        } else if (m.tk === 'Distribuição de lucros') a.dist += v;
        else if (m.tk === 'Retirada pessoal / Sócio') a.retir += v;
        else a.tOut += v;
      } else if (ti && !fi) {
        if (m.to === 'PF') {
          a.ent += v; a.rendaPJ += v; addTo(a.catE, m.tk, v); a.recPrev += v;
          if (m.realized) a.recReal += v; else a.recPend += v;
        } else if (m.from === 'PF') a.apRec += v;
        else a.tIn += v;
      }
      if (m.inv > 0 && ti) a.inv += v; else if (m.inv < 0 && fi) a.inv -= v;
    }
  }
  for (const a of map.values()) roundM(a);
  return map;
}
function roundM(a) {
  for (const k of ['ent', 'sai', 'rec', 'rendaPJ', 'imp', 'ess', 'inv', 'dist', 'retir', 'tOut', 'tIn', 'apRec', 'prolab', 'recPrev', 'recReal', 'recPend', 'despPend', 'saiAuto', 'mix']) a[k] = r2(a[k]);
  for (const k in a.b) a.b[k] = r2(a.b[k]);
  return a;
}
function sumM(list) {
  const s = blank();
  for (const a of list) {
    if (!a) continue;
    for (const k of ['ent', 'sai', 'rec', 'rendaPJ', 'imp', 'ess', 'inv', 'dist', 'retir', 'tOut', 'tIn', 'apRec', 'prolab', 'recPrev', 'recReal', 'recPend', 'despPend', 'saiAuto', 'mix', 'mixN', 'n']) s[k] += a[k];
    for (const k in a.b) s.b[k] = (s.b[k] || 0) + a.b[k];
    for (const k in a.cat) addTo(s.cat, k, a.cat[k]);
    for (const k in a.catE) addTo(s.catE, k, a.catE[k]);
    for (const k in a.sub) addTo(s.sub, k, a.sub[k]);
    for (const k in a.subVar) addTo(s.subVar, k, a.subVar[k]);
    for (const k in a.impB) addTo(s.impB, k, a.impB[k]);
    if (a.items.length) s.items = s.items.concat(a.items);
  }
  return roundM(s);
}
const getM = (map, m) => map.get(m) || blank();
const sumRange = (map, a, b) => sumM(mrange(a, b).map(m => map.get(m)));
const monthsWithData = (map, a, b) => mrange(a, b).filter(m => { const x = map.get(m); return x && x.n > 0; });

/* indicadores derivados */
function der(a) {
  const ent = a.ent, res = r2(a.ent - a.sai), comp = r2(a.b.Fixa + a.b.Financiamento + a.b.Parcela);
  return {
    ent, sai: a.sai, res,
    taxa: ent > 0 ? res / ent : null,
    compromet: ent > 0 ? comp / ent : null, compVal: comp,
    pFix: ent > 0 ? a.b.Fixa / ent : null,
    pVar: ent > 0 ? a.b['Variável'] / ent : null,
    pParc: ent > 0 ? a.b.Parcela / ent : null,
    pDiv: ent > 0 ? (a.b.Parcela + a.b.Financiamento) / ent : null,
    fcl: r2(res - a.inv),
    recLiq: r2(a.rec - a.imp),
    margem: a.rec > 0 ? (a.rec - a.sai) / a.rec : null,
    caixaPJ: r2(res - a.dist - a.retir - a.tOut + a.apRec + a.tIn - a.inv),
    fixosSemImp: r2(a.b.Fixa - a.prolab),
  };
}

/* ==========================================================================
   SALDOS DE CONTAS
   ========================================================================== */
function accountDeltas(ledger) {
  const out = [];
  for (const m of ledger.items) {
    if (!m.realized || !m.caixa) continue;
    if (m.kind === 'R' && m.contaId) out.push({ data: m.caixa, contaId: m.contaId, d: m.valor });
    else if (m.kind === 'D' && m.contaId && !m.cartaoId) out.push({ data: m.caixa, contaId: m.contaId, d: -m.valor });
    else if (m.kind === 'T' && !m.implicit) {
      if (m.contaOrig) out.push({ data: m.caixa, contaId: m.contaOrig, d: -m.valor });
      if (m.contaDest) out.push({ data: m.caixa, contaId: m.contaDest, d: m.valor });
    }
  }
  for (const f of ledger.faturas.values()) if (f.pago && f.contaId && f.total) out.push({ data: f.data, contaId: f.contaId, d: -f.total, fatura: f.key });
  out.sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : 0));
  return out;
}
function balancesAt(state, ledger, asOf, deltas) {
  deltas = deltas || accountDeltas(ledger);
  const bal = {};
  for (const c of state.contas) bal[c.id] = (c.dataSaldo && c.dataSaldo > asOf) ? null : r2(c.saldoInicial);
  for (const x of deltas) {
    if (x.data > asOf) break;
    const c = ledger.idx.contas.get(x.contaId);
    if (!c || bal[c.id] == null) continue;
    if (c.dataSaldo && x.data < c.dataSaldo) continue;
    bal[c.id] = r2(bal[c.id] + x.d);
  }
  return bal;
}
function balanceSeries(state, ledger, months, filterFn) {
  const deltas = accountDeltas(ledger);
  const contas = state.contas.filter(filterFn || (() => true));
  return months.map(m => {
    const bal = balancesAt(state, ledger, monthEnd(m), deltas);
    let tot = 0, any = false;
    for (const c of contas) if (bal[c.id] != null) { tot += bal[c.id]; any = true; }
    return any ? r2(tot) : null;
  });
}
function contaFiltro(view) {
  return c => view.nucleos.includes(c.nucleo) && (view.resp === 'ALL' || c.titular === view.resp);
}

/* ==========================================================================
   COMPROMISSOS — resumo de cada obrigação (parcela atual, restantes, término)
   ========================================================================== */
function resumoCompromissos(state, ledger) {
  const today = ledger.today, curM = ledger.curM, ini = ledger.ini;
  const byRef = new Map();
  for (const m of ledger.items) if (m.src === 'comp' && !m.implicit) { (byRef.get(m.ref) || byRef.set(m.ref, []).get(m.ref)).push(m); }
  return state.compromissos.map(c => {
    const occ = byRef.get(c.id) || [];
    const n = compN(c);
    const sm = ym(c.inicio);
    const antes = Math.max(0, Math.min(n === Infinity ? 1e9 : n, mdiff(sm, ini)));
    const pagas = antes + occ.filter(o => o.realized).length;
    const pend = occ.filter(o => !o.realized);
    let lastM = n === Infinity ? null : addM(sm, n - 1);
    if (c.encerradoEm && (!lastM || c.encerradoEm < lastM)) lastM = c.encerradoEm;
    const finito = lastM != null;
    const restantes = finito ? Math.max(0, (n === Infinity ? mdiff(sm, lastM) + 1 : Math.min(n, mdiff(sm, lastM) + 1)) - pagas) : null;
    const valorRestante = finito ? r2(pend.reduce((s, o) => s + o.valor, 0)) : null;
    const prox = pend.slice().sort((a, b) => (a.venc < b.venc ? -1 : 1))[0];
    const atual = occ.find(o => o.occ === curM);
    const valorMes = c.recorrencia === 'Parcelamento' && +c.valorTotal > 0 ? r2(+c.valorTotal / n) : r2(c.valor);
    let status = 'Ativo';
    if (sm > curM) status = 'Futuro';
    if (finito && lastM < curM) status = 'Encerrado';
    if (c.encerradoEm && c.encerradoEm < curM) status = 'Encerrado';
    return { c, n, pagas, restantes, valorRestante, prox: prox ? prox.venc : null, proxValor: prox ? prox.valor : null,
      parcelaAtual: atual ? atual.parcela : (status === 'Futuro' ? 0 : null), lastM, finito, valorMes, status,
      atrasadas: pend.filter(o => o.overdue).length };
  });
}
/* compras parceladas no cartão (agrupadas pela compra original) */
function resumoParceladosCartao(state, ledger) {
  const g = new Map();
  for (const m of ledger.items) if (m.src === 'card' && m.parcelas > 1 && m.kind === 'D') { (g.get(m.ref) || g.set(m.ref, []).get(m.ref)).push(m); }
  const out = [];
  for (const [ref, its] of g) {
    const l = state.lancamentos.find(x => x.id === ref); if (!l) continue;
    its.sort((a, b) => a.parcela - b.parcela);
    const n = its[0].parcelas, pagas = its.filter(i => i.realized).length + (n - its.length);
    const pend = its.filter(i => !i.realized);
    const last = its[its.length - 1];
    const atual = pend[0] || its.find(i => i.faturaMes === ledger.curM);
    out.push({ l, n, pagas, restantes: n - pagas, valorParcela: its[0].valor, valorRestante: r2(pend.reduce((s, i) => s + i.valor, 0)),
      lastM: last.faturaMes, parcelaAtual: atual ? atual.parcela : n, cartaoId: l.cartaoId, nucleo: l.nucleo });
  }
  return out.sort((a, b) => (a.lastM < b.lastM ? -1 : 1));
}

/* ==========================================================================
   PROJEÇÕES — compromissos já assumidos + cenário-base
   ========================================================================== */
function projetar(state, ledger, view, n, histMap) {
  const curM = ledger.curM, months = mrange(curM, addM(curM, n - 1));
  const inV = x => view.nucleos.includes(x);
  const rows = new Map(months.map(m => [m, { mes: m, fixos: 0, parc: 0, fin: 0, outros: 0, total: 0, recAg: 0, varAg: 0, distAg: 0 }]));
  for (const m of ledger.items) {
    if (view.resp !== 'ALL' && m.resp !== view.resp) continue;
    const pm = m.cartaoId ? m.faturaMes : m.pmes;
    const r = rows.get(pm); if (!r) continue;
    if (m.kind === 'D' && inV(m.nucleo)) {
      const auto = m.src === 'comp' || (m.src === 'card' && m.parcelas > 1);
      if (auto) { if (m.nat === 'Parcela') r.parc += m.valor; else if (m.nat === 'Financiamento') r.fin += m.valor; else if (m.nat === 'Fixa') r.fixos += m.valor; else r.outros += m.valor; }
      else if (!m.realized || m.cartaoId) { r.outros += m.valor; r.varAg += m.valor; }
    } else if (m.kind === 'R' && inV(m.nucleo)) { r.recAg += m.valor; }
    else if (m.kind === 'T' && !m.implicit) {
      const fi = inV(m.from), ti = inV(m.to);
      if (fi && !ti) {
        if (m.from === 'PF' || m.tk === 'Pró-labore') { if (m.src === 'comp') r.fixos += m.valor; else if (!m.realized) r.outros += m.valor; }
        else if (m.src === 'comp' || !m.realized) r.distAg += m.valor;
      } else if (ti && !fi && m.to === 'PF') r.recAg += m.valor;
    }
  }
  // médias históricas: últimos 6 meses fechados
  const h1 = addM(curM, -1), h0 = addM(curM, -6);
  const hm = monthsWithData(histMap, h0, h1);
  const nh = hm.length || 1;
  const H = sumM(hm.map(m => histMap.get(m)));
  const recMed = hm.length ? H.ent / nh : 0;
  const varMed = hm.length ? (H.sai - H.saiAuto) / nh : 0;
  const distMed = hm.length ? (H.dist + H.retir + H.tOut - H.apRec - H.tIn) / nh : 0;
  const deltas = accountDeltas(ledger);
  const bal = balancesAt(state, ledger, ledger.today, deltas);
  const filt = contaFiltro(view);
  let saldo = 0; for (const c of state.contas) if (filt(c) && bal[c.id] != null) saldo += bal[c.id];
  saldo = r2(saldo);
  // realizado até hoje no mês corrente (caixa)
  const cx = aggregate(ledger, view, 'caixa').get(curM) || blank();
  let s = saldo;
  const out = [];
  for (const r of rows.values()) {
    for (const k of ['fixos', 'parc', 'fin', 'outros', 'recAg', 'varAg', 'distAg']) r[k] = r2(r[k]);
    r.total = r2(r.fixos + r.parc + r.fin + r.outros);
    r.comprometidoSemVar = r2(r.fixos + r.parc + r.fin);
    r.recProj = r2(Math.max(recMed, r.recAg));
    const varProj = Math.max(varMed, r.varAg);
    r.saiProj = r2(r.comprometidoSemVar + varProj);
    r.resProj = r2(r.recProj - r.saiProj);
    const distProj = Math.max(distMed, r.distAg);
    if (r.mes === curM) {
      const recFalta = Math.max(0, r.recProj - cx.ent), saiFalta = Math.max(0, r.saiProj - cx.sai);
      const distFalta = Math.max(0, distProj - (cx.dist + cx.retir + cx.tOut - cx.apRec - cx.tIn));
      s = r2(s + recFalta - saiFalta - distFalta);
    } else s = r2(s + r.resProj - distProj);
    r.saldoProj = s;
    out.push(r);
  }
  return { rows: out, recMed: r2(recMed), varMed: r2(varMed), distMed: r2(distMed), saldoHoje: saldo, mesesBase: hm.length };
}

/* compromissos que terminam (compromissos com fim + parcelados no cartão) */
function encerramentos(state, ledger, view, ateMes) {
  const inV = x => view.nucleos.includes(x);
  const curM = ledger.curM, out = [];
  for (const r of resumoCompromissos(state, ledger)) {
    const c = r.c;
    if (!r.finito || !r.lastM || r.lastM < curM || (ateMes && r.lastM > ateMes)) continue;
    if (!inV(c.nucleo) || (view.resp !== 'ALL' && (c.responsavel || 'NA') !== view.resp)) continue;
    out.push({ desc: c.descricao, nucleo: c.nucleo, tipo: c.tipo || 'Despesa', valor: r.valorMes, lastM: r.lastM, libera: addM(r.lastM, 1),
      natureza: c.natureza || (c.recorrencia === 'Parcelamento' ? 'Parcela' : 'Fixa'), origem: 'Compromisso', restante: r.valorRestante, recorrencia: c.recorrencia });
  }
  for (const p of resumoParceladosCartao(state, ledger)) {
    if (p.lastM < curM || (ateMes && p.lastM > ateMes)) continue;
    if (!inV(p.nucleo) || (view.resp !== 'ALL' && (p.l.responsavel || 'NA') !== view.resp)) continue;
    out.push({ desc: p.l.descricao || p.l.subcategoria, nucleo: p.nucleo, tipo: 'Despesa', valor: p.valorParcela, lastM: p.lastM, libera: addM(p.lastM, 1),
      natureza: 'Parcela', origem: 'Cartão', restante: p.valorRestante, recorrencia: 'Parcelamento' });
  }
  return out.sort((a, b) => (a.lastM < b.lastM ? -1 : a.lastM > b.lastM ? 1 : b.valor - a.valor));
}
function parcelasFuturas(state, ledger, view) {
  const inV = x => view.nucleos.includes(x);
  let tot = 0, ate = null;
  for (const m of ledger.items) {
    if (m.kind !== 'D' || m.realized || !inV(m.nucleo)) continue;
    if (view.resp !== 'ALL' && m.resp !== view.resp) continue;
    if (m.nat !== 'Parcela') continue;
    tot += m.valor; const pm = m.cartaoId ? m.faturaMes : m.pmes; if (!ate || pm > ate) ate = pm;
  }
  return { total: r2(tot), ate };
}

/* ==========================================================================
   RESERVA, LIQUIDEZ, CAIXA PJ
   ========================================================================== */
function reserva(state, ledger, mesBase, histPF) {
  const asOf = mesBase >= ledger.curM ? ledger.today : monthEnd(mesBase);
  const bal = balancesAt(state, ledger, asOf);
  let total = 0; const contas = [];
  for (const c of state.contas) if (c.reserva && c.nucleo === 'PF' && bal[c.id] != null) { total += bal[c.id]; contas.push(c); }
  const fim = mesBase >= ledger.curM ? addM(ledger.curM, -1) : mesBase;
  const ms = monthsWithData(histPF, addM(fim, -5), fim);
  const ess = ms.length ? sumM(ms.map(m => histPF.get(m))).ess / ms.length : 0;
  const meses = ess > 0 ? total / ess : null;
  const f = state.config.faixasReserva || [3, 6, 12];
  let faixa = 'Sem dado', nivel = 'info';
  if (meses != null) {
    if (meses < f[0]) { faixa = 'Atenção'; nivel = 'alerta'; }
    else if (meses < f[1]) { faixa = 'Razoável'; nivel = 'atencao'; }
    else if (meses < f[2]) { faixa = 'Confortável'; nivel = 'ok'; }
    else { faixa = 'Elevada segurança de liquidez'; nivel = 'ok'; }
  }
  return { total: r2(total), essMed: r2(ess), meses, faixa, nivel, contas, nMeses: ms.length };
}
function saldoPorNucleo(state, ledger, asOf) {
  const bal = balancesAt(state, ledger, asOf);
  const out = {};
  for (const n of NUCLEOS) out[n] = { liquido: 0, reserva: 0, outros: 0, total: 0 };
  for (const c of state.contas) {
    const v = bal[c.id]; if (v == null || !out[c.nucleo]) continue;
    const o = out[c.nucleo];
    if (c.reserva || INV_TIPOS.includes(c.tipo)) o.reserva += v; else if (LIQ_TIPOS.includes(c.tipo)) o.liquido += v; else o.outros += v;
    o.total += v;
  }
  for (const n of NUCLEOS) for (const k in out[n]) out[n][k] = r2(out[n][k]);
  return { porNucleo: out, bal };
}

/* ==========================================================================
   SAÚDE FINANCEIRA (0–100) — PF + empresas
   ========================================================================== */
const PESOS_PADRAO = { resultado: 10, poupanca: 20, comprometimento: 15, reserva: 20, endividamento: 10, tendencia: 10, liquidez: 10, consultorios: 5 };
const FAIXAS_SAUDE = [[85, 'Excelente', 'ok'], [70, 'Saudável', 'ok'], [55, 'Atenção', 'atencao'], [40, 'Risco', 'alerta'], [0, 'Crítico', 'alerta']];
function faixaSaude(s) { for (const f of FAIXAS_SAUDE) if (s >= f[0]) return { nome: f[1], nivel: f[2] }; return { nome: 'Crítico', nivel: 'alerta' }; }
const lin = (x, x0, x1) => clamp((x - x0) / (x1 - x0), 0, 1) * 100; // x0 -> 0 pts, x1 -> 100 pts

function saude(state, ledger, ctx, mesSel) {
  const cfg = state.config, P = Object.assign({}, PESOS_PADRAO, cfg.pesosSaude || {});
  const base = mesSel >= ledger.curM ? addM(ledger.curM, -1) : mesSel;   // mês em andamento usa meses fechados
  const all = ctx.agg('ALL', 'ALL', 'comp'), pf = ctx.agg('PF', 'ALL', 'comp');
  // critérios 1–5 medem a PF (renda = o que entra na PF, inclusive pró-labore e lucros das empresas)
  const l3 = monthsWithData(pf, addM(base, -2), base), l6 = monthsWithData(pf, addM(base, -5), base);
  const S3 = sumM(l3.map(m => pf.get(m))), d3 = der(S3);
  // critérios 6–8 medem o conjunto (PF + empresas)
  const t3 = monthsWithData(all, addM(base, -2), base), p3 = monthsWithData(all, addM(base, -5), addM(base, -3));
  const T3 = sumM(t3.map(m => all.get(m))), SP = sumM(p3.map(m => all.get(m)));
  const comps = [];
  const add = (key, nome, nota, valor, detalhe) => comps.push({ key, nome, peso: +P[key] || 0, nota: nota == null ? null : Math.round(nota), valor, detalhe });

  // 1 resultado: % dos últimos 6 meses com sobra
  if (l6.length) { const pos = l6.filter(m => der(pf.get(m)).res >= 0).length; add('resultado', 'Resultado mensal', pos / l6.length * 100, pos + ' de ' + l6.length + ' meses', 'Meses em que a PF fechou com sobra, entre os últimos ' + l6.length + ' fechados'); }
  else add('resultado', 'Resultado mensal', null, 'Sem dado', 'Precisa de pelo menos 1 mês fechado');
  // 2 taxa de poupança
  const meta = +cfg.metaPoupanca || 0.2;
  if (l3.length && S3.ent > 0) add('poupanca', 'Taxa de poupança', lin(d3.taxa, 0, meta), pct(d3.taxa), 'Sobra da PF ÷ entradas da PF, ' + l3.length + ' meses; nota máxima a partir de ' + pct(meta, 0));
  else add('poupanca', 'Taxa de poupança', null, 'Sem dado', '');
  // 3 comprometimento
  const cl = cfg.limitesComprometimento || [0.4, 0.8];
  if (l3.length && S3.ent > 0) add('comprometimento', 'Comprometimento da renda', lin(d3.compromet, cl[1], cl[0]), pct(d3.compromet), 'Fixos + parcelas + financiamentos da PF ÷ entradas da PF; 100 pts até ' + pct(cl[0], 0) + ', zero a partir de ' + pct(cl[1], 0));
  else add('comprometimento', 'Comprometimento da renda', null, 'Sem dado', '');
  // 4 reserva
  const rs = reserva(state, ledger, mesSel, pf), metaR = +cfg.metaReservaMeses || 6;
  if (rs.meses != null) add('reserva', 'Reserva de emergência', lin(rs.meses, 0, metaR), num(rs.meses) + ' meses', 'Reserva ÷ despesas essenciais médias da PF; nota máxima com ' + metaR + ' meses');
  else add('reserva', 'Reserva de emergência', null, 'Sem dado', 'Marque as contas de reserva e registre despesas da PF');
  // 5 endividamento
  const el = cfg.limitesEndividamento || [0.1, 0.4];
  if (l3.length && S3.ent > 0) add('endividamento', 'Endividamento', lin(d3.pDiv, el[1], el[0]), pct(d3.pDiv), 'Parcelas + financiamentos da PF ÷ entradas da PF; 100 pts até ' + pct(el[0], 0) + ', zero a partir de ' + pct(el[1], 0));
  else add('endividamento', 'Endividamento', null, 'Sem dado', '');
  // 6 tendência
  const p6 = monthsWithData(all, addM(base, -8), addM(base, -3)), usa6 = p6.length === 6;
  const SB = usa6 ? sumM(p6.map(m => all.get(m))) : SP, nB = usa6 ? 6 : p3.length;
  if (t3.length === 3 && nB >= 3 && SB.ent > 0 && SB.sai > 0) {
    const gR = (T3.ent / 3) / (SB.ent / nB) - 1, gD = (T3.sai / 3) / (SB.sai / nB) - 1, diff = gR - gD;
    add('tendencia', 'Tendência', clamp(50 + diff * 500, 0, 100), (diff >= 0 ? '+' : '') + num(diff * 100) + ' p.p.', 'Visão consolidada: variação das entradas médias (' + pct(gR) + ') menos a das saídas (' + pct(gD) + '), últimos 3 meses x ' + nB + ' anteriores');
  } else add('tendencia', 'Tendência', null, 'Sem dado', 'Precisa de 6 meses fechados');
  // 7 liquidez: caixa líquido ÷ compromissos do mês seguinte
  const asOf = mesSel >= ledger.curM ? ledger.today : monthEnd(mesSel);
  const sn = saldoPorNucleo(state, ledger, asOf);
  const caixa = NUCLEOS.reduce((s, n) => s + sn.porNucleo[n].liquido, 0);
  const prox = addM(mesSel >= ledger.curM ? ledger.curM : mesSel, 1);
  let obrig = 0;
  for (const m of ledger.items) if (m.kind === 'D' && (m.cartaoId ? m.faturaMes : m.pmes) === prox && (m.src !== 'manual' || !m.realized)) obrig += m.valor;
  const ll = cfg.limitesLiquidez || [0.5, 1.5];
  if (obrig > 0) add('liquidez', 'Liquidez', lin(caixa / obrig, ll[0], ll[1]), num(caixa / obrig, 2) + 'x', 'Saldo em contas correntes ÷ compromissos de ' + mesLongo(prox) + '; 100 pts a partir de ' + num(ll[1]) + 'x');
  else add('liquidez', 'Liquidez', null, 'Sem dado', 'Sem compromissos cadastrados para o mês seguinte');
  // 8 empresas
  const c1 = ctx.agg('C1', 'ALL', 'comp'), c2 = ctx.agg('C2', 'ALL', 'comp');
  const pj = sumM(t3.map(m => c1.get(m)).concat(t3.map(m => c2.get(m))));
  if (pj.rec > 0) {
    const mg = (pj.rec - pj.sai) / pj.rec, resPJ = pj.rec - pj.sai;
    let nota = lin(mg, 0, +cfg.metaMargemPJ || 0.25), obs = '';
    if (pj.apRec > 0) { nota *= 0.5; obs = '; nota pela metade: houve aporte da PF (' + brl(pj.apRec) + ')'; }
    if (pj.dist + pj.retir > resPJ && pj.dist + pj.retir > 0) { nota *= 0.7; obs += '; ×0,7: distribuíram ' + brl(pj.dist + pj.retir) + ', acima do resultado de ' + brl(resPJ); }
    if (T3.mix > 0) { nota = Math.max(0, nota - 15); obs += '; −15 pts por mistura PF/PJ'; }
    add('consultorios', 'Resultado das empresas', nota, pct(mg), 'Margem operacional somada das empresas (3 meses); nota máxima com ' + pct(+cfg.metaMargemPJ || 0.25, 0) + obs);
  } else add('consultorios', 'Resultado das empresas', null, 'Sem dado', '');

  const valid = comps.filter(c => c.nota != null && c.peso > 0);
  const pesoTot = valid.reduce((s, c) => s + c.peso, 0);
  const score = pesoTot > 0 ? Math.round(valid.reduce((s, c) => s + c.nota * c.peso, 0) / pesoTot) : null;
  for (const c of comps) c.contrib = c.nota != null && pesoTot > 0 ? c.nota * c.peso / pesoTot : null;
  return { score, faixa: score == null ? null : faixaSaude(score), comps, base, pesoTot, reserva: rs };
}

/* ==========================================================================
   COMPARAÇÕES
   ========================================================================== */
function comparacoes(map, mesSel, curM) {
  const M = mesSel, part = M >= curM;
  const per = [
    { key: 'mm', nome: 'Mês x mês anterior', a: [M, M], b: [addM(M, -1), addM(M, -1)] },
    { key: 'ma', nome: 'Mês x mesmo mês do ano anterior', a: [M, M], b: [addM(M, -12), addM(M, -12)] },
    { key: '3m', nome: 'Últimos 3 meses x 3 anteriores', a: [addM(M, -2), M], b: [addM(M, -5), addM(M, -3)] },
    { key: '6m', nome: 'Últimos 6 meses x 6 anteriores', a: [addM(M, -5), M], b: [addM(M, -11), addM(M, -6)] },
    { key: '12m', nome: 'Últimos 12 meses x 12 anteriores', a: [addM(M, -11), M], b: [addM(M, -23), addM(M, -12)] },
    { key: 'ano', nome: 'Ano até o mês x mesmo período do ano anterior', a: [M.slice(0, 4) + '-01', M], b: [(+M.slice(0, 4) - 1) + '-01', addM(M, -12)] },
  ];
  return per.map(p => {
    const ma = monthsWithData(map, p.a[0], p.a[1]), mb = monthsWithData(map, p.b[0], p.b[1]);
    const nb = mdiff(p.b[0], p.b[1]) + 1;
    const A = sumM(ma.map(m => map.get(m))), B = sumM(mb.map(m => map.get(m)));
    return Object.assign({}, p, { A, B, dA: der(A), dB: der(B), temA: ma.length > 0, temB: mb.length === nb, parcial: part, nA: ma.length, nB: mb.length, nEsp: nb });
  });
}
const varPct = (a, b) => (b && Math.abs(b) > 0.005) ? (a - b) / Math.abs(b) : null;

/* ==========================================================================
   DIAGNÓSTICO E RECOMENDAÇÕES — textos gerados a partir dos números
   ========================================================================== */
const semPJ = s => String(s == null ? '' : s).replace(/^\s*PJ\s+/i, '').trim();
function nomeN(state, n) { const c = state.config; return n === 'PF' ? (c.nomePF || 'Pessoal (PF)') : n === 'C1' ? 'PJ ' + (semPJ(c.nomeC1) || 'Imobiliária') : n === 'C2' ? 'PJ ' + (semPJ(c.nomeC2) || 'Jurídico') : 'Consolidado'; }

function diagnostico(state, ledger, ctx, nucleo, resp, mesSel) {
  const out = [], view = viewOf(nucleo, resp);
  const map = ctx.agg(nucleo, resp, 'comp');
  const base = mesSel >= ledger.curM ? addM(ledger.curM, -1) : mesSel;
  const cur = getM(map, mesSel), dc = der(cur);
  const S3 = sumRange(map, addM(base, -2), base), SP = sumRange(map, addM(base, -5), addM(base, -3));
  const n3 = monthsWithData(map, addM(base, -2), base).length, np = monthsWithData(map, addM(base, -5), addM(base, -3)).length;
  const isPJ = nucleo === 'C1' || nucleo === 'C2';
  const lbl = isPJ ? { e: 'a receita', s: 'os custos' } : { e: 'as entradas', s: 'as despesas' };

  if (cur.n > 0 && cur.ent > 0) {
    if (dc.res < 0) out.push({ nivel: 'alerta', txt: 'O mês de ' + mesLongo(mesSel) + ' está com déficit de ' + brl(-dc.res) + ': as saídas superam ' + lbl.e + ' em ' + pct(-dc.res / cur.ent) + '.' });
    else out.push({ nivel: 'ok', txt: 'Em ' + mesLongo(mesSel) + ' sobraram ' + brl(dc.res) + ' (' + pct(dc.taxa) + ' ' + (isPJ ? 'de margem' : 'do que entrou') + ').' });
  }
  const S6p = sumRange(map, addM(base, -8), addM(base, -3)), n6p = monthsWithData(map, addM(base, -8), addM(base, -3)).length;
  const BS = n6p === 6 ? S6p : SP, nb = n6p === 6 ? 6 : np;
  if (n3 === 3 && nb >= 3 && BS.ent > 0 && BS.sai > 0) {
    const gD = (S3.sai / 3) / (BS.sai / nb) - 1, gR = (S3.ent / 3) / (BS.ent / nb) - 1;
    const niv = gD - gR > 0.05 ? 'atencao' : (gR - gD > 0.03 ? 'ok' : 'info');
    out.push({ nivel: niv, txt: 'Na média dos últimos 3 meses fechados, ' + lbl.s + ' variaram ' + sinal(gD) + ' e ' + lbl.e + ' ' + sinal(gR) + ' em relação à média dos ' + nb + ' meses anteriores.' });
  }
  if (cur.ent > 0) {
    const c = dc.compromet;
    out.push({ nivel: c > 0.6 ? 'alerta' : c > 0.45 ? 'atencao' : 'info', txt: pct(c, 0) + ' ' + (isPJ ? 'da receita' : 'da renda') + ' do mês está comprometida com custos fixos, financiamentos e parcelas (' + brl(dc.compVal) + ').' });
    if (cur.b.Parcela > 0) out.push({ nivel: dc.pParc > 0.15 ? 'atencao' : 'info', txt: 'Os parcelamentos somam ' + brl(cur.b.Parcela) + ' no mês, ' + pct(dc.pParc) + ' ' + (isPJ ? 'da receita' : 'da renda') + '.' });
  }
  if (!isPJ) {
    const c1 = ctx.agg('C1', 'ALL', 'comp'), c2 = ctx.agg('C2', 'ALL', 'comp');
    const a1 = sumRange(c1, addM(base, -5), base), a2 = sumRange(c2, addM(base, -5), base);
    if (a1.rec > 0 && a2.rec > 0 && nucleo === 'ALL') {
      const m1 = der(a1).margem, m2 = der(a2).margem;
      out.push({ nivel: Math.min(m1, m2) < 0.1 ? 'atencao' : 'info', txt: nomeN(state, 'C1') + ' tem margem operacional média de ' + pct(m1, 0) + ' nos últimos 6 meses; ' + nomeN(state, 'C2') + ', ' + pct(m2, 0) + '.' });
    }
  }
  const lim = addM(ledger.curM, 6);
  const enc = encerramentos(state, ledger, view, lim).filter(e => e.tipo === 'Despesa' && e.lastM >= ledger.curM);
  if (enc.length) {
    const tot = enc.reduce((s, e) => s + e.valor, 0);
    const ult = enc[enc.length - 1].lastM;
    out.push({ nivel: 'ok', txt: 'Até ' + mesBarra(ult) + (enc.length > 1 ? ' terminam ' + enc.length + ' compromissos' : ' termina 1 compromisso') + ', liberando cerca de ' + brl(tot) + '/mês no orçamento.' });
  }
  if (!isPJ) {
    const rs = reserva(state, ledger, mesSel, ctx.agg('PF', 'ALL', 'comp'));
    if (rs.meses != null) out.push({ nivel: rs.nivel, txt: 'A reserva (' + brl(rs.total) + ') cobre cerca de ' + num(rs.meses) + ' meses das despesas essenciais da PF (' + brl(rs.essMed) + '/mês) — faixa: ' + rs.faixa.toLowerCase() + '.' });
  }
  if (cur.recPend > 0 && mesSel <= ledger.curM) out.push({ nivel: 'info', txt: 'Faltam receber ' + brl(cur.recPend) + ' das ' + (isPJ ? 'receitas' : 'entradas') + ' previstas do mês (' + pct(cur.recReal / (cur.recPrev || 1), 0) + ' já recebido).' });
  const atr = ledger.items.filter(m => m.overdue && m.kind === 'D' && view.nucleos.includes(m.nucleo) && (view.resp === 'ALL' || m.resp === view.resp));
  if (atr.length) out.push({ nivel: 'alerta', txt: atr.length + (atr.length > 1 ? ' contas estão atrasadas' : ' conta está atrasada') + ', somando ' + brl(atr.reduce((s, m) => s + m.valor, 0)) + '.' });
  if (cur.mixN > 0) out.push({ nivel: 'atencao', txt: cur.mixN + (cur.mixN > 1 ? ' lançamentos misturaram' : ' lançamento misturou') + ' dinheiro da PF e das empresas neste mês (' + brl(cur.mix) + '). Foram tratados como retirada ou aporte do sócio.' });
  const orc = orcamentoStatus(state, ctx, nucleo === 'ALL' ? null : nucleo, mesSel).filter(o => o.uso > 1);
  if (orc.length) out.push({ nivel: 'atencao', txt: orc.length + (orc.length > 1 ? ' categorias passaram' : ' categoria passou') + ' do orçamento: ' + orc.slice(0, 3).map(o => o.categoria + ' (' + pct(o.uso, 0) + ')').join(', ') + '.' });
  const ord = { alerta: 0, atencao: 1, ok: 2, info: 3 };
  return out.sort((a, b) => ord[a.nivel] - ord[b.nivel]);
}
const sinal = v => (v == null || !isFinite(v) ? '—' : Math.abs(v) < 0.005 ? '0%' : (v > 0 ? '+' : '') + pct(v, 0));

function orcamentoStatus(state, ctx, nucleo, mes) {
  const al = state.config.alertaOrcamento || [0.8, 1];
  const out = [];
  const nucs = nucleo ? [nucleo] : NUCLEOS;
  for (const n of nucs) {
    const a = getM(ctx.agg(n, 'ALL', 'comp'), mes);
    for (const o of state.orcamentos.filter(o => o.nucleo === n)) {
      const real = a.cat[o.categoria] || 0, orc = +o.valor || 0;
      const uso = orc > 0 ? real / orc : (real > 0 ? Infinity : 0);
      out.push({ o, nucleo: n, categoria: o.categoria, orcado: orc, realizado: r2(real), dif: r2(orc - real), uso,
        status: uso > al[1] ? 'Excedido' : uso >= al[0] ? 'Atenção' : 'Normal' });
    }
  }
  return out;
}

function recomendacoes(state, ledger, ctx, mesSel) {
  const R = [];
  const base = mesSel >= ledger.curM ? addM(ledger.curM, -1) : mesSel;
  const all = ctx.agg('ALL', 'ALL', 'comp'), pf = ctx.agg('PF', 'ALL', 'comp');
  const l3 = [addM(base, -2), base], p3 = [addM(base, -5), addM(base, -3)], l6 = [addM(base, -5), base];
  const n6 = monthsWithData(all, l6[0], l6[1]).length;
  const A3 = sumRange(all, ...l3), A6 = sumRange(all, ...l6);
  const d3 = der(A3);
  const PF3 = sumRange(pf, ...l3), PFp = sumRange(pf, ...p3);
  const nPF3 = monthsWithData(pf, ...l3).length, nPFp = monthsWithData(pf, ...p3).length;

  // 1) subcategorias da PF em alta
  if (nPF3 === 3 && nPFp === 3 && PF3.sai > 0) {
    const cands = [];
    for (const k in PF3.subVar) {
      const a = PF3.subVar[k] / 3, b = (PFp.subVar[k] || 0) / 3;
      if (b <= 0 || a < 400) continue;
      const g = a / b - 1, share = PF3.subVar[k] / PF3.sai;
      if (g >= 0.2 && share >= 0.03) cands.push({ k, a, b, g, share });
    }
    cands.sort((x, y) => (y.a - y.b) - (x.a - x.b));
    for (const c of cands.slice(0, 2)) {
      const [cat, sub] = c.k.split(' › ');
      R.push({ prio: 2, tipo: 'Gastos', titulo: 'Gastos com ' + (sub && sub !== '—' ? sub.toLowerCase() : cat.toLowerCase()) + ' em alta',
        txt: 'Os gastos com ' + cat + (sub && sub !== '—' ? ' › ' + sub : '') + ' cresceram ' + pct(c.g, 0) + ' nos últimos três meses (média de ' + brl(c.a) + '/mês, contra ' + brl(c.b) + ' antes) e representam ' + pct(c.share, 0) + ' das despesas da PF.',
        efeito: 'Voltar à média anterior libera cerca de ' + brl(c.a - c.b) + '/mês.', ganho: c.a - c.b });
    }
  }
  // 2) custos comprometidos elevados (PF)
  const dPF3 = der(PF3), limC = +state.config.limiteComprometimento || 0.5;
  if (nPF3 && PF3.ent > 0 && dPF3.compromet > limC) {
    const fixos = topFixos(ledger, l3[0], l3[1], 3, 'PF');
    R.push({ prio: dPF3.compromet > limC + 0.1 ? 1 : 2, tipo: 'Estrutura', titulo: 'Renda da PF muito comprometida',
      txt: 'Custos fixos, financiamentos e parcelas da PF representam ' + pct(dPF3.compromet, 0) + ' das entradas médias dos últimos três meses, acima do limite adotado de ' + pct(limC, 0) + '. Revise contratos recorrentes antes de assumir novos parcelamentos.' + (fixos.length ? ' Maiores itens: ' + fixos.map(f => f.desc + ' (' + brl(f.v) + ')').join(', ') + '.' : ''),
      efeito: 'Para voltar ao limite, é preciso reduzir cerca de ' + brl((dPF3.compromet - limC) * PF3.ent / nPF3) + '/mês em compromissos — ou aguardar o fim dos parcelamentos em curso.', ganho: (dPF3.compromet - limC) * PF3.ent / nPF3 });
  }
  // 3) sobra consistente → destinação
  const rs = reserva(state, ledger, mesSel, pf);
  if (n6 >= 3) {
    const sobra = der(A6).res / n6;
    if (sobra > 0 && der(A6).taxa >= 0.1) {
      const metaR = (+state.config.metaReservaMeses || 6) * rs.essMed;
      const falta = Math.max(0, metaR - rs.total);
      let t = 'A geração de caixa média dos últimos ' + n6 + ' meses é de ' + brl(sobra) + '/mês (' + pct(der(A6).taxa, 0) + ' das entradas). Defina uma destinação automática desse excedente entre reserva, metas e investimentos.';
      let ef = '';
      if (falta > 0 && rs.essMed > 0) { const mens = Math.ceil(falta / (sobra * 0.5)); t += ' Para a reserva chegar a ' + state.config.metaReservaMeses + ' meses faltam ' + brl(falta) + '.'; ef = 'Destinando metade da sobra (' + brl(sobra * 0.5) + '/mês), a reserva completa em cerca de ' + mens + ' meses.'; }
      else ef = 'A reserva já está na meta: a sobra pode ir para metas e investimentos de longo prazo.';
      R.push({ prio: 3, tipo: 'Destinação', titulo: 'Sobra recorrente sem destino definido', txt: t, efeito: ef, ganho: sobra });
    } else if (sobra < 0) {
      R.push({ prio: 1, tipo: 'Resultado', titulo: 'Déficit médio nos últimos meses', txt: 'Nos últimos ' + n6 + ' meses a PF e as empresas gastaram, em média, ' + brl(-sobra) + '/mês a mais do que entrou.', efeito: 'Zerar o déficit exige cortar ou adiar ' + brl(-sobra) + '/mês em gastos variáveis ou compromissos.', ganho: -sobra });
    }
  }
  // 4) reserva baixa
  if (rs.meses != null && rs.meses < (state.config.faixasReserva || [3])[0]) {
    R.push({ prio: 1, tipo: 'Reserva', titulo: 'Reserva de emergência curta', txt: 'A reserva cobre ' + num(rs.meses) + ' meses das despesas essenciais (' + brl(rs.essMed) + '/mês). Priorize recompor ao menos ' + state.config.faixasReserva[0] + ' meses antes de novos compromissos.', efeito: 'Faltam ' + brl(state.config.faixasReserva[0] * rs.essMed - rs.total) + ' para 3 meses de cobertura.', ganho: 0 });
  }
  // 5) empresas piorando / caixa / distribuição
  for (const n of ['C1', 'C2']) {
    const map = ctx.agg(n, 'ALL', 'comp');
    // comissão e honorário de êxito oscilam muito: compara a média dos últimos 3 meses com a dos 6 anteriores (ou 3, se não houver 6)
    const p6 = [addM(base, -8), addM(base, -3)], longa = monthsWithData(map, ...p6).length === 6;
    const a = sumRange(map, ...l3), b = longa ? sumRange(map, ...p6) : sumRange(map, ...p3);
    const na = monthsWithData(map, ...l3).length, nb = longa ? 6 : monthsWithData(map, ...p3).length;
    if (na === 3 && nb >= 3 && b.rec > 0) {
      const ra = a.rec / 3, rb = b.rec / nb, ca = a.sai / 3, cb = b.sai / nb;
      const gR = ra / rb - 1, gC = cb > 0 ? ca / cb - 1 : 0, ref = longa ? 'média dos 6 meses anteriores' : 'média dos 3 meses anteriores';
      if (gR <= -0.05 && gC > gR + 0.03) R.push({ prio: 1, tipo: 'Empresa', titulo: nomeN(state, n) + ': receita caindo',
        txt: 'A receita média da ' + nomeN(state, n) + ' nos últimos três meses (' + brl(ra) + '/mês) ficou ' + pct(-gR, 0) + ' abaixo da ' + ref + ' (' + brl(rb) + '/mês), enquanto seus custos ' + (Math.abs(gC) < 0.03 ? 'permaneceram praticamente constantes (' + sinal(gC) + ')' : 'variaram ' + sinal(gC)) + '.',
        efeito: 'Voltar à média anterior acrescenta cerca de ' + brl(rb - ra) + '/mês ao resultado.', ganho: rb - ra });
      else if (gC - gR > 0.08) R.push({ prio: 2, tipo: 'Empresa', titulo: nomeN(state, n) + ': custos crescendo mais que a receita',
        txt: 'Nos últimos três meses os custos médios da ' + nomeN(state, n) + ' variaram ' + sinal(gC) + ' e a receita ' + sinal(gR) + ', em relação à ' + ref + '.', efeito: 'A diferença pesa ' + brl((ca - cb) - (ra - rb)) + '/mês no resultado.', ganho: 0 });
    }
    const s6 = sumRange(map, ...l6), n6p = monthsWithData(map, ...l6).length;
    if (n6p >= 3) {
      const d6 = der(s6), saidaSocios = s6.dist + s6.retir;
      if (saidaSocios > 0 && saidaSocios - d6.res > Math.max(1000, Math.abs(d6.res) * 0.05)) R.push({ prio: 2, tipo: 'Empresa', titulo: nomeN(state, n) + ': distribuição acima do resultado',
        txt: 'Nos últimos ' + n6p + ' meses a ' + nomeN(state, n) + ' distribuiu ' + brl(saidaSocios) + ' aos sócios, acima do resultado operacional de ' + brl(d6.res) + '. O caixa da empresa está sendo consumido.',
        efeito: 'Ajustar a distribuição ao resultado preserva cerca de ' + brl((saidaSocios - d6.res) / n6p) + '/mês no caixa da empresa.', ganho: 0 });
      const sn = saldoPorNucleo(state, ledger, ledger.today).porNucleo[n];
      const fixM = (s6.b.Fixa + s6.b.Financiamento + s6.b.Parcela) / n6p;
      const minM = +state.config.caixaPJMinMeses || 2;
      if (fixM > 0 && sn.total / fixM < minM) R.push({ prio: 2, tipo: 'Empresa', titulo: nomeN(state, n) + ': caixa curto',
        txt: 'O caixa da ' + nomeN(state, n) + ' (' + brl(sn.total) + ') cobre ' + num(sn.total / fixM) + ' mês(es) de custos fixos (' + brl(fixM) + '/mês). Referência adotada: ' + minM + ' meses.',
        efeito: 'Para chegar à referência faltam ' + brl(minM * fixM - sn.total) + '; reter parte da distribuição dos próximos meses resolve sem aporte da PF.', ganho: 0 });
    }
  }
  // 6) parcelas futuras
  const pfut = parcelasFuturas(state, ledger, viewOf('ALL', 'ALL'));
  const sobraMed = n6 ? der(A6).res / n6 : 0;
  if (pfut.total > 0 && (pfut.total > 3 * Math.max(sobraMed, 1) || pfut.total > 50000)) R.push({ prio: 2, tipo: 'Parcelas', titulo: 'Parcelas futuras relevantes',
    txt: 'Há ' + brl(pfut.total) + ' em parcelas futuras já contratadas (até ' + mesBarra(pfut.ate) + '). Evite assumir novos compromissos relevantes até a redução desse saldo.', efeito: 'Equivale a ' + num(sobraMed > 0 ? pfut.total / sobraMed : null) + ' meses da sobra média atual.', ganho: 0 });
  // 7) mistura PF/PJ
  if (A6.mixN > 0) R.push({ prio: 2, tipo: 'Separação PF/PJ', titulo: 'Mistura de contas da PF e das empresas',
    txt: 'Nos últimos 6 meses houve ' + A6.mixN + ' pagamento(s) cruzados entre PF e empresas (' + brl(A6.mix) + '): gastos de um núcleo pagos pela conta ou cartão do outro. A planilha tratou como retirada/aporte do sócio, mas o ideal é pagar cada gasto pela conta do próprio núcleo.',
    efeito: 'Separar as contas evita distorcer a margem das empresas e o resultado da PF.', ganho: 0 });
  // 8) metas x sobra
  const mt = metasResumo(state, ledger);
  const aporteNec = mt.reduce((s, m) => s + (m.aporteMensal || 0), 0);
  if (mt.length && aporteNec > 0 && n6) {
    if (aporteNec > Math.max(sobraMed, 0)) R.push({ prio: 2, tipo: 'Metas', titulo: 'Metas acima da capacidade atual', txt: 'As metas cadastradas exigem ' + brl(aporteNec) + '/mês, acima da sobra média de ' + brl(sobraMed) + '/mês dos últimos ' + n6 + ' meses.', efeito: 'Alongar prazos ou reduzir valores-alvo em ' + brl(aporteNec - Math.max(sobraMed, 0)) + '/mês fecha a conta.', ganho: 0 });
    else R.push({ prio: 4, tipo: 'Metas', titulo: 'Metas cabem na sobra atual', txt: 'As metas exigem ' + brl(aporteNec) + '/mês e a sobra média é de ' + brl(sobraMed) + '/mês: ' + pct(aporteNec / sobraMed, 0) + ' do excedente.', efeito: 'Programe esses aportes logo após a entrada da renda.', ganho: 0 });
  }
  // 9) orçamento estourado de forma recorrente
  for (const n of NUCLEOS) {
    for (const o of state.orcamentos.filter(o => o.nucleo === n)) {
      let ex = 0, tot = 0;
      for (const m of mrange(...l3)) { const a = getM(ctx.agg(n, 'ALL', 'comp'), m); const r = a.cat[o.categoria] || 0; tot += r; if (o.valor > 0 && r > o.valor) ex++; }
      if (ex >= 2) R.push({ prio: 3, tipo: 'Orçamento', titulo: o.categoria + ' acima do orçamento', txt: 'Em ' + ex + ' dos últimos 3 meses ' + o.categoria + ' (' + nomeN(state, n) + ') passou do orçamento de ' + brl(o.valor) + '. Média realizada: ' + brl(tot / 3) + '/mês.', efeito: 'Ou o orçamento está subestimado, ou o gasto precisa de ajuste: a diferença é de ' + brl(tot / 3 - o.valor) + '/mês.', ganho: tot / 3 - o.valor });
    }
  }
  // 10) lucros distribuídos acima do limite mensal sem retenção de IR (Lei 15.270/2025)
  const limR = +state.config.limiteRetencaoLucros || 0, aliqR = +state.config.aliquotaRetencaoLucros || 0.1;
  if (limR > 0) for (const n of ['C1', 'C2']) {
    const map = ctx.agg(n, 'ALL', 'comp');
    const acima = mrange(addM(mesSel, -2), mesSel).map(m => [m, getM(map, m).dist]).filter(x => x[1] > limR);
    if (!acima.length) continue;
    const tot = acima.reduce((s, x) => s + x[1], 0);
    R.push({ prio: 2, tipo: 'Tributação', titulo: nomeN(state, n) + ': lucros acima do limite mensal sem retenção',
      txt: 'Em ' + acima.map(x => mesBarra(x[0]) + ' (' + brl(x[1]) + ')').join(', ') + ' a distribuição de lucros da ' + nomeN(state, n) + ' passou de ' + brl(limR) + ' no mês. Pela Lei 15.270/2025, acima desse valor, pago pela mesma empresa à mesma pessoa física, há retenção de ' + pct(aliqR, 0) + ' de IR na fonte sobre o total distribuído.',
      efeito: 'Retenção estimada: ' + brl(tot * aliqR) + '. Distribuir em meses diferentes, abaixo do limite, evita a retenção mensal, mas não o ajuste anual do IR mínimo de altas rendas. Confirme com o contador.', ganho: tot * aliqR });
  }
  return R.sort((a, b) => a.prio - b.prio || (b.ganho || 0) - (a.ganho || 0));
}
function topFixos(ledger, a, b, k, nucleo) {
  const g = {};
  for (const m of ledger.items) if (m.kind === 'D' && (!nucleo || m.nucleo === nucleo) && m.comp >= a && m.comp <= b && (m.nat === 'Fixa' || m.nat === 'Financiamento' || m.nat === 'Parcela')) g[m.desc || m.sub] = (g[m.desc || m.sub] || 0) + m.valor;
  const n = mdiff(a, b) + 1;
  return Object.entries(g).map(([desc, v]) => ({ desc, v: v / n })).sort((x, y) => y.v - x.v).slice(0, k);
}

/* capacidade para novos compromissos */
function capacidade(state, ledger, ctx, nucleo) {
  nucleo = nucleo || 'PF';
  const base = addM(ledger.curM, -1);
  const map = ctx.agg(nucleo, 'ALL', 'comp');
  const ms = monthsWithData(map, addM(base, -5), base);
  if (!ms.length) return null;
  const S = sumM(ms.map(m => map.get(m))), n = ms.length;
  const renda = S.ent / n, sobra = (S.ent - S.sai) / n;
  const proj = projetar(state, ledger, viewOf(nucleo, 'ALL'), 24, map);
  const lim = +state.config.limiteComprometimento || 0.5;
  const linha = proj.rows.map(r => ({ mes: r.mes, comprom: r.comprometidoSemVar, folga: r2(renda * lim - r.comprometidoSemVar) }));
  const prox3 = linha.slice(0, 3);
  const comprom = prox3.reduce((s, r) => s + r.comprom, 0) / prox3.length;
  const folgaLimite = renda * lim - comprom;
  const cap = Math.max(0, Math.min(folgaLimite, sobra));
  // quando a folga melhora: primeiro mês em que ela supera a atual em pelo menos R$ 500
  const capDe = r => Math.max(0, Math.min(r.folga, sobra + (comprom - r.comprom)));
  const melhora = linha.find(r => capDe(r) > cap + 500);
  return { nucleo, renda: r2(renda), sobra: r2(sobra), comprom: r2(comprom), lim, folgaLimite: r2(folgaLimite), cap: r2(cap), meses: n,
    limitante: folgaLimite < sobra ? 'limite de comprometimento' : 'sobra média', linha, melhora: melhora || null,
    capMelhora: melhora ? r2(capDe(melhora)) : null };
}

/* metas */
function metasResumo(state, ledger) {
  const bal = balancesAt(state, ledger, ledger.today);
  const resTot = state.contas.filter(c => c.reserva && c.nucleo === 'PF').reduce((s, c) => s + (bal[c.id] || 0), 0);
  return state.metas.map(m => {
    let acum = +m.acumulado || 0;
    if (m.vinculo === 'RESERVA') acum = resTot;
    else if (m.vinculo === 'CARTEIRA') acum = valorCarteiraEm(state, ledger.today, [m.nucleo || 'PF']);
    else if (m.vinculo && bal[m.vinculo] != null) acum = bal[m.vinculo];
    const alvo = +m.alvo || 0, falta = Math.max(0, alvo - acum);
    const meses = m.data ? Math.max(0, mdiff(ledger.curM, ym(m.data))) : null;
    return { m, acum: r2(acum), alvo, falta: r2(falta), meses, prog: alvo > 0 ? clamp(acum / alvo, 0, 1) : 0,
      aporteMensal: falta > 0 ? r2(falta / Math.max(1, meses || 1)) : 0, vencida: meses === 0 && falta > 0 };
  });
}

/* ==========================================================================
   CARTEIRA DE INVESTIMENTOS (ações, FIIs, ETFs, BDRs)
   operações: Compra / Venda / Provento; cotações manuais por ativo.
   Custo pelo preço médio ponderado (inclui taxas de compra). O histórico de
   preços é a soma das cotações manuais com o preço de cada compra e venda:
   atualizar a cotação acrescenta um ponto, nunca apaga os anteriores.
   ========================================================================== */
const TIPOS_ATIVO = ['Ação', 'FII', 'ETF', 'BDR', 'Outro'];
const diasEntre = (a, b) => (Date.parse(b + 'T12:00:00') - Date.parse(a + 'T12:00:00')) / 864e5;
const ordOp = (a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : (a.seq || 0) - (b.seq || 0));
function opValor(o) {           // valor financeiro líquido da operação
  if (o.tipo === 'Provento') return r2(+o.valor || 0);
  const g = (+o.quantidade || 0) * (+o.preco || 0), tx = +o.taxas || 0;
  return r2(o.tipo === 'Compra' ? g + tx : g - tx);
}
function opsDo(state, ativoId, ate) {
  const c = state.carteira || {};
  return (c.operacoes || []).filter(o => o.ativoId === ativoId && o.data && (!ate || o.data <= ate)).sort(ordOp);
}
function pontosPreco(state, ativoId) {
  const c = state.carteira || {}, pts = [];
  for (const o of c.operacoes || []) if (o.ativoId === ativoId && (o.tipo === 'Compra' || o.tipo === 'Venda') && +o.preco > 0) pts.push({ data: o.data, preco: +o.preco, origem: o.tipo, id: o.id });
  for (const q of ((c.cotacoes || {})[ativoId] || [])) if (+q.preco > 0 && q.data) pts.push({ data: q.data, preco: +q.preco, origem: 'Cotação', id: q.id });
  // no mesmo dia, a cotação manual vale mais que o preço da operação
  return pts.sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : (a.origem === 'Cotação') - (b.origem === 'Cotação')));
}
function precoEm(pts, iso) { let p = null; for (const x of pts) { if (x.data > iso) break; p = x; } return p; }
// posição até uma data (inclusive)
function posicaoEm(ops, iso) {
  let qtd = 0, custo = 0, realizado = 0, prov = 0, aplicado = 0, recebido = 0;
  for (const o of ops) {
    if (iso && o.data > iso) break;
    const v = opValor(o);
    if (o.tipo === 'Compra') { qtd += +o.quantidade; custo += v; aplicado += v; }
    else if (o.tipo === 'Venda') {
      const q = +o.quantidade, pm = qtd > 0 ? custo / qtd : 0, cb = pm * q;
      realizado += v - cb; custo -= cb; qtd -= q; recebido += v;
      if (Math.abs(qtd) < 1e-9) { qtd = 0; custo = 0; }
    } else if (o.tipo === 'Provento') prov += v;
  }
  return { qtd, custo: r2(custo), pm: qtd > 0 ? custo / qtd : 0, realizado: r2(realizado), prov: r2(prov), aplicado: r2(aplicado), recebido: r2(recebido) };
}
// primeira data em que a posição ficaria negativa (vendas maiores que o que havia)
function validarPosicao(ops) {
  let qtd = 0;
  for (const o of ops.slice().sort(ordOp)) {
    if (o.tipo === 'Compra') qtd += +o.quantidade; else if (o.tipo === 'Venda') qtd -= +o.quantidade;
    if (qtd < -1e-9) return { data: o.data, qtd };
  }
  return null;
}
// TIR anual pelos fluxos datados (v < 0 = dinheiro que saiu do bolso)
function xirr(fl) {
  if (fl.length < 2 || !fl.some(f => f.v < 0) || !fl.some(f => f.v > 0)) return null;
  const s = fl.slice().sort((a, b) => (a.data < b.data ? -1 : 1)), t0 = s[0].data;
  const ts = s.map(f => diasEntre(t0, f.data) / 365);
  const npv = r => s.reduce((acc, f, i) => acc + f.v / Math.pow(1 + r, ts[i]), 0);
  let lo = -0.9999, hi = 1, flo = npv(lo), fhi = npv(hi), k = 0;
  while (flo * fhi > 0 && k++ < 40) { hi *= 2; fhi = npv(hi); }
  if (!isFinite(flo) || !isFinite(fhi) || flo * fhi > 0) return null;
  for (let i = 0; i < 300; i++) {
    const mid = (lo + hi) / 2, fm = npv(mid);
    if (Math.abs(fm) < 1e-8 || hi - lo < 1e-12) return mid;
    if (flo * fm < 0) { hi = mid; fhi = fm; } else { lo = mid; flo = fm; }
  }
  return (lo + hi) / 2;
}
const mensalDe = a => (a == null ? null : Math.pow(1 + a, 1 / 12) - 1);
// quanto as mesmas aplicações e retiradas, nas mesmas datas, valeriam rendendo 'ref' a.a. até 'ate'
function valorNaReferencia(fl, ref, ate) {
  return r2(fl.reduce((s, f) => s + (-f.v) * Math.pow(1 + ref, Math.max(0, diasEntre(f.data, ate)) / 365), 0));
}
const fluxoDe = o => ({ data: o.data, v: o.tipo === 'Compra' ? -opValor(o) : opValor(o) });

function resumoAtivo(state, a, today) {
  const cfg = state.config || {};
  const ops = opsDo(state, a.id, today), pts = pontosPreco(state, a.id).filter(p => p.data <= today);
  const pos = posicaoEm(ops, today), ult = pts[pts.length - 1] || null;
  const cot = ult ? ult.preco : pos.pm;
  const valor = r2(pos.qtd * cot), naoReal = r2(valor - pos.custo);
  const retorno = r2(naoReal + pos.realizado + pos.prov);
  const lastOp = ops.length ? ops[ops.length - 1].data : null;
  const valData = [ult && ult.data, lastOp].filter(Boolean).sort().pop() || today;
  const fl = ops.map(fluxoDe);
  const flT = pos.qtd > 0 ? fl.concat([{ data: valData, v: valor }]) : fl;
  const dias = ops.length ? diasEntre(ops[0].data, pos.qtd > 0 ? today : lastOp) : 0;
  const tir = ops.length && diasEntre(ops[0].data, valData) >= 30 ? xirr(flT) : null;
  const ref = +cfg.taxaReferenciaAA || 0;
  const valRef = ops.length ? valorNaReferencia(fl, ref, valData) : 0;
  const c1 = ops.find(o => o.tipo === 'Compra');
  const ptsDesde = c1 ? pts.filter(p => p.data >= c1.data) : [];
  const max = ptsDesde.reduce((m, p) => Math.max(m, p.preco), 0);
  const prov12 = r2(ops.filter(o => o.tipo === 'Provento' && o.data > addDays(today, -365)).reduce((s, o) => s + opValor(o), 0));
  return { a, ops, pts, pos, cot, cotData: ult ? ult.data : null, cotOrigem: ult ? ult.origem : null, diasCot: ult ? diasEntre(ult.data, today) : null,
    valor, naoReal, naoRealPct: pos.custo > 0 ? naoReal / pos.custo : null, retorno, pct: pos.aplicado > 0 ? retorno / pos.aplicado : null,
    tir, tirM: mensalDe(tir), valRef, vsRef: r2(valor - valRef), valData, dias, max, queda: max > 0 && cot > 0 ? 1 - cot / max : null,
    prov12, yoc: pos.custo > 0 ? prov12 / pos.custo : null, aberta: pos.qtd > 1e-9, inicio: ops.length ? ops[0].data : null, fim: lastOp };
}
function saudeAtivo(r, peso, cfg) {
  const ref = +cfg.taxaReferenciaAA || 0, lq = cfg.limitesQueda || [0.15, 0.30], lc = +cfg.limiteConcentracao || 0.25;
  const meses = r.dias / 30.44, it = [];
  if (!r.aberta) return { nivel: 'info', status: 'Encerrada', itens: [] };
  if (r.tir == null) it.push({ nivel: 'info', chave: 'retorno', txt: 'Menos de 30 dias desde a primeira compra: cedo para medir retorno por mês.' });
  else {
    const dif = r.tir - ref;
    const niv = r.tir < 0 ? (meses >= 6 ? 'alerta' : 'atencao') : dif < 0 ? 'atencao' : 'ok';
    it.push({ nivel: niv, chave: 'retorno', txt: 'Rende ' + pct(r.tirM, 2) + ' ao mês (' + pct(r.tir) + ' ao ano), ' + (dif >= 0 ? num(dif * 100) + ' p.p. acima' : num(-dif * 100) + ' p.p. abaixo') + ' da referência de ' + pct(ref) + ' a.a. Em reais: ' + (r.vsRef >= 0 ? brl(r.vsRef) + ' a mais' : brl(-r.vsRef) + ' a menos') + ' do que o mesmo dinheiro, nas mesmas datas, teria na referência.' });
  }
  if (r.queda != null) {
    const niv = r.queda >= lq[1] ? 'alerta' : r.queda >= lq[0] ? 'atencao' : 'ok';
    it.push({ nivel: niv, chave: 'queda', txt: r.queda < 0.005 ? 'Cotação na máxima registrada desde a primeira compra (' + brl(r.max) + ').' : 'Cotação ' + pct(r.queda) + ' abaixo da máxima registrada desde a primeira compra (' + brl(r.max) + '). Faixas: atenção a partir de ' + pct(lq[0], 0) + ', alerta a partir de ' + pct(lq[1], 0) + '.' });
  }
  if (peso != null) it.push({ nivel: peso > lc ? 'atencao' : 'ok', chave: 'peso', txt: 'Representa ' + pct(peso) + ' da carteira' + (peso > lc ? ', acima do limite adotado de ' + pct(lc, 0) + ' por ativo.' : ' (limite adotado: ' + pct(lc, 0) + ').') });
  if (meses < 12) it.push({ nivel: 'info', chave: 'tempo', txt: 'Na carteira há ' + (meses < 1 ? Math.round(r.dias) + ' dias' : num(meses, 0) + ' meses') + ' — para julgar o longo prazo, o ideal é ter 12 meses ou mais.' });
  if (r.diasCot != null && r.diasCot > 35) it.push({ nivel: 'atencao', chave: 'cot', txt: 'Cotação atualizada há ' + Math.round(r.diasCot) + ' dias: os números usam esse preço.' });
  if (r.prov12 > 0) it.push({ nivel: 'info', chave: 'prov', txt: 'Proventos dos últimos 12 meses: ' + brl(r.prov12) + (r.yoc != null ? ' (' + pct(r.yoc) + ' sobre o custo atual da posição).' : '.') });
  // status do ativo: só retorno e queda. Peso é assunto da carteira; cotação velha e tempo são avisos.
  const pesa = it.filter(x => x.chave === 'retorno' || x.chave === 'queda');
  const nivel = pesa.some(x => x.nivel === 'alerta') ? 'alerta' : pesa.some(x => x.nivel === 'atencao') ? 'atencao' : (r.tir == null || meses < 6) ? 'info' : 'ok';
  return { nivel, status: { alerta: 'Alerta', atencao: 'Atenção', ok: 'Saudável', info: 'Em formação' }[nivel], itens: it };
}
function resumoCarteira(state, today, nucleos) {
  const c = state.carteira || {}, cfg = state.config || {};
  const ativos = (c.ativos || []).filter(a => !nucleos || nucleos.includes(a.nucleo || 'PF'));
  const rs = ativos.map(a => resumoAtivo(state, a, today)).filter(r => r.ops.length);
  const tot = { valor: 0, custo: 0, aplicado: 0, realizado: 0, prov: 0, naoReal: 0, retorno: 0, prov12: 0 };
  for (const r of rs) { tot.valor += r.valor; tot.custo += r.pos.custo; tot.aplicado += r.pos.aplicado; tot.realizado += r.pos.realizado; tot.prov += r.pos.prov; tot.naoReal += r.naoReal; tot.retorno += r.retorno; tot.prov12 += r.prov12; }
  for (const k in tot) tot[k] = r2(tot[k]);
  for (const r of rs) { r.peso = r.aberta && tot.valor > 0 ? r.valor / tot.valor : null; r.saude = saudeAtivo(r, r.peso, cfg); }
  const fl = []; for (const r of rs) for (const o of r.ops) fl.push(fluxoDe(o));
  fl.sort((a, b) => (a.data < b.data ? -1 : 1));
  const flT = tot.valor > 0 ? fl.concat([{ data: today, v: tot.valor }]) : fl;
  const tir = fl.length && diasEntre(fl[0].data, today) >= 30 ? xirr(flT) : null;
  const valRef = fl.length ? valorNaReferencia(fl, +cfg.taxaReferenciaAA || 0, today) : 0;
  return { rs, tot, tir, tirM: mensalDe(tir), valRef, vsRef: r2(tot.valor - valRef), pct: tot.aplicado > 0 ? tot.retorno / tot.aplicado : null, ativos };
}
function valorCarteiraEm(state, iso, nucleos) {
  const c = state.carteira || {}; let v = 0;
  for (const a of c.ativos || []) {
    if (nucleos && !nucleos.includes(a.nucleo || 'PF')) continue;
    const q = posicaoEm(opsDo(state, a.id, iso), iso).qtd; if (!(q > 0)) continue;
    const p = precoEm(pontosPreco(state, a.id), iso); if (p) v += q * p.preco;
  }
  return r2(v);
}
// retorno de cada mês pelo método Dietz modificado (aportes no meio do mês ponderados pelos dias)
function retornosMensais(state, ativos, today) {
  const data = ativos.map(a => ({ ops: opsDo(state, a.id, today), pts: pontosPreco(state, a.id).filter(p => p.data <= today) })).filter(x => x.ops.length);
  if (!data.length) return [];
  const first = data.map(x => x.ops[0].data).sort()[0];
  const valorEm = iso => data.reduce((s, x) => { const q = posicaoEm(x.ops, iso).qtd; if (!(q > 0)) return s; const p = precoEm(x.pts, iso); return s + (p ? q * p.preco : 0); }, 0);
  const custoEm = iso => data.reduce((s, x) => s + posicaoEm(x.ops, iso).custo, 0);
  const curM = ym(today), out = [];
  for (const m of mrange(ym(first), curM)) {
    const ini = monthEnd(addM(m, -1)), fim = m === curM ? today : monthEnd(m), D = m === curM ? +today.slice(8, 10) : lastDay(m);
    const vIni = valorEm(ini), vFim = valorEm(fim);
    let F = 0, W = 0;
    for (const x of data) for (const o of x.ops) {
      if (ym(o.data) !== m) continue;
      const f = o.tipo === 'Compra' ? opValor(o) : -opValor(o), d = +o.data.slice(8, 10);
      F += f; W += f * Math.max(0, D - d + 1) / D;
    }
    const den = vIni + W, ganho = vFim - vIni - F;
    out.push({ mes: m, vIni: r2(vIni), vFim: r2(vFim), fluxo: r2(F), ganho: r2(ganho), ret: den > 0.01 ? ganho / den : null, custo: r2(custoEm(fim)) });
  }
  return out;
}
// IR estimado sobre vendas da PF, por mês (sem day trade e sem compensar prejuízos de meses anteriores)
function irVendas(state, today) {
  const c = state.carteira || {}, cfg = state.config || {}, rows = new Map();
  const isen = +cfg.irIsencaoAcoes || 0, al = cfg.irAliquotas || [0.15, 0.20];
  for (const a of c.ativos || []) {
    if ((a.nucleo || 'PF') !== 'PF') continue;
    let qtd = 0, custo = 0;
    for (const o of opsDo(state, a.id, today)) {
      if (o.tipo === 'Compra') { qtd += +o.quantidade; custo += opValor(o); }
      else if (o.tipo === 'Venda') {
        const q = +o.quantidade, pm = qtd > 0 ? custo / qtd : 0, g = opValor(o) - pm * q;
        custo -= pm * q; qtd -= q;
        const m = ym(o.data), x = rows.get(m) || { mes: m, vendasAcoes: 0, ganhoAcoes: 0, ganho15: 0, ganhoFii: 0, ganhoOutros: 0, vendas: 0, ops: 0 };
        x.vendas += (+o.quantidade) * (+o.preco); x.ops++;
        if (a.tipo === 'Ação') { x.vendasAcoes += (+o.quantidade) * (+o.preco); x.ganhoAcoes += g; }
        else if (a.tipo === 'ETF' || a.tipo === 'BDR') x.ganho15 += g;
        else if (a.tipo === 'FII') x.ganhoFii += g;
        else x.ganhoOutros += g;
        rows.set(m, x);
      }
    }
  }
  return [...rows.values()].sort((a, b) => (a.mes < b.mes ? 1 : -1)).map(x => {
    for (const k of ['vendasAcoes', 'ganhoAcoes', 'ganho15', 'ganhoFii', 'ganhoOutros', 'vendas']) x[k] = r2(x[k]);
    x.isento = x.vendasAcoes <= isen;
    x.irAcoes = x.isento ? 0 : r2(Math.max(0, x.ganhoAcoes) * al[0]);
    x.ir15 = r2(Math.max(0, x.ganho15) * al[0]);
    x.irFii = r2(Math.max(0, x.ganhoFii) * al[1]);
    x.ir = r2(x.irAcoes + x.ir15 + x.irFii);
    x.venc = addM(x.mes, 1);
    return x;
  });
}

function ganhosPorVenda(state) {
  const out = new Map(), c = state.carteira || {};
  for (const a of c.ativos || []) {
    let qtd = 0, custo = 0;
    for (const o of opsDo(state, a.id)) {
      if (o.tipo === 'Compra') { qtd += +o.quantidade; custo += opValor(o); }
      else if (o.tipo === 'Venda') { const q = +o.quantidade, pm = qtd > 0 ? custo / qtd : 0; out.set(o.id, { ganho: r2(opValor(o) - pm * q), pm }); custo -= pm * q; qtd -= q; }
    }
  }
  return out;
}

/* patrimônio */
function patrimonio(state, ledger) {
  const bal = balancesAt(state, ledger, ledger.today);
  const contasTot = r2(state.contas.reduce((s, c) => s + (bal[c.id] || 0), 0));
  const pat = state.patrimonio || { ativos: [], passivos: [] };
  const atM = r2(pat.ativos.reduce((s, a) => s + (+a.valor || 0), 0));
  const paM = r2(pat.passivos.reduce((s, a) => s + (+a.valor || 0), 0));
  const pf = pat.incluirParcelas !== false ? parcelasFuturas(state, ledger, viewOf('ALL', 'ALL')).total : 0;
  const carteira = valorCarteiraEm(state, ledger.today);
  const ativos = r2(atM + contasTot + carteira), passivos = r2(paM + pf);
  return { contasTot, atM, paM, carteira, parcelas: pf, ativos, passivos, pl: r2(ativos - passivos), bal };
}
function serieIDPatrimonio(state, ledger, months) {
  const hist = (state.patrimonio && state.patrimonio.historico || []).slice().sort((a, b) => (a.mes < b.mes ? -1 : 1));
  if (!hist.length) return months.map(() => null);
  const deltas = accountDeltas(ledger);
  return months.map(m => {
    const snap = hist.filter(h => h.mes <= m).pop();
    if (!snap) return null;
    const bal = balancesAt(state, ledger, monthEnd(m), deltas);
    let cont = 0; for (const c of state.contas) if (bal[c.id] != null) cont += bal[c.id];
    let parc = 0;
    if (state.patrimonio.incluirParcelas !== false) for (const x of ledger.items) if (x.kind === 'D' && x.nat === 'Parcela' && (x.cartaoId ? x.faturaMes : x.pmes) > m && (x.comp <= m || x.src === 'comp')) parc += x.valor;
    const cartM = valorCarteiraEm(state, monthEnd(m) > ledger.today ? ledger.today : monthEnd(m));
    return r2(snap.ativos + cont + cartM - snap.passivos - parc);
  });
}

/* ---------- contexto com cache de agregações ---------- */
function makeCtx(state, today) {
  const ledger = buildLedger(state, today);
  const cache = new Map();
  const agg = (nucleo, resp, regime) => {
    const k = nucleo + '/' + resp + '/' + regime;
    if (!cache.has(k)) cache.set(k, aggregate(ledger, viewOf(nucleo, resp), regime));
    return cache.get(k);
  };
  return { ledger, agg, today, curM: ledger.curM };
}
function primeiroMes(state, ledger) {
  let m = null;
  for (const x of ledger.items) if (!m || x.comp < m) m = x.comp;
  return m || ledger.curM;
}

const FE = { pad, isoOf, ym, addM, mdiff, lastDay, dayIn, monthEnd, addDays, mrange, r2, clamp, brl, brl0, pct, num, mesLongo, mesCurto, mesBarra, dataBR, MESES, MES3,
  NUCLEOS, NATUREZAS, NAT_LABEL, TKINDS, INV_TIPOS, LIQ_TIPOS, RESP, canonKind, scopeOf, buildIndex, subInfo, faturaVenc, buildLedger, compN,
  blank, aggregate, sumM, getM, sumRange, monthsWithData, der, viewOf, accountDeltas, balancesAt, balanceSeries, contaFiltro,
  resumoCompromissos, resumoParceladosCartao, projetar, encerramentos, parcelasFuturas, reserva, saldoPorNucleo,
  PESOS_PADRAO, FAIXAS_SAUDE, faixaSaude, saude, comparacoes, varPct, diagnostico, orcamentoStatus, recomendacoes, capacidade,
  metasResumo, patrimonio, serieIDPatrimonio, makeCtx, primeiroMes, nomeN, semPJ, sinal, isInvAcc,
  TIPOS_ATIVO, diasEntre, opValor, opsDo, pontosPreco, precoEm, posicaoEm, validarPosicao, xirr, mensalDe, valorNaReferencia,
  resumoAtivo, saudeAtivo, resumoCarteira, valorCarteiraEm, retornosMensais, irVendas, ganhosPorVenda };
if (typeof module !== 'undefined' && module.exports) module.exports = FE; else root.FE = FE;
})(typeof window !== 'undefined' ? window : globalThis);

/* ==========================================================================
   Cadastros padrão + dados de demonstração (marcados com exemplo:true)
   ========================================================================== */
(function (root) {
'use strict';
const FE = root.FE || (typeof require !== 'undefined' ? require('./engine.js') : null);
const { addM, dayIn, ym, r2 } = FE;

let _seq = 0;
const uid = p => p + Date.now().toString(36).slice(-4) + (++_seq).toString(36) + Math.random().toString(36).slice(2, 5);

/* sub(nome, natureza, essencial) */
const S = (nome, nat, ess) => ({ nome, nat: nat || 'Variável', ess: !!ess });
const F = 'Fixa', V = 'Variável', FIN = 'Financiamento', P = 'Parcela';

function categoriasPadrao() {
  const C = (escopo, tipo, nome, subs, extra) => Object.assign({ id: uid('cat'), escopo, tipo, nome, subs }, extra || {});
  // categorias comuns às duas empresas (cada uma recebe sua própria cópia)
  const pjComuns = n => [
    C(n, 'Receita', 'Receitas extraordinárias', [S('Geral'), S('Rendimentos financeiros')]),
    C(n, 'Receita', 'Aporte do sócio', [S('Aporte')], { transfer: 'Aporte do sócio' }),
    C(n, 'Despesa', 'Impostos', [S('Simples / DAS', V), S('ISS', V), S('IRPJ e CSLL', V), S('INSS sobre pró-labore', F), S('Outros', V)], { imp: true }),
    C(n, 'Despesa', 'Contabilidade', [S('Honorários contábeis', F)]),
    C(n, 'Despesa', 'Aluguel', [S('Sala / coworking', F)]),
    C(n, 'Despesa', 'Telefonia', [S('Telefone e internet', F)]),
    C(n, 'Despesa', 'Equipamentos', [S('Compra'), S('Parcelamento', P)]),
    C(n, 'Despesa', 'Deslocamento', [S('Combustível'), S('Aplicativos'), S('Estacionamento')]),
    C(n, 'Despesa', 'Taxas bancárias', [S('Tarifas'), S('Maquininha / gateway')]),
    C(n, 'Despesa', 'Pró-labore', [S('Pró-labore')], { transfer: 'Pró-labore' }),
    C(n, 'Despesa', 'Distribuição aos sócios', [S('Distribuição de lucros')], { transfer: 'Distribuição de lucros' }),
    C(n, 'Despesa', 'Retirada pessoal / Sócio', [S('Retirada')], { transfer: 'Retirada pessoal / Sócio' }),
    C(n, 'Despesa', 'Outros', [S('Outros')]),
  ];
  return [
    // ---------- PF · Receitas ----------
    C('PF', 'Receita', 'Pró-labore', [S('Pró-labore')], { transfer: 'Pró-labore' }),
    C('PF', 'Receita', 'Distribuição de lucros', [S('Distribuição de lucros')], { transfer: 'Distribuição de lucros' }),
    C('PF', 'Receita', 'Rendimentos', [S('Juros e dividendos'), S('Rendimento da reserva')]),
    C('PF', 'Receita', 'Trabalho autônomo', [S('Serviços avulsos'), S('Comissão como PF / RPA')]),
    C('PF', 'Receita', 'Salário', [S('Salário'), S('13º / férias'), S('Bônus')]),
    C('PF', 'Receita', 'Aluguéis', [S('Aluguel recebido')]),
    C('PF', 'Receita', 'Investimentos', [S('Venda de ativos'), S('Resgate com ganho')]),
    C('PF', 'Receita', 'Receitas extraordinárias', [S('Venda de bens'), S('Presente / prêmio'), S('Outras')]),
    C('PF', 'Receita', 'Reembolsos', [S('Plano de saúde'), S('Empresa'), S('Outros')]),
    C('PF', 'Receita', 'Outros', [S('Outros')]),
    // ---------- PF · Despesas ----------
    C('PF', 'Despesa', 'Moradia', [S('Aluguel', F, 1), S('Financiamento', FIN, 1), S('Condomínio', F, 1), S('IPTU', F, 1), S('Energia', F, 1), S('Água', F, 1), S('Gás', V, 1), S('Internet', F, 1), S('Manutenção', V), S('Diarista', F)]),
    C('PF', 'Despesa', 'Alimentação', [S('Supermercado', V, 1), S('Restaurantes', V), S('Delivery', V), S('Padaria e feira', V, 1)]),
    C('PF', 'Despesa', 'Transporte', [S('Combustível', V, 1), S('Seguro', F, 1), S('IPVA', F, 1), S('Manutenção', V, 1), S('Estacionamento', V), S('Aplicativos', V), S('Financiamento do veículo', FIN, 1)]),
    C('PF', 'Despesa', 'Saúde', [S('Plano de saúde', F, 1), S('Médicos', V, 1), S('Medicamentos', V, 1), S('Academia', F), S('Terapias', V, 1)]),
    C('PF', 'Despesa', 'Educação', [S('Faculdade', F, 1), S('Pós-graduação', F, 1), S('Cursos', F), S('Livros e material', V)]),
    C('PF', 'Despesa', 'Viagens', [S('Passagens'), S('Hospedagem'), S('Passeios'), S('Outros')]),
    C('PF', 'Despesa', 'Lazer', [S('Programas e eventos'), S('Hobbies'), S('Outros')]),
    C('PF', 'Despesa', 'Assinaturas', [S('Streaming', F), S('Aplicativos e software', F), S('Clubes', F)]),
    C('PF', 'Despesa', 'Seguros', [S('Vida', F, 1), S('Residencial', F, 1), S('Outros', F, 1)]),
    C('PF', 'Despesa', 'Impostos', [S('Imposto de renda', V, 1), S('Taxas', V, 1), S('Outros', V, 1)], { imp: true }),
    C('PF', 'Despesa', 'Cuidados pessoais', [S('Barbearia / salão'), S('Cosméticos'), S('Outros')]),
    C('PF', 'Despesa', 'Animais', [S('Ração', V, 1), S('Veterinário', V, 1), S('Banho e tosa', V)]),
    C('PF', 'Despesa', 'Compras pessoais', [S('Roupas'), S('Eletrônicos'), S('Casa'), S('Presentes')]),
    C('PF', 'Despesa', 'Cartão de crédito', [S('Anuidade', F), S('Juros e encargos'), S('IOF')]),
    C('PF', 'Despesa', 'Aporte em empresa', [S('Aporte')], { transfer: 'Aporte do sócio' }),
    C('PF', 'Despesa', 'Outros', [S('Doações'), S('Outros')]),
    // ---------- PJ Imobiliária (C1) ----------
    C('C1', 'Receita', 'Comissões de venda', [S('Venda'), S('Captação'), S('Parceria')]),
    C('C1', 'Receita', 'Comissões de locação', [S('Primeiro aluguel'), S('Taxa de administração')]),
    C('C1', 'Receita', 'Serviços imobiliários', [S('Avaliação'), S('Consultoria'), S('Documentação')]),
    C('C1', 'Despesa', 'Repasses de comissão', [S('Corretores parceiros'), S('Indicação')]),
    C('C1', 'Despesa', 'Marketing', [S('Anúncios e portais'), S('Fotografia e vídeo'), S('Impulsionamento'), S('Agência', F)]),
    C('C1', 'Despesa', 'Sistemas / software', [S('CRM e site', F), S('Outros', F)]),
    C('C1', 'Despesa', 'Registro profissional', [S('Anuidade CRECI'), S('Certificado digital')]),
    ...pjComuns('C1'),
    // ---------- PJ Jurídico (C2) ----------
    C('C2', 'Receita', 'Honorários contratuais', [S('Mensalidade (partido)'), S('Por ato / peça')]),
    C('C2', 'Receita', 'Honorários de êxito', [S('Êxito')]),
    C('C2', 'Receita', 'Honorários de sucumbência', [S('Sucumbência')]),
    C('C2', 'Receita', 'Consultoria e contratos', [S('Parecer'), S('Contratos'), S('Due diligence')]),
    C('C2', 'Receita', 'Reembolso de custas', [S('Custas'), S('Diligências')]),
    C('C2', 'Despesa', 'Custas e diligências', [S('Custas processuais'), S('Cartórios'), S('Correspondentes')]),
    C('C2', 'Despesa', 'Anuidades e certificações', [S('OAB', F), S('Certificado digital')]),
    C('C2', 'Despesa', 'Sistemas / software', [S('Gestão de processos', F), S('Pesquisa e jurisprudência', F), S('Outros', F)]),
    C('C2', 'Despesa', 'Parceiros', [S('Advogados parceiros'), S('Peritos e assistentes técnicos')]),
    C('C2', 'Despesa', 'Atualização profissional', [S('Cursos'), S('Livros'), S('Eventos')]),
    C('C2', 'Despesa', 'Marketing', [S('Site e conteúdo'), S('Anúncios'), S('Outros')]),
    ...pjComuns('C2'),
  ];
}

const toIso = t => (t instanceof Date ? FE.isoOf(t) : (t || FE.isoOf(new Date())));
function defaultState(today) {
  today = toIso(today);
  return {
    version: 2,
    config: {
      nomeApp: 'Minhas finanças',
      pessoa1: 'Eu', pessoa2: '',
      nomePF: 'Pessoal (PF)', nomeC1: 'Imobiliária', nomeC2: 'Jurídico',
      inicioControle: ym(today),
      baixaAutomatica: true,
      metaPoupanca: 0.20, metaReservaMeses: 6, faixasReserva: [3, 6, 12],
      limiteComprometimento: 0.50, limitesComprometimento: [0.40, 0.80], limitesEndividamento: [0.10, 0.40], limitesLiquidez: [0.5, 1.5],
      metaMargemPJ: 0.30, caixaPJMinMeses: 3, alertaOrcamento: [0.8, 1.0],
      limiteRetencaoLucros: 50000, aliquotaRetencaoLucros: 0.10,
      taxaReferenciaAA: 0.1365, limiteConcentracao: 0.25, limitesQueda: [0.15, 0.30], irIsencaoAcoes: 20000, irAliquotas: [0.15, 0.20],
      pesosSaude: Object.assign({}, FE.PESOS_PADRAO),
      formas: ['PIX', 'Cartão de crédito', 'Débito', 'Boleto', 'Débito automático', 'Transferência bancária', 'Dinheiro', 'Outro'],
      invSubs: ['Reserva de emergência', 'Renda fixa', 'Renda variável', 'Previdência', 'Objetivos', 'Outros'],
    },
    categorias: categoriasPadrao(),
    contas: [], cartoes: [], lancamentos: [], compromissos: [], overrides: {}, faturas: {},
    orcamentos: [], metas: [], patrimonio: { ativos: [], passivos: [], historico: [], incluirParcelas: true },
    carteira: { ativos: [], operacoes: [], cotacoes: {}, seq: 0 },
    seq: 0, temExemplos: false,
  };
}

/* ---------- gerador pseudoaleatório determinístico ---------- */
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

function demoState(today) {
  today = toIso(today);
  const st = defaultState(today);
  const R = rng(20261022);
  const vary = (v, p) => r2(v * (1 + (R() * 2 - 1) * p));
  const cur = ym(today), start = addM(cur, -13);
  st.config.inicioControle = start;
  st.temExemplos = true;
  const X = { exemplo: true };
  const seq = () => (++st.seq);

  // ---------- contas ----------
  const ds = start + '-01';
  const conta = (nome, instituicao, tipo, nucleo, saldo, reserva) => { const c = Object.assign({ id: uid('ct'), nome, instituicao, tipo, nucleo, titular: 'P1', saldoInicial: saldo, dataSaldo: ds, reserva: !!reserva }, X); st.contas.push(c); return c; };
  const cPF = conta('Conta corrente PF', 'Banco A', 'Conta corrente', 'PF', 9000);
  const cRes = conta('Reserva de emergência', 'Banco A', 'Investimento', 'PF', 22000, true);
  const cInv = conta('Investimentos de longo prazo', 'Corretora X', 'Investimento', 'PF', 14000);
  const cDin = conta('Dinheiro', 'Carteira', 'Dinheiro', 'PF', 300);
  const cC1 = conta('Conta PJ Imobiliária', 'Banco B', 'Conta corrente', 'C1', 14000);
  const cC2 = conta('Conta PJ Jurídico', 'Banco C', 'Conta corrente', 'C2', 11000);

  // ---------- cartões ----------
  const cartao = (nome, nucleo, limite, fechamento, vencimento, contaId) => { const c = Object.assign({ id: uid('cc'), nome, titular: 'P1', nucleo, limite, fechamento, vencimento, contaId }, X); st.cartoes.push(c); return c; };
  const kPF = cartao('Cartão pessoal', 'PF', 15000, 3, 10, cPF.id);
  const kC1 = cartao('Cartão PJ Imobiliária', 'C1', 8000, 25, 5, cC1.id);

  // ---------- compromissos ----------
  const comp = (o) => { const c = Object.assign({ id: uid('cp'), tipo: 'Despesa', responsavel: 'P1', recorrencia: 'Permanente', semFim: true }, o, X); st.compromissos.push(c); return c; };
  const d = (m, day) => dayIn(m, day);
  const anoCur = cur.slice(0, 4);
  // PF
  comp({ descricao: 'Aluguel do apartamento', nucleo: 'PF', categoria: 'Moradia', subcategoria: 'Aluguel', valor: 3200, inicio: d(start, 5), contaId: cPF.id });
  comp({ descricao: 'Condomínio', nucleo: 'PF', categoria: 'Moradia', subcategoria: 'Condomínio', valor: 650, inicio: d(start, 10), contaId: cPF.id });
  comp({ descricao: 'Plano de saúde', nucleo: 'PF', categoria: 'Saúde', subcategoria: 'Plano de saúde', valor: 690, inicio: d(start, 15), contaId: cPF.id });
  comp({ descricao: 'Internet e celular', nucleo: 'PF', categoria: 'Moradia', subcategoria: 'Internet', valor: 180, inicio: d(start, 20), contaId: cPF.id });
  comp({ descricao: 'Academia', nucleo: 'PF', categoria: 'Saúde', subcategoria: 'Academia', valor: 150, inicio: d(start, 8), contaId: cPF.id });
  comp({ descricao: 'Streaming e apps', nucleo: 'PF', categoria: 'Assinaturas', subcategoria: 'Streaming', valor: 90, inicio: d(start, 12), cartaoId: kPF.id });
  comp({ descricao: 'Pós-graduação', nucleo: 'PF', categoria: 'Educação', subcategoria: 'Pós-graduação', valor: 850, inicio: d(addM(cur, -9), 15), recorrencia: 'Temporária', parcelas: 18, semFim: false, contaId: cPF.id });
  comp({ descricao: 'Financiamento do carro', nucleo: 'PF', categoria: 'Transporte', subcategoria: 'Financiamento do veículo', valor: 1400, inicio: d(addM(cur, -42), 18), recorrencia: 'Temporária', parcelas: 48, semFim: false, contaId: cPF.id, natureza: 'Financiamento' });
  // pró-labore: transferência PJ → PF todo mês
  comp({ descricao: 'Pró-labore Imobiliária', nucleo: 'C1', categoria: 'Pró-labore', subcategoria: 'Pró-labore', valor: 2700, inicio: d(start, 5), contaId: cC1.id, contaDestinoId: cPF.id });
  comp({ descricao: 'Pró-labore Jurídico', nucleo: 'C2', categoria: 'Pró-labore', subcategoria: 'Pró-labore', valor: 2200, inicio: d(start, 5), contaId: cC2.id, contaDestinoId: cPF.id });
  // imobiliária
  const c1 = { nucleo: 'C1', responsavel: 'NA', contaId: cC1.id };
  comp(Object.assign({ descricao: 'Coworking', categoria: 'Aluguel', subcategoria: 'Sala / coworking', valor: 900, inicio: d(start, 10) }, c1));
  comp(Object.assign({ descricao: 'Contabilidade', categoria: 'Contabilidade', subcategoria: 'Honorários contábeis', valor: 450, inicio: d(start, 10) }, c1));
  comp(Object.assign({ descricao: 'INSS do pró-labore', categoria: 'Impostos', subcategoria: 'INSS sobre pró-labore', valor: 300, inicio: d(start, 20) }, c1));
  comp(Object.assign({ descricao: 'Telefone', categoria: 'Telefonia', subcategoria: 'Telefone e internet', valor: 90, inicio: d(start, 12) }, c1));
  comp(Object.assign({ descricao: 'CRM e site', categoria: 'Sistemas / software', subcategoria: 'CRM e site', valor: 380, inicio: d(start, 15) }, c1, { contaId: null, cartaoId: kC1.id }));
  // jurídico
  const c2 = { nucleo: 'C2', responsavel: 'NA', contaId: cC2.id };
  comp(Object.assign({ descricao: 'Contabilidade', categoria: 'Contabilidade', subcategoria: 'Honorários contábeis', valor: 400, inicio: d(start, 10) }, c2));
  comp(Object.assign({ descricao: 'INSS do pró-labore (com CPP)', categoria: 'Impostos', subcategoria: 'INSS sobre pró-labore', valor: 680, inicio: d(start, 20) }, c2));
  comp(Object.assign({ descricao: 'Sistema de gestão de processos', categoria: 'Sistemas / software', subcategoria: 'Gestão de processos', valor: 190, inicio: d(start, 15) }, c2));
  comp(Object.assign({ descricao: 'Anuidade OAB ' + anoCur + ' (5x)', categoria: 'Anuidades e certificações', subcategoria: 'OAB', valor: 220, valorTotal: 1100, parcelas: 5, inicio: anoCur + '-02-10', recorrencia: 'Parcelamento', semFim: false }, c2));
  // honorários mensais fixos: receitas recorrentes
  comp(Object.assign({ tipo: 'Receita', descricao: 'Honorários mensais — cliente A', categoria: 'Honorários contratuais', subcategoria: 'Mensalidade (partido)', valor: 1800, inicio: d(start, 10) }, c2));
  comp(Object.assign({ tipo: 'Receita', descricao: 'Honorários mensais — cliente B', categoria: 'Honorários contratuais', subcategoria: 'Mensalidade (partido)', valor: 1500, inicio: d(start, 10) }, c2));
  comp(Object.assign({ tipo: 'Receita', descricao: 'Honorários mensais — cliente C', categoria: 'Honorários contratuais', subcategoria: 'Mensalidade (partido)', valor: 2200, inicio: d(addM(cur, -6), 10) }, c2));

  // ---------- lançamentos manuais ----------
  const lan = (o) => {
    const status = o.status || (o.data <= today ? (o.tipo === 'Receita' ? 'Recebido' : 'Pago') : 'Pendente');
    st.lancamentos.push(Object.assign({ id: uid('l'), seq: seq(), competencia: o.competencia || ym(o.data), responsavel: 'P1', status, criadoEm: o.data }, o, X));
  };
  const months = FE.mrange(start, cur), N = months.length;
  months.forEach((m, i) => {
    const last3 = i >= N - 3;
    const pf = { nucleo: 'PF', contaId: cPF.id };
    const kp = { nucleo: 'PF', forma: 'Cartão de crédito', cartaoId: kPF.id, parcelas: 1 };
    // ---- PF: variáveis ----
    lan(Object.assign({ tipo: 'Despesa', data: d(m, 6), categoria: 'Alimentação', subcategoria: 'Supermercado', descricao: 'Supermercado do mês', valor: vary(1100, 0.1), forma: 'Débito' }, pf));
    lan(Object.assign({ tipo: 'Despesa', data: d(m, 19), categoria: 'Alimentação', subcategoria: 'Supermercado', descricao: 'Supermercado (reposição)', valor: vary(400, 0.2) }, kp));
    const rest = last3 ? 1500 + (i - (N - 3)) * 200 : 950;
    lan(Object.assign({ tipo: 'Despesa', data: d(m, 9), categoria: 'Alimentação', subcategoria: 'Restaurantes', descricao: 'Restaurantes', valor: vary(rest * 0.55, 0.06) }, kp));
    lan(Object.assign({ tipo: 'Despesa', data: d(m, 23), categoria: 'Alimentação', subcategoria: 'Restaurantes', descricao: 'Restaurantes', valor: vary(rest * 0.45, 0.06) }, kp));
    lan(Object.assign({ tipo: 'Despesa', data: d(m, 14), categoria: 'Alimentação', subcategoria: 'Delivery', descricao: 'Delivery', valor: vary(350, 0.2) }, kp));
    lan(Object.assign({ tipo: 'Despesa', data: d(m, 11), categoria: 'Transporte', subcategoria: 'Combustível', descricao: 'Combustível', valor: vary(450, 0.12) }, kp));
    lan(Object.assign({ tipo: 'Despesa', data: d(m, 22), categoria: 'Transporte', subcategoria: 'Aplicativos', descricao: 'Aplicativos de transporte', valor: vary(220, 0.25) }, kp));
    lan(Object.assign({ tipo: 'Despesa', data: d(m, 12), categoria: 'Moradia', subcategoria: 'Energia', descricao: 'Conta de luz', valor: vary(170, 0.15), forma: 'Débito automático' }, pf));
    lan(Object.assign({ tipo: 'Despesa', data: d(m, 16), categoria: 'Compras pessoais', subcategoria: i % 2 ? 'Roupas' : 'Casa', descricao: i % 2 ? 'Roupas' : 'Itens para casa', valor: vary(550, 0.3) }, kp));
    lan(Object.assign({ tipo: 'Despesa', data: d(m, 25), categoria: 'Lazer', subcategoria: 'Programas e eventos', descricao: 'Lazer', valor: vary(450, 0.3), forma: 'PIX' }, pf));
    lan(Object.assign({ tipo: 'Despesa', data: d(m, 17), categoria: 'Saúde', subcategoria: 'Medicamentos', descricao: 'Farmácia', valor: vary(140, 0.25) }, kp));
    lan(Object.assign({ tipo: 'Despesa', data: d(m, 20), categoria: 'Cuidados pessoais', subcategoria: 'Barbearia / salão', descricao: 'Cuidados pessoais', valor: vary(120, 0.2), forma: 'PIX' }, pf));
    // rendimentos e aplicação mensal
    lan({ tipo: 'Receita', nucleo: 'PF', data: d(m, 28), categoria: 'Rendimentos', subcategoria: 'Rendimento da reserva', descricao: 'Rendimento dos investimentos', valor: r2(330 + i * 18), contaId: cInv.id, forma: 'Transferência bancária' });
    lan({ tipo: 'Investimento', nucleo: 'PF', data: d(m, 13), categoria: 'Aplicação', subcategoria: i % 2 ? 'Reserva de emergência' : 'Objetivos', descricao: 'Aplicação mensal', valor: 1500, contaId: cPF.id, contaDestinoId: i % 2 ? cRes.id : cInv.id, forma: 'Transferência bancária' });
    // distribuição de lucros (PJ → PF)
    lan({ tipo: 'Transferência', nucleo: 'C1', data: d(m, 15), categoria: 'Distribuição de lucros', subcategoria: 'Distribuição de lucros', descricao: 'Distribuição de lucros', valor: 6500, contaId: cC1.id, contaDestinoId: cPF.id, forma: 'Transferência bancária' });
    lan({ tipo: 'Transferência', nucleo: 'C2', data: d(m, 15), categoria: 'Distribuição de lucros', subcategoria: 'Distribuição de lucros', descricao: 'Distribuição de lucros', valor: 3000, contaId: cC2.id, contaDestinoId: cPF.id, forma: 'Transferência bancária' });
    // ---- PJ Imobiliária: comissões irregulares ----
    const im = { nucleo: 'C1', responsavel: 'NA', contaId: cC1.id };
    let vendas = R() < 0.25 ? 0 : (R() < 0.7 ? 1 : 2);
    if (i === N - 3) vendas = 1;
    if (i === N - 2) vendas = 0;                // mês fraco recente
    if (m === cur) vendas = 0;                  // no mês atual a comissão entra como "a receber" (abaixo)
    let recIm = 0;
    for (let k = 0; k < vendas; k++) {
      const v = vary(14000, 0.35); recIm += v;
      lan(Object.assign({ tipo: 'Receita', data: d(m, k ? 24 : 12), categoria: 'Comissões de venda', subcategoria: 'Venda', descricao: 'Comissão de venda', valor: v, forma: 'Transferência bancária' }, im));
      if (R() < 0.3) lan(Object.assign({ tipo: 'Despesa', data: d(m, k ? 26 : 14), categoria: 'Repasses de comissão', subcategoria: 'Corretores parceiros', descricao: 'Repasse a corretor parceiro', valor: r2(v * 0.3), forma: 'PIX' }, im));
    }
    if (R() < 0.5) { const v = vary(2800, 0.2); recIm += v; lan(Object.assign({ tipo: 'Receita', data: d(m, 18), categoria: 'Comissões de locação', subcategoria: 'Primeiro aluguel', descricao: 'Comissão de locação', valor: v, forma: 'PIX' }, im)); }
    if (recIm > 0) lan(Object.assign({ tipo: 'Despesa', data: d(addM(m, 1), 20), competencia: m, categoria: 'Impostos', subcategoria: 'Simples / DAS', descricao: 'DAS (Simples Nacional)', valor: r2(recIm * 0.06), forma: 'Boleto' }, im));
    lan({ tipo: 'Despesa', nucleo: 'C1', responsavel: 'NA', data: d(m, 21), categoria: 'Marketing', subcategoria: 'Anúncios e portais', descricao: 'Portais e anúncios', valor: vary(900, 0.2), forma: 'Cartão de crédito', cartaoId: kC1.id, parcelas: 1 });
    if (i % 2 === 0) lan(Object.assign({ tipo: 'Despesa', data: d(m, 8), categoria: 'Marketing', subcategoria: 'Fotografia e vídeo', descricao: 'Fotos de imóvel captado', valor: vary(450, 0.2), forma: 'PIX' }, im));
    lan({ tipo: 'Despesa', nucleo: 'C1', responsavel: 'NA', data: d(m, 26), categoria: 'Deslocamento', subcategoria: 'Combustível', descricao: 'Deslocamento para visitas', valor: vary(320, 0.25), forma: 'Cartão de crédito', cartaoId: kC1.id, parcelas: 1 });
    // ---- PJ Jurídico ----
    const ju = { nucleo: 'C2', responsavel: 'NA', contaId: cC2.id };
    let recJu = 1800 + 1500 + (m >= addM(cur, -6) ? 2200 : 0);   // honorários mensais (compromissos de receita)
    if (R() < 0.5) { const v = vary(2500, 0.3); recJu += v; lan(Object.assign({ tipo: 'Receita', data: d(m, 20), categoria: 'Consultoria e contratos', subcategoria: i % 2 ? 'Contratos' : 'Parecer', descricao: i % 2 ? 'Elaboração de contrato' : 'Parecer jurídico', valor: v, forma: 'PIX' }, ju)); }
    if (i % 5 === 3) { const v = vary(12000, 0.3); recJu += v; lan(Object.assign({ tipo: 'Receita', data: d(m, 25), categoria: 'Honorários de êxito', subcategoria: 'Êxito', descricao: 'Honorários de êxito — acordo', valor: v, forma: 'Transferência bancária' }, ju)); }
    const cus = vary(260, 0.4);
    lan(Object.assign({ tipo: 'Despesa', data: d(m, 9), categoria: 'Custas e diligências', subcategoria: 'Custas processuais', descricao: 'Custas processuais', valor: cus, forma: 'Boleto' }, ju));
    lan(Object.assign({ tipo: 'Receita', data: d(m, 24), categoria: 'Reembolso de custas', subcategoria: 'Custas', descricao: 'Reembolso de custas pelo cliente', valor: cus, forma: 'PIX' }, ju));
    lan(Object.assign({ tipo: 'Despesa', data: d(addM(m, 1), 20), competencia: m, categoria: 'Impostos', subcategoria: 'Simples / DAS', descricao: 'DAS (Simples Nacional)', valor: r2(recJu * 0.045), forma: 'Boleto' }, ju));
    if (i % 3 === 1) lan(Object.assign({ tipo: 'Despesa', data: d(m, 18), categoria: 'Atualização profissional', subcategoria: 'Livros', descricao: 'Livros jurídicos', valor: vary(220, 0.3), forma: 'PIX' }, ju));
  });
  // eventos pontuais
  const inWin = dt => dt >= start + '-01';
  const yr = cur.slice(0, 4);
  [yr + '-01-20', yr + '-02-20', yr + '-03-20'].forEach((dt, k) => { if (inWin(dt)) lan({ tipo: 'Despesa', nucleo: 'PF', data: dt, categoria: 'Transporte', subcategoria: 'IPVA', descricao: 'IPVA ' + yr + ' (' + (k + 1) + '/3)', valor: 650, contaId: cPF.id, forma: 'Boleto' }); });
  if (inWin(yr + '-04-30')) lan({ tipo: 'Despesa', nucleo: 'PF', data: yr + '-04-30', categoria: 'Impostos', subcategoria: 'Imposto de renda', descricao: 'IR ' + yr + ' — quota única', valor: 1600, contaId: cPF.id, forma: 'Boleto' });
  if (inWin(yr + '-03-15')) lan({ tipo: 'Despesa', nucleo: 'C1', responsavel: 'NA', data: yr + '-03-15', categoria: 'Registro profissional', subcategoria: 'Anuidade CRECI', descricao: 'Anuidade CRECI ' + yr, valor: 720, contaId: cC1.id, forma: 'Boleto' });
  if (inWin(yr + '-05-12')) lan({ tipo: 'Despesa', nucleo: 'C2', responsavel: 'NA', data: yr + '-05-12', categoria: 'Anuidades e certificações', subcategoria: 'Certificado digital', descricao: 'Certificado digital A3', valor: 260, contaId: cC2.id, forma: 'PIX' });
  // comissões já negociadas, ainda a receber
  lan({ tipo: 'Receita', nucleo: 'C1', responsavel: 'NA', data: d(cur, 28), categoria: 'Comissões de venda', subcategoria: 'Venda', descricao: 'Comissão de venda (escritura agendada)', valor: 16500, contaId: cC1.id, forma: 'Transferência bancária' });
  lan({ tipo: 'Receita', nucleo: 'C1', responsavel: 'NA', data: d(addM(cur, 1), 15), categoria: 'Comissões de venda', subcategoria: 'Venda', descricao: 'Comissão de venda (aguardando financiamento)', valor: 12800, contaId: cC1.id, forma: 'Transferência bancária' });
  // compras parceladas no cartão
  lan({ tipo: 'Despesa', nucleo: 'PF', data: d(addM(cur, -4), 20), categoria: 'Compras pessoais', subcategoria: 'Eletrônicos', descricao: 'Notebook (10x)', valor: 6500, parcelas: 10, forma: 'Cartão de crédito', cartaoId: kPF.id });
  lan({ tipo: 'Despesa', nucleo: 'PF', data: d(addM(cur, -2), 7), categoria: 'Viagens', subcategoria: 'Hospedagem', descricao: 'Viagem (6x)', valor: 4800, parcelas: 6, forma: 'Cartão de crédito', cartaoId: kPF.id });
  lan({ tipo: 'Despesa', nucleo: 'C1', responsavel: 'NA', data: d(addM(cur, -3), 27), categoria: 'Equipamentos', subcategoria: 'Compra', descricao: 'Câmera para fotos de imóveis (5x)', valor: 3500, parcelas: 5, forma: 'Cartão de crédito', cartaoId: kC1.id });
  // mistura PF/PJ: gasto pessoal no cartão da PJ; curso do Jurídico pago pela conta PF
  lan({ tipo: 'Despesa', nucleo: 'PF', data: d(addM(cur, -1), 21), categoria: 'Alimentação', subcategoria: 'Restaurantes', descricao: 'Jantar pessoal (pago com cartão da PJ)', valor: 280, forma: 'Cartão de crédito', cartaoId: kC1.id });
  lan({ tipo: 'Despesa', nucleo: 'C2', responsavel: 'NA', data: d(addM(cur, -2), 9), categoria: 'Atualização profissional', subcategoria: 'Cursos', descricao: 'Curso de contratos imobiliários (pago pela conta PF)', valor: 690, contaId: cPF.id, forma: 'PIX' });
  // transferência entre contas da PF
  lan({ tipo: 'Transferência', nucleo: 'PF', data: d(addM(cur, -3), 4), categoria: 'Entre contas', subcategoria: '', descricao: 'Saque para dinheiro', valor: 400, contaId: cPF.id, contaDestinoId: cDin.id, forma: 'Transferência bancária' });
  // ajuste: no mês corrente, nada do que vence depois de hoje fica pago
  st.lancamentos.forEach(l => { if (l.data > today) l.status = 'Pendente'; });

  // ---------- orçamento ----------
  const orc = (nucleo, categoria, valor) => st.orcamentos.push(Object.assign({ id: uid('or'), nucleo, categoria, valor }, X));
  orc('PF', 'Alimentação', 2900); orc('PF', 'Transporte', 2300); orc('PF', 'Lazer', 600); orc('PF', 'Compras pessoais', 1300); orc('PF', 'Saúde', 1100); orc('PF', 'Moradia', 4300);
  orc('C1', 'Marketing', 1500); orc('C2', 'Custas e diligências', 400);

  // ---------- metas ----------
  const meta = (o) => st.metas.push(Object.assign({ id: uid('mt') }, o, X));
  meta({ nome: 'Reserva de emergência (6 meses)', nucleo: 'PF', alvo: 60000, vinculo: 'RESERVA', data: dayIn(addM(cur, 18), 1) });
  meta({ nome: 'Entrada do apartamento', nucleo: 'PF', alvo: 120000, vinculo: cInv.id, data: dayIn(addM(cur, 36), 1) });
  meta({ nome: 'Estrutura do escritório', nucleo: 'C2', alvo: 15000, acumulado: 4000, vinculo: '', data: dayIn(addM(cur, 10), 1) });

  // ---------- patrimônio ----------
  const pat = st.patrimonio;
  pat.ativos.push(Object.assign({ id: uid('pa'), descricao: 'Carro', tipo: 'Veículos', valor: 72000 }, X));
  pat.passivos.push(Object.assign({ id: uid('pp'), descricao: 'Saldo devedor do financiamento do carro', tipo: 'Financiamentos de veículos', valor: 8400 }, X));
  months.forEach((m, i) => {
    const k = N - 1 - i;
    pat.historico.push({ mes: m, ativos: r2(72000 + k * 700), passivos: r2(8400 + k * 1400), exemplo: true });
  });

  // ---------- carteira de investimentos (tickers fictícios) ----------
  const cCor = conta('Corretora (saldo)', 'Corretora X', 'Investimento', 'PF', 22000);
  const cart = st.carteira;
  const at = (ticker, nome, tipo) => { const a = Object.assign({ id: uid('at'), ticker, nome, tipo, nucleo: 'PF' }, X); cart.ativos.push(a); cart.cotacoes[a.id] = []; return a; };
  const aA = at('AAAA3', 'Empresa A (exemplo)', 'Ação'), aB = at('BBBB4', 'Empresa B (exemplo)', 'Ação'), aC = at('CCCC11', 'Fundo imobiliário C (exemplo)', 'FII');
  const RP = rng(424242), ruido = p => 1 + (RP() * 2 - 1) * p;
  const pA = months.map((m, i) => r2(32 * Math.pow(1.022, i) * ruido(0.03)));
  const pB = months.map((m, i) => r2((i <= 4 ? 18.5 * Math.pow(1.022, i) : 20.2 * Math.pow(0.945, i - 4)) * ruido(0.03)));
  const pC = months.map((m, i) => r2((98 + 2.5 * Math.sin(i * 0.9)) * ruido(0.01)));
  const opc = o => { if (o.data <= today) cart.operacoes.push(Object.assign({ id: uid('op'), seq: ++cart.seq, contaId: cCor.id, taxas: 0 }, o, X)); };
  const tx = v => r2(v * 0.0003);
  // cotação de fim de mês (e a de hoje no mês corrente)
  months.forEach((m, i) => {
    const dt = i === N - 1 ? today : d(m, 28);
    for (const [a, p] of [[aA, pA], [aB, pB], [aC, pC]]) cart.cotacoes[a.id].push(Object.assign({ id: uid('cq'), data: dt, preco: p[i] }, X));
  });
  const compra = (a, p, i, dia, q) => { const pr = r2(p[i] * 0.99); opc({ ativoId: a.id, tipo: 'Compra', data: d(months[i], dia), quantidade: q, preco: pr, taxas: tx(q * pr) }); };
  compra(aA, pA, 0, 10, 100); compra(aA, pA, 5, 10, 100); compra(aA, pA, 10, 12, 50);
  compra(aB, pB, 1, 8, 200); compra(aB, pB, 7, 9, 150);
  compra(aC, pC, 0, 15, 40); compra(aC, pC, 8, 15, 25);
  { const pr = r2(pA[N - 2] * 1.01); opc({ ativoId: aA.id, tipo: 'Venda', data: d(months[N - 2], 14), quantidade: 80, preco: pr, taxas: tx(80 * pr) }); }
  [[2, 100], [5, 200], [8, 200], [11, 250]].forEach(([i, q]) => opc({ ativoId: aA.id, tipo: 'Provento', provTipo: i === 8 ? 'JCP' : 'Dividendo', data: d(months[i], 20), valor: r2(q * 0.55) }));
  months.forEach((m, i) => { if (i >= 1) opc({ ativoId: aC.id, tipo: 'Provento', provTipo: 'Rendimento (FII)', data: d(m, 14), valor: r2((i > 8 ? 65 : 40) * 0.85) }); });
  return st;
}

const DATA = { categoriasPadrao, defaultState, demoState, uid };
if (typeof module !== 'undefined' && module.exports) module.exports = DATA; else root.DATA = DATA;
})(typeof window !== 'undefined' ? window : globalThis);
