# Kontrol - Operacao de Producao

## App em producao

- App: Kontrol
- URL primaria/canonica: https://kontrol-atgc.vercel.app
- Login administrador: `ostrensky@ufpr.br`
- Papel: `admin`
- Senha do usuario admin: armazenada no Supabase Auth / gerenciador de senhas, nao versionar.
- Autenticacao: o app protege as rotas por Supabase Auth e redireciona acessos nao autenticados para `/login`.

## Codigo

- Repositorio: https://github.com/ostrensky6/kontrol
- Conta GitHub: `ostrensky6`
- Branch de producao: `main`
- Baseline estavel pos-auditoria: `efa20f15205ea3d12b7bd9b0f72444d27561173a`
- Tag local do baseline: `baseline-producao-pos-auditoria-20260704`
- Main atual validada apos blindagem: `1f03603c69c7915c5e702b0115525eaa71da80e1`
- Fluxo atual: deploy automatico pela integracao GitHub/Vercel do projeto `kontrol` na branch `main`.
- Antes de publicar, rode `npm run prod:check`.

### Ambiente local corrompido

Use este procedimento quando `node_modules` existir, mas comandos como
`npm run lint` ou `npm run test` falharem por nao encontrar binarios locais
como `eslint` ou `vitest`.

```powershell
Remove-Item node_modules -Recurse -Force
npm ci
npm ls eslint vitest next --depth=0
npm run lint
npm run test
```

Se `Remove-Item` falhar por arquivo em uso, feche servidores locais,
terminais e editores que possam estar mantendo handles abertos no projeto e
repita o procedimento.

## Hospedagem - Vercel

- Conta/time: `Gia`
- Team ID: `team_N5uHkBDu4hLjI9Yx2gmtpg4L`
- Scope: `giaufpr`
- Projeto oficial: `kontrol`
- Project ID: `prj_3l6QuGqsG63Lna4pTZ5Di1vV8RZc`
- Dashboard: https://vercel.com/giaufpr/kontrol
- Framework preset: Next.js (Turbopack, Next 16)
- Build command: padrao Next.js (`npm run build`)
- Output directory: padrao Next.js
- Production URL canonica: https://kontrol-atgc.vercel.app
- Dominio alternativo validado: https://kontrol-lac.vercel.app
- Commit validado em producao: `1f03603c69c7915c5e702b0115525eaa71da80e1`
- Status do commit validado: CI success, Vercel success, login e `/analises` validados em producao.
- Deploy: preferir merge/push em `main` para acionar a integracao GitHub/Vercel. Deploy manual pela CLI/API deve ser excecao controlada, com `VERCEL_TOKEN` definido no ambiente e sem colar tokens em chat/logs.
- Se o Node local falhar com erro de certificado do proxy, configure `NODE_EXTRA_CA_CERTS` para a cadeia corporativa/local. Evite `NODE_TLS_REJECT_UNAUTHORIZED=0`, salvo diagnostico pontual.
- Variaveis de ambiente configuradas e verificadas em producao (Production scope):
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY`
- `DATABASE_URL`/`POSTGRES_URL` nao sao obrigatorias no Vercel: o runtime Next.js usa Supabase HTTP/SSR e nao faz conexao PostgreSQL direta. Essas variaveis aparecem apenas em scripts operacionais/preflight/backup fora do runtime.

### Estado Vercel

- Variaveis de ambiente de producao configuradas no projeto `kontrol`.
- Supabase Auth deve manter Site URL/Redirect URLs para `https://kontrol-atgc.vercel.app`.
- Producao validada em `https://kontrol-atgc.vercel.app/login`.

## Banco de dados - Supabase producao

- Conta: `ostrensky6@gmail.com`
- Projeto: `estoque`
- Project ref: `gkcjzwfsnoknxgpsumxi`
- Regiao: `sa-east-1`
- API URL: https://gkcjzwfsnoknxgpsumxi.supabase.co
- Pooler IPv4:
  - Host: `aws-1-sa-east-1.pooler.supabase.com`
  - Porta: `5432`
  - User: `postgres.gkcjzwfsnoknxgpsumxi`
  - Database: `postgres`
