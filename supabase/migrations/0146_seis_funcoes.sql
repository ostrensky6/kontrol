-- Seis funções no lugar de quatro (pedido do dono em 2026-11-06).
--
-- Antes: tecnico < coordenador < gestor < admin.
-- Agora: laboratorio = compra = cadastro < coordenador < gestor < admin.
--
-- Mapeamento de quem já existe (ninguém ganha nem perde acesso no dia):
--   tecnico      -> laboratorio  (mesma marcação de caixinhas; só muda o nome)
--   coordenador  -> coordenador
--   gestor       -> gestor
--   admin        -> admin
--   compra e cadastro são novas e nascem sem ninguém.
--
-- Desde a 0124 quem manda é a caixinha (permissoes_categorias + exceções em
-- perfis.permissoes); o papel só define o padrão e o nível onde ainda há
-- "papel mínimo" (papel_minimo/fn_exige_papel e avisos por papel_destino).
-- Por isso:
--  1. kontrol_private.nivel_papel(text): laboratorio/compra/cadastro = 0,
--     coordenador = 1, gestor = 2, admin = 3. "tecnico" continua valendo 0
--     como apelido, porque corpos de função antigos chamam
--     fn_exige_papel('tecnico') e políticas usam papel_minimo('tecnico'), e
--     avisos antigos têm papel_destino = 'tecnico'.
--  2. papel_minimo, notificacao_visivel e destinatarios_notificacao passam a
--     comparar pelo nível.
--  3. Funções que só aceitavam ('tecnico', 'coordenador', 'gestor') como papel
--     com caixinha (tem_permissao_efetiva, tem_permissao_do_usuario,
--     pode_editar_cadastro…) são reescritas a partir da definição viva, com a
--     nova lista.
--  4. CHECKs de perfis, usuarios_pre_aprovados e permissoes_categorias aceitam
--     as seis funções; o padrão de coluna passa a 'laboratorio'.
--  5. Dados: tecnico -> laboratorio em perfis, usuarios_pre_aprovados e
--     permissoes_categorias (a linha da categoria é renomeada, mantendo as
--     caixinhas). Compra e Cadastro ganham a marcação inicial do app.
--
-- Não remove tabelas, colunas, RLS nem triggers de auditoria (a troca de papel
-- em perfis fica na trilha de auditoria). Só troca CHECKs por versões mais
-- amplas.
--
-- Rollback (antes de alguém receber Compra ou Cadastro):
--   update perfis/usuarios_pre_aprovados set papel = 'tecnico' where papel = 'laboratorio';
--   update permissoes_categorias set papel = 'tecnico' where papel = 'laboratorio';
--   delete from permissoes_categorias where papel in ('compra', 'cadastro');
--   recriar os CHECKs com ('tecnico','coordenador','gestor','admin') e o default 'tecnico';
--   reaplicar papel_minimo (0014), notificacao_visivel/destinatarios_notificacao
--   (0128) e as funções listadas no NOTICE "0146: reescrita" com a lista antiga
--   (definições em 0108, 0128 e 0132).

begin;

set local lock_timeout = '5s';
set local statement_timeout = '180s';

do $$
begin
  if to_regprocedure('kontrol_private.tem_permissao_efetiva(text)') is null
    or to_regprocedure('kontrol_private.notificacao_visivel(uuid,text,text)') is null
    or to_regprocedure('public.destinatarios_notificacao(bigint)') is null
    or to_regprocedure('public.papel_minimo(text)') is null then
    raise exception '0146: requer as migrations 0014, 0112 e 0128';
  end if;
  if exists (
    select 1 from public.perfis
    where papel not in ('tecnico', 'coordenador', 'gestor', 'admin')
  ) then
    raise exception '0146: há perfis com papel fora dos quatro conhecidos; confira antes de aplicar';
  end if;
end $$;

