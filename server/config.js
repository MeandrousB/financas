import path from 'node:path';
import { fileURLToPath } from 'node:url';

const env = process.env;
const bool = (v, d) => (v == null || v === '' ? d : /^(1|true|yes|sim|on)$/i.test(v));
const int = (v, d) => (v == null || v === '' || !Number.isFinite(+v) ? d : Math.trunc(+v));

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const cfg = {
  root,
  publicDir: path.join(root, 'public'),
  port: int(env.PORT, 3000),
  dataDir: path.resolve(env.DATA_DIR || path.join(root, 'data')),

  // Atrás do Traefik (Coolify/Dokploy) o TLS termina no proxy; o cookie continua Secure.
  // Só desligue em desenvolvimento local sem HTTPS.
  cookieSecure: bool(env.COOKIE_SECURE, true),
  sessionDays: int(env.SESSION_DAYS, 30),

  // Origem pública exata (ex.: https://financas.seudominio.com.br). Vazio = compara com o Host da requisição.
  allowedOrigin: (env.ALLOWED_ORIGIN || '').replace(/\/+$/, ''),
  trustProxy: bool(env.TRUST_PROXY, true),

  maxStateBytes: int(env.MAX_STATE_MB, 25) * 1024 * 1024,   // JSON descomprimido
  historyKeep: int(env.HISTORY_KEEP, 60),                     // versões anteriores guardadas
  historyEveryMin: int(env.HISTORY_EVERY_MIN, 30),            // intervalo mínimo entre snapshots do mesmo aparelho
  backupKeepDays: int(env.BACKUP_KEEP_DAYS, 14),              // cópias diárias do .db

  loginMaxFailsPerIp: int(env.LOGIN_MAX_FAILS_IP, 8),         // por janela de 15 min
  loginMaxFailsGlobal: int(env.LOGIN_MAX_FAILS_GLOBAL, 40),

  initEmail: (env.INIT_EMAIL || '').trim(),
  initPassword: env.INIT_PASSWORD || '',
};