- Chave anon/public: configurar como `NEXT_PUBLIC_SUPABASE_ANON_KEY` no host. Pode usar o formato novo `sb_publishable_...` (Settings -> API Keys -> Publishable key) ou o legacy anon JWT.
- Chave service/secret: configurar como `SUPABASE_SERVICE_ROLE_KEY` no host. Pode usar o formato novo `sb_secret_...` (Settings -> API Keys -> Secret keys) ou o legacy service_role JWT.
- Status CLI esperado: linkado com `supabase link --project-ref gkcjzwfsnoknxgpsumxi`.
- Historico de migrations em producao: conferir sempre com `psql` em `supabase_migrations.schema_migrations` antes de qualquer operacao (ver "Como aplicar uma migration" abaixo); nao assumir um intervalo fixo a partir da documentacao. `supabase migration list --linked` e `supabase db push` NAO servem enquanto a `0109` estiver registrada como `20260922185946`.
- Senha Postgres: armazenada no gerenciador de senhas. Nunca versionar.

Nota operacional (2026-07-05): `gkcjzwfsnoknxgpsumxi` e o Supabase atual
de producao do Kontrol no projeto Vercel `kontrol`. O ref legado
`hhxwdcwphitfxywbgtju` foi removido apos validacao de producao e nao deve ser
usado como alvo de producao, homologacao, migrations ou exemplos ativos.

### LEGADO / NAO USAR

- Project ref legado: `hhxwdcwphitfxywbgtju`
- API URL legada: https://hhxwdcwphitfxywbgtju.supabase.co
- Pooler user legado: `postgres.hhxwdcwphitfxywbgtju`
- Status: projeto legado apagado em 2026-07-05 apos validacao de producao.
- Manter apenas como referencia historica. Nao usar como producao, default, alvo esperado, homologacao ou exemplo ativo.

## Checklist operacional

1. Rode `npm run prod:check` antes de deploy ou de migration; ele bloqueia projeto Vercel errado, Supabase linkado no ref errado e migrations com prefixo duplicado.
2. Antes de features que dependam de schema novo, aplicar as migrations pendentes no Supabase producao (`gkcjzwfsnoknxgpsumxi`) pelo procedimento abaixo, **antes** do merge em `main`.
3. No projeto Vercel (`kontrol`), manter configurado:
   - `NEXT_PUBLIC_SUPABASE_URL=https://gkcjzwfsnoknxgpsumxi.supabase.co`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY=<publishable key do Supabase>`
   - `SUPABASE_SERVICE_ROLE_KEY=<secret/service role key do Supabase>`
4. No Supabase Auth, manter Site URL/Redirect URLs para `https://kontrol-atgc.vercel.app`.
5. Para publicar, usar o fluxo GitHub/Vercel em `main`; `npm run prod:deploy` e API Vercel ficam para excecoes controladas.
6. Validar login admin, `/`, `/analises`, `/orcamento`, `/orcamento/demandas`, `/estoque`, `/compras`, `/governanca/privilegios`, `/usuarios`, `/auditoria` e `/governanca/backups`.

## Como aplicar uma migration em producao

Procedimento usado de fato desde a 0125 (26-27/09/2026). Cada migration so vai
para producao com autorizacao explicita do dono, na hora.

1. `npm run prod:check`.
2. Conferir o que ja esta aplicado, com `psql` pela porta **5432** do pooler
   (sessao; a 6543 e de transacao e nao serve para migration):
   `select version, name from supabase_migrations.schema_migrations order by version desc limit 10;`
3. Backup antes, em `D:\Dropbox\Aplicativos\Kontrol\HISTORICO\deploy-NNNN-AAAA-MM-DD`:
   `pg_dump -Fc` do banco e as definicoes atuais (`pg_get_functiondef`,
   `pg_get_viewdef`, grants) de tudo que a migration recria, ja no formato de
   rollback.
