-- ORD88: autorização por função; sem copiar concessões ou apagar JSON legado.
-- Ativação requer o consumidor da RPC, reconciliação dos vínculos e gate de RLS.
begin;
set local lock_timeout = '5s';

do $$
begin
  if not exists (select 1 from pg_catalog.pg_trigger
                 where tgrelid = 'public.perfis'::regclass and tgname = 'aud_perfis'
                   and tgenabled in ('O','A') and not tgisinternal) then
    raise exception '0151 exige o gatilho de auditoria aud_perfis ativo.';
  end if;
end $$;

alter table public.perfis drop constraint perfis_papel_check,
  add constraint perfis_papel_check check (papel in
    ('laboratorio','compra','cadastro','gestor','coordenador','supervisor','admin'));
alter table public.usuarios_pre_aprovados drop constraint usuarios_pre_aprovados_papel_check,
  add constraint usuarios_pre_aprovados_papel_check check (papel in
    ('laboratorio','compra','cadastro','gestor','coordenador','supervisor','admin'));
alter table public.permissoes_categorias drop constraint permissoes_categorias_papel_check,
  add constraint permissoes_categorias_papel_check check (papel in
    ('laboratorio','compra','cadastro','gestor','coordenador','supervisor','admin'));

-- A categoria nasce vazia; escopo geral não equivale a privilégios de Admin.
insert into public.permissoes_categorias(papel, permissoes)
values ('supervisor', '{}'::jsonb) on conflict (papel) do nothing;

create function kontrol_private.papel_catalogado(p_papel text)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(p_papel in
    ('laboratorio','compra','cadastro','gestor','coordenador','supervisor','admin'), false);
$$;

-- Não reordenar nivel_papel: ele ainda é usado por guardas legadas de
-- outras operações. Na nomeação, a posição dos operacionais não foi decidida.
create function kontrol_private.nivel_nomeacao(p_papel text)
returns integer language sql immutable set search_path = '' as $$
  select case p_papel
    when 'admin' then 4 when 'supervisor' then 3 when 'coordenador' then 2
    when 'gestor' then 1 end;
$$;

create function kontrol_private.chave_permissao_conhecida(p_chave text)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(p_chave = any(array[
    'analises.editar','analises.ver','auditoria.visualizar','backups.gerenciar',
    'cadastros.editar','cadastros.ver','compras.aprovar','compras.cancelar',
    'compras.receber','compras.solicitar','compras.ver','configuracoes.ver',
    'custeio.ver','estoque.descartar_bloquear','estoque.lote.aceitar',
    'estoque.lote.gerir','estoque.movimentar','estoque.ver','insumos.editar',
    'insumos.excluir_em_cascata','insumos.ver','orcamento.parametros.editar',
    'orcamentos.cancelar','orcamentos.criar_editar','orcamentos.emitir',
    'orcamentos.fundos','orcamentos.modelos','orcamentos.pessoal',
    'orcamentos.visualizar','pedido.aprovar','pedido.criar','pedido.ver',
    'planejamento.editar','planejamento.executar','planejamento.ver',
    'privilegios.gerenciar','projetos.editar','projetos.ver','recebimento.registrar',
    'recebimento.ver','tecnicos.salario.ver','usuarios.gerenciar'
  ]::text[]), false);
$$;

create or replace function kontrol_private.tem_permissao_do_usuario(p_user uuid, p_chave text)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((
    select p.papel = 'admin' or c.permissoes -> p_chave = 'true'::jsonb
    from public.perfis p
    left join public.permissoes_categorias c on c.papel = p.papel
    where p.id = p_user and not p.suspenso and not p.senha_provisoria
      and kontrol_private.papel_catalogado(p.papel)
      and kontrol_private.chave_permissao_conhecida(p_chave)
  ), false);
$$;

create or replace function kontrol_private.tem_permissao_efetiva(p_chave text)
returns boolean language sql stable security definer set search_path = '' as $$
  select kontrol_private.tem_permissao_do_usuario(auth.uid(), p_chave);
$$;

