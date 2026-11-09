-- 0169 — aprovação por competência no pedido interno.
--
-- Etapa 3 do plano de adaptação do fluxo de compras (decisões de Antonio em
-- 09/11/2026, respostas D3 e D4):
--
--   * Quem valida o pedido é o coordenador do projeto (projetos.coordenador_id).
--     Pedido sem projeto vai para a Supervisão (função Supervisor). Na ausência
--     do coordenador, o Administrador valida como substituto, e fica registrado
--     (pedidos_internos_aprovacoes.papel = 'admin').
--   * "Pedido sem coordenador tem que travar com mensagem clara": o envio para
--     validação é recusado quando o projeto não tem coordenador cadastrado como
--     usuário ativo, ou quando não há Supervisor ativo para pedido sem projeto.
--   * Material de consumo de laboratório (natureza da 0168) passa também pela
--     coordenação do laboratório, depois do coordenador do projeto e antes de
--     seguir para compras. A tabela coordenacoes_area guarda o coordenador e o
--     substituto de cada laboratório ou área (Genética, LAPOA, LHM, LQA, Campo).
--
-- As regras valem no banco: o gatilho exigir_competencia_pedido roda em toda
-- troca de status de pedidos_internos, venha da tela, da API ou de outra RPC.
-- Como as demais regras de autoria, a conferência de QUEM decide só vale para
-- usuário autenticado (auth.uid() presente); operações do dono do banco
-- (migrations, rotinas do servidor) seguem livres.
--
-- Não destrutiva: cria uma tabela, acrescenta três colunas que aceitam vazio
-- em pedidos_internos, cria funções e gatilhos, e recria avisar_passagem_etapa
-- (0136) com dois avisos a mais. Nada é apagado; RLS e auditoria preservadas.
--
-- Rollback:
--   drop trigger pedidos_internos_exigir_competencia on public.pedidos_internos;
--   drop function public.decidir_coordenacao_laboratorio(bigint, text, text);
--   drop function public.aprovadores_pedido_interno(bigint);
--   drop function kontrol_private.exigir_competencia_pedido();
--   drop function kontrol_private.aprovadores_pedido(bigint, text, bigint);
--   recriar kontrol_private.avisar_passagem_etapa() da 0136;
--   (só depois de exportar, se houver dados) alter table public.pedidos_internos
--     drop column area_id, drop column aprovacao_area_por, drop column aprovacao_area_em;
--     drop table public.coordenacoes_area.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '180s';

do $$
begin
  if to_regclass('public.pedidos_internos') is null
     or not exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = 'pedidos_internos' and column_name = 'natureza') then
    raise exception '0169: requer a migration 0168 (pedidos_internos.natureza)';
  end if;
  if to_regprocedure('kontrol_private.tem_permissao_efetiva(text)') is null
     or to_regprocedure('kontrol_private.tem_permissao_do_usuario(uuid,text)') is null
     or to_regprocedure('public.fn_auditoria()') is null then
    raise exception '0169: requer as migrations 0112 e 0128';
  end if;
end $$;

-- ---- 1. Coordenações de laboratório e de área ----------------------------------
create table if not exists public.coordenacoes_area (
  id bigint generated always as identity primary key,
  nome text not null,
  coordenador_id uuid references public.perfis(id) on delete set null,
  substituto_id uuid references public.perfis(id) on delete set null,
  ativo boolean not null default true,
  observacoes text,
  criado_em timestamptz not null default now(),
  constraint coordenacoes_area_nome_check check (char_length(btrim(nome)) between 1 and 120),
  constraint coordenacoes_area_observacoes_check check (coalesce(char_length(observacoes), 0) <= 1000),
  constraint coordenacoes_area_substituto_check check (substituto_id is null or substituto_id is distinct from coordenador_id)
);

create unique index if not exists coordenacoes_area_nome_unico on public.coordenacoes_area (lower(btrim(nome)));

comment on table public.coordenacoes_area is
  '0169: laboratórios e áreas com o coordenador que aprova material de consumo de laboratório e o substituto na ausência.';
comment on column public.coordenacoes_area.coordenador_id is
  '0169: usuário que aprova os pedidos de material de consumo de laboratório desta área.';
