# Rodada para passar de 8 (28/09/2026, versão 1.2.5)

Base: auditoria com notas de 28/09 (nota 7,4, `main` 72725f0). Esta rodada ataca
o que a régua ainda contava como P1/P2 aberto em código. São dois PRs:

| PR | O que muda | Migration |
|---|---|---|
| 1 (este) | Monitor de erros, cabeçalhos de segurança, tela de backups sem depender do disco `D:\` | 0141 |
| 2 | Anexos de orçamento e de pedido interno restritos por permissão; proposta aprovada e cancelada volta a ser aprovável pelo link | 0142 |

## Monitor de erros (0141)

- `src/instrumentation.ts`: todo erro que o servidor captura (tela, rota de API,
  server action, proxy) vai para `erros_app`, com a rota do arquivo
  (`/aprovar/[token]`, nunca o token) e o `digest` que aparece na tela de erro.
- `mensagemDoBanco` continua mostrando o texto amigável, mas agora entrega a
  recusa técnica original ao registro (antes ela era descartada). Recusas de
  negócio em português e conflitos de concorrência não entram.
- `error.tsx`, as telas de erro por área e o novo `global-error.tsx` mandam os
  erros do navegador para `/api/erros`, que só grava de quem está logado.
- De hora em hora, `kontrol_private.verificar_erros()` avisa os administradores
  em Notificações (no máximo um aviso por hora) e apaga registros com mais de
  90 dias. Os erros aparecem em **Governança > Erros do app**.
- Sem a 0141 aplicada o app funciona igual: o erro fica só no log da Vercel.

## Cabeçalhos de segurança

`next.config.ts` manda em todas as respostas: CSP com `frame-ancestors 'none'`,
`object-src 'none'`, `base-uri 'self'` e `form-action 'self'`; `X-Frame-Options`,
`nosniff`, `Referrer-Policy`, `Permissions-Policy` (câmera só no próprio site,
por causa do scanner) e HSTS. A CSP de scripts (`script-src`) ficou de fora: ela
exige nonce em todas as páginas e é uma rodada própria.

## Backups sem `D:\` fixo

As pastas vêm de `KONTROL_BACKUP_APP_DIR` e `KONTROL_BACKUP_DB_DIR` (padrão: as
mesmas dos scripts). No site publicado (Vercel) a tela mostra só o **Registro
dos backups** gravado pela 0134, que funciona em qualquer lugar; a lista de
arquivos e o botão de backup do aplicativo aparecem só no Kontrol local.

## Para produção (passo do dono)

Seguir `docs/operacao-producao.md`, "Como aplicar uma migration em producao":

1. `npm run prod:check` e backup antes (`pg_dump -Fc`).
2. Ver o que falta: `npm run db:migration -- --situacao --env-file G:\Aplicativos\Kontrol\.env.local`.
   A ficha do ambiente registrava a nuvem até a 0124 em 26/09; as rodadas
   seguintes pediram 0130 a 0140. Aplicar na ordem tudo o que aparecer como
   faltando.
3. Para cada uma: ensaio (`--arquivo supabase/migrations/NNNN_nome.sql --ensaio`),
   depois aplicar com `--log <pasta do backup>`.
4. 0141 e 0142 por último, do mesmo jeito.
5. No painel do Supabase: desligar "Allow new users to sign up"
   (Authentication > Sign In / Providers), pendente desde a 0132.
6. Rodar `npm run backup:ensaio` uma vez com o backup real e guardar o relatório.
7. Depois do merge, abrir **Governança > Erros do app** e **Backups** no site para
   conferir que as duas telas leem o banco.
