# E2E contra banco real

Desde a 1.3.8 a CI tem o job `e2e-real`, que roda o app de verdade contra um
Supabase local (Docker) com todas as migrations, Auth, PostgREST e RLS. Os E2E
antigos (`e2e/`) continuam rodando com o mock, que é rápido, mas o mock só
simula o que alguém escreveu nele: a RPC `criar_insumo_com_quantidade`, por
exemplo, não existe no mock, então o cadastro com estoque inicial nunca tinha
sido testado de ponta a ponta.

## O que o job faz

1. `supabase start` e `supabase db reset --no-seed` (banco limpo, todas as migrations).
2. `npm run test:e2e:real:prep` cria dois usuários de teste pelo Auth admin:
   `admin.e2e@kontrol.local` (Administrador) e `compra.e2e@kontrol.local` (Compra).
   A senha é sorteada a cada execução.
3. `npm run build` com a URL e a chave pública do Supabase local.
4. `npm run test:e2e:real` (pasta `e2e-real/`, config `playwright.real.config.ts`).

## O que os testes cobrem

- Sem sessão, as áreas mandam para o login; senha errada mostra erro.
- Administrador entra, abre as áreas principais e sai.
- Função Compra não abre a Auditoria (bloqueio no servidor) e não consegue gravar
  insumo direto no banco (RLS).
- Insumo cadastrado com estoque inicial aparece na lista e no Estoque depois de recarregar.
- Insumo sem estoque com ponto de reposição aparece nos alertas do painel de Cadastros.

## Segurança

- O preparo e a config recusam qualquer Supabase que não esteja em 127.0.0.1/localhost.
- As chaves vêm de `supabase status -o env` dentro da CI; nada vai para o repositório.
- Para rodar na sua máquina: `supabase start`, exportar as mesmas variáveis do job
  (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
  `E2E_REAL_SENHA`), depois `npm run test:e2e:real:prep`, `npm run build` e `npm run test:e2e:real`.
