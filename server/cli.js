import readline from 'node:readline';
import { users, sessions, state, gunzip, dailyBackup } from './db.js';
import { hashPassword, MIN_PASSWORD, MAX_PASSWORD } from './auth.js';

const [cmd, ...args] = process.argv.slice(2);
process.stdout.on('error', e => { if (e.code === 'EPIPE') process.exit(0); throw e; });
const out = s => process.stdout.write(s + '\n');
const err = s => { process.stderr.write(s + '\n'); process.exit(1); };
const dt = ms => (ms ? new Date(ms).toLocaleString('pt-BR', { timeZone: process.env.TZ || 'America/Sao_Paulo' }) : '—');
const kb = n => (n / 1024).toFixed(0) + ' KB';

function pickUser(email) {
  if (email) return users.byEmail(email) || err(`Usuário ${email} não existe.`);
  const all = users.list();
  if (all.length === 1) return users.byId(all[0].id);
  err(all.length ? 'Há mais de um usuário; informe o e-mail.' : 'Nenhum usuário cadastrado.');
}

function askHidden(prompt) {
  if (!process.stdin.isTTY) {   // senha via pipe: echo "..." | npm run cli -- usuario x@y
    return new Promise(res => { let d = ''; process.stdin.on('data', c => (d += c)); process.stdin.on('end', () => res(d.replace(/\r?\n$/, ''))); });
  }
  return new Promise(res => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = s => { if (s.includes(prompt)) rl.output.write(prompt); };
    rl.question(prompt, a => { rl.close(); process.stdout.write('\n'); res(a); });
  });
}

const help = `Uso: npm run cli -- <comando>

  usuario <email>            cria o usuário ou troca a senha (encerra as sessões abertas)
  usuarios                   lista usuários
  sessoes                    lista sessões ativas
  sair-de-todos [email]      encerra todas as sessões
  historico [email]          versão atual + versões anteriores guardadas
  exportar [versao] [email]  imprime o JSON (atual ou de uma versão) — redirecione para um arquivo
  restaurar <versao> [email] torna uma versão anterior a atual (a atual vai para o histórico)
  backup                     grava agora a cópia do dia em DATA_DIR/backups`;

switch (cmd) {
  case 'usuario': {
    const email = (args[0] || '').trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) err('Informe um e-mail válido: npm run cli -- usuario voce@email.com');
    const p1 = await askHidden('Senha: ');
    if (p1.length < MIN_PASSWORD || p1.length > MAX_PASSWORD) err(`A senha precisa ter de ${MIN_PASSWORD} a ${MAX_PASSWORD} caracteres.`);
    if (process.stdin.isTTY) { const p2 = await askHidden('Repita a senha: '); if (p1 !== p2) err('As senhas não conferem.'); }
    const hash = await hashPassword(p1);
    const u = users.byEmail(email);
    if (u) { users.setPassword(u.id, hash); out(`Senha de ${u.email} trocada. Sessões encerradas.`); }
    else { users.create(email, hash); out(`Usuário ${email} criado.`); }
    break;
  }
  case 'usuarios':
    for (const u of users.list()) out(`${u.id}\t${u.email}\tcriado ${dt(u.created_at)}\tsenha trocada ${dt(u.pass_changed_at)}`);
    break;
  case 'sessoes':
    for (const s of sessions.list()) out(`${s.email}\túltimo uso ${dt(s.last_seen)}\texpira ${dt(s.expires_at)}\t${s.user_agent || ''}`);
    break;
  case 'sair-de-todos': {
    const u = pickUser(args[0]);
    sessions.deleteUser(u.id);
    out(`Sessões de ${u.email} encerradas.`);
    break;
  }
  case 'historico': {
    const u = pickUser(args[0]);
    const m = state.meta(u.id);
    if (!m) { out('Sem dados no servidor.'); break; }
    out(`atual\tv${m.version}\t${dt(m.updated_at)}\t${kb(m.bytes)}\taparelho ${m.device || '—'}`);
    for (const r of state.history(u.id)) out(`\tv${r.version}\t${dt(r.updated_at)}\t${kb(r.bytes)}\taparelho ${r.device || '—'}\t(${r.reason}, substituída ${dt(r.archived_at)})`);
    break;
  }
  case 'exportar': {
    const ver = args[0] && /^\d+$/.test(args[0]) ? +args[0] : null;
    const u = pickUser(ver == null ? args[0] : args[1]);
    const row = ver == null ? state.full(u.id) : state.historyGet(u.id, ver) || (state.meta(u.id)?.version === ver ? state.full(u.id) : null);
    if (!row) err(ver == null ? 'Sem dados no servidor.' : `Versão ${ver} não encontrada (veja: historico).`);
    process.stdout.write(gunzip(Buffer.from(row.data)));
    process.stdout.write('\n');
    break;
  }
  case 'restaurar': {
    if (!/^\d+$/.test(args[0] || '')) err('Informe a versão: npm run cli -- restaurar 12');
    const u = pickUser(args[1]);
    const row = state.historyGet(u.id, +args[0]) || err(`Versão ${args[0]} não está no histórico.`);
    const cur = state.meta(u.id);
    const r = state.put(u.id, cur ? cur.version : 0, Buffer.from(row.data), row.bytes, 'cli', 'antes de restaurar v' + args[0]);
    out(`v${args[0]} restaurada como v${r.version}. Os aparelhos recebem na próxima sincronização; quem tiver alterações não enviadas verá a escolha de versão.`);
    break;
  }
  case 'backup':
    out('Cópia: ' + dailyBackup());
    break;
  default:
    out(help);
}