-- ---- 1. Nível de cada função ----------------------------------------------
create or replace function kontrol_private.nivel_papel(p_papel text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case p_papel
    when 'admin' then 3
    when 'gestor' then 2
    when 'coordenador' then 1
    when 'laboratorio' then 0
    when 'compra' then 0
    when 'cadastro' then 0
    -- 0146: nome antigo de Laboratório (corpos de função e avisos antigos)
    when 'tecnico' then 0
  end;
$$;

comment on function kontrol_private.nivel_papel(text) is
  'Nível da função (0146): laboratorio/compra/cadastro 0, coordenador 1, gestor 2, admin 3; tecnico = 0 (nome antigo). Desconhecido: NULL.';

revoke all on function kontrol_private.nivel_papel(text) from public, anon;
grant execute on function kontrol_private.nivel_papel(text) to authenticated, service_role;

-- ---- 2. Comparações por nível ----------------------------------------------
create or replace function public.papel_minimo(p_min text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    kontrol_private.nivel_papel(current_papel()) >= kontrol_private.nivel_papel(p_min),
    false
  );
$$;

create or replace function kontrol_private.notificacao_visivel(
  p_usuario_destino uuid,
  p_papel_destino text,
  p_permissao_destino text
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_papel text;
begin
  if auth.uid() is null then
    return false;
  end if;
  select papel into v_papel from public.perfis where id = auth.uid() and not suspenso;
  if not found then
    return false;
  end if;
  if p_usuario_destino is not null then
    return p_usuario_destino = auth.uid();
  end if;
  if p_permissao_destino is not null then
    return kontrol_private.tem_permissao_efetiva(p_permissao_destino);
  end if;
  if p_papel_destino is not null then
    -- 0146: pelo nível (Laboratório, Compra e Cadastro no mesmo nível)
    return v_papel = 'admin'
      or coalesce(kontrol_private.nivel_papel(v_papel) >= kontrol_private.nivel_papel(p_papel_destino), false);
  end if;
  return true;
end $function$;

create or replace function public.destinatarios_notificacao(p_notificacao_id bigint)
returns setof text
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_n record;
begin
  select usuario_destino, papel_destino, permissao_destino into v_n
  from public.notificacoes where id = p_notificacao_id;
  if not found then
    return;
  end if;
  return query
    select distinct p.email
    from public.perfis p
    where not p.suspenso
      and p.email is not null
      and case
        when v_n.usuario_destino is not null then p.id = v_n.usuario_destino
        when v_n.permissao_destino is not null
          then kontrol_private.tem_permissao_do_usuario(p.id, v_n.permissao_destino)
        when v_n.papel_destino is not null
          then p.papel = 'admin'
            or coalesce(kontrol_private.nivel_papel(p.papel) >= kontrol_private.nivel_papel(v_n.papel_destino), false)
        else false
      end;
end $function$;

-- ---- 3. Funções que listam os papéis com caixinha ---------------------------
-- Reescreve a definição VIVA (pg_get_functiondef), trocando só a lista.
do $$
declare
  v_fn record;
  v_def text;
  v_nova text;
  v_total integer := 0;
begin
  for v_fn in
    select p.oid
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'kontrol_private')
      and p.prokind = 'f'
      and p.prosrc like '%(''tecnico'', ''coordenador'', ''gestor'')%'
  loop
    v_def := pg_get_functiondef(v_fn.oid);
    v_nova := replace(
      v_def,
      '(''tecnico'', ''coordenador'', ''gestor'')',
      '(''laboratorio'', ''compra'', ''cadastro'', ''coordenador'', ''gestor'')'
    );
    execute v_nova;
    v_total := v_total + 1;
    raise notice '0146: reescrita %', v_fn.oid::regprocedure;
  end loop;

  if v_total = 0 then
    raise exception '0146: nenhuma função com a lista antiga encontrada; esperado ao menos tem_permissao_efetiva';
  end if;

  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'kontrol_private')
      and p.prokind = 'f'
      and p.prosrc like '%(''tecnico'', ''coordenador'', ''gestor'')%'
  ) then
    raise exception '0146: ainda há função com a lista antiga';
  end if;
end $$;

-- ---- 4. CHECKs que aceitam as seis funções ---------------------------------
do $$
declare
  v_c record;
begin
  for v_c in
    select c.conrelid::regclass as tabela, c.conname
    from pg_constraint c
    where c.contype = 'c'
      and c.conrelid in (
        'public.perfis'::regclass,
        'public.usuarios_pre_aprovados'::regclass,
        'public.permissoes_categorias'::regclass
      )
      and pg_get_constraintdef(c.oid) like '%papel%'
      and pg_get_constraintdef(c.oid) like '%tecnico%'
  loop
    execute format('alter table %s drop constraint %I', v_c.tabela, v_c.conname);
    raise notice '0146: CHECK antigo % em % substituído', v_c.conname, v_c.tabela;
  end loop;
end $$;

-- ---- 5. Dados: Técnico vira Laboratório ------------------------------------
update public.perfis set papel = 'laboratorio' where papel = 'tecnico';
update public.usuarios_pre_aprovados set papel = 'laboratorio' where papel = 'tecnico';

