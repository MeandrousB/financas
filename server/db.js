import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { cfg } from './config.js';

fs.mkdirSync(cfg.dataDir, { recursive: true });
export const dbFile = path.join(cfg.dataDir, 'financas.db');
export const db = new DatabaseSync(dbFile);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;
`);

/* ---------- schema (PRAGMA user_version controla migrações futuras) ---------- */
const MIGRATIONS = [
  `CREATE TABLE users (
     id INTEGER PRIMARY KEY,
     email TEXT NOT NULL UNIQUE COLLATE NOCASE,
     pass_hash TEXT NOT NULL,
     created_at INTEGER NOT NULL,
     pass_changed_at INTEGER NOT NULL
   );
   CREATE TABLE sessions (
     token_hash TEXT PRIMARY KEY,
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     created_at INTEGER NOT NULL,
     last_seen INTEGER NOT NULL,
     expires_at INTEGER NOT NULL,
     user_agent TEXT
   );
   CREATE INDEX sessions_user ON sessions(user_id);
   CREATE TABLE state (
     user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
     version INTEGER NOT NULL,
     data BLOB NOT NULL,          -- JSON em gzip
     bytes INTEGER NOT NULL,      -- tamanho do JSON descomprimido
     updated_at INTEGER NOT NULL,
     device TEXT
   );
   CREATE TABLE state_history (
     id INTEGER PRIMARY KEY,
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     version INTEGER NOT NULL,
     data BLOB NOT NULL,
     bytes INTEGER NOT NULL,
     updated_at INTEGER NOT NULL, -- quando essa versão foi gravada
     archived_at INTEGER NOT NULL,-- quando foi substituída
     device TEXT,
     reason TEXT
   );
   CREATE INDEX hist_user ON state_history(user_id, version);`,
];
{
  const cur = db.prepare('PRAGMA user_version').get().user_version;
  for (let v = cur; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN');
    try { db.exec(MIGRATIONS[v]); db.exec(`PRAGMA user_version = ${v + 1}`); db.exec('COMMIT'); }
    catch (e) { db.exec('ROLLBACK'); throw e; }
  }
}

export function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}

/* ---------- usuários ---------- */
const q = {
  userCount: db.prepare('SELECT COUNT(*) n FROM users'),
  userByEmail: db.prepare('SELECT * FROM users WHERE email = ?'),
  userById: db.prepare('SELECT * FROM users WHERE id = ?'),
  userInsert: db.prepare('INSERT INTO users (email, pass_hash, created_at, pass_changed_at) VALUES (?, ?, ?, ?)'),
  userSetPass: db.prepare('UPDATE users SET pass_hash = ?, pass_changed_at = ? WHERE id = ?'),
  users: db.prepare('SELECT id, email, created_at, pass_changed_at FROM users ORDER BY id'),

  sessInsert: db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, last_seen, expires_at, user_agent) VALUES (?, ?, ?, ?, ?, ?)'),
  sessGet: db.prepare('SELECT s.*, u.email FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?'),
  sessTouch: db.prepare('UPDATE sessions SET last_seen = ?, expires_at = ? WHERE token_hash = ?'),
  sessDelete: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
  sessDeleteUser: db.prepare('DELETE FROM sessions WHERE user_id = ?'),
  sessPurge: db.prepare('DELETE FROM sessions WHERE expires_at < ?'),
  sessList: db.prepare('SELECT s.created_at, s.last_seen, s.expires_at, s.user_agent, u.email FROM sessions s JOIN users u ON u.id = s.user_id ORDER BY s.last_seen DESC'),

  stateMeta: db.prepare('SELECT version, bytes, updated_at, device FROM state WHERE user_id = ?'),
  stateFull: db.prepare('SELECT version, data, bytes, updated_at, device FROM state WHERE user_id = ?'),
  stateUpsert: db.prepare(`INSERT INTO state (user_id, version, data, bytes, updated_at, device) VALUES (?, ?, ?, ?, ?, ?)
                           ON CONFLICT(user_id) DO UPDATE SET version = excluded.version, data = excluded.data, bytes = excluded.bytes,
                           updated_at = excluded.updated_at, device = excluded.device`),
  histLast: db.prepare('SELECT archived_at, device FROM state_history WHERE user_id = ? ORDER BY id DESC LIMIT 1'),
  histArchive: db.prepare(`INSERT INTO state_history (user_id, version, data, bytes, updated_at, archived_at, device, reason)
                           SELECT user_id, version, data, bytes, updated_at, ?, device, ? FROM state WHERE user_id = ?`),
  histPrune: db.prepare(`DELETE FROM state_history WHERE user_id = ? AND id NOT IN
                           (SELECT id FROM state_history WHERE user_id = ? ORDER BY id DESC LIMIT ?)`),
  histList: db.prepare('SELECT version, bytes, updated_at, archived_at, device, reason FROM state_history WHERE user_id = ? ORDER BY version DESC'),
  histGet: db.prepare('SELECT version, data, bytes, updated_at, device FROM state_history WHERE user_id = ? AND version = ? ORDER BY id DESC LIMIT 1'),
};
export { q };

export const users = {
  count: () => q.userCount.get().n,
  byEmail: email => q.userByEmail.get(String(email).trim()),
  byId: id => q.userById.get(id),
  list: () => q.users.all(),
  create: (email, hash) => Number(q.userInsert.run(String(email).trim(), hash, Date.now(), Date.now()).lastInsertRowid),
  setPassword: (id, hash) => tx(() => { q.userSetPass.run(hash, Date.now(), id); q.sessDeleteUser.run(id); }),
};

export const sessions = {
  insert: (tokenHash, userId, expiresAt, ua) => { const now = Date.now(); q.sessInsert.run(tokenHash, userId, now, now, expiresAt, ua || null); },
  get: tokenHash => q.sessGet.get(tokenHash),
  touch: (tokenHash, expiresAt) => q.sessTouch.run(Date.now(), expiresAt, tokenHash),
  delete: tokenHash => q.sessDelete.run(tokenHash),
  deleteUser: userId => q.sessDeleteUser.run(userId),
  purge: () => q.sessPurge.run(Date.now()),
  list: () => q.sessList.all(),
};

/* ---------- estado (um documento JSON por usuário, versionado) ---------- */
export const state = {
  meta: userId => q.stateMeta.get(userId) || null,
  full: userId => q.stateFull.get(userId) || null,

  /**
   * Grava se expected === versão atual (0 = ainda não existe). Antes de sobrescrever,
   * arquiva a versão atual quando ela veio de outro aparelho ou quando o último arquivo
   * é mais velho que HISTORY_EVERY_MIN — assim o histórico cobre conflitos e dias de uso
   * sem guardar cada tecla.
   */
  put(userId, expected, gz, bytes, device, reason) {
    return tx(() => {
      const cur = q.stateMeta.get(userId);
      const curV = cur ? cur.version : 0;
      if (expected !== curV) return { conflict: true, current: cur || { version: 0, updated_at: null, device: null } };
      const now = Date.now();
      if (cur) {
        const last = q.histLast.get(userId);
        const old = !last || now - last.archived_at >= cfg.historyEveryMin * 60000;
        const otherDevice = (cur.device || '') !== (device || '');
        if (old || otherDevice || reason) {
          q.histArchive.run(now, reason || (otherDevice ? 'outro aparelho' : 'periódico'), userId);
          q.histPrune.run(userId, userId, cfg.historyKeep);
        }
      }
      const version = curV + 1;
      q.stateUpsert.run(userId, version, gz, bytes, now, device || null);
      return { version, updatedAt: now };
    });
  },
  history: userId => q.histList.all(userId),
  historyGet: (userId, version) => q.histGet.get(userId, version) || null,
};

export const gzip = buf => gzipSync(buf, { level: 6 });
export const gunzip = (buf, max) => gunzipSync(buf, max ? { maxOutputLength: max } : undefined);

/* ---------- cópia diária do banco (VACUUM INTO) ---------- */
export function dailyBackup() {
  const dir = path.join(cfg.dataDir, 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const day = new Date().toISOString().slice(0, 10);
  const file = path.join(dir, `financas-${day}.db`);
  if (!fs.existsSync(file)) db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  const limit = Date.now() - cfg.backupKeepDays * 86400000;
  for (const f of fs.readdirSync(dir)) {
    const m = /^financas-(\d{4}-\d{2}-\d{2})\.db$/.exec(f);
    if (m && Date.parse(m[1] + 'T00:00:00Z') < limit) fs.rmSync(path.join(dir, f), { force: true });
  }
  return file;
}