create or replace function public.minhas_permissoes()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce((
    select case
      when p.senha_provisoria then '{"admin":false,"permissoes":{},"senha_provisoria":true}'::jsonb
      when p.papel = 'admin' then '{"admin":true,"permissoes":{}}'::jsonb
      else pg_catalog.jsonb_build_object('admin', false, 'permissoes', coalesce((
        select pg_catalog.jsonb_object_agg(e.key, e.value)
        from pg_catalog.jsonb_each(case when pg_catalog.jsonb_typeof(c.permissoes) = 'object'
          then c.permissoes else '{}'::jsonb end) e
        where kontrol_private.chave_permissao_conhecida(e.key)
          and pg_catalog.jsonb_typeof(e.value) = 'boolean'
      ), '{}'::jsonb))
    end
    from public.perfis p
    left join public.permissoes_categorias c on c.papel = p.papel
    where p.id = auth.uid() and not p.suspenso
      and kontrol_private.papel_catalogado(p.papel)
  ), '{"admin":false,"permissoes":{}}'::jsonb);
$$;

create or replace function kontrol_private.pode_editar_cadastro(p_chave text)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(p_chave in ('projetos.editar','insumos.editar','cadastros.editar'), false)
    and kontrol_private.tem_permissao_efetiva(p_chave);
$$;

-- Vínculos explícitos, sem inferir membresia de e-mail/nome ou preenchê-la
-- no legado. Coordenador_id continua sendo vínculo existente e autoritativo.
create table kontrol_private.projetos_vinculos (
  projeto_id bigint not null references public.projetos(id) on delete cascade,
  usuario_id uuid not null references public.perfis(id) on delete cascade,
  primary key (projeto_id, usuario_id)
);
alter table kontrol_private.projetos_vinculos enable row level security;
revoke all on table kontrol_private.projetos_vinculos from public, anon, authenticated, service_role;

create function kontrol_private.projeto_no_escopo(p_projeto_id bigint)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((
    select case
      when p.papel in ('admin','supervisor') then true
      when p.papel in ('coordenador','gestor') then
        exists (select 1 from kontrol_private.projetos_vinculos v
                where v.projeto_id = p_projeto_id and v.usuario_id = p.id)
        or (p.papel = 'coordenador' and exists (
          select 1 from public.projetos pr where pr.id = p_projeto_id and pr.coordenador_id = p.id
        ))
      -- Preservar o escopo legado dos operacionais; não conceder chave.
      when p.papel in ('laboratorio','compra','cadastro') then true
      else false
    end
    from public.perfis p where p.id = auth.uid() and not p.suspenso and not p.senha_provisoria
  ), false);
$$;

create policy projetos_funcao_leitura on public.projetos as restrictive
  for select to authenticated using (
    kontrol_private.tem_permissao_efetiva('projetos.ver')
    and kontrol_private.projeto_no_escopo(id));
create policy projetos_funcao_escrita on public.projetos as restrictive
  for all to authenticated using (
    kontrol_private.projeto_no_escopo(id)
  ) with check (
    kontrol_private.tem_permissao_efetiva('projetos.editar')
    and kontrol_private.projeto_no_escopo(id));
-- DELETE não tem WITH CHECK; manter exigência explícita mesmo se houver
-- uma policy permissiva histórica.
create policy projetos_funcao_exclusao on public.projetos as restrictive
  for delete to authenticated using (kontrol_private.tem_permissao_efetiva('projetos.editar'));

-- O vínculo não pode ser fabricado por edição comum do projeto.
create function kontrol_private.proteger_coordenador_projeto()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (case when tg_op = 'INSERT' then new.coordenador_id is not null
           else new.coordenador_id is distinct from old.coordenador_id end)
     and (auth.uid() is not null or current_user in ('anon','authenticated','service_role'))
     and public.current_papel() is distinct from 'admin' then
    raise exception 'Somente Administrador altera o vínculo de coordenação.' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger kontrol_proteger_coordenador_projeto
  before insert or update of coordenador_id on public.projetos
  for each row execute function kontrol_private.proteger_coordenador_projeto();

-- Mesmo recorte em tabelas de acesso direto que carregam projeto_id.
-- Registros sem projeto conservam a regra preexistente; estoque compartilhado
-- (lotes, movimentos e saldo) não recebe filtro por projeto.
do $$
declare v_table text;
begin
  foreach v_table in array array[
    'demandas_propostas','orcamentos','orcamento_projetos','planejamento',
    'pedidos_internos','pedidos_compra','equipamento_reservas'
  ] loop
    execute pg_catalog.format(
      'create policy projeto_vinculado_0151 on public.%I as restrictive for all to authenticated
       using (projeto_id is null or kontrol_private.projeto_no_escopo(projeto_id))
       with check (projeto_id is null or kontrol_private.projeto_no_escopo(projeto_id))',
       v_table);
  end loop;