-- A categoria é renomeada com as caixinhas que já tinha (inclui ajustes do admin).
update public.permissoes_categorias
   set papel = 'laboratorio', atualizado_em = now()
 where papel = 'tecnico'
   and not exists (select 1 from public.permissoes_categorias where papel = 'laboratorio');

-- Marcação inicial das funções novas (a mesma do app, src/lib/auth/permissions.ts).
insert into public.permissoes_categorias (papel, permissoes, atualizado_em) values
  ('compra', '{"cadastros.ver":true,"cadastros.editar":false,"projetos.ver":false,"projetos.editar":false,"tecnicos.salario.ver":false,"analises.ver":false,"analises.editar":false,"insumos.ver":true,"insumos.editar":false,"custeio.ver":false,"configuracoes.ver":false,"estoque.ver":true,"estoque.movimentar":false,"estoque.lote.aceitar":false,"estoque.lote.gerir":false,"estoque.descartar_bloquear":false,"planejamento.ver":true,"planejamento.editar":false,"planejamento.executar":false,"pedido.ver":true,"pedido.criar":true,"pedido.aprovar":false,"compras.ver":true,"compras.solicitar":true,"compras.aprovar":true,"compras.receber":true,"compras.cancelar":false,"recebimento.ver":true,"recebimento.registrar":true,"orcamentos.visualizar":false,"orcamentos.criar_editar":false,"orcamentos.emitir":false,"orcamentos.cancelar":false,"orcamento.parametros.editar":false,"orcamentos.fundos":false,"orcamentos.modelos":false,"orcamentos.pessoal":false,"auditoria.visualizar":false}'::jsonb, now()),
  ('cadastro', '{"cadastros.ver":true,"cadastros.editar":true,"projetos.ver":true,"projetos.editar":true,"tecnicos.salario.ver":false,"analises.ver":true,"analises.editar":false,"insumos.ver":true,"insumos.editar":true,"custeio.ver":false,"configuracoes.ver":false,"estoque.ver":true,"estoque.movimentar":false,"estoque.lote.aceitar":false,"estoque.lote.gerir":false,"estoque.descartar_bloquear":false,"planejamento.ver":false,"planejamento.editar":false,"planejamento.executar":false,"pedido.ver":false,"pedido.criar":false,"pedido.aprovar":false,"compras.ver":false,"compras.solicitar":false,"compras.aprovar":false,"compras.receber":false,"compras.cancelar":false,"recebimento.ver":false,"recebimento.registrar":false,"orcamentos.visualizar":false,"orcamentos.criar_editar":false,"orcamentos.emitir":false,"orcamentos.cancelar":false,"orcamento.parametros.editar":false,"orcamentos.fundos":false,"orcamentos.modelos":false,"orcamentos.pessoal":false,"auditoria.visualizar":false}'::jsonb, now())
on conflict (papel) do nothing;

alter table public.perfis
  alter column papel set default 'laboratorio',
  add constraint perfis_papel_check
    check (papel in ('laboratorio', 'compra', 'cadastro', 'coordenador', 'gestor', 'admin'));

alter table public.usuarios_pre_aprovados
  alter column papel set default 'laboratorio',
  add constraint usuarios_pre_aprovados_papel_check
    check (papel in ('laboratorio', 'compra', 'cadastro', 'coordenador', 'gestor', 'admin'));

alter table public.permissoes_categorias
  add constraint permissoes_categorias_papel_check
    check (papel in ('laboratorio', 'compra', 'cadastro', 'coordenador', 'gestor', 'admin'));

-- ---- 6. Conferência --------------------------------------------------------
do $$
begin
  if exists (select 1 from public.perfis where papel = 'tecnico')
    or exists (select 1 from public.usuarios_pre_aprovados where papel = 'tecnico')
    or exists (select 1 from public.permissoes_categorias where papel = 'tecnico') then
    raise exception '0146: ainda há registro com papel tecnico';
  end if;
  if (select count(*) from public.permissoes_categorias
      where papel in ('laboratorio', 'compra', 'cadastro', 'coordenador', 'gestor')) < 5 then
    raise notice '0146: alguma função sem linha em permissoes_categorias (o app usa o padrão do código)';
  end if;
  raise notice '0146: funções por quantidade de perfis: %',
    (select coalesce(jsonb_object_agg(papel, n), '{}'::jsonb)
     from (select papel, count(*) as n from public.perfis group by papel) t);
end $$;

commit;
