-- 0180: função Administrativo e remoção de usuário antigo (pedido do Antonio, 13/11/2026).
--
-- * Administrativo (chave 'administrativo') é uma função de pessoa, diferente do
--   Administrador do sistema: organização, planejamento geral, compras e
--   financeiro. Nível 0 (como Compra e Cadastro): o que ela faz são as
--   caixinhas da categoria, ajustáveis em Governança → Privilégios.
--   Não administra usuários, privilégios nem backups.
-- * As etapas "Autorização administrativa" e "Pagamento" do pedido passam a ter
--   um dono natural: sem responsável indicado em Cadastros → Responsáveis por
--   etapa (ou com ele e o substituto suspensos), quem tem a função
--   Administrativo recebe os avisos e vê os pedidos em "Aguardando você"; só
--   sem ninguém nessa função os avisos vão para o Administrador, como antes.
-- * Remover usuário antigo sem apagar o histórico: perfis ganha removido_em e
--   removido_por. Remover = bloquear o login (suspenso) + marcar a data; a
--   pessoa sai da lista de Usuários, mas pedidos, movimentações, aprovações e a
--   auditoria continuam com o nome dela. Reativar desfaz.
--
-- Só acrescenta: nenhuma linha muda de função, nenhuma coluna sai.
-- Rollback: delete from permissoes_categorias where papel='administrativo'
--   (depois de mudar a função de quem estiver nela); CHECKs e as funções
--   nivel_papel, papel_catalogado, tem_permissao_*, pode_editar_cadastro e
--   responsavel_compras voltam à definição anterior (0179); as colunas
--   removido_em/removido_por podem ficar (sem uso, não mudam nada).

begin;

set local lock_timeout = '5s';
set local statement_timeout = '180s';

do $$
begin
  if to_regprocedure('kontrol_private.responsavel_compras(text)') is null then
    raise exception '0180: requer a migration 0173';
  end if;
end $$;

-- ---- 1. A função nova nos CHECKs ---------------------------------------------------
alter table public.perfis drop constraint perfis_papel_check,
  add constraint perfis_papel_check check (papel in
    ('laboratorio','compra','cadastro','administrativo','gestor','coordenador','supervisor','admin'));
alter table public.usuarios_pre_aprovados drop constraint usuarios_pre_aprovados_papel_check,
  add constraint usuarios_pre_aprovados_papel_check check (papel in
    ('laboratorio','compra','cadastro','administrativo','gestor','coordenador','supervisor','admin'));
alter table public.permissoes_categorias drop constraint permissoes_categorias_papel_check,
  add constraint permissoes_categorias_papel_check check (papel in
    ('laboratorio','compra','cadastro','administrativo','gestor','coordenador','supervisor','admin'));

-- ---- 2. Nível e catálogo -----------------------------------------------------------
create or replace function kontrol_private.nivel_papel(p_papel text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case p_papel
    when 'admin' then 4
    when 'supervisor' then 3
    when 'gestor' then 2
    when 'coordenador' then 1
    when 'laboratorio' then 0
    when 'compra' then 0
    when 'cadastro' then 0
    when 'administrativo' then 0
    -- 0146: nome antigo de Laboratório (corpos de função e avisos antigos)
    when 'tecnico' then 0
  end;
$$;

comment on function kontrol_private.nivel_papel(text) is
  'Nível da função (0180): laboratorio/compra/cadastro/administrativo 0, coordenador 1, gestor 2, supervisor 3, admin 4; tecnico = 0 (nome antigo). Desconhecido: NULL.';

create or replace function kontrol_private.papel_catalogado(p_papel text)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(p_papel in
    ('laboratorio','compra','cadastro','administrativo','gestor','coordenador','supervisor','admin'), false);
$$;

-- Funções que avaliam a caixinha pela lista de funções (técnica da 0146/0151):
-- tem_permissao_efetiva, tem_permissao_do_usuario e pode_editar_cadastro.
do $$
declare
  v_fn record;
  v_total integer := 0;
begin
  for v_fn in
    select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'kontrol_private') and p.prokind = 'f'
      and p.prosrc like '%(''laboratorio'', ''compra'', ''cadastro'', ''coordenador'', ''gestor'', ''supervisor'')%'
  loop
    execute replace(pg_get_functiondef(v_fn.oid),
      '(''laboratorio'', ''compra'', ''cadastro'', ''coordenador'', ''gestor'', ''supervisor'')',
      '(''laboratorio'', ''compra'', ''cadastro'', ''administrativo'', ''coordenador'', ''gestor'', ''supervisor'')');
    v_total := v_total + 1;
  end loop;
  if v_total < 3 then
    raise exception '0180: esperava ao menos 3 funções com a lista de funções da 0151, achou %', v_total;
  end if;
