# Minhas finanças — backend, login e PWA

A planilha HTML de controle financeiro (PF, PJ Imobiliária e PJ Jurídico), agora com servidor próprio, login e instalação como app. As telas e o motor de cálculo são os mesmos do arquivo único; o que mudou foi onde os dados ficam e como chegam aos aparelhos.

```
server/
  index.js    HTTP (Hono): cabeçalhos de segurança, login, API do estado, /sw.js versionado, estáticos
  auth.js     senha (scrypt), sessão em cookie, limite de tentativas
  db.js       SQLite (node:sqlite): usuários, sessões, estado versionado, histórico, cópia diária
  cli.js      administração pelo terminal
  config.js   variáveis de ambiente
public/
  index.html  casca do app + tela de acesso
  engine.js   motor de cálculo e dados padrão (extraído do HTML, sem mudanças)
  app.js      interface (extraída do HTML; só os textos sobre "dados neste navegador" mudaram)
  sync.js     sessão, sincronização local-first, tela de acesso, service worker
  sw.js       service worker (o servidor injeta versão e lista de arquivos)
  vendor/     Chart.js 4.4.4 (MIT)
  fonts/      IBM Plex Sans 400/500/600, subconjunto latin (OFL)
  icons/, manifest.webmanifest, styles.css
```

Dependências de produção: `hono@4.13.13` e `@hono/node-server@2.1.4`, versões fixas. Nada compila na instalação: o banco é o SQLite que já vem no Node (22.13+; a imagem usa 24).

## Rodar localmente

```bash
npm ci
INIT_EMAIL=voce@email.com INIT_PASSWORD='uma-senha-longa' npm run dev   # http://localhost:3000
```

`npm run dev` desliga o cookie `Secure` (não há HTTPS em localhost). O service worker funciona em `localhost`.

## Deploy

O app precisa de **HTTPS** (cookie `Secure` e service worker) e de **armazenamento persistente em `/data`**. Sem o volume, o banco fica dentro do container e some no próximo deploy; o servidor avisa no log quando `/data` não é um volume montado.

**Coolify** — novo recurso a partir do repositório, build pack *Dockerfile*, porta `3000`. Em *Domains*, o domínio com `https://`. Em *Persistent Storage*, um volume com destino `/data`. Em *Environment Variables*, `INIT_EMAIL`, `INIT_PASSWORD` e `ALLOWED_ORIGIN` (veja abaixo).

**Dokploy** — aplicação com build type *Dockerfile* (ou *Compose*, usando o `docker-compose.yml`), porta `3000`, domínio com HTTPS, e em *Advanced → Volumes* um volume montado em `/data`.

Depois do primeiro login, apague `INIT_PASSWORD` do ambiente e faça um redeploy. Ela só é usada quando ainda não existe usuário.

### Variáveis

| Variável | Padrão | Uso |
|---|---|---|
| `INIT_EMAIL`, `INIT_PASSWORD` | — | Criam o usuário na primeira subida (senha com 10+ caracteres). |
| `ALLOWED_ORIGIN` | vazio | Origem pública exata, ex.: `https://financas.seudominio.com.br`. Vazio = compara a `Origin` com o `Host`. |
| `DATA_DIR` | `/data` | Banco (`financas.db`) e cópias diárias (`backups/`). |
| `COOKIE_SECURE` | `true` | `false` só em desenvolvimento sem HTTPS. |
| `SESSION_DAYS` | `30` | Validade da sessão, renovada com o uso. |
| `TRUST_PROXY` | `true` | Lê o IP do cliente de `X-Real-IP`/`X-Forwarded-For` (Traefik). |
| `MAX_STATE_MB` | `25` | Tamanho máximo do JSON de dados. |
| `HISTORY_KEEP` / `HISTORY_EVERY_MIN` | `60` / `30` | Versões anteriores guardadas e intervalo mínimo entre elas. |
| `BACKUP_KEEP_DAYS` | `14` | Dias de cópia diária do banco. |
| `LOGIN_MAX_FAILS_IP` / `LOGIN_MAX_FAILS_GLOBAL` | `8` / `40` | Erros de login tolerados em 15 min, por IP e no total. |

## Primeiro acesso e migração do arquivo antigo

Os dados do arquivo HTML antigo estão no armazenamento do navegador, ligados ao endereço onde o arquivo foi aberto. O app novo roda em outro endereço e não enxerga esses dados. Para trazer:

1. No arquivo antigo: **Cadastros → Dados e backup → Baixar backup (JSON)**.
2. No app novo, depois do login, a tela de primeiro uso oferece **Importar backup**. Escolha o arquivo.

