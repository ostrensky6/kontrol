-- 0163 — falta e disputa de reservas entre planos.
--
-- Quando um plano reservado ficou com falta de um insumo que outro plano
-- reservado segura, quem executa pede a reserva do outro plano. Coordenador
-- ou acima decide: transferir (move a reserva de lote do plano de origem para
-- o de destino) ou negar. Cada decisão fica registrada e auditada.
--
-- Regras:
--   * Pedido: permissão "Executar planejamento"; o plano precisa estar
--     reservado e ter falta registrada do insumo. Um pedido aberto por
--     plano e insumo.
--   * Decisão: Coordenador, Gestor, Supervisor ou Admin, ligado ao projeto do
--     plano de origem (0160). A linha do pedido é travada; a segunda pessoa
--     que decidir ao mesmo tempo recebe "já foi decidido".
--   * Transferir só entre planos reservados e com reserva atualizada. Move
--     no máximo a falta atual do destino, lote a lote (validade mais curta
--     primeiro); embalagem fechada vai inteira. O destino perde a falta
--     coberta; a origem ganha uma falta do mesmo tamanho (e precisa repor ou
--     reservar de novo antes de iniciar).
--
-- Aditivo: uma tabela nova (auditada) e três funções. Nada existente muda.
-- Rollback: drop function public.decidir_disputa_reserva(bigint,text,bigint,text);
-- drop function public.planos_com_reserva(bigint,bigint);
-- drop function public.pedir_reserva_de_outro_plano(bigint,bigint,text);
-- drop table public.reservas_disputas. (Reservas já transferidas ficam como
-- estão; a trilha da auditoria mostra cada mudança.)
begin;
set local lock_timeout = '10s';

create table public.reservas_disputas (
  id bigint generated always as identity primary key,
  planejamento_destino_id bigint not null references public.planejamento(id) on delete cascade,
  insumo_id bigint not null references public.insumos(id) on delete cascade,
  quantidade numeric not null check (quantidade > 0),
  motivo text not null check (char_length(btrim(motivo)) between 1 and 1000),
  status text not null default 'pendente' check (status in ('pendente', 'transferida', 'negada')),
  solicitado_por uuid not null default auth.uid(),
  solicitado_em timestamptz not null default now(),
  planejamento_origem_id bigint references public.planejamento(id) on delete set null,
  quantidade_transferida numeric check (quantidade_transferida is null or quantidade_transferida > 0),
  decidido_por uuid,
  decidido_em timestamptz,
  decisao_observacao text check (decisao_observacao is null or char_length(btrim(decisao_observacao)) between 1 and 1000)
);
comment on table public.reservas_disputas is
  'Pedidos de reserva de outro plano quando falta insumo (0163). Alteração só pelas funções pedir_reserva_de_outro_plano e decidir_disputa_reserva.';
create unique index reservas_disputas_pendente_uidx
  on public.reservas_disputas (planejamento_destino_id, insumo_id) where status = 'pendente';
create index reservas_disputas_status_idx on public.reservas_disputas (status, solicitado_em desc);

alter table public.reservas_disputas enable row level security;
revoke all on table public.reservas_disputas from public, anon, authenticated;
grant select on table public.reservas_disputas to authenticated;
grant all on table public.reservas_disputas to service_role;
create policy reservas_disputas_leitura on public.reservas_disputas for select to authenticated
  using (kontrol_private.tem_permissao_efetiva('planejamento.ver')
         or kontrol_private.tem_permissao_efetiva('planejamento.executar'));

create trigger aud_reservas_disputas
  after insert or update or delete on public.reservas_disputas
  for each row execute function public.fn_auditoria();

-- Falta registrada (reserva sem lote) do insumo no plano, na unidade física.
create function kontrol_private.falta_reservada(p_planejamento_id bigint, p_insumo_id bigint)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(r.quantidade - coalesce(r.quantidade_consumida, 0)), 0)
    from public.reservas_estoque r
   where r.planejamento_id = p_planejamento_id
     and r.insumo_id = p_insumo_id
     and r.lote_id is null
     and r.status = 'parcial';
$$;
revoke all on function kontrol_private.falta_reservada(bigint, bigint) from public, anon;
grant execute on function kontrol_private.falta_reservada(bigint, bigint) to authenticated;