4. Ver o que falta: `npm run db:migration -- --situacao --env-file G:\Aplicativos\Kontrol\.env.local`.
5. Ensaiar e aplicar uma por vez com o script, que aplica **e registra na mesma
   transação** (se cair no meio, nada fica aplicado nem registrado), sempre em
   UTF8 e na porta 5432 (a 6543 do `.env.local` e trocada sozinha):
   - ensaio (termina em rollback): `npm run db:migration -- --arquivo supabase/migrations/NNNN_nome.sql --env-file G:\Aplicativos\Kontrol\.env.local --ensaio`
   - aplicar: o mesmo comando sem `--ensaio` e com `--log <pasta do backup>`, que guarda a saida sem a senha.
   - migration ja registrada: o script avisa e nao faz nada.
   - migration aplicada a mao e nao registrada (o caso antigo, antes do
     script): se ela e idempotente (`create or replace`) e o ensaio passa,
     aplicar pelo script de novo; se o ensaio falhar porque os objetos ja
     existem, conferir as definicoes (passo 6) e so entao usar `--somente-registrar`.
6. Conferir: definicoes iguais as testadas no banco local (md5 de
   `pg_get_functiondef`), nenhuma funcao com acento estragado (`chr(195)`), e os
   `supabase/tests/*.sql` da migration rodando em transacao revertida.
7. So entao fazer o merge do PR em `main` (a Vercel publica) e abrir as rotas
   principais.

Nunca usar `supabase db push` neste projeto enquanto o historico da `0109` nao
for conciliado.

## Backup e recuperacao

O que roda sozinho (tarefa "Kontrol - Backup banco nuvem", 00:30 e 12:30, no
computador do laboratorio; instalar com `scripts/install-windows-backup-tasks.ps1`):

1. `pg_dump` do banco da nuvem em `D:\Dropbox\Aplicativos\Kontrol\BD`
   (30 dias, mais os dias 1 e 15 de cada mes para sempre).
2. Copia dos arquivos do Storage (anexos, assinaturas) em
   `D:\Dropbox\Aplicativos\Kontrol\ARQUIVOS`, 14 copias. O `pg_dump` leva so a
   lista dos arquivos; sem esta copia, os anexos voltariam quebrados. Precisa de
   `NEXT_PUBLIC_SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` da nuvem no
   `.env.local` da pasta principal e do Node instalado.
3. Cada execucao (boa ou com falha) fica em `public.backups_execucoes` (0134).

Alerta: todo dia as 8h (Brasilia) o banco confere o registro. Se o ultimo
backup bom do banco ou dos arquivos tiver mais de 26 horas, ou se houve falha
nas ultimas 24 horas, os administradores recebem aviso em Notificacoes. Pega
tambem o computador desligado e a tarefa parada.

Ensaio de restauracao (uma vez por mes e depois de mudanca grande no banco):
`npm run backup:ensaio` restaura o backup mais recente num banco descartavel do
Supabase local (Docker), confere tabelas, historico de migrations e contagens,
mede o tempo e grava o relatorio em `D:\Dropbox\Aplicativos\Kontrol\HISTORICO\ensaios`.
Nao toca a producao. Resultado "OK" = o backup volta inteiro.

Recuperacao de verdade (incidente): 1) parar o uso do app; 2) escolher o backup
(o ultimo "OK" do ensaio); 3) backup do estado atual antes de qualquer coisa;
4) restaurar com `pg_restore --clean --if-exists --no-owner --no-privileges` no
banco alvo (ou num projeto Supabase novo, apontando a Vercel para ele); 5)
reenviar os arquivos da copia de `ARQUIVOS` para os mesmos buckets e caminhos;
6) `npm run db:migration -- --situacao` e o passo 6 da secao anterior; 7) abrir
as rotas do checklist. So com autorizacao explicita do dono.

## Observacoes de seguranca

- Nao registrar senha Postgres, senha de usuario ou `service_role` em arquivos versionados.
- Se algum segredo tiver sido colado em chat, issue, commit ou documento, rotacionar no Supabase e atualizar as variaveis do host.
- A conta Supabase correta de producao e `ostrensky6@gmail.com`; nao misturar com a conta dos projetos BioLog/WaiOra.