end $$;

-- ---- 3. Caixinhas iniciais do Administrativo ----------------------------------------
-- Organização (cadastros, projetos), planejamento geral, compras (todas as
-- etapas, inclusive autorização administrativa e pagamento) e financeiro
-- (custos, orçamentos, fundos, pessoal e salários, auditoria). Fora: usuários,
-- privilégios, backups e as operações de bancada do estoque.
insert into public.permissoes_categorias (papel, permissoes)
select 'administrativo', jsonb_object_agg(k, true)
  from unnest(array[
    'cadastros.ver','cadastros.editar',
    'projetos.ver','projetos.editar',
    'planejamento.ver','planejamento.editar',
    'insumos.ver','estoque.ver','analises.ver',
    'pedido.ver','pedido.criar','pedido.aprovar',
    'compras.ver','compras.solicitar','compras.aprovar','compras.receber','compras.cancelar',
    'recebimento.ver','recebimento.registrar',
    'custeio.ver',
    'orcamentos.visualizar','orcamentos.criar_editar','orcamentos.emitir','orcamentos.cancelar',
    'orcamentos.fundos','orcamentos.pessoal','tecnicos.salario.ver',
    'auditoria.visualizar','configuracoes.ver'
  ]::text[]) as k
on conflict (papel) do nothing;

-- ---- 4. Administrativo como dono natural das etapas de compras ---------------------
-- Antes: responsável indicado; sem ele, o substituto; sem nenhum, NULL (avisos
-- para o Administrador). Agora, antes do NULL, a primeira pessoa ativa com a
-- função Administrativo (por nome).
create or replace function kontrol_private.responsavel_compras(p_etapa text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $function$
  select coalesce(
    (select case
              when u.id is not null and not coalesce(u.suspenso, false) then u.id
              when s.id is not null and not coalesce(s.suspenso, false) then s.id
            end
       from public.responsaveis_compras r
       left join public.perfis u on u.id = r.usuario_id
       left join public.perfis s on s.id = r.substituto_id
      where r.etapa = p_etapa),
    (select pf.id
       from public.perfis pf
      where p_etapa in ('administrativo', 'pagamento')
        and pf.papel = 'administrativo'
        and not coalesce(pf.suspenso, false)
      order by coalesce(nullif(btrim(pf.nome), ''), pf.email), pf.id
      limit 1)
  )
$function$;

comment on function kontrol_private.responsavel_compras(text) is
  '0180: responsável da etapa (administrativo/pagamento); sem ele, o substituto; sem nenhum ativo, a primeira pessoa ativa com a função Administrativo; sem ninguém, NULL (Administrador).';

-- ---- 5. Remover usuário antigo, guardando o histórico ------------------------------
alter table public.perfis
  add column if not exists removido_em timestamptz,
  add column if not exists removido_por uuid references public.perfis(id) on delete set null;

comment on column public.perfis.removido_em is
  '0180: quando a pessoa foi removida da equipe (login bloqueado; histórico preservado). NULL = na equipe.';
comment on column public.perfis.removido_por is
  '0180: quem removeu.';

-- removido sempre anda junto com suspenso (login bloqueado); reativar limpa a marca
alter table public.perfis drop constraint if exists perfis_removido_suspenso_check;
alter table public.perfis add constraint perfis_removido_suspenso_check
  check (removido_em is null or coalesce(suspenso, false)) not valid;
alter table public.perfis validate constraint perfis_removido_suspenso_check;

create index if not exists perfis_removido_em_idx on public.perfis (removido_em) where removido_em is not null;

commit;