comment on column public.coordenacoes_area.substituto_id is
  '0169: usuário que aprova na ausência do coordenador (férias, afastamento).';

alter table public.coordenacoes_area enable row level security;

drop policy if exists coordenacoes_area_ler on public.coordenacoes_area;
create policy coordenacoes_area_ler on public.coordenacoes_area
  for select to authenticated using (true);

-- Quem aprova o quê é decisão de quem gerencia usuários (Administrador).
drop policy if exists coordenacoes_area_incluir on public.coordenacoes_area;
create policy coordenacoes_area_incluir on public.coordenacoes_area
  for insert to authenticated
  with check (kontrol_private.tem_permissao_efetiva('usuarios.gerenciar'));
drop policy if exists coordenacoes_area_alterar on public.coordenacoes_area;
create policy coordenacoes_area_alterar on public.coordenacoes_area
  for update to authenticated
  using (kontrol_private.tem_permissao_efetiva('usuarios.gerenciar'))
  with check (kontrol_private.tem_permissao_efetiva('usuarios.gerenciar'));
drop policy if exists coordenacoes_area_excluir on public.coordenacoes_area;
create policy coordenacoes_area_excluir on public.coordenacoes_area
  for delete to authenticated
  using (kontrol_private.tem_permissao_efetiva('usuarios.gerenciar'));

grant select, insert, update, delete on public.coordenacoes_area to authenticated;

drop trigger if exists aud_coordenacoes_area on public.coordenacoes_area;
create trigger aud_coordenacoes_area
  after insert or update or delete on public.coordenacoes_area
  for each row execute function public.fn_auditoria('id');

-- Laboratórios e áreas indicados por Antonio em 09/11/2026.
insert into public.coordenacoes_area (nome, observacoes)
select v.nome, v.observacoes
  from (values
    ('Genética', 'Coordenação indicada em 09/11/2026: Sandra.'),
    ('LAPOA', 'Coordenação indicada em 09/11/2026: Vilmar.'),
    ('LHM', 'Coordenação indicada em 09/11/2026: Gisele.'),
    ('LQA', 'Coordenação a definir.'),
    ('Campo', 'Coordenação indicada em 09/11/2026: Ju.')
  ) as v(nome, observacoes)
 where not exists (select 1 from public.coordenacoes_area c where lower(btrim(c.nome)) = lower(v.nome));

-- Liga o coordenador só quando há exatamente um usuário ativo com aquele
-- primeiro nome; nos demais casos o Administrador escolhe na tela.
update public.coordenacoes_area c
   set coordenador_id = u.id
  from (values ('Genética', 'sandra'), ('LAPOA', 'vilmar'), ('LHM', 'gisele'), ('Campo', 'ju')) as m(area, primeiro)
 cross join lateral (
   select (array_agg(pf.id))[1] as id, count(*) as n
     from public.perfis pf
    where not coalesce(pf.suspenso, false)
      and lower(split_part(btrim(coalesce(pf.nome, '')), ' ', 1)) = m.primeiro
 ) as u
 where c.nome = m.area
   and c.coordenador_id is null
   and u.n = 1;

do $$
declare
  v_linha record;
begin
  for v_linha in
    select c.nome, pf.nome as coordenador
      from public.coordenacoes_area c
      left join public.perfis pf on pf.id = c.coordenador_id
     order by c.nome
  loop
    raise notice '0169: % -> %', v_linha.nome, coalesce(v_linha.coordenador, 'sem coordenador (escolher em Cadastros > Laboratórios e áreas)');
  end loop;
end $$;

-- ---- 2. Pedido interno: laboratório e aprovação da coordenação -----------------
alter table public.pedidos_internos
  add column if not exists area_id bigint references public.coordenacoes_area(id),
  add column if not exists aprovacao_area_por text,
  add column if not exists aprovacao_area_em timestamptz;

create index if not exists pedidos_internos_area_idx on public.pedidos_internos (area_id) where area_id is not null;

comment on column public.pedidos_internos.area_id is
  '0169: laboratório ou área do pedido. Obrigatório para material de consumo de laboratório (a coordenação do laboratório aprova).';
comment on column public.pedidos_internos.aprovacao_area_por is
  '0169: e-mail de quem aprovou pela coordenação do laboratório. Gravado só pela RPC decidir_coordenacao_laboratorio.';
