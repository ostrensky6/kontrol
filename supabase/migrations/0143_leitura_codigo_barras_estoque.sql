-- 0143 — entrada e saída de insumos por leitura de código de barras
-- (relatório de bugs, item 18, 02/10/2026).
--
-- 1. Códigos lidos e vínculos que não gravavam. As tabelas identificadores e
--    scan_eventos nasceram na 0067 com colunas obrigatórias (tipo, valor,
--    valor_lido) que a 0068 não preencheu: vincular um código pela triagem
--    falhava com "null value in column tipo" e nenhuma leitura ficava
--    registrada. Gatilhos BEFORE INSERT/UPDATE completam as colunas antigas a
--    partir das novas (e vice-versa); nenhuma coluna é removida.
--
-- 2. Auditoria. Movimentações de estoque e vínculos de código passam a entrar
--    na trilha (fn_auditoria), com usuário, data/hora e insumo.
--
-- 3. Entrada por leitura (registrar_entrada_por_leitura): o insumo
--    identificado pelo código entra como embalagens fechadas, com lote interno
--    gerado (LEIT-…), validade e local opcionais. Reaproveita
--    registrar_entrada_manual_embalagens (0109/0132). Com pedido de compra em
--    aberto, registrar_recebimento_por_leitura recebe pelo item do pedido
--    (receber_item_pedido_compra, 0127), sem lançamento duplo.
--
-- 4. Saída por leitura (abrir_embalagem_por_leitura): registra a abertura de
--    1 embalagem do lote que vence primeiro (sem validade: o mais antigo), sem
--    o usuário escolher lote. Reaproveita abrir_embalagem (0109). Embalagem
--    aberta deixa de contar no estoque e no planejamento.
--
-- 5. Desfazer a última leitura (desfazer_leitura_estoque): quem leu, até 2
--    horas depois (ou quem tem "Corrigir estoque"), desde que o lote não tenha
--    sido usado depois.
--
-- 6. Inventário por insumo: inventario_contagens ganha insumo_id e lote_id
--    deixa de ser obrigatório (uma das duas referências é exigida). O ajuste de
--    uma contagem por insumo usa corrigir_quantidade_embalagens_fechadas (0109).
--
-- Não remove tabelas, colunas, dados, RLS nem gatilhos de auditoria.
--
-- Rollback: drop das funções registrar_entrada_por_leitura,
-- registrar_recebimento_por_leitura, abrir_embalagem_por_leitura,
-- desfazer_leitura_estoque, kontrol_private.completar_identificador e
-- kontrol_private.completar_scan_evento (com os gatilhos
-- trg_completar_identificador, trg_completar_scan_evento,
-- aud_estoque_movimentacoes e aud_identificadores); reaplicar
-- aplicar_ajuste_inventario_contagem da 0127; apagar as contagens por insumo
-- (lote_id null) depois de um backup lógico, restaurar "lote_id not null",
-- remover a constraint inventario_contagens_alvo_check e a coluna insumo_id.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $$
begin
  if to_regclass('public.identificadores') is null
    or to_regclass('public.scan_eventos') is null
    or to_regclass('public.inventario_contagens') is null
    or to_regprocedure('public.registrar_entrada_manual_embalagens(bigint,integer,uuid,date,numeric,text,text,text)') is null
    or to_regprocedure('public.abrir_embalagem(bigint,integer,uuid,text)') is null
    or to_regprocedure('public.corrigir_quantidade_embalagens_fechadas(bigint,integer,uuid,text)') is null
    or to_regprocedure('public.receber_item_pedido_compra(bigint,bigint,uuid,numeric,date,text,text,numeric,bigint)') is null
    or to_regprocedure('public.estornar_recebimento_do_lote(bigint,text)') is null
    or to_regprocedure('kontrol_private.exigir_permissao(text)') is null
    or to_regprocedure('kontrol_private.tem_permissao_efetiva(text)') is null
    or to_regprocedure('public.fn_auditoria()') is null then
    raise exception '0143: dependências ausentes';
  end if;
