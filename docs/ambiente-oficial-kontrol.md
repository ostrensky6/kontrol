# Ambiente oficial do Kontrol

Atualizado e verificado em 2026-09-26.

## Identidade

- App: **Kontrol** (com K)
- Versão em produção: `1.1.2` (publicada em 2026-09-26 junto com esta ficha)
- Produção: https://kontrol-atgc.vercel.app
- Admin: `ostrensky@ufpr.br`
- Papel do admin: `admin`

## Pasta local

- Pasta oficial: `G:\Aplicativos\Kontrol` (disco "SSD Novo").
- Use **sempre** o caminho `G:`. `D:\Aplicativos` é só uma junção do Windows que
  aponta para `G:\Aplicativos` (não há cópia em D). Ela continua existindo porque
  tarefas agendadas de **outros** projetos (Sanepar/Yvae, WaiOra, GIA, Piscis, ATGC)
  ainda usam o caminho D; o Kontrol não depende mais dela.
- Backup automático do banco: tarefa "Kontrol - Backup banco nuvem" (00:30 e 12:30),
  roda `G:\Aplicativos\Kontrol\scripts\backup-database-cloud.ps1` e grava em
  `D:\Dropbox\Aplicativos\Kontrol\BD` (o Dropbox fica de fato no disco D).
  Caminho do projeto corrigido de D para G em 2026-09-27.
- Worktrees de sessões do Claude ficam em `G:\Aplicativos\Kontrol\.claude\worktrees\...`.
- A pasta antiga `Aplicativos\Estoque` está depreciada, não é repositório git e
  não deve receber commits novos.

## GitHub

- Conta dona: `ostrensky6`
- Repositório: `ostrensky6/kontrol` (público)
- Origin: `https://github.com/ostrensky6/kontrol.git`
- Nome antigo: `ostrensky6/estoque`, renomeado em 2026-09-26. O GitHub
  redireciona o nome antigo, mas usar sempre o novo.
- Branch alvo de produção: `main`
- Acesso ao repositório: **somente `ostrensky6`** (admin). A conta
  `ostrensky1-code` foi retirada do Kontrol em 2026-09-26 e continua ativa em
  outros projetos do usuário; não apagá-la.
- Regra de CI: todo PR precisa avançar `APP_VERSION` em exatamente uma unidade
  (`npm run version:bump`), inclusive PR só de documentação. Se dois PRs
  abertos avançarem para o mesmo número, o segundo precisa avançar de novo
  depois de atualizar com o `main`.

## Vercel

- Conta de publicação: `Plankton Solucoes Meio Ambiente` (informado pelo
  usuário; não verificado em 2026-09-26 porque o conector não acessa o time)
- E-mail de acesso informado pelo usuário: `planktonsma@gmail.com`
- Username Vercel observado: `planktonsma-6466`
- Projeto oficial: `kontrol`
- Project ID: `prj_3l6QuGqsG63Lna4pTZ5Di1vV8RZc`
- Scope: `giaufpr`
- Team ID: `team_N5uHkBDu4hLjI9Yx2gmtpg4L`
- Dashboard: https://vercel.com/giaufpr/kontrol
- URL de produção canônica: https://kontrol-atgc.vercel.app
- Domínio alternativo: https://kontrol-lac.vercel.app (redireciona para
  `kontrol-atgc`)
- Publicação automática pela integração GitHub: push no `main` publica em
  produção; cada PR gera deploy de preview. Confirmado funcionando após a
  renomeação do repositório (merge do PR #36 publicado com sucesso).

O alvo canônico é definido pelo conjunto `scope + Team ID + Project ID +
domínio`, não por uma conta GitHub, Supabase ou por semelhança de nome. Para
deploy manual, a sessão deve identificar `planktonsma-6466` e comprovar acesso
ao projeto/time acima. Qualquer outra identidade, inclusive `ostrensky2`,
bloqueia a publicação; não usar fallback. Em 2026-09-26 a Vercel CLI desta
máquina estava logada como `ostrensky2-3553`, portanto deploy manual por ela
está bloqueado. O e-mail acima foi informado pelo usuário e não deve ser
inferido ou substituído a partir de GitHub, Supabase ou username.

## Supabase

- Conta de acesso: `ostrensky6@gmail.com`
- Projeto: `Kontrol` (nome antigo: `estoque`)
- Project ref: `gkcjzwfsnoknxgpsumxi`
- Região: `sa-east-1` (São Paulo)
- API URL: https://gkcjzwfsnoknxgpsumxi.supabase.co
- Dashboard: https://supabase.com/dashboard/project/gkcjzwfsnoknxgpsumxi
- Pooler host: `aws-1-sa-east-1.pooler.supabase.com`
- Pooler port: `5432`
- Pooler user: `postgres.gkcjzwfsnoknxgpsumxi`
- Database: `postgres`
- Chaves publicáveis e secretas: manter somente nos ambientes autorizados e no
  gerenciador de segredos; não registrar valores neste documento.

Nota operacional (2026-07-05): `gkcjzwfsnoknxgpsumxi` é o Supabase atual do
projeto Vercel `kontrol`. O ref `hhxwdcwphitfxywbgtju` era legado, foi removido
após validação de produção e não deve ser usado como alvo de produção,
homologação, migrations ou exemplos ativos.

Migrations (2026-09-26): a nuvem está com as migrations até `0124` aplicadas e
registradas em `supabase_migrations`. A `0109` está registrada na nuvem com a
versão `20260922185946`, por isso **não usar `supabase db push`** sem antes
alinhar esse histórico; conferir o estado real com `psql` antes de qualquer
migration nova.

## Serviços desativados — NÃO USAR

### Supabase legado

- Project ref legado: `hhxwdcwphitfxywbgtju`
- API URL legada: https://hhxwdcwphitfxywbgtju.supabase.co
- Dashboard legado: https://supabase.com/dashboard/project/hhxwdcwphitfxywbgtju
- Pooler user legado: `postgres.hhxwdcwphitfxywbgtju`
- Status: apagado em 2026-07-05 após validação de produção; confirmado fora do
  ar em 2026-09-26.
- Manter apenas como referência histórica. Não usar como produção, default,
  alvo esperado, homologação ou exemplo ativo.

### Netlify

- Projeto `estoque-gia` (`estoque-gia.netlify.app`): apagado em 2026-09-26 e
  desligado do GitHub (GitHub App e autorização OAuth removidos). Não recriar.

## Histórico de baseline

- Baseline estável pós-auditoria: commit `efa20f15205ea3d12b7bd9b0f72444d27561173a`
- Tag local do baseline: `baseline-producao-pos-auditoria-20260704`
- Main validada após blindagem: commit `1f03603c69c7915c5e702b0115525eaa71da80e1`
  (CI success, Vercel success, login e `/analises` validados em produção)

## Segurança

Não registrar em arquivos versionados:

- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_AUTH_ADMIN_KEY`
- `DATABASE_URL`
- `POSTGRES_URL`
- Senhas do banco

Para testes puramente front-end, usar o modo mock/e2e ou apenas `NEXT_PUBLIC_*`.