comment on column public.pedidos_internos.aprovacao_area_em is
  '0169: quando a coordenação do laboratório aprovou. Limpo a cada novo envio para validação.';

-- ---- 3. Quem é competente para cada etapa -------------------------------------
-- Uma regra só, usada pelo gatilho, pela RPC da coordenação do laboratório e
-- pela tela (aprovadores_pedido_interno).
create or replace function kontrol_private.aprovadores_pedido(
  p_projeto_id bigint,
  p_natureza text,
  p_area_id bigint
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_projeto_nome text;
  v_coord_id uuid;
  v_coord_nome text;
  v_coord_email text;
  v_coord_ativo boolean;
  v_ids jsonb := '[]'::jsonb;
  v_nomes text;
  v_coordenador jsonb;
  v_falta text;
  v_lab_exigido boolean := coalesce(p_natureza, '') = 'material_consumo_lab';
  v_area_nome text;
  v_area_ativa boolean;
  v_lab_id uuid;
  v_sub_id uuid;
  v_lab_nome text;
  v_sub_nome text;
  v_lab_ids jsonb := '[]'::jsonb;
  v_laboratorio jsonb;
  v_falta_lab text;
begin
  if p_projeto_id is not null then
    select pr.nome, pr.coordenador_id into v_projeto_nome, v_coord_id
      from public.projetos pr where pr.id = p_projeto_id;
    if v_coord_id is not null then
      select coalesce(pf.nome, pf.email), pf.email, not coalesce(pf.suspenso, false)
        into v_coord_nome, v_coord_email, v_coord_ativo
        from public.perfis pf where pf.id = v_coord_id;
    end if;
    if v_coord_id is null or not coalesce(v_coord_ativo, false) then
      v_falta := format(
        'O projeto "%s" não tem coordenador cadastrado como usuário ativo. O pedido não segue sem a indicação do coordenador: peça ao Administrador para indicar o coordenador em Cadastros > Projetos.',
        coalesce(v_projeto_nome, '#' || p_projeto_id));
    else
      v_ids := jsonb_build_array(v_coord_id);
      v_coordenador := jsonb_build_object(
        'motivo', 'coordenador_projeto',
        'rotulo', format('Coordenador do projeto %s', coalesce(v_projeto_nome, '#' || p_projeto_id)),
        'nome', v_coord_nome,
        'email', v_coord_email,
        'ids', v_ids);
    end if;
  else
    select coalesce(jsonb_agg(pf.id order by coalesce(pf.nome, pf.email)), '[]'::jsonb),
           string_agg(coalesce(pf.nome, pf.email), ', ' order by coalesce(pf.nome, pf.email))
      into v_ids, v_nomes
      from public.perfis pf
     where pf.papel = 'supervisor' and not coalesce(pf.suspenso, false);
    if jsonb_array_length(v_ids) = 0 then
      v_falta := 'Pedido sem projeto é validado pela Supervisão, mas não há usuário ativo com a função Supervisor. O pedido não segue: escolha o projeto ou peça ao Administrador para cadastrar a Supervisora.';
    else
      v_coordenador := jsonb_build_object(
        'motivo', 'supervisao',
        'rotulo', 'Supervisão (pedido sem projeto)',
        'nome', v_nomes,
        'email', null,
        'ids', v_ids);
    end if;
  end if;

  if v_lab_exigido then
    if p_area_id is null then
      v_falta_lab := 'Material de consumo de laboratório precisa indicar o laboratório (Editar, no topo do pedido). A coordenação do laboratório aprova depois do coordenador.';
    else
      select c.nome, c.ativo, c.coordenador_id, c.substituto_id
        into v_area_nome, v_area_ativa, v_lab_id, v_sub_id
        from public.coordenacoes_area c where c.id = p_area_id;
      if v_area_nome is null or not v_area_ativa then
        v_falta_lab := 'O laboratório escolhido não está ativo. Escolha outro laboratório (Editar, no topo do pedido).';
      else
        select coalesce(pf.nome, pf.email) into v_lab_nome
          from public.perfis pf where pf.id = v_lab_id and not coalesce(pf.suspenso, false);
        select coalesce(pf.nome, pf.email) into v_sub_nome
          from public.perfis pf where pf.id = v_sub_id and not coalesce(pf.suspenso, false);
        if v_lab_nome is not null then
          v_lab_ids := v_lab_ids || jsonb_build_array(v_lab_id);
        end if;
        if v_sub_nome is not null then
          v_lab_ids := v_lab_ids || jsonb_build_array(v_sub_id);
        end if;
        if jsonb_array_length(v_lab_ids) = 0 then
          v_falta_lab := format(
            'O laboratório %s não tem coordenação cadastrada. O pedido não segue: peça ao Administrador para indicar o coordenador em Cadastros > Laboratórios e áreas.',
            v_area_nome);
        else
          v_laboratorio := jsonb_build_object(
            'area_id', p_area_id,
            'area', v_area_nome,
            'nome', coalesce(v_lab_nome, v_sub_nome),
            'substituto_nome', case when v_lab_nome is not null then v_sub_nome end,
            'ids', v_lab_ids);
        end if;
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'coordenador', v_coordenador,
    'falta_coordenador', v_falta,
    'laboratorio_exigido', v_lab_exigido,
    'laboratorio', v_laboratorio,
    'falta_laboratorio', v_falta_lab);