create function public.pedir_reserva_de_outro_plano(
  p_planejamento_id bigint,
  p_insumo_id bigint,
  p_motivo text
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_nome text;
  v_falta numeric;
  v_id bigint;
  v_insumo text;
begin
  perform kontrol_private.exigir_permissao('planejamento.executar');
  select status_operacional, coalesce(nome, 'Plano #' || id) into v_status, v_nome
    from public.planejamento where id = p_planejamento_id;
  if not found then
    raise exception 'Planejamento não encontrado.' using errcode = 'P0002';
  end if;
  if v_status <> 'reservado' then
    raise exception 'Só um plano reservado pode pedir reserva de outro plano.' using errcode = '22023';
  end if;
  v_falta := kontrol_private.falta_reservada(p_planejamento_id, p_insumo_id);
  if v_falta <= 0 then
    raise exception 'Este plano não tem falta registrada desse insumo. Reserve de novo para atualizar.'
      using errcode = '22023';
  end if;
  if exists (select 1 from public.reservas_disputas
              where planejamento_destino_id = p_planejamento_id and insumo_id = p_insumo_id and status = 'pendente') then
    raise exception 'Já existe um pedido aberto deste insumo para este plano.' using errcode = '23505';
  end if;
  insert into public.reservas_disputas (planejamento_destino_id, insumo_id, quantidade, motivo, solicitado_por)
  values (p_planejamento_id, p_insumo_id, v_falta, btrim(p_motivo), auth.uid())
  returning id into v_id;

  select especificacao into v_insumo from public.insumos where id = p_insumo_id;
  insert into public.notificacoes (tipo, titulo, corpo, entidade_tipo, entidade_id, papel_destino, dedupe_key)
  values ('aprovacao_pendente', 'Pedido de reserva de outro plano',
          v_nome || ' precisa de ' || coalesce(v_insumo, 'insumo #' || p_insumo_id) || ': ' || btrim(p_motivo),
          'disputa_reserva', v_id, 'coordenador', 'disputa-reserva-' || v_id || '-pedido');
  return v_id;
end $$;
revoke all on function public.pedir_reserva_de_outro_plano(bigint, bigint, text) from public, anon;
grant execute on function public.pedir_reserva_de_outro_plano(bigint, bigint, text) to authenticated;

-- Planos reservados que seguram o insumo em lote (candidatos a ceder).
create function public.planos_com_reserva(p_insumo_id bigint, p_excluir_planejamento_id bigint default null)
returns table (
  planejamento_id bigint,
  nome text,
  data_inicio_prevista date,
  prioridade text,
  reservado numeric,
  reserva_desatualizada boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, coalesce(p.nome, 'Plano #' || p.id), p.data_inicio_prevista, p.prioridade,
         sum((r.quantidade - coalesce(r.quantidade_consumida, 0))
             * case when l.modelo_quantidade = 'EMBALAGEM_FECHADA'
                    then coalesce(nullif(l.conteudo_embalagem_snapshot, 0), 1) else 1 end),
         p.reserva_desatualizada
    from public.reservas_estoque r
    join public.planejamento p on p.id = r.planejamento_id
    join public.lotes_estoque l on l.id = r.lote_id
   where r.insumo_id = p_insumo_id
     and r.status = 'reservado'
     and p.status_operacional = 'reservado'
     and (p_excluir_planejamento_id is null or p.id <> p_excluir_planejamento_id)
     and (kontrol_private.tem_permissao_efetiva('planejamento.ver')
          or kontrol_private.tem_permissao_efetiva('planejamento.executar'))
   group by p.id
   order by p.data_inicio_prevista nulls last, p.id;
$$;
revoke all on function public.planos_com_reserva(bigint, bigint) from public, anon;
grant execute on function public.planos_com_reserva(bigint, bigint) to authenticated;

create function public.decidir_disputa_reserva(
  p_disputa_id bigint,
  p_decisao text,
  p_planejamento_origem_id bigint default null,
  p_observacao text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.reservas_disputas%rowtype;
  v_origem record;
  v_destino record;
  v_obs text := nullif(btrim(coalesce(p_observacao, '')), '');
  v_ator text;
  v_restante numeric;
  v_coberto numeric := 0;
  v_conteudo numeric;
  v_pendente numeric;
  v_take numeric;
  v_cobre numeric;
  v_reduzir numeric;
  r record;
  v_insumo text;
begin
  if coalesce(kontrol_private.nivel_papel(public.current_papel()), -1) < kontrol_private.nivel_papel('coordenador') then
    raise exception 'Somente Coordenador, Gestor, Supervisor ou Administrador decidem disputas de reserva.'
      using errcode = '42501';
  end if;
  if p_decisao not in ('transferir', 'negar') then
    raise exception 'Decisão inválida.' using errcode = '22023';
  end if;
  if v_obs is null then
    raise exception 'Escreva o motivo da decisão.' using errcode = '22023';
  end if;

  -- Trava o pedido: quem chega depois vê que já foi decidido.
  select * into d from public.reservas_disputas where id = p_disputa_id for update;
  if not found then
    raise exception 'Pedido não encontrado.' using errcode = 'P0002';
  end if;
  if d.status <> 'pendente' then
    raise exception 'Este pedido já foi decidido por outra pessoa. Recarregue a página.' using errcode = '55000';
  end if;
  select especificacao into v_insumo from public.insumos where id = d.insumo_id;

  if p_decisao = 'negar' then
    update public.reservas_disputas
       set status = 'negada', decidido_por = auth.uid(), decidido_em = now(), decisao_observacao = v_obs
     where id = d.id;
    insert into public.notificacoes (tipo, titulo, corpo, entidade_tipo, entidade_id, usuario_destino, dedupe_key)
    values ('sistema', 'Pedido de reserva negado', coalesce(v_insumo, 'Insumo') || ': ' || v_obs,
            'disputa_reserva', d.id, d.solicitado_por, 'disputa-reserva-' || d.id || '-decisao');
    return jsonb_build_object('status', 'negada', 'transferido', 0);
  end if;

  if p_planejamento_origem_id is null or p_planejamento_origem_id = d.planejamento_destino_id then
    raise exception 'Escolha o plano que vai ceder a reserva.' using errcode = '22023';
  end if;

  -- Trava os dois planos sempre na mesma ordem (evita impasse).
  perform 1 from public.planejamento
   where id in (p_planejamento_origem_id, d.planejamento_destino_id)
   order by id for update;
  select id, projeto_id, status_operacional, reserva_desatualizada, coalesce(nome, 'Plano #' || id) as nome
    into v_origem from public.planejamento where id = p_planejamento_origem_id;
  if not found then
    raise exception 'Plano de origem não encontrado.' using errcode = 'P0002';
  end if;
  select id, status_operacional, reserva_desatualizada, coalesce(nome, 'Plano #' || id) as nome
    into v_destino from public.planejamento where id = d.planejamento_destino_id;
  if v_origem.status_operacional <> 'reservado' or v_destino.status_operacional <> 'reservado' then
    raise exception 'Os dois planos precisam estar reservados (nem iniciados, nem concluídos).' using errcode = '22023';
  end if;
  if v_origem.reserva_desatualizada or v_destino.reserva_desatualizada then
    raise exception 'Um dos planos mudou depois da reserva. Reserve de novo antes de transferir.' using errcode = '22023';
  end if;
  if not kontrol_private.pode_agir_no_projeto(v_origem.projeto_id) then
    raise exception 'Você não está ligado ao projeto do plano que cederia a reserva.' using errcode = '42501';
  end if;

  v_ator := coalesce(
    nullif(coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb->>'email', ''),
    auth.uid()::text);
  v_restante := least(d.quantidade, kontrol_private.falta_reservada(d.planejamento_destino_id, d.insumo_id));
  if v_restante <= 0 then
    raise exception 'O plano que pediu já não tem falta desse insumo.' using errcode = '22023';
  end if;

  for r in
    select re.id, re.lote_id, re.quantidade - coalesce(re.quantidade_consumida, 0) as pendente,
           l.modelo_quantidade, l.conteudo_embalagem_snapshot
      from public.reservas_estoque re
      join public.lotes_estoque l on l.id = re.lote_id
     where re.planejamento_id = p_planejamento_origem_id
       and re.insumo_id = d.insumo_id
       and re.status = 'reservado'
     order by public.menor_validade(l.validade, l.validade_apos_abertura) nulls last, re.id
     for update of re
  loop
    exit when v_restante <= 0;
    v_pendente := r.pendente;
    continue when v_pendente <= 0;
    if r.modelo_quantidade = 'EMBALAGEM_FECHADA' then
      v_conteudo := coalesce(nullif(r.conteudo_embalagem_snapshot, 0), 1);
      v_take := least(ceil(v_restante / v_conteudo), floor(v_pendente));
      v_cobre := v_take * v_conteudo;
    else
      v_take := least(v_restante, v_pendente);
      v_cobre := v_take;
    end if;
    continue when v_take <= 0;

    if v_take >= v_pendente then
      update public.reservas_estoque
         set status = 'liberado', liberado_em = now(),
             observacao = left(coalesce(observacao || ' | ', '') || 'Cedida ao plano #' || d.planejamento_destino_id
               || ' (disputa #' || d.id || ')', 500)
       where id = r.id;
    else
      update public.reservas_estoque
         set quantidade = quantidade - v_take,
             observacao = left(coalesce(observacao || ' | ', '') || 'Cedeu ' || v_take || ' ao plano #'
               || d.planejamento_destino_id || ' (disputa #' || d.id || ')', 500)
       where id = r.id;
    end if;
    insert into public.reservas_estoque (planejamento_id, insumo_id, lote_id, quantidade, quantidade_consumida,
                                         status, origem, criado_por, observacao)
    values (d.planejamento_destino_id, d.insumo_id, r.lote_id, v_take, 0, 'reservado', 'planejamento', v_ator,
            'Recebida do plano #' || p_planejamento_origem_id || ' (disputa #' || d.id || ')');
    v_restante := greatest(0, v_restante - v_cobre);
    v_coberto := v_coberto + v_cobre;
  end loop;

  if v_coberto <= 0 then
    raise exception 'O plano escolhido não tem reserva em lote desse insumo.' using errcode = '22023';
  end if;

  -- Destino: tira a falta coberta das linhas sem lote.
  v_restante := v_coberto;
  for r in
    select id, quantidade - coalesce(quantidade_consumida, 0) as pendente
      from public.reservas_estoque
     where planejamento_id = d.planejamento_destino_id and insumo_id = d.insumo_id
       and lote_id is null and status = 'parcial'
     order by id
     for update
  loop
    exit when v_restante <= 0;
    v_reduzir := least(v_restante, r.pendente);
    if v_reduzir >= r.pendente then
      update public.reservas_estoque
         set status = 'liberado', liberado_em = now(),
             observacao = left(coalesce(observacao || ' | ', '') || 'Falta coberta pela disputa #' || d.id, 500)
       where id = r.id;
    else
      update public.reservas_estoque set quantidade = quantidade - v_reduzir where id = r.id;
    end if;
    v_restante := v_restante - v_reduzir;
  end loop;

  -- Origem: passa a ter falta do que cedeu.
  insert into public.reservas_estoque (planejamento_id, insumo_id, lote_id, quantidade, quantidade_consumida,
                                       status, origem, criado_por, observacao)
  values (p_planejamento_origem_id, d.insumo_id, null, v_coberto, 0, 'parcial', 'planejamento', v_ator,
          'Falta: cedido ao plano #' || d.planejamento_destino_id || ' (disputa #' || d.id || ')');

  update public.reservas_disputas
     set status = 'transferida', planejamento_origem_id = p_planejamento_origem_id,
         quantidade_transferida = v_coberto, decidido_por = auth.uid(), decidido_em = now(),
         decisao_observacao = v_obs
   where id = d.id;

  insert into public.notificacoes (tipo, titulo, corpo, entidade_tipo, entidade_id, usuario_destino, dedupe_key)
  values ('sistema', 'Reserva transferida para ' || v_destino.nome,
          coalesce(v_insumo, 'Insumo') || ': ' || v_coberto || ' vieram de ' || v_origem.nome || '. ' || v_obs,
          'disputa_reserva', d.id, d.solicitado_por, 'disputa-reserva-' || d.id || '-decisao');
  insert into public.notificacoes (tipo, titulo, corpo, entidade_tipo, entidade_id, papel_destino, dedupe_key)
  values ('falta_plano', v_origem.nome || ' cedeu reserva e ficou com falta',
          coalesce(v_insumo, 'Insumo') || ': faltam ' || v_coberto || ' (cedido a ' || v_destino.nome || '). Reponha ou reserve de novo antes de iniciar.',
          'planejamento', p_planejamento_origem_id, 'coordenador', 'disputa-reserva-' || d.id || '-origem');

  return jsonb_build_object('status', 'transferida', 'transferido', v_coberto);
end $$;
revoke all on function public.decidir_disputa_reserva(bigint, text, bigint, text) from public, anon;
grant execute on function public.decidir_disputa_reserva(bigint, text, bigint, text) to authenticated;

commit;