end $$;

-- ponytail: um lock transacional de nomeações. Ele serializa também remoções
-- de Admin ativo; sem snapshot antigo que possa mascarar o último Admin.
create function kontrol_private.serializar_nomeacao()
returns void language plpgsql set search_path = '' as $$
begin
  if pg_catalog.current_setting('transaction_isolation') not in ('read committed','read uncommitted') then
    raise exception 'Nomeação exige leitura atual do catálogo.' using errcode = '25000';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(151, 1907);
end $$;

create function kontrol_private.exigir_sessao_nomeacao()
returns uuid language plpgsql set search_path = '' as $$
declare
  v_ator uuid := auth.uid();
  v_sessao text := auth.jwt() ->> 'session_id';
begin
  if v_ator is null or auth.jwt() ->> 'role' is distinct from 'authenticated'
     or v_sessao is null or v_sessao !~ '^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$' then
    raise exception 'Sessão de nomeação inválida.' using errcode = '42501';
  end if;
  if not exists (
    select 1 from auth.sessions s where s.id = v_sessao::uuid and s.user_id = v_ator
      and (s.not_after is null or s.not_after > pg_catalog.now())
  ) then
    raise exception 'Sessão de nomeação inválida.' using errcode = '42501';
  end if;
  return v_ator;
end $$;