end $function$;

revoke all on function kontrol_private.aprovadores_pedido(bigint, text, bigint) from public, anon;
grant execute on function kontrol_private.aprovadores_pedido(bigint, text, bigint) to authenticated, service_role;

-- Leitura para a tela: só devolve algo para quem enxerga o pedido (RLS).
create or replace function public.aprovadores_pedido_interno(p_pedido_id bigint)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_projeto_id bigint;
  v_natureza text;
  v_area_id bigint;
begin
  select pi.projeto_id, pi.natureza, pi.area_id
    into v_projeto_id, v_natureza, v_area_id
    from public.pedidos_internos pi where pi.id = p_pedido_id;
  if not found then
    return null;
  end if;
  return kontrol_private.aprovadores_pedido(v_projeto_id, v_natureza, v_area_id);
end $function$;

revoke all on function public.aprovadores_pedido_interno(bigint) from public, anon;
grant execute on function public.aprovadores_pedido_interno(bigint) to authenticated, service_role;

-- ---- 4. O banco exige a competência em cada passagem ---------------------------
-- SECURITY INVOKER de propósito: current_user = 'authenticated' identifica a
-- alteração direta pela API (dentro das RPCs, current_user é o dono).
create or replace function kontrol_private.exigir_competencia_pedido()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_ap jsonb;
begin
  if current_user = 'authenticated' and (
       new.aprovacao_area_em is distinct from old.aprovacao_area_em
       or new.aprovacao_area_por is distinct from old.aprovacao_area_por) then
    raise exception 'A aprovação da coordenação do laboratório só é registrada pelo botão do pedido.'
      using errcode = '42501';
  end if;

  if current_user = 'authenticated'
     and old.status not in ('rascunho', 'ajuste_solicitante', 'ajuste_compras')
     and (new.area_id is distinct from old.area_id
          or new.natureza is distinct from old.natureza
          or new.projeto_id is distinct from old.projeto_id) then
    raise exception 'Projeto, tipo de material e laboratório só mudam com o pedido em rascunho ou devolvido para ajuste.'
      using errcode = '42501';
  end if;

  if new.status is not distinct from old.status then
    return new;
  end if;

  -- Envio para validação: precisa haver quem valide (e, para material de
  -- consumo de laboratório, quem aprove pelo laboratório).
  if new.status = 'em_validacao' then
    if v_uid is not null then
      v_ap := kontrol_private.aprovadores_pedido(new.projeto_id, new.natureza, new.area_id);
      if v_ap ->> 'falta_coordenador' is not null then
        raise exception '%', v_ap ->> 'falta_coordenador' using errcode = '22023';
      end if;
      if v_ap ->> 'falta_laboratorio' is not null then
        raise exception '%', v_ap ->> 'falta_laboratorio' using errcode = '22023';
      end if;
    end if;
    -- cada envio pede a aprovação do laboratório de novo
    new.aprovacao_area_em := null;
    new.aprovacao_area_por := null;
    return new;
  end if;

  -- Validação: só o coordenador competente, ou o Administrador como substituto.
  if old.status = 'em_validacao' and new.status = 'validado' and v_uid is not null then
    v_ap := kontrol_private.aprovadores_pedido(new.projeto_id, new.natureza, new.area_id);
    if v_ap ->> 'falta_coordenador' is not null and coalesce(public.current_papel(), '') <> 'admin' then
      raise exception '%', v_ap ->> 'falta_coordenador' using errcode = '22023';
    end if;
    if coalesce(public.current_papel(), '') <> 'admin'
       and not coalesce((v_ap -> 'coordenador' -> 'ids') ? v_uid::text, false) then
      raise exception 'Este pedido é validado por % (%). Na ausência, o Administrador valida como substituto.',
        coalesce(v_ap -> 'coordenador' ->> 'nome', 'quem coordena'),
        coalesce(v_ap -> 'coordenador' ->> 'rotulo', 'coordenador competente')
        using errcode = '42501';
    end if;
    return new;
  end if;

  -- Material de consumo de laboratório não segue para compras sem a
  -- coordenação do laboratório.
  if old.status = 'validado'
     and new.status not in ('ajuste_solicitante', 'cancelado')
     and coalesce(new.natureza, '') = 'material_consumo_lab'
     and new.aprovacao_area_em is null then
    raise exception 'Material de consumo de laboratório precisa da aprovação da coordenação do laboratório antes de seguir para compras.'
      using errcode = '42501';
  end if;

  return new;