end $$;

-- ---- 1. Colunas antigas de identificadores e scan_eventos -------------------

create or replace function kontrol_private.completar_identificador()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.codigo := coalesce(nullif(btrim(new.codigo), ''), nullif(btrim(new.valor), ''));
  new.valor := coalesce(nullif(btrim(new.valor), ''), new.codigo);
  new.codigo_normalizado := coalesce(
    nullif(btrim(new.codigo_normalizado), ''),
    upper(regexp_replace(btrim(new.codigo), '\s+', ' ', 'g'))
  );
  new.tipo := coalesce(
    nullif(btrim(new.tipo), ''),
    case when new.formato in ('kontrol_interno', 'url_kontrol') then 'qr_interno' else 'codigo_barras' end
  );
  new.atualizado_em := now();
  return new;
end $$;

create or replace function kontrol_private.completar_scan_evento()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.codigo := coalesce(nullif(btrim(new.codigo), ''), nullif(btrim(new.valor_lido), ''));
  new.valor_lido := coalesce(nullif(btrim(new.valor_lido), ''), new.codigo);
  return new;
end $$;

revoke all on function kontrol_private.completar_identificador() from public, anon, authenticated;
revoke all on function kontrol_private.completar_scan_evento() from public, anon, authenticated;

do $$
begin
  -- só quando as colunas da 0067 existem (bancos criados direto pela 0068 não as têm)
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'identificadores' and column_name = 'valor'
  ) and exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'identificadores' and column_name = 'tipo'
  ) then
    drop trigger if exists trg_completar_identificador on public.identificadores;
    create trigger trg_completar_identificador
      before insert or update on public.identificadores
      for each row execute function kontrol_private.completar_identificador();
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'scan_eventos' and column_name = 'valor_lido'
  ) then
    drop trigger if exists trg_completar_scan_evento on public.scan_eventos;
    create trigger trg_completar_scan_evento
      before insert or update on public.scan_eventos
      for each row execute function kontrol_private.completar_scan_evento();
  end if;
end $$;

-- ---- 2. Auditoria de movimentações e códigos ---------------------------------

drop trigger if exists aud_estoque_movimentacoes on public.estoque_movimentacoes;
create trigger aud_estoque_movimentacoes
  after insert or update or delete on public.estoque_movimentacoes
  for each row execute function public.fn_auditoria();

drop trigger if exists aud_identificadores on public.identificadores;
create trigger aud_identificadores
  after insert or update or delete on public.identificadores
  for each row execute function public.fn_auditoria();

-- ---- 3. Entrada por leitura ---------------------------------------------------