A mesma tela oferece começar do zero ou com dados de exemplo. Depois disso, **Restaurar backup** em Cadastros continua funcionando e sincroniza.

Para instalar como app: no Chrome/Edge, o ícone de instalar na barra de endereço; no Android, *Adicionar à tela inicial*; no iPhone, Safari → Compartilhar → *Adicionar à Tela de Início*.

## Administração (CLI)

No container (`docker exec -it <container> sh`, ou o terminal do Coolify/Dokploy):

```bash
npm run cli -- usuario voce@email.com   # cria o usuário ou troca a senha (encerra as sessões)
npm run cli -- sessoes                  # sessões ativas
npm run cli -- sair-de-todos            # encerra todas
npm run cli -- historico                # versão atual + anteriores
npm run cli -- exportar > atual.json    # JSON da versão atual
npm run cli -- exportar 12 > v12.json   # JSON de uma versão anterior
npm run cli -- restaurar 12             # v12 vira a atual (a atual vai para o histórico)
npm run cli -- backup                   # cópia do dia agora
```

## Backup

Há três camadas de backup:

- **Histórico de versões no banco.** A versão substituída é guardada sempre que outro aparelho sobrescreve, ou a cada 30 min de uso, até 60 versões. Restaure com a CLI. Isso cobre "apaguei sem querer" e "Apagar tudo".
- **Cópia diária do banco** (`VACUUM INTO`) em `/data/backups/financas-AAAA-MM-DD.db`, mantida por 14 dias.
- **Backup JSON pelo app**, em Cadastros.

As duas primeiras ficam na mesma VPS. Para sobreviver à perda da máquina, sincronize `/data/backups` para fora, por exemplo com rclone para R2 ou B2 num cron do host.

## Como a sincronização funciona

O estado do app é um único documento JSON por usuário, versionado no servidor.

- **Gravação.** O aparelho grava sempre localmente e, cerca de 1 s depois de cada alteração, envia o documento em gzip com `If-Match: <versão base>`.
- **Conflito.** Se outro aparelho gravou antes, o servidor responde 409 e o app pergunta qual versão fica. A outra é baixada como JSON, e o servidor também a guarda no histórico.
- **Sem conexão.** O app abre pela cópia local (o service worker guarda os arquivos) e envia as alterações quando a rede volta.
- **Atualizações de outros aparelhos.** O app consulta o servidor ao voltar ao foco, ao reconectar e a cada 60 s. Se houver versão nova e nada pendente local, aplica, mas nunca com um formulário aberto.
- **Indicador.** Na barra lateral (no celular, o ponto no topo). Quando o estado pede ação — conflito, sessão expirada ou erro — dá para clicar.

Quando sai versão nova do app, aparece **Nova versão do app disponível → Atualizar**. A versão é o hash do conteúdo de `public/`, então todo deploy que muda arquivo dispara o aviso.

## Segurança

- **Senha:** scrypt (N=2¹⁷, r=8, p=1), parâmetros recomendados pela OWASP.
- **Login:** o tempo de resposta é o mesmo para e-mail inexistente e para senha errada.
- **Sessão:** token aleatório de 256 bits, guardado no banco só como SHA-256. O cookie é `__Host-sid` (httpOnly, Secure, SameSite=Lax).
- **Escrita (CSRF):** só aceita `Origin` igual à do app e `Content-Type: application/json`.
- **CSP:** `script-src 'self'`, sem scripts inline nem `eval`. Também envia HSTS, `X-Frame-Options: DENY` e `nosniff`.
- **Limite de tentativas:** fica em memória e zera quando o container reinicia. O limite global protege contra força bruta distribuída, mas também bloqueia você por até 15 min durante um ataque desses.
- **Cadastro:** não há rota de cadastro. Usuário só por `INIT_*` ou pela CLI.
- **Cloudflare:** se o domínio passar pelo proxy da Cloudflare, o IP visto é o da borda. Para limitar por IP real, ajuste `clientIp()` em `server/auth.js` para ler `CF-Connecting-IP`.

## Limites conhecidos

- **Cópia local:** a cópia do aparelho continua no `localStorage`, que tem alguns MB por site. Com ~340 bytes por lançamento, isso cobre anos; quando apertar, o caminho é mover essa cópia para IndexedDB.
- **Conflito:** é resolvido por documento inteiro, sem mesclar campo a campo. Para uma pessoa usando em mais de um aparelho isso é raro (só com edição offline nos dois).
- **Sair:** apaga a cópia local do aparelho. Se houver alterações não enviadas, o app avisa antes.