end $function$;

revoke all on function kontrol_private.exigir_competencia_pedido() from public, anon;

drop trigger if exists pedidos_internos_exigir_competencia on public.pedidos_internos;
create trigger pedidos_internos_exigir_competencia
  before update on public.pedidos_internos
  for each row execute function kontrol_private.exigir_competencia_pedido();

-- ---- 5. Decisão da coordenação do laboratório -----------------------------------
create or replace function public.decidir_coordenacao_laboratorio(
  p_pedido_id bigint,
  p_decisao text,
  p_observacao text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_papel text := public.current_papel();
  v_status text;
  v_natureza text;
  v_area_id bigint;
  v_projeto_id bigint;
  v_aprovado_em timestamptz;
  v_ap jsonb;
  v_obs text := nullif(btrim(coalesce(p_observacao, '')), '');
begin
  if v_uid is null then
    raise exception 'Entre no Kontrol para registrar a decisão.' using errcode = '42501';
  end if;
  begin
    v_email := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email';
  exception when others then
    v_email := null;
  end;
  if p_decisao is null or p_decisao not in ('aprovado', 'devolvido') then
    raise exception 'Decisão inválida: use aprovar ou devolver.' using errcode = '22023';
  end if;

  select pi.status, pi.natureza, pi.area_id, pi.projeto_id, pi.aprovacao_area_em
    into v_status, v_natureza, v_area_id, v_projeto_id, v_aprovado_em
    from public.pedidos_internos pi
   where pi.id = p_pedido_id
   for update;
  if not found then
    raise exception 'Pedido interno não encontrado.' using errcode = 'P0002';
  end if;
  if v_status <> 'validado' or coalesce(v_natureza, '') <> 'material_consumo_lab' then
    raise exception 'Este pedido não está aguardando a coordenação do laboratório.' using errcode = '22023';
  end if;
  if v_aprovado_em is not null then
    raise exception 'A coordenação do laboratório já aprovou este pedido.' using errcode = '22023';
  end if;

  v_ap := kontrol_private.aprovadores_pedido(v_projeto_id, v_natureza, v_area_id);
  if v_ap ->> 'falta_laboratorio' is not null and coalesce(v_papel, '') <> 'admin' then
    raise exception '%', v_ap ->> 'falta_laboratorio' using errcode = '22023';
  end if;
  if coalesce(v_papel, '') <> 'admin'
     and not coalesce((v_ap -> 'laboratorio' -> 'ids') ? v_uid::text, false) then
    raise exception 'Esta etapa é da coordenação do laboratório % (%). Na ausência, o substituto cadastrado ou o Administrador decide.',
      coalesce(v_ap -> 'laboratorio' ->> 'area', ''), coalesce(v_ap -> 'laboratorio' ->> 'nome', 'sem coordenador')
      using errcode = '42501';
  end if;
  if p_decisao = 'devolvido' and v_obs is null then
    raise exception 'Escreva o motivo da devolução.' using errcode = '22023';
  end if;

  if p_decisao = 'aprovado' then
    update public.pedidos_internos
       set aprovacao_area_em = now(), aprovacao_area_por = coalesce(v_email, v_uid::text)
     where id = p_pedido_id;
    insert into public.pedidos_internos_aprovacoes (
      pedido_interno_id, etapa, decisao, responsavel, papel, comentario, status_origem, status_destino)
    values (p_pedido_id, 'Aprovação da coordenação do laboratório', 'aprovado', v_email, v_papel, v_obs,
            'validado', 'validado');
  else
    perform set_config('app.pedido_interno_transicao', 'permitida', true);
    update public.pedidos_internos set status = 'ajuste_solicitante' where id = p_pedido_id;
    perform set_config('app.pedido_interno_transicao', '', true);
    insert into public.pedidos_internos_aprovacoes (
      pedido_interno_id, etapa, decisao, responsavel, papel, comentario, status_origem, status_destino)
    values (p_pedido_id, 'Aprovação da coordenação do laboratório', 'devolvido', v_email, v_papel, v_obs,
            'validado', 'ajuste_solicitante');
    insert into public.eventos_status (entidade, entidade_id, de_status, para_status, usuario, observacao)
    values ('pedido_interno', p_pedido_id, 'validado', 'ajuste_solicitante', v_email, v_obs);
  end if;

  return jsonb_build_object('pedido_id', p_pedido_id, 'decisao', p_decisao);
end $function$;

revoke all on function public.decidir_coordenacao_laboratorio(bigint, text, text) from public, anon;
grant execute on function public.decidir_coordenacao_laboratorio(bigint, text, text) to authenticated;

-- ---- 6. Avisos: Supervisão e coordenação do laboratório -------------------------
-- Mesma função da 0136, com duas mudanças nos pedidos internos:
--   * em_validacao sem projeto: o aviso vai para a Supervisão;
--   * validado de material de consumo de laboratório: aviso para a coordenação
--     do laboratório (ou para quem tem "Aprovar pedidos internos", se faltar).
create or replace function kontrol_private.avisar_passagem_etapa()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_coluna text := coalesce(nullif(tg_argv[0], ''), 'status');
  v_novo_reg jsonb := to_jsonb(new);
  v_novo text;
  v_antigo text;
  v_id bigint := (to_jsonb(new) ->> 'id')::bigint;
  v_permissao text;
  v_titulo text;
  v_corpo text;
  v_entidade_tipo text;
  v_entidade_id bigint := (to_jsonb(new) ->> 'id')::bigint;
  v_chave text;
  v_rotulo text;
  v_usuario uuid;
begin
  v_novo := v_novo_reg ->> v_coluna;
  if tg_op = 'UPDATE' then
    v_antigo := to_jsonb(old) ->> v_coluna;
  end if;
  if v_novo is null or v_novo is not distinct from v_antigo then
    return null;
  end if;
  v_chave := format('etapa:%s:%s:%s:%s', tg_table_name, v_id, v_novo,
    (extract(epoch from clock_timestamp()) * 1000)::bigint);

  if tg_table_name = 'pedidos_internos' and v_novo = 'em_validacao' then
    -- 0136 (D3): coordenador do projeto; 0169: sem projeto, a Supervisão.
    if nullif(v_novo_reg ->> 'projeto_id', '') is not null then
      select coordenador_id into v_usuario
        from public.projetos where id = (v_novo_reg ->> 'projeto_id')::bigint;
    else
      select pf.id into v_usuario
        from public.perfis pf
       where pf.papel = 'supervisor' and not coalesce(pf.suspenso, false)
       order by coalesce(pf.nome, pf.email)
       limit 1;
    end if;
    v_permissao := case when v_usuario is null then 'pedido.aprovar' end;
    v_titulo := 'Pedido interno aguardando validação';
    v_corpo := format('Pedido interno #%s: %s. Solicitante: %s.', v_id,
      coalesce(v_novo_reg ->> 'titulo', 'sem título'), coalesce(v_novo_reg ->> 'solicitante', '—'));
    v_entidade_tipo := 'pedido_interno';
  elsif tg_table_name = 'pedidos_internos' and v_novo = 'validado'
        and coalesce(v_novo_reg ->> 'natureza', '') = 'material_consumo_lab' then
    select c.coordenador_id, c.nome into v_usuario, v_rotulo
      from public.coordenacoes_area c
     where c.id = nullif(v_novo_reg ->> 'area_id', '')::bigint;
    v_permissao := case when v_usuario is null then 'pedido.aprovar' end;
    v_titulo := 'Pedido interno aguardando a coordenação do laboratório';
    v_corpo := format('Pedido interno #%s: %s. Laboratório: %s. O coordenador do projeto já validou.', v_id,
      coalesce(v_novo_reg ->> 'titulo', 'sem título'), coalesce(v_rotulo, 'não informado'));
    v_entidade_tipo := 'pedido_interno';
  elsif tg_table_name = 'pedidos_compra' and v_novo = 'solicitado' then
    v_permissao := 'compras.aprovar';
    v_titulo := 'Compra aguardando aprovação';
    v_corpo := format('Compra #%s solicitada%s.', v_id,
      coalesce(' para ' || nullif(v_novo_reg ->> 'projeto', ''), ''));
    v_entidade_tipo := 'pedido_compra';
  elsif tg_table_name = 'pedidos_compra' and v_novo in ('aprovado', 'enviado') then
    v_permissao := 'compras.receber';
    v_titulo := case v_novo when 'aprovado' then 'Compra aprovada: acompanhe até o recebimento'
      else 'Compra enviada: prepare o recebimento' end;
    v_corpo := format('Compra #%s está %s.', v_id, case v_novo when 'aprovado' then 'aprovada' else 'enviada' end);
    v_entidade_tipo := 'pedido_compra';
  elsif tg_table_name = 'lotes_estoque' and v_novo = 'quarentena' then
    v_permissao := 'estoque.lote.aceitar';
    select especificacao into v_rotulo from public.insumos where id = (v_novo_reg ->> 'insumo_id')::bigint;
    v_titulo := 'Lote em quarentena aguardando aceite';
    v_corpo := format('Lote %s de %s aguarda conferência e aceite.',
      coalesce(v_novo_reg ->> 'codigo_lote', '#' || v_id), coalesce(v_rotulo, 'insumo'));
    v_entidade_tipo := 'lote';
    v_chave := format('etapa:lotes_estoque:%s:quarentena', v_id);
  elsif tg_table_name = 'orcamentos' and v_novo = 'revisado' then
    v_permissao := 'orcamentos.emitir';
    v_titulo := 'Módulo laboratorial revisado: proposta pronta para emissão';
    v_corpo := format('O orçamento de análises #%s foi revisado.', v_id);
    if v_novo_reg ->> 'demanda_id' is not null then
      v_entidade_tipo := 'demanda';
      v_entidade_id := (v_novo_reg ->> 'demanda_id')::bigint;
    else
      v_entidade_tipo := 'orcamento';
    end if;
  elsif tg_table_name = 'orcamento_projetos' and v_novo = 'enviado' then
    v_permissao := 'orcamentos.emitir';
    v_titulo := 'Custos de projeto revisados: proposta pronta para emissão';
    v_corpo := format('Os custos de projeto #%s foram revisados.', v_id);
    if v_novo_reg ->> 'demanda_id' is not null then
      v_entidade_tipo := 'demanda';
      v_entidade_id := (v_novo_reg ->> 'demanda_id')::bigint;
    else
      v_entidade_tipo := 'orcamento_projeto';
    end if;
  else
    return null;
  end if;

  begin
    insert into public.notificacoes (tipo, titulo, corpo, entidade_tipo, entidade_id, permissao_destino, usuario_destino, dedupe_key)
    values ('aprovacao_pendente', v_titulo, v_corpo, v_entidade_tipo, v_entidade_id, v_permissao, v_usuario, v_chave)
    on conflict do nothing;
  exception when others then
    raise warning 'Kontrol: aviso de etapa não gravado (% #%): %', tg_table_name, v_id, sqlerrm;
  end;
  return null;
end $function$;

revoke all on function kontrol_private.avisar_passagem_etapa() from public, anon, authenticated;

notify pgrst, 'reload schema';

commit;