create or replace function public.registrar_entrada_por_leitura(
  p_insumo_id bigint,
  p_quantidade_embalagens integer,
  p_validade date,
  p_local_id bigint,
  p_codigo text,
  p_operacao_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claims jsonb;
  v_ator text;
  v_evento public.scan_eventos%rowtype;
  v_insumo public.insumos%rowtype;
  v_entrada jsonb;
  v_lote public.lotes_estoque%rowtype;
  v_fechadas numeric;
  v_resultado jsonb;
begin
  perform kontrol_private.exigir_permissao('estoque.movimentar');
  if auth.uid() is null then
    raise exception 'Sessão inválida.' using errcode = '28000';
  end if;
  if p_insumo_id is null or p_operacao_id is null
    or p_quantidade_embalagens is null or p_quantidade_embalagens <= 0
    or nullif(btrim(p_codigo), '') is null then
    raise exception 'Informe o código lido e uma quantidade inteira de embalagens maior que zero.' using errcode = '22023';
  end if;
  if p_local_id is not null and not exists (select 1 from public.locais where id = p_local_id) then
    raise exception 'Local de armazenamento não encontrado.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('leitura:' || p_operacao_id::text, 0));
  select * into v_evento
  from public.scan_eventos e
  where e.acao in ('entrada_leitura', 'entrada_pedido_leitura', 'saida_leitura')
    and e.contexto->>'operacao_id' = p_operacao_id::text
  limit 1;
  if found then
    return jsonb_set(v_evento.contexto->'resultado', '{repetido}', 'true'::jsonb, true);
  end if;

  select * into v_insumo from public.insumos where id = p_insumo_id;
  if not found then
    raise exception 'Insumo não encontrado.' using errcode = 'P0002';
  end if;

  v_entrada := public.registrar_entrada_manual_embalagens(
    p_insumo_id,
    p_quantidade_embalagens,
    p_operacao_id,
    p_validade,
    coalesce(v_insumo.custo_total_embalagem, 0),
    'LEIT-' || upper(left(replace(p_operacao_id::text, '-', ''), 8)),
    null,
    'leitura de código de barras'
  );

  select * into v_lote from public.lotes_estoque where id = (v_entrada->>'lote_id')::bigint for update;
  if p_local_id is not null then
    update public.lotes_estoque set local_id = p_local_id where id = v_lote.id;
  end if;

  select coalesce(sum(l.quantidade_atual), 0) into v_fechadas
  from public.lotes_estoque l
  where l.insumo_id = p_insumo_id and l.modelo_quantidade = 'EMBALAGEM_FECHADA' and l.status = 'aceito';

  v_claims := coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
  v_ator := coalesce(nullif(v_claims->>'email', ''), auth.uid()::text);
  v_resultado := jsonb_build_object(
    'tipo', 'entrada',
    'insumo_id', p_insumo_id,
    'especificacao', v_insumo.especificacao,
    'lote_id', v_lote.id,
    'codigo_lote', v_lote.codigo_lote,
    'validade', v_lote.validade,
    'quantidade_embalagens', p_quantidade_embalagens,
    'fechadas', v_fechadas,
    'repetido', false
  );
  insert into public.scan_eventos (
    codigo, valor_lido, formato, entidade_tipo, entidade_id, acao, resultado, contexto, usuario, usuario_id
  ) values (
    btrim(p_codigo), btrim(p_codigo), 'codigo_barras', 'insumo', p_insumo_id, 'entrada_leitura', 'criado',
    jsonb_build_object('operacao_id', p_operacao_id, 'lote_id', v_lote.id, 'resultado', v_resultado),
    v_ator, auth.uid()
  );
  return v_resultado;
end $$;

create or replace function public.registrar_recebimento_por_leitura(
  p_insumo_id bigint,
  p_pedido_id bigint,
  p_item_id bigint,
  p_quantidade_embalagens integer,
  p_validade date,
  p_local_id bigint,
  p_codigo text,
  p_operacao_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claims jsonb;
  v_ator text;
  v_responsavel text;
  v_evento public.scan_eventos%rowtype;
  v_item record;
  v_lote_id bigint;
  v_lote public.lotes_estoque%rowtype;
  v_fechadas numeric;
  v_resultado jsonb;
begin
  perform kontrol_private.exigir_permissao('compras.receber');
  if auth.uid() is null then
    raise exception 'Sessão inválida.' using errcode = '28000';
  end if;
  if p_insumo_id is null or p_pedido_id is null or p_item_id is null or p_operacao_id is null
    or p_quantidade_embalagens is null or p_quantidade_embalagens <= 0
    or nullif(btrim(p_codigo), '') is null then
    raise exception 'Informe o código lido, o item do pedido e uma quantidade inteira de embalagens.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('leitura:' || p_operacao_id::text, 0));
  select * into v_evento
  from public.scan_eventos e
  where e.acao in ('entrada_leitura', 'entrada_pedido_leitura', 'saida_leitura')
    and e.contexto->>'operacao_id' = p_operacao_id::text
  limit 1;
  if found then
    return jsonb_set(v_evento.contexto->'resultado', '{repetido}', 'true'::jsonb, true);
  end if;

  select pi.insumo_id, pi.quantidade_em, i.especificacao
    into v_item
  from public.pedidos_compra_itens pi
  join public.insumos i on i.id = pi.insumo_id
  where pi.id = p_item_id and pi.pedido_id = p_pedido_id;
  if not found then
    raise exception 'Item do pedido de compra não encontrado.' using errcode = 'P0002';
  end if;
  if v_item.insumo_id is distinct from p_insumo_id then
    raise exception 'O item do pedido é de outro insumo; confira o código lido.' using errcode = '22023';
  end if;
  if v_item.quantidade_em is distinct from 'embalagem' then
    raise exception 'Este item foi comprado em unidade, não em embalagens; receba pela tela de Recebimento.' using errcode = '22023';
  end if;

  v_claims := coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
  v_ator := coalesce(nullif(v_claims->>'email', ''), auth.uid()::text);
  select coalesce(nullif(btrim(p.nome), ''), v_ator) into v_responsavel
  from public.perfis p where p.id = auth.uid();
  v_responsavel := coalesce(v_responsavel, v_ator);

  v_lote_id := public.receber_item_pedido_compra(
    p_pedido_id, p_item_id, p_operacao_id, p_quantidade_embalagens::numeric, p_validade,
    'LEIT-' || upper(left(replace(p_operacao_id::text, '-', ''), 8)), v_responsavel, null, p_local_id
  );
  select * into v_lote from public.lotes_estoque where id = v_lote_id;

  select coalesce(sum(l.quantidade_atual), 0) into v_fechadas
  from public.lotes_estoque l
  where l.insumo_id = p_insumo_id and l.modelo_quantidade = 'EMBALAGEM_FECHADA' and l.status = 'aceito';

  v_resultado := jsonb_build_object(
    'tipo', 'entrada',
    'insumo_id', p_insumo_id,
    'especificacao', v_item.especificacao,
    'lote_id', v_lote.id,
    'codigo_lote', v_lote.codigo_lote,
    'validade', v_lote.validade,
    'quantidade_embalagens', p_quantidade_embalagens,
    'pedido_id', p_pedido_id,
    'fechadas', v_fechadas,
    'repetido', false
  );
  insert into public.scan_eventos (
    codigo, valor_lido, formato, entidade_tipo, entidade_id, acao, resultado, contexto, usuario, usuario_id
  ) values (
    btrim(p_codigo), btrim(p_codigo), 'codigo_barras', 'insumo', p_insumo_id, 'entrada_pedido_leitura', 'criado',
    jsonb_build_object('operacao_id', p_operacao_id, 'lote_id', v_lote.id, 'pedido_id', p_pedido_id,
                       'item_id', p_item_id, 'resultado', v_resultado),
    v_ator, auth.uid()
  );
  return v_resultado;
end $$;

-- ---- 4. Saída por leitura (abertura de 1 embalagem) ---------------------------

create or replace function public.abrir_embalagem_por_leitura(
  p_insumo_id bigint,
  p_codigo text,
  p_operacao_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claims jsonb;
  v_ator text;
  v_evento public.scan_eventos%rowtype;
  v_insumo public.insumos%rowtype;
  v_lote record;
  v_fechadas numeric;
  v_reservadas numeric;
  v_vencidas numeric;
  v_resultado jsonb;
begin
  perform kontrol_private.exigir_permissao('estoque.movimentar');
  if auth.uid() is null then
    raise exception 'Sessão inválida.' using errcode = '28000';
  end if;
  if p_insumo_id is null or p_operacao_id is null or nullif(btrim(p_codigo), '') is null then
    raise exception 'Informe o código lido.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('leitura:' || p_operacao_id::text, 0));
  select * into v_evento
  from public.scan_eventos e
  where e.acao in ('entrada_leitura', 'entrada_pedido_leitura', 'saida_leitura')
    and e.contexto->>'operacao_id' = p_operacao_id::text
  limit 1;
  if found then
    return jsonb_set(v_evento.contexto->'resultado', '{repetido}', 'true'::jsonb, true);
  end if;

  select * into v_insumo from public.insumos where id = p_insumo_id for update;
  if not found then
    raise exception 'Insumo não encontrado.' using errcode = 'P0002';
  end if;
  if exists (
    select 1 from public.lotes_estoque l
    where l.insumo_id = p_insumo_id and l.modelo_quantidade = 'LEGADO'
      and l.status in ('aceito', 'em_uso') and l.quantidade_atual > 0
  ) then
    raise exception 'Este insumo ainda é controlado por volume (modelo antigo); registre a saída por "Dar baixa".' using errcode = '22023';
  end if;

  -- FEFO: vence primeiro sai primeiro; sem validade, o lote mais antigo.
  -- Só lotes liberados, dentro da validade e com embalagem livre de reserva.
  select l.id, l.quantidade_atual, l.codigo_lote, l.validade
    into v_lote
  from public.lotes_estoque l
  left join lateral (
    select coalesce(sum(r.quantidade - coalesce(r.quantidade_consumida, 0)), 0) as reservado
    from public.reservas_estoque r
    where r.lote_id = l.id and r.status in ('reservado', 'parcial')
  ) r on true
  where l.insumo_id = p_insumo_id
    and l.modelo_quantidade = 'EMBALAGEM_FECHADA'
    and l.status = 'aceito'
    and l.quantidade_atual >= 1
    and (l.validade is null or l.validade >= current_date)
    and l.quantidade_atual - r.reservado >= 1
  order by l.validade nulls last, l.criado_em, l.id
  limit 1
  for update of l;

  if not found then
    select
      coalesce(sum(l.quantidade_atual), 0),
      coalesce(sum(l.quantidade_atual) filter (where l.validade < current_date), 0)
      into v_fechadas, v_vencidas
    from public.lotes_estoque l
    where l.insumo_id = p_insumo_id and l.modelo_quantidade = 'EMBALAGEM_FECHADA' and l.status = 'aceito';
    if v_fechadas <= 0 then
      raise exception 'Não há embalagem fechada de "%" no estoque. Nada foi registrado.', v_insumo.especificacao
        using errcode = '22023';
    end if;
    if v_vencidas >= v_fechadas then
      raise exception 'As embalagens fechadas de "%" estão vencidas. Nada foi registrado; dê baixa por vencimento no Controle de Estoque.', v_insumo.especificacao
        using errcode = '22023';
    end if;
    select coalesce(sum(r.quantidade - coalesce(r.quantidade_consumida, 0)), 0) into v_reservadas
    from public.reservas_estoque r
    join public.lotes_estoque l on l.id = r.lote_id
    where l.insumo_id = p_insumo_id and r.status in ('reservado', 'parcial');
    raise exception 'As embalagens fechadas de "%" estão reservadas para planejamentos (% reservada(s)). Nada foi registrado; registre a retirada pelo planejamento.',
      v_insumo.especificacao, v_reservadas using errcode = '22023';
  end if;

  perform public.abrir_embalagem(
    v_lote.id, v_lote.quantidade_atual::integer, p_operacao_id, 'leitura de código de barras'
  );

  select coalesce(sum(l.quantidade_atual), 0) into v_fechadas
  from public.lotes_estoque l
  where l.insumo_id = p_insumo_id and l.modelo_quantidade = 'EMBALAGEM_FECHADA' and l.status = 'aceito';

  v_claims := coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
  v_ator := coalesce(nullif(v_claims->>'email', ''), auth.uid()::text);
  v_resultado := jsonb_build_object(
    'tipo', 'saida',
    'insumo_id', p_insumo_id,
    'especificacao', v_insumo.especificacao,
    'lote_id', v_lote.id,
    'codigo_lote', v_lote.codigo_lote,
    'validade', v_lote.validade,
    'quantidade_embalagens', 1,
    'fechadas', v_fechadas,
    'repetido', false
  );
  insert into public.scan_eventos (
    codigo, valor_lido, formato, entidade_tipo, entidade_id, acao, resultado, contexto, usuario, usuario_id
  ) values (
    btrim(p_codigo), btrim(p_codigo), 'codigo_barras', 'insumo', p_insumo_id, 'saida_leitura', 'criado',
    jsonb_build_object('operacao_id', p_operacao_id, 'lote_id', v_lote.id, 'resultado', v_resultado),
    v_ator, auth.uid()
  );
  return v_resultado;
end $$;

-- ---- 5. Desfazer a última leitura ---------------------------------------------

create or replace function public.desfazer_leitura_estoque(p_operacao_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claims jsonb;
  v_ator text;
  v_evento public.scan_eventos%rowtype;
  v_lote public.lotes_estoque%rowtype;
  v_lote_id bigint;
  v_reservado numeric;
  v_resultado jsonb;
begin
  perform kontrol_private.exigir_permissao('estoque.movimentar');
  if auth.uid() is null then
    raise exception 'Sessão inválida.' using errcode = '28000';
  end if;
  if p_operacao_id is null then
    raise exception 'Leitura não informada.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('leitura:' || p_operacao_id::text, 0));
  select * into v_evento
  from public.scan_eventos e
  where e.acao in ('entrada_leitura', 'entrada_pedido_leitura', 'saida_leitura')
    and e.contexto->>'operacao_id' = p_operacao_id::text
  limit 1;
  if not found then
    raise exception 'Leitura não encontrada.' using errcode = 'P0002';
  end if;
  if exists (
    select 1 from public.scan_eventos e
    where e.acao = 'desfazer_leitura' and e.contexto->>'operacao_id' = p_operacao_id::text
  ) then
    return jsonb_build_object('operacao_id', p_operacao_id, 'repetido', true);
  end if;

  v_claims := coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
  v_ator := coalesce(nullif(v_claims->>'email', ''), auth.uid()::text);
  if not kontrol_private.tem_permissao_efetiva('estoque.lote.gerir')
    and (v_evento.usuario_id is distinct from auth.uid() or v_evento.criado_em < now() - interval '2 hours') then
    raise exception 'Só quem fez a leitura pode desfazê-la, até 2 horas depois. Depois disso, peça a quem tem "Corrigir estoque".'
      using errcode = '42501';
  end if;

  v_lote_id := (v_evento.contexto->>'lote_id')::bigint;
  select * into v_lote from public.lotes_estoque where id = v_lote_id for update;
  if not found then
    raise exception 'Lote da leitura não encontrado.' using errcode = 'P0002';
  end if;

  if v_evento.acao = 'entrada_pedido_leitura' then
    -- estorno bilateral (lote, item e situação da compra) da 0127
    perform public.estornar_recebimento_do_lote(v_lote_id, 'leitura desfeita');
  elsif v_evento.acao = 'entrada_leitura' then
    select coalesce(sum(r.quantidade - coalesce(r.quantidade_consumida, 0)), 0) into v_reservado
    from public.reservas_estoque r
    where r.lote_id = v_lote_id and r.status in ('reservado', 'parcial');
    if v_lote.status <> 'aceito' or v_lote.quantidade_atual <> v_lote.quantidade_inicial or v_reservado > 0 then
      raise exception 'O lote % já foi usado depois da entrada; corrija pelo Controle de Estoque.', v_lote.codigo_lote
        using errcode = '22023';
    end if;
    update public.lotes_estoque
       set quantidade_atual = 0,
           status = 'descartado',
           motivo_bloqueio = 'leitura desfeita'
     where id = v_lote_id;
    insert into public.estoque_movimentacoes (insumo_id, tipo, quantidade, custo_unitario, motivo, referencia, lote_id)
    values (v_lote.insumo_id, 'ajuste', v_lote.quantidade_atual, v_lote.custo_unitario,
            'leitura desfeita: entrada por código de barras', p_operacao_id::text, v_lote_id);
  else
    if v_lote.status not in ('aceito', 'consumido') or v_lote.quantidade_atual + 1 > v_lote.quantidade_inicial then
      raise exception 'O lote % mudou depois da abertura; corrija pelo Controle de Estoque.', v_lote.codigo_lote
        using errcode = '22023';
    end if;
    update public.lotes_estoque
       set quantidade_atual = quantidade_atual + 1,
           status = 'aceito'
     where id = v_lote_id;
    insert into public.estoque_movimentacoes (insumo_id, tipo, quantidade, custo_unitario, motivo, referencia, lote_id)
    values (v_lote.insumo_id, 'ajuste', 1, v_lote.custo_unitario,
            'leitura desfeita: abertura de embalagem', p_operacao_id::text, v_lote_id);
  end if;

  v_resultado := jsonb_build_object(
    'operacao_id', p_operacao_id,
    'tipo', case when v_evento.acao = 'saida_leitura' then 'saida' else 'entrada' end,
    'insumo_id', v_lote.insumo_id,
    'lote_id', v_lote_id,
    'repetido', false
  );
  insert into public.eventos_status (entidade, entidade_id, de_status, para_status, usuario, observacao)
  values ('lote_embalagem_fechada', v_lote_id, v_evento.acao, 'LEITURA_DESFEITA', v_ator,
          'Leitura de código desfeita (' || v_evento.codigo || ').');
  insert into public.scan_eventos (
    codigo, valor_lido, formato, entidade_tipo, entidade_id, acao, resultado, contexto, usuario, usuario_id
  ) values (
    v_evento.codigo, v_evento.codigo, v_evento.formato, 'insumo', v_lote.insumo_id, 'desfazer_leitura', 'atualizado',
    jsonb_build_object('operacao_id', p_operacao_id, 'lote_id', v_lote_id, 'acao_desfeita', v_evento.acao),
    v_ator, auth.uid()
  );
  return v_resultado;
end $$;

-- ---- 6. Inventário por insumo -------------------------------------------------

alter table public.inventario_contagens
  add column if not exists insumo_id bigint references public.insumos(id) on delete restrict;

alter table public.inventario_contagens
  alter column lote_id drop not null;

alter table public.inventario_contagens
  drop constraint if exists inventario_contagens_alvo_check;
alter table public.inventario_contagens
  add constraint inventario_contagens_alvo_check
  check (lote_id is not null or insumo_id is not null);

create index if not exists ix_inventario_contagens_insumo
  on public.inventario_contagens (insumo_id);

comment on column public.inventario_contagens.insumo_id is
  'Contagem por insumo (0143): total de embalagens fechadas, sem lote. Quando lote_id está preenchido, a contagem é do lote.';

create or replace function public.aplicar_ajuste_inventario_contagem(p_contagem_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_contagem public.inventario_contagens%rowtype;
  v_ciclo_status text;
  v_responsavel text;
  v_saldo_atual numeric;
  v_motivo text;
begin
  perform kontrol_private.exigir_permissao('estoque.lote.gerir');

  select *
    into v_contagem
    from public.inventario_contagens
   where id = p_contagem_id
   for update;

  if not found then
    raise exception 'Contagem de inventario nao encontrada.' using errcode = '22023';
  end if;

  select status
    into v_ciclo_status
    from public.inventario_ciclos
   where id = v_contagem.ciclo_id
   for update;

  if v_ciclo_status is distinct from 'aberto' then
    raise exception 'Campanha de inventario nao esta aberta.' using errcode = '22023';
  end if;

  if v_contagem.ajuste_aplicado then
    raise exception 'Ajuste ja aplicado para esta contagem.' using errcode = '22023';
  end if;

  if abs(v_contagem.divergencia) <= 0.000001 then
    raise exception 'Contagem sem divergencia nao exige ajuste.' using errcode = '22023';
  end if;

  if nullif(btrim(coalesce(v_contagem.justificativa, '')), '') is null then
    raise exception 'Justificativa obrigatoria para ajuste de inventario.' using errcode = '22023';
  end if;

  v_responsavel := coalesce(
    nullif(auth.jwt() ->> 'email', ''),
    nullif(auth.uid()::text, ''),
    current_user
  );
  v_motivo := 'inventario ciclo #' || v_contagem.ciclo_id || ': ' || btrim(v_contagem.justificativa)
    || coalesce(' (ajustado por ' || v_responsavel || ')', '');

  if v_contagem.lote_id is null then
    -- 0143: contagem por insumo (embalagens fechadas, sem lote)
    perform 1 from public.lotes_estoque
     where insumo_id = v_contagem.insumo_id and modelo_quantidade = 'EMBALAGEM_FECHADA' and status = 'aceito'
     order by id
     for update;
    select coalesce(sum(quantidade_atual), 0) into v_saldo_atual
    from public.lotes_estoque
    where insumo_id = v_contagem.insumo_id and modelo_quantidade = 'EMBALAGEM_FECHADA' and status = 'aceito';
    if v_saldo_atual is distinct from v_contagem.quantidade_sistema then
      raise exception 'O saldo do insumo mudou depois da contagem (era %, agora %). Conte de novo antes de ajustar.',
        v_contagem.quantidade_sistema, v_saldo_atual
        using errcode = '40001';
    end if;
    if v_contagem.quantidade_contada <> trunc(v_contagem.quantidade_contada) then
      raise exception 'A contagem por insumo é em embalagens fechadas: use um número inteiro.' using errcode = '22023';
    end if;
    perform public.corrigir_quantidade_embalagens_fechadas(
      v_contagem.insumo_id, v_contagem.quantidade_contada::integer, gen_random_uuid(), v_motivo
    );
  else
    select quantidade_atual into v_saldo_atual
    from public.lotes_estoque
    where id = v_contagem.lote_id
    for update;
    if v_saldo_atual is distinct from v_contagem.quantidade_sistema then
      raise exception 'O saldo do lote mudou depois da contagem (era %, agora %). Conte de novo antes de ajustar.',
        v_contagem.quantidade_sistema, v_saldo_atual
        using errcode = '40001';
    end if;

    perform public.ajustar_saldo_lote(v_contagem.lote_id, v_contagem.quantidade_contada, v_motivo);
  end if;

  update public.inventario_contagens
     set ajuste_aplicado = true,
         ajustado_em = now(),
         ajustado_por = v_responsavel
   where id = v_contagem.id;

  return jsonb_build_object(
    'contagem_id', v_contagem.id,
    'ciclo_id', v_contagem.ciclo_id,
    'lote_id', v_contagem.lote_id,
    'insumo_id', v_contagem.insumo_id,
    'quantidade_contada', v_contagem.quantidade_contada
  );
end;
$function$;

-- ---- Permissões de execução ---------------------------------------------------

revoke all on function public.registrar_entrada_por_leitura(bigint, integer, date, bigint, text, uuid) from public, anon;
revoke all on function public.registrar_recebimento_por_leitura(bigint, bigint, bigint, integer, date, bigint, text, uuid) from public, anon;
revoke all on function public.abrir_embalagem_por_leitura(bigint, text, uuid) from public, anon;
revoke all on function public.desfazer_leitura_estoque(uuid) from public, anon;
revoke all on function public.aplicar_ajuste_inventario_contagem(bigint) from public, anon;

grant execute on function public.registrar_entrada_por_leitura(bigint, integer, date, bigint, text, uuid) to authenticated;
grant execute on function public.registrar_recebimento_por_leitura(bigint, bigint, bigint, integer, date, bigint, text, uuid) to authenticated;
grant execute on function public.abrir_embalagem_por_leitura(bigint, text, uuid) to authenticated;
grant execute on function public.desfazer_leitura_estoque(uuid) to authenticated;
grant execute on function public.aplicar_ajuste_inventario_contagem(bigint) to authenticated;

commit;