-- Admin gerencia somente o vínculo explícito, não muda o papel do alvo ou
-- o vínculo de coordenação canônico (projetos.coordenador_id).
create function public.configurar_vinculo_projeto(
  p_projeto_id bigint, p_usuario_id uuid, p_vinculado boolean
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_ator uuid := kontrol_private.exigir_sessao_nomeacao();
  v_email text;
  v_papel text;
  v_coordenador uuid;
  v_alterado boolean;
  v_trilha jsonb;
begin
  if p_projeto_id is null or p_projeto_id <= 0 or p_usuario_id is null or p_vinculado is null then
    raise exception 'Informe projeto, usuário e estado do vínculo.' using errcode = '22023';
  end if;
  perform kontrol_private.serializar_nomeacao();
  select coalesce(p.email,p.id::text) into v_email from public.perfis p
    where p.id = v_ator and p.papel = 'admin' and not p.suspenso and not p.senha_provisoria for update;
  if not found then
    raise exception 'Somente Administrador pode configurar o vínculo.' using errcode = '42501';
  end if;
  select p.papel into v_papel from public.perfis p where p.id = p_usuario_id for update;
  if not found then raise exception 'Perfil de destino não encontrado.' using errcode = 'P0002'; end if;
  select p.coordenador_id into v_coordenador from public.projetos p where p.id = p_projeto_id for update;
  if not found then raise exception 'Projeto não encontrado.' using errcode = 'P0002'; end if;
  if p_vinculado and v_papel not in ('coordenador','gestor') then
    raise exception 'Vínculo explícito exige Coordenador ou Gestor.' using errcode = '22023';
  end if;
  if p_vinculado then
    insert into kontrol_private.projetos_vinculos(projeto_id,usuario_id)
    values (p_projeto_id,p_usuario_id) on conflict do nothing;
    v_alterado := found;
  else
    delete from kontrol_private.projetos_vinculos
    where projeto_id = p_projeto_id and usuario_id = p_usuario_id;
    v_alterado := found;
  end if;
  if v_alterado then
    v_trilha := pg_catalog.jsonb_build_object('projeto_id',p_projeto_id,'usuario_id',p_usuario_id,'ator_id',v_ator);
    insert into public.auditoria(tabela,registro_id,acao,valor_anterior,valor_novo,usuario)
    values ('projetos_vinculos',p_projeto_id::text || ':' || p_usuario_id::text,
      case when p_vinculado then 'insert' else 'delete' end,
      case when not p_vinculado then v_trilha end,
      case when p_vinculado then v_trilha end, v_email);
  end if;
  return pg_catalog.jsonb_build_object('projeto_id',p_projeto_id,'usuario_id',p_usuario_id,
    'vinculado',p_vinculado,'alterado',v_alterado,
    'coordenacao_direta',coalesce(v_papel='coordenador' and v_coordenador=p_usuario_id,false));
end $$;

create function public.nomear_papel_usuario(
  p_usuario_id uuid, p_papel_atual_esperado text, p_papel_destino text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_ator uuid := kontrol_private.exigir_sessao_nomeacao();
  v_papel_ator text;
  v_papel_alvo text;
  v_marcador text;
begin
  if p_usuario_id is null or v_ator = p_usuario_id then
    raise exception 'Não é permitido alterar a própria função.' using errcode = '42501';
  end if;
  if not kontrol_private.papel_catalogado(p_papel_atual_esperado)
     or not kontrol_private.papel_catalogado(p_papel_destino) then
    raise exception 'Função inválida.' using errcode = '22023';
  end if;

  perform kontrol_private.serializar_nomeacao();
  select papel into v_papel_ator from public.perfis
    where id = v_ator and not suspenso and not senha_provisoria for update;
  if not found or v_papel_ator not in ('admin','supervisor','coordenador') then
    raise exception 'Nomeação não autorizada.' using errcode = '42501';
  end if;
  select papel into v_papel_alvo from public.perfis where id = p_usuario_id for update;
  if not found then
    raise exception 'Perfil de destino não encontrado.' using errcode = 'P0002';
  end if;
  if v_papel_ator <> 'admin' and not coalesce(
    kontrol_private.nivel_nomeacao(v_papel_alvo) < kontrol_private.nivel_nomeacao(v_papel_ator)
    and kontrol_private.nivel_nomeacao(p_papel_destino) < kontrol_private.nivel_nomeacao(v_papel_ator),
    false
  ) then
    raise exception 'Nomeação não autorizada para função atual ou de destino.' using errcode = '42501';
  end if;
  if v_papel_alvo is distinct from p_papel_atual_esperado then
    raise exception 'Papel atual diverge; recarregue o perfil.' using errcode = '40001';
  end if;
  if v_papel_alvo = p_papel_destino then
    return pg_catalog.jsonb_build_object('usuario_id', p_usuario_id, 'papel', v_papel_alvo, 'alterado', false);
  end if;

  v_marcador := pg_catalog.current_setting('app.nomeacao_papel', true);
  perform pg_catalog.set_config('app.nomeacao_papel', 'permitida', true);
  update public.perfis set papel = p_papel_destino where id = p_usuario_id;
  perform pg_catalog.set_config('app.nomeacao_papel', coalesce(v_marcador, ''), true);
  -- aud_perfis (0128) registra o UPDATE na mesma transação.
  return pg_catalog.jsonb_build_object('usuario_id', p_usuario_id, 'papel', p_papel_destino, 'alterado', true);
end $$;

create function kontrol_private.proteger_papel_perfil()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.papel is distinct from 'laboratorio' or new.permissoes is distinct from '{}'::jsonb then
      raise exception 'Perfis novos começam sem nomeação ou exceção.' using errcode = '42501';
    end if;
  else
    if new.id is distinct from old.id or new.permissoes is distinct from old.permissoes then
      raise exception 'Identidade e exceções legadas do perfil não podem ser regravadas.' using errcode = '42501';
    end if;
    if new.papel is distinct from old.papel and (
      pg_catalog.current_setting('app.nomeacao_papel', true) is distinct from 'permitida'
      or not public.fn_marcador_transacional_autorizado(
        array['public.nomear_papel_usuario(uuid,text,text)'::regprocedure])
    ) then
      raise exception 'Função só muda por nomeação transacional.' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
create trigger kontrol_proteger_papel_perfil before insert or update on public.perfis
  for each row execute function kontrol_private.proteger_papel_perfil();

-- Lock no início da instrução, antes das linhas: ordena suspensão, senha,
-- exclusão e nomeação pelo mesmo lock, sem conceder acesso a essas operações.
create function kontrol_private.serializar_mutacao_admin()
returns trigger language plpgsql set search_path = '' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(151, 1907);
  return null;
end $$;
create trigger kontrol_serializar_mutacao_admin
  before update of papel, suspenso, senha_provisoria or delete on public.perfis
  for each statement execute function kontrol_private.serializar_mutacao_admin();

-- Só Admin efetivamente apto conta como alternativa.
create function kontrol_private.proteger_ultimo_admin()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.papel = 'admin' and not old.suspenso and not old.senha_provisoria and
     (tg_op = 'DELETE' or new.papel is distinct from 'admin' or new.suspenso or new.senha_provisoria) then
    perform kontrol_private.serializar_nomeacao();
    if not exists (
      select 1 from public.perfis p where p.id <> old.id and p.papel = 'admin'
        and not p.suspenso and not p.senha_provisoria
    ) then
      raise exception 'Não é permitido remover o último Administrador ativo.' using errcode = '42501';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
create trigger kontrol_proteger_ultimo_admin before update of papel, suspenso, senha_provisoria or delete on public.perfis
  for each row execute function kontrol_private.proteger_ultimo_admin();
revoke truncate on public.perfis from public, anon, authenticated, service_role;

-- Compra agrupada, direta ou sucessora de pendência: cada projeto
-- explicitamente ligado na origem canônica deve estar no escopo do ator.
-- Sem projeto em toda a cadeia não cria escopo: segue só a guarda legada
-- de permissão e as transições da 0136. Não usar o texto "projeto" ou e-mail.
create function kontrol_private.exigir_escopo_compra_0151(p_pedido_id bigint)
returns void language plpgsql set search_path = '' as $$
begin
  if exists (
    with recursive compras as (
      select c.id,c.compra_origem_id,c.projeto_id
        from public.pedidos_compra c where c.id = p_pedido_id
      union
      select c.id,c.compra_origem_id,c.projeto_id
        from public.pedidos_compra c join compras a on a.compra_origem_id = c.id
    ), internos as (
      select p.id,p.projeto_id,p.planejamento_id from public.pedidos_internos p
      join compras c on c.id = p.pedido_compra_id
      union
      select p.id,p.projeto_id,p.planejamento_id from compras c
      join public.pedidos_compra_itens i on i.pedido_id = c.id
      join public.pedidos_internos_itens ii on ii.id = i.pedido_interno_item_id
      join public.pedidos_internos p on p.id = ii.pedido_interno_id
    ), projetos as (
      select projeto_id from compras
      union select projeto_id from internos
      union select pl.projeto_id from public.planejamento pl
        join internos i on i.planejamento_id = pl.id
    )
    select 1 from projetos pr where pr.projeto_id is not null
      and not kontrol_private.projeto_no_escopo(pr.projeto_id)
  ) then
    raise exception 'Compra fora do escopo de projetos desta sessão.' using errcode = '42501';
  end if;
end $$;

CREATE OR REPLACE FUNCTION public.transicionar_pedido_compra(p_pedido_id bigint, p_status_destino text, p_observacao text DEFAULT NULL::text, p_data_prevista_entrega date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_pedido record;
  v_claims jsonb;
  v_ator text;
  v_tem_recebimento boolean;
  v_interno bigint;
  v_internos bigint[];
  v_tudo_recebido boolean;
  v_bloqueio record;
begin
  perform kontrol_private.exigir_permissao(case when p_status_destino = 'cancelado' then 'compras.cancelar' else 'compras.aprovar' end);

  v_claims := coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
  v_ator := coalesce(nullif(v_claims->>'email', ''), nullif(v_claims->>'sub', ''));
  if v_ator is null then
    raise exception 'Contexto JWT do ator e obrigatorio para transicionar a compra.' using errcode = '42501';
  end if;

  select id, status, solicitante, projeto_id
    into v_pedido
  from public.pedidos_compra
  where id = p_pedido_id
  for update;

  if not found then
    raise exception 'Pedido de compra nao encontrado.' using errcode = 'P0002';
  end if;

  perform kontrol_private.exigir_escopo_compra_0151(p_pedido_id);

  -- 0136 (D2): quem pediu a compra não a aprova, salvo o coordenador do projeto (ou admin).
  if p_status_destino = 'aprovado'
     and not kontrol_private.pode_decidir_proprio_pedido(v_pedido.solicitante, v_pedido.projeto_id) then
    raise exception 'Quem pediu a compra não pode aprová-la. Peça ao coordenador do projeto ou a outra pessoa com a permissão.'
      using errcode = '42501';
  end if;

  if not (
    (v_pedido.status = 'solicitado' and p_status_destino = 'aprovado') or
    (v_pedido.status = 'aprovado' and p_status_destino = 'enviado') or
    (v_pedido.status = 'enviado' and p_status_destino = 'em_transito') or
    (v_pedido.status in ('solicitado', 'aprovado', 'enviado', 'em_transito') and p_status_destino = 'cancelado') or
    (v_pedido.status in ('aprovado', 'enviado', 'em_transito') and p_status_destino = 'recebido')
  ) then
    raise exception 'Transicao de status nao permitida: % -> %.', v_pedido.status, p_status_destino
      using errcode = '22023';
  end if;

  -- 0130 (D1): compra que nasceu de pedido interno só anda depois que o pedido
  -- chega a "Aprovado para compra". Compra sem pedido interno (rascunho de
  -- reposição, compra criada em Compras, pendência de outra compra) segue a
  -- regra própria: basta a permissão de aprovar compras.
  if p_status_destino in ('aprovado', 'enviado', 'em_transito') then
    select pi.id, pi.status into v_bloqueio
    from public.pedidos_internos pi
    where pi.status <> 'cancelado'
      and (pi.pedido_compra_id = p_pedido_id
           or exists (
             select 1
             from public.pedidos_compra_itens ci
             join public.pedidos_internos_itens pii on pii.id = ci.pedido_interno_item_id
             where ci.pedido_id = p_pedido_id and pii.pedido_interno_id = pi.id))
      and pi.status not in ('aprovado_para_compra', 'compra_fechada', 'encaminhado_instituicao',
                            'aguardando_pagamento_nf', 'compra_concluida')
    order by pi.id
    limit 1;
    if found then
      raise exception 'Esta compra vem do pedido interno #%, que está em "%". Ela só pode ser aprovada ou enviada depois que o pedido chegar a "Aprovado para compra".',
        v_bloqueio.id, kontrol_private.rotulo_status_pedido_interno(v_bloqueio.status)
        using errcode = '22023';
    end if;
  end if;

  -- 0130: encerrar com pendência exige destino para o que faltou; só a RPC
  -- encerrar_compra_com_pendencia chega aqui com essa marca.
  if p_status_destino = 'recebido'
     and coalesce(current_setting('app.encerramento_com_destino', true), '') <> 'sim' then
    raise exception 'Para encerrar a compra com pendência, use "Encerrar com pendência" e escolha o destino do que faltou.'
      using errcode = '22023';
  end if;

  select exists (
      select 1
      from public.pedidos_compra_item_recebimentos r
      where r.pedido_compra_id = p_pedido_id
        and r.estornado_em is null
        and r.quantidade > 0
    ) or exists (
      select 1
      from public.pedidos_internos_item_recebimentos r
      join public.pedidos_compra_itens i on i.id = r.pedido_compra_item_id
      where i.pedido_id = p_pedido_id
        and r.estornado_em is null
        and r.quantidade > 0
    ) or exists (
      select 1 from public.pedidos_compra_itens
      where pedido_id = p_pedido_id and lote_id is not null
    )
    into v_tem_recebimento;

  if p_status_destino = 'cancelado' and v_tem_recebimento then
    raise exception 'Pedido com recebimento parcial ou total nao pode ser cancelado. Use "Encerrar com pendência".' using errcode = '22023';
  end if;

  if p_status_destino = 'recebido' then
    if not v_tem_recebimento then
      raise exception 'Nada foi recebido nesta compra; para desistir dela, cancele.' using errcode = '22023';
    end if;
    if nullif(btrim(coalesce(p_observacao, '')), '') is null then
      raise exception 'Informe por que a compra será encerrada com itens pendentes.' using errcode = '22023';
    end if;
    update public.pedidos_compra_itens
       set divergencia_recebimento = left(
             'Encerrado com pendência: recebido '
               || coalesce(quantidade_recebida, 0) || ' de ' || quantidade
               || '. Motivo: ' || btrim(p_observacao), 500)
     where pedido_id = p_pedido_id
       and coalesce(quantidade_recebida, case when lote_id is not null then quantidade else 0 end) < quantidade;

    -- Decisão do dono (EST2-7): o pedido interno de origem conclui o
    -- recebimento com a pendência registrada em cada item não recebido.
    with afetados as (
      update public.pedidos_internos_itens pii
         set divergencia_recebimento = left(
               'Compra #' || p_pedido_id || ' encerrada com pendência: recebido '
                 || coalesce(pii.quantidade_recebida, 0) || ' de ' || pii.quantidade
                 || '. Motivo: ' || btrim(p_observacao), 500),
             recebido_em = now(),
             recebido_por = v_ator
        from public.pedidos_compra_itens ci
       where ci.pedido_id = p_pedido_id
         and ci.pedido_interno_item_id = pii.id
         and pii.recebido_em is null
      returning pii.pedido_interno_id
    )
    select coalesce(array_agg(distinct pedido_interno_id), '{}') into v_internos from afetados;

    foreach v_interno in array v_internos
    loop
      select not exists (
        select 1 from public.pedidos_internos_itens
        where pedido_interno_id = v_interno
          and tipo = 'material' and recebido_em is null
      ) into v_tudo_recebido;
      update public.pedidos_internos
         set recebido_em = case when v_tudo_recebido then coalesce(recebido_em, now()) else recebido_em end,
             recebido_por = case when v_tudo_recebido then coalesce(recebido_por, v_ator) else recebido_por end
       where id = v_interno;
      insert into public.eventos_status(entidade, entidade_id, de_status, para_status, usuario, observacao)
      select 'pedido_interno', p.id, p.status, p.status, v_ator,
             left('Recebimento concluído com pendência: a compra #' || p_pedido_id
               || ' foi encerrada. Motivo: ' || btrim(p_observacao), 1000)
      from public.pedidos_internos p where p.id = v_interno;
    end loop;
  end if;

  perform set_config('app.pedido_compra_transicao', 'permitida', true);
  update public.pedidos_compra
     set status = p_status_destino,
         aprovador = case when p_status_destino = 'aprovado' then v_ator else aprovador end,
         data_aprovacao = case when p_status_destino = 'aprovado' then current_date else data_aprovacao end,
         data_prevista_entrega = case
           when p_status_destino = 'aprovado' then p_data_prevista_entrega
           -- 0132: ao sair para o fornecedor a tramitação acabou; a previsão
           -- passa a ser o envio + prazo do fornecedor, informada pelo app.
           when p_status_destino = 'enviado' and p_data_prevista_entrega is not null
             then p_data_prevista_entrega
           else data_prevista_entrega
         end
   where id = p_pedido_id;

  insert into public.eventos_status(entidade, entidade_id, de_status, para_status, usuario, observacao)
  values (
    'pedido_compra', p_pedido_id, v_pedido.status, p_status_destino, v_ator,
    case when p_status_destino = 'recebido'
      then 'Encerrada com pendência: ' || btrim(p_observacao)
      else p_observacao
    end
  );

  return jsonb_build_object(
    'status_origem', v_pedido.status,
    'status_destino', p_status_destino,
    'data_prevista_entrega', p_data_prevista_entrega
  );
end $function$;

create or replace function public.encerrar_compra_com_pendencia(
  p_pedido_id bigint,
  p_destino text,
  p_motivo text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
  v_claims jsonb;
  v_ator text;
  v_compra record;
  v_nova bigint;
  v_itens int := 0;
  v_rotulo text;
begin
  perform kontrol_private.exigir_permissao('compras.aprovar');

  if p_destino is null or p_destino not in ('nova_compra', 'desistencia', 'atendido_outra_forma') then
    raise exception 'Escolha o destino do que faltou: nova compra, desistência ou atendido de outra forma.'
      using errcode = '22023';
  end if;
  if v_motivo is null or length(v_motivo) < 3 then
    raise exception 'Explique o motivo (pelo menos 3 letras).' using errcode = '22023';
  end if;

  v_claims := coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
  v_ator := coalesce(nullif(v_claims->>'email', ''), nullif(v_claims->>'sub', ''));
  if v_ator is null then
    raise exception 'Contexto JWT do ator e obrigatorio para encerrar a compra.' using errcode = '42501';
  end if;

  select id, status, fornecedor_id, projeto, projeto_id, solicitante into v_compra
  from pedidos_compra where id = p_pedido_id
  for update;
  if not found then
    raise exception 'Pedido de compra nao encontrado.' using errcode = 'P0002';
  end if;

  perform kontrol_private.exigir_escopo_compra_0151(p_pedido_id);

  if not exists (
    select 1 from pedidos_compra_itens i
    where i.pedido_id = p_pedido_id
      and i.quantidade - coalesce(i.quantidade_recebida, case when i.lote_id is not null then i.quantidade else 0 end) > 0
  ) then
    raise exception 'Nada ficou pendente nesta compra.' using errcode = '22023';
  end if;

  v_rotulo := case p_destino
    when 'nova_compra' then 'Nova compra'
    when 'desistencia' then 'Desistência'
    else 'Atendido de outra forma'
  end;

  if p_destino = 'nova_compra' then
    insert into pedidos_compra(fornecedor_id, projeto, projeto_id, status, solicitante, observacao, compra_origem_id)
    -- 0136 (D2): a continuação herda quem pediu os itens, não quem encerrou
    values (v_compra.fornecedor_id, v_compra.projeto, v_compra.projeto_id, 'solicitado', coalesce(nullif(btrim(v_compra.solicitante), ''), v_ator),
            left('Pendência da compra #' || p_pedido_id || ': ' || v_motivo, 500), p_pedido_id)
    returning id into v_nova;

    insert into pedidos_compra_itens(pedido_id, insumo_id, quantidade, quantidade_em, conteudo_embalagem, custo_unitario_estimado)
    select v_nova, i.insumo_id,
           i.quantidade - coalesce(i.quantidade_recebida, case when i.lote_id is not null then i.quantidade else 0 end),
           i.quantidade_em, i.conteudo_embalagem, i.custo_unitario_estimado
    from pedidos_compra_itens i
    where i.pedido_id = p_pedido_id
      and i.quantidade - coalesce(i.quantidade_recebida, case when i.lote_id is not null then i.quantidade else 0 end) > 0
    order by i.id;
    get diagnostics v_itens = row_count;
  end if;

  update pedidos_compra_itens i
     set quantidade_nao_atendida = i.quantidade - coalesce(i.quantidade_recebida, case when i.lote_id is not null then i.quantidade else 0 end),
         destino_pendencia = p_destino,
         compra_pendencia_id = v_nova
   where i.pedido_id = p_pedido_id
     and i.quantidade - coalesce(i.quantidade_recebida, case when i.lote_id is not null then i.quantidade else 0 end) > 0;

  perform set_config('app.encerramento_com_destino', 'sim', true);
  perform transicionar_pedido_compra(
    p_pedido_id, 'recebido',
    v_rotulo || case when v_nova is not null then ' (compra #' || v_nova || ')' else '' end || ': ' || v_motivo
  );
  perform set_config('app.encerramento_com_destino', '', true);

  if v_nova is not null then
    insert into eventos_status(entidade, entidade_id, de_status, para_status, usuario, observacao)
    values ('pedido_compra', v_nova, null, 'solicitado', v_ator,
            left('Criada para repor o que faltou na compra #' || p_pedido_id || ': ' || v_motivo, 1000));
  end if;

  return jsonb_build_object(
    'pedido_compra_id', p_pedido_id,
    'destino', p_destino,
    'nova_compra_id', v_nova,
    'itens_nova_compra', v_itens
  );
end $function$;

revoke all on function kontrol_private.nivel_nomeacao(text),
  kontrol_private.papel_catalogado(text),
  kontrol_private.chave_permissao_conhecida(text),
  kontrol_private.tem_permissao_do_usuario(uuid,text),
  kontrol_private.serializar_nomeacao(),
  kontrol_private.exigir_sessao_nomeacao(),
  kontrol_private.serializar_mutacao_admin(),
  kontrol_private.exigir_escopo_compra_0151(bigint),
  kontrol_private.proteger_papel_perfil(),
  kontrol_private.proteger_ultimo_admin(),
  kontrol_private.proteger_coordenador_projeto()
  from public, anon, authenticated, service_role;
revoke all on function public.nomear_papel_usuario(uuid,text,text), public.configurar_vinculo_projeto(bigint,uuid,boolean), public.minhas_permissoes(),
  kontrol_private.tem_permissao_efetiva(text), kontrol_private.pode_editar_cadastro(text),
  kontrol_private.projeto_no_escopo(bigint)
  from public, anon, authenticated, service_role;
grant execute on function public.nomear_papel_usuario(uuid,text,text), public.configurar_vinculo_projeto(bigint,uuid,boolean), public.minhas_permissoes(),
  kontrol_private.tem_permissao_efetiva(text), kontrol_private.pode_editar_cadastro(text),
  kontrol_private.projeto_no_escopo(bigint) to authenticated;

comment on column public.perfis.permissoes is
  'Histórico individual somente; 0151 não usa nem regrava este JSON para autorização.';

commit;
