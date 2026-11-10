-- 0178 — disputa de reservas: o Gestor identifica e solicita, não decide.
--
-- Decisão de Antonio em 10/11/2026: a regra aprovada era o Gestor só
-- identificar a falta e pedir a reserva de outro plano. A 0163 deixava
-- qualquer função de Coordenador para cima decidir, o que incluía o Gestor.
--
-- O que muda:
--   * Decidem a disputa (transferir ou negar): Coordenador, Supervisor e
--     Administrador. O Gestor deixa de decidir.
--   * Pedir a reserva continua igual: quem tem "Executar planejamento".
--   * O resto da decisão não muda: ligação ao projeto do plano de origem
--     (0160), trava do pedido, planos reservados e atualizados, movimento
--     lote a lote, avisos e auditoria. O corpo abaixo é o da 0163 com a
--     checagem de quem decide trocada.
--   * Decisões já registradas ficam como estão.
--
-- Aditivo: uma função privada nova e a troca do corpo de uma função.
-- Nenhuma tabela, coluna, política ou gatilho muda.
-- Rollback: recriar public.decidir_disputa_reserva(bigint,text,bigint,text)
-- com o corpo da 0163 (create or replace) e depois
-- drop function kontrol_private.pode_decidir_disputa_reserva().
begin;
set local lock_timeout = '10s';

-- Uma regra só para o banco: quem decide disputa de reserva.
create function kontrol_private.pode_decidir_disputa_reserva()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  -- current_papel() já devolve nulo para suspenso ou com senha provisória.
  select coalesce(public.current_papel() in ('coordenador', 'supervisor', 'admin'), false);
$$;
revoke all on function kontrol_private.pode_decidir_disputa_reserva() from public, anon;
grant execute on function kontrol_private.pode_decidir_disputa_reserva() to authenticated;

create or replace function public.decidir_disputa_reserva(
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
  -- 0178: a função decide quem pode; o Gestor identifica a falta e pede, não decide.
  if not kontrol_private.pode_decidir_disputa_reserva() then
    raise exception 'Somente Coordenador, Supervisor ou Administrador decidem disputas de reserva. O Gestor identifica a falta e pede a reserva.'
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
