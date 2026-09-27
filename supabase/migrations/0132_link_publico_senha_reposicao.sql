-- Parecer técnico de 27/09/2026 sobre a versão 1.1.7 (conferido no código).
--
-- O que muda e por quê:
--
--  1. Link público da proposta: ler_orcamento_publico devolvia o snapshot
--     inteiro (custos, parâmetros, lucro) a quem tivesse o link, chamando o
--     banco direto com a chave pública. A página do cliente já mostra só o
--     valor comercial, mas precisa do snapshot para montar a composição. A
--     leitura passa a ser feita só pelo servidor do app (service_role); anon e
--     authenticated perdem a execução. aprovar_orcamento_publico continua
--     pública (não devolve o snapshot).
--  2. Conta com senha provisória não opera no banco antes de trocar a senha.
--     A troca já era exigida pelo proxy do app, mas um token obtido direto no
--     Auth chegava às RPCs e às políticas de escrita com todas as permissões.
--     Critério (ambos): perfis.senha_provisoria = true E o token ainda com
--     app_metadata.senha_provisoria = true. Assim, logo depois da troca (token
--     antigo ainda marcado, perfil já limpo) a conta não fica travada, e uma
--     falha ao limpar o perfil não prende a conta depois que o token renova.
--     Vale para tem_permissao_efetiva (RPCs e políticas de escrita),
--     minhas_permissoes (menu) e current_papel (políticas antigas por papel).
--  3. Validade: a entrada manual em frascos (registrar_entrada_manual_embalagens)
--     passa a recusar validade vencida, como a entrada direta da 0130. A RPC
--     antiga receber_lote (sem validade, sem proteção contra repetição e sem
--     uso no app) deixa de ser executável por usuários; fica só para o
--     service_role.
--  4. Previsão da compra: ao marcar "Enviado ao fornecedor", a data prevista
--     pode ser recalculada (envio + prazo do fornecedor). Na aprovação o app
--     passa a somar a tramitação (parâmetro prazo_tramitacao_compra_dias).
--  5. Reposição aguardando aprovação: compra ainda "solicitada" (inclusive o
--     rascunho automático diário) e pedido interno de reposição ainda não
--     aprovado para compra continuam descontando a quantidade sugerida (para
--     o rascunho automático não repetir itens), mas deixam de silenciar o
--     painel: v_previsao_suprimentos ganha qtd_pedida_pendente e
--     qtd_reposicao_pendente, e v_alertas_estoque ganha o alerta
--     "reposicao_pendente" quando a necessidade só está coberta por pedidos
--     ainda sem aprovação.
--  6. Auto-cadastro: o Auth de produção aceitava cadastro por e-mail
--     (disable_signup = false) e o perfil nascia técnico ativo, com as
--     permissões padrão do papel. Todo cadastro legítimo passa pelo
--     administrador (createUser com app_metadata.cadastrado_pelo_admin); o
--     perfil criado sem essa marca passa a nascer suspenso. A correção
--     principal é desligar o cadastro no painel do Supabase; esta é a defesa
--     no banco. Perfis existentes não mudam.
--
-- Não remove tabelas, colunas, dados, RLS nem gatilhos de auditoria. As
-- funções recriadas partem do pg_get_functiondef vigente (0131) com a mudança
-- pontual descrita; as views partem da 0130 com colunas novas no fim.
--
-- Rollback: reaplicar tem_permissao_efetiva (0112), minhas_permissoes (0124),
-- current_papel (0128), registrar_entrada_manual_embalagens (0109, com a
-- permissão da 0124), transicionar_pedido_compra e as views v_previsao_suprimentos
-- e v_alertas_estoque (0130; as colunas novas exigem drop/recreate das views
-- dependentes), devolver execute de ler_orcamento_publico e receber_lote a
-- anon/authenticated (0101/0130), reaplicar fn_novo_perfil (0026) e remover
-- kontrol_private.senha_provisoria_pendente. Nenhum dado requer reversão.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- ---- 1. Link público: leitura só pelo servidor ------------------------------
revoke all on function public.ler_orcamento_publico(text) from public, anon, authenticated;
grant execute on function public.ler_orcamento_publico(text) to service_role;

-- ---- 2. Senha provisória -----------------------------------------------------
create or replace function kontrol_private.senha_provisoria_pendente()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(auth.jwt() -> 'app_metadata' -> 'senha_provisoria' = 'true'::jsonb, false)
     and exists (
       select 1 from public.perfis p
       where p.id = auth.uid() and p.senha_provisoria
     );
$$;

comment on function kontrol_private.senha_provisoria_pendente() is
  'Verdadeiro enquanto a conta do token ainda usa a senha provisória (perfil e token marcados). Sem permissões até a troca (0132).';

revoke all on function kontrol_private.senha_provisoria_pendente() from public, anon, authenticated, service_role;
grant execute on function kontrol_private.senha_provisoria_pendente() to authenticated;

CREATE OR REPLACE FUNCTION kontrol_private.tem_permissao_efetiva(p_chave text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  v_papel text;
  v_permissoes jsonb;
  v_valor jsonb;
begin
  if p_chave is null
    or p_chave !~ '^[a-z_]+(\.[a-z_]+)+$'
    or auth.uid() is null then
    return false;
  end if;
  -- 0132: senha provisória não opera até a troca.
  if kontrol_private.senha_provisoria_pendente() then
    return false;
  end if;

  select papel, permissoes into v_papel, v_permissoes
  from public.perfis
  where id = auth.uid() and not suspenso;
  if not found then
    return false;
  end if;
  if v_papel = 'admin' then
    return true;
  end if;
  if v_papel not in ('tecnico', 'coordenador', 'gestor') then
    return false;
  end if;

  if v_permissoes ? p_chave then
    v_valor := v_permissoes -> p_chave;
  else
    select permissoes -> p_chave into v_valor
    from public.permissoes_categorias where papel = v_papel;
  end if;
  if jsonb_typeof(v_valor) = 'boolean' then
    return v_valor = 'true'::jsonb;
  end if;
  return false;
end $function$;

CREATE OR REPLACE FUNCTION public.minhas_permissoes()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_perfil record;
  v_categoria jsonb;
begin
  if auth.uid() is null then
    return jsonb_build_object('admin', false, 'permissoes', '{}'::jsonb);
  end if;
  -- 0132: senha provisória não opera até a troca.
  if kontrol_private.senha_provisoria_pendente() then
    return jsonb_build_object('admin', false, 'permissoes', '{}'::jsonb, 'senha_provisoria', true);
  end if;
  select papel, permissoes, suspenso into v_perfil from public.perfis where id = auth.uid();
  if not found or v_perfil.suspenso then
    return jsonb_build_object('admin', false, 'permissoes', '{}'::jsonb);
  end if;
  if v_perfil.papel = 'admin' then
    return jsonb_build_object('admin', true, 'permissoes', '{}'::jsonb);
  end if;
  select permissoes into v_categoria from public.permissoes_categorias where papel = v_perfil.papel;
  return jsonb_build_object(
    'admin', false,
    'permissoes', coalesce(v_categoria, '{}'::jsonb) || coalesce(v_perfil.permissoes, '{}'::jsonb)
  );
end $function$;

CREATE OR REPLACE FUNCTION public.current_papel()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- 0132: suspenso ou com senha provisória não tem papel.
  select papel from perfis
  where id = auth.uid() and not suspenso
    and not kontrol_private.senha_provisoria_pendente();
$function$;

CREATE OR REPLACE FUNCTION public.fn_novo_perfil()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  insert into perfis(id, email, nome, senha_provisoria, suspenso)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data->>'nome',
    coalesce((new.raw_user_meta_data->>'senha_provisoria')::boolean, false),
    -- 0132: só nasce ativo quem o administrador cadastrou; auto-cadastro fica suspenso.
    not coalesce(new.raw_app_meta_data->'cadastrado_pelo_admin' = 'true'::jsonb, false)
  )
  on conflict (id) do nothing;
  return new;
end $function$;

-- ---- 3. Validade na entrada manual em frascos; RPC antiga fora do app -------

CREATE OR REPLACE FUNCTION public.registrar_entrada_manual_embalagens(p_insumo_id bigint, p_quantidade_embalagens integer, p_operacao_id uuid, p_validade date, p_custo_total_embalagem numeric, p_codigo_lote text, p_fornecedor text, p_motivo text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_ator_id uuid := auth.uid();
  v_claims jsonb;
  v_ator text;
  v_insumo public.insumos%rowtype;
  v_lote_id bigint;
  v_requisicao jsonb;
  v_resultado jsonb;
  v_evento public.eventos_status%rowtype;
begin
  perform kontrol_private.exigir_permissao('estoque.movimentar');
  if v_ator_id is null then
    raise exception 'Sessão inválida.' using errcode = '28000';
  end if;
  if p_insumo_id is null or p_quantidade_embalagens is null
    or p_quantidade_embalagens <= 0 or p_operacao_id is null
    or p_custo_total_embalagem is null or p_custo_total_embalagem < 0
    or nullif(btrim(p_motivo), '') is null then
    raise exception 'Verifique insumo, quantidade, custo e motivo.' using errcode = '22023';
  end if;

  v_requisicao := jsonb_build_object(
    'acao', 'registrar_entrada_manual_embalagens', 'insumo_id', p_insumo_id,
    'quantidade_embalagens', p_quantidade_embalagens, 'validade', p_validade,
    'custo_total_embalagem', p_custo_total_embalagem,
    'codigo_lote', nullif(btrim(p_codigo_lote), ''),
    'fornecedor', nullif(btrim(p_fornecedor), ''), 'motivo', btrim(p_motivo)
  );
  perform pg_advisory_xact_lock(hashtextextended(p_operacao_id::text, 0));
  select * into v_evento
  from public.eventos_status e
  where e.entidade = 'lote_embalagem_fechada'
    and e.operacao_id = p_operacao_id
  for update;
  if found then
    if v_evento.operacao_payload->'requisicao' is distinct from v_requisicao then
      raise exception 'Esta operação já foi registrada com dados diferentes.' using errcode = '23505';
    end if;
    return jsonb_set(
      v_evento.operacao_payload->'resultado', '{repetido}', 'true'::jsonb, true
    );
  end if;

  select * into v_insumo
  from public.insumos i
  where i.id = p_insumo_id
  for update;
  if not found then
    raise exception 'Insumo não encontrado.' using errcode = 'P0002';
  end if;
  if exists (
    select 1 from public.lotes_estoque l
    where l.insumo_id = p_insumo_id and l.modelo_quantidade = 'LEGADO' and l.quantidade_atual > 0
  ) then
    raise exception 'Este insumo usa controle por volume (modelo legado); use o fluxo de recebimento existente.' using errcode = '22023';
  end if;
  if nullif(btrim(v_insumo.unidade), '') is null
    or v_insumo.quantidade_embalagem is null or v_insumo.quantidade_embalagem <= 0
    or nullif(btrim(coalesce(v_insumo.unidade_consumo, v_insumo.unidade)), '') is null
    or v_insumo.fator_conversao is null or v_insumo.fator_conversao <= 0 then
    raise exception 'Cadastro da embalagem incompleto; complete unidade, quantidade da embalagem e fator de conversão.' using errcode = '22023';
  end if;
  if v_insumo.categoria_compra = 'critico' and p_validade is null then
    raise exception 'Insumo crítico exige data de validade.' using errcode = '22023';
  end if;
  -- 0132: mesma regra da entrada direta (0130): vencido não entra no estoque.
  if p_validade is not null and p_validade < current_date then
    raise exception 'A validade informada (%) já passou: material vencido não entra no estoque. Confira a data ou devolva ao fornecedor.',
      to_char(p_validade, 'DD/MM/YYYY') using errcode = '22023';
  end if;

  v_claims := coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
  v_ator := coalesce(nullif(v_claims->>'email', ''), v_ator_id::text);
  insert into public.lotes_estoque (
    insumo_id, codigo_lote, validade, quantidade_inicial, quantidade_atual,
    custo_unitario, fornecedor, status, responsavel_recebimento,
    modelo_quantidade, unidade_fisica_snapshot, conteudo_embalagem_snapshot,
    unidade_consumo_snapshot, fator_conversao_snapshot
  ) values (
    p_insumo_id, coalesce(nullif(btrim(p_codigo_lote), ''), 'MANUAL-' || left(p_operacao_id::text, 8)),
    p_validade, p_quantidade_embalagens, p_quantidade_embalagens,
    p_custo_total_embalagem, nullif(btrim(p_fornecedor), ''), 'aceito', v_ator,
    'EMBALAGEM_FECHADA', btrim(v_insumo.unidade), v_insumo.quantidade_embalagem,
    btrim(coalesce(v_insumo.unidade_consumo, v_insumo.unidade)),
    v_insumo.fator_conversao
  ) returning id into v_lote_id;

  insert into public.estoque_movimentacoes (
    insumo_id, tipo, quantidade, custo_unitario, motivo, referencia, lote_id
  ) values (
    p_insumo_id, 'entrada', p_quantidade_embalagens, p_custo_total_embalagem,
    'entrada manual de embalagens fechadas: ' || btrim(p_motivo),
    p_operacao_id::text, v_lote_id
  );

  v_resultado := jsonb_build_object(
    'insumo_id', p_insumo_id, 'lote_id', v_lote_id,
    'quantidade_embalagens', p_quantidade_embalagens, 'repetido', false
  );
  insert into public.eventos_status (
    entidade, entidade_id, de_status, para_status, usuario, observacao,
    operacao_id, operacao_payload
  ) values (
    'lote_embalagem_fechada', v_lote_id, null, 'ENTRADA_MANUAL', v_ator,
    btrim(p_motivo), p_operacao_id,
    jsonb_build_object('requisicao', v_requisicao, 'resultado', v_resultado)
  );
  return v_resultado;
end;
$function$;

revoke all on function public.receber_lote(bigint, numeric, date, numeric, text, text, bigint, text, text)
  from public, anon, authenticated;
grant execute on function public.receber_lote(bigint, numeric, date, numeric, text, text, bigint, text, text)
  to service_role;
comment on function public.receber_lote(bigint, numeric, date, numeric, text, text, bigint, text, text) is
  'Legado sem uso no app (sem validade nem proteção contra repetição). Só service_role desde a 0132; use entrada_inventario.';

-- ---- 4. Previsão da compra recalculada no envio ----------------------------
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

  select id, status
    into v_pedido
  from public.pedidos_compra
  where id = p_pedido_id
  for update;

  if not found then
    raise exception 'Pedido de compra nao encontrado.' using errcode = 'P0002';
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

-- ---- 5. Reposição aguardando aprovação -------------------------------------
create or replace view public.v_previsao_suprimentos
with (security_invoker = true) as
 WITH cfg AS (
         SELECT COALESCE(( SELECT parametros.valor::integer AS valor
                   FROM parametros
                  WHERE parametros.chave = 'janela_consumo_previsao_dias'::text), 90) AS janela,
                COALESCE(( SELECT parametros.valor::integer AS valor
                   FROM parametros
                  WHERE parametros.chave = 'prazo_tramitacao_compra_dias'::text), 0) AS tramitacao
        ), modelo AS (
         SELECT s.insumo_id,
            s.modelo_quantidade,
            NULLIF(i.quantidade_embalagem, 0::numeric) AS conteudo
           FROM v_estoque_saldo s
             JOIN insumos i ON i.id = s.insumo_id
        ), consumo AS (
         SELECT m.insumo_id,
            sum(
                CASE
                    WHEN m.tipo <> 'saida'::text THEN 0::numeric
                    WHEN md.modelo_quantidade = 'EMBALAGEM_FECHADA'::text AND COALESCE(l.modelo_quantidade, 'LEGADO'::text) <> 'EMBALAGEM_FECHADA'::text AND md.conteudo IS NOT NULL
                      THEN m.quantidade / md.conteudo
                    WHEN md.modelo_quantidade <> 'EMBALAGEM_FECHADA'::text AND l.modelo_quantidade = 'EMBALAGEM_FECHADA'::text
                      THEN m.quantidade * COALESCE(NULLIF(l.conteudo_embalagem_snapshot, 0::numeric), 1::numeric)
                    ELSE m.quantidade
                END) AS consumo_janela
           FROM estoque_movimentacoes m
             CROSS JOIN cfg
             LEFT JOIN lotes_estoque l ON l.id = m.lote_id
             LEFT JOIN modelo md ON md.insumo_id = m.insumo_id
          WHERE m.data >= (CURRENT_DATE - cfg.janela)
          GROUP BY m.insumo_id
        ), compras_abertas AS (
         SELECT c.insumo_id,
            sum(c.qtd_restante) AS quantidade,
            sum(c.qtd_restante) FILTER (WHERE c.prevista < CURRENT_DATE) AS atrasada,
            min(c.prevista) FILTER (WHERE c.prevista < CURRENT_DATE AND c.qtd_restante > 0::numeric) AS atrasada_desde,
            -- 0132: compra ainda solicitada (sem aprovação), inclusive o rascunho automático.
            sum(c.qtd_restante) FILTER (WHERE c.status = 'solicitado'::text) AS pendente
           FROM v_compras_prazo c
          GROUP BY c.insumo_id
        ), reposicoes_internas_abertas AS (
         SELECT pii.insumo_id,
            sum(GREATEST(pii.quantidade - COALESCE(pii.quantidade_recebida, 0::numeric), 0::numeric)
                * kontrol_private.fator_item_para_estoque(pii.insumo_id, COALESCE(pii.quantidade_em, 'unidade'), pii.conteudo_embalagem)) AS quantidade
           FROM pedidos_internos_itens pii
             JOIN pedidos_internos p ON p.id = pii.pedido_interno_id
          WHERE p.origem = 'reposicao_estoque'::text AND (p.status = ANY (ARRAY['rascunho'::text, 'em_validacao'::text, 'ajuste_solicitante'::text, 'validado'::text])) AND pii.insumo_id IS NOT NULL
          GROUP BY pii.insumo_id
        ), abertos AS (
         SELECT fontes.insumo_id,
            sum(fontes.quantidade) AS qtd_pedida_aberta,
            sum(fontes.pendente) AS qtd_pedida_pendente
           FROM ( SELECT compras_abertas.insumo_id,
                    compras_abertas.quantidade,
                    COALESCE(compras_abertas.pendente, 0::numeric) AS pendente
                   FROM compras_abertas
                UNION ALL
                 -- 0132: pedido interno de reposição aberto ainda não foi aprovado para compra.
                 SELECT reposicoes_internas_abertas.insumo_id,
                    reposicoes_internas_abertas.quantidade,
                    reposicoes_internas_abertas.quantidade AS pendente
                   FROM reposicoes_internas_abertas) fontes
          GROUP BY fontes.insumo_id
        ), base AS (
         SELECT s.insumo_id,
            s.especificacao,
            s.unidade,
            s.disponivel,
            s.em_maos,
            s.reservado,
            s.ponto_reposicao AS ponto_reposicao_configurado,
            COALESCE(s.estoque_seguranca, 0::numeric) AS estoque_seguranca,
            -- Zero ou vazio no insumo cai para o prazo médio do fornecedor.
            COALESCE(NULLIF(i.lead_time_dias, 0), NULLIF(f.prazo_medio_dias, 0), NULLIF(i.prazo_entrega_max_dias, 0), 0) AS prazo_fornecedor_dias,
            cfg.tramitacao AS prazo_tramitacao_dias,
            cfg.janela AS janela_dias,
            COALESCE(c.consumo_janela, 0::numeric) AS consumo_janela,
                CASE
                    WHEN cfg.janela > 0 THEN COALESCE(c.consumo_janela, 0::numeric) / cfg.janela::numeric
                    ELSE 0::numeric
                END AS consumo_medio_diario,
            COALESCE(a.qtd_pedida_aberta, 0::numeric) AS qtd_pedida_aberta,
            COALESCE(a.qtd_pedida_pendente, 0::numeric) AS qtd_pedida_pendente,
            COALESCE(ca.atrasada, 0::numeric) AS qtd_compra_atrasada,
            ca.atrasada_desde AS compra_atrasada_desde,
            i.fornecedor_id,
            f.nome AS fornecedor_nome,
            i.custo_unitario,
            i.categoria_compra,
            s.modelo_quantidade,
            s.unidade_saldo
           FROM v_estoque_saldo s
             JOIN insumos i ON i.id = s.insumo_id
             LEFT JOIN fornecedores f ON f.id = i.fornecedor_id
             LEFT JOIN consumo c ON c.insumo_id = s.insumo_id
             LEFT JOIN abertos a ON a.insumo_id = s.insumo_id
             LEFT JOIN compras_abertas ca ON ca.insumo_id = s.insumo_id
             CROSS JOIN cfg
        ), calc AS (
         SELECT base.*,
            base.prazo_tramitacao_dias + base.prazo_fornecedor_dias AS lead_time_dias,
            -- Uma regra só: o maior entre o ponto cadastrado e o consumo durante
            -- o prazo total mais o estoque de segurança.
            GREATEST(COALESCE(base.ponto_reposicao_configurado, 0::numeric),
                     base.consumo_medio_diario * (base.prazo_tramitacao_dias + base.prazo_fornecedor_dias)::numeric
                       + base.estoque_seguranca) AS necessidade
           FROM base
        )
 SELECT insumo_id,
    especificacao,
    unidade,
    disponivel,
    em_maos,
    reservado,
    ponto_reposicao_configurado,
    estoque_seguranca,
    lead_time_dias,
    janela_dias,
    consumo_janela,
    consumo_medio_diario,
        CASE
            WHEN consumo_janela > 0::numeric THEN disponivel / consumo_medio_diario
            ELSE NULL::numeric
        END AS dias_cobertura,
    necessidade AS ponto_reposicao_sugerido,
    -- Insumo contado em frascos só se compra em frascos inteiros.
        CASE
            WHEN modelo_quantidade = 'EMBALAGEM_FECHADA'::text
              THEN ceil(GREATEST(0::numeric, necessidade - disponivel - qtd_pedida_aberta))
            ELSE GREATEST(0::numeric, necessidade - disponivel - qtd_pedida_aberta)
        END AS qtd_sugerida_compra,
    qtd_pedida_aberta,
    fornecedor_id,
    fornecedor_nome,
    custo_unitario,
    categoria_compra,
    unidade_saldo,
    prazo_fornecedor_dias,
    prazo_tramitacao_dias,
    qtd_compra_atrasada,
    compra_atrasada_desde,
    -- 0132: parte do que está a caminho que ainda aguarda aprovação.
    qtd_pedida_pendente,
    -- 0132: parte da necessidade coberta só por pedidos ainda sem aprovação.
    LEAST(qtd_pedida_pendente,
          GREATEST(0::numeric, necessidade - disponivel - (qtd_pedida_aberta - qtd_pedida_pendente))) AS qtd_reposicao_pendente
   FROM calc;

comment on column public.v_previsao_suprimentos.qtd_pedida_pendente is
  'Parte de qtd_pedida_aberta ainda sem aprovação: compra solicitada ou pedido interno de reposição aberto (0132).';
comment on column public.v_previsao_suprimentos.qtd_reposicao_pendente is
  'Necessidade coberta só por pedidos ainda sem aprovação; > 0 com sugestão zerada gera o alerta reposicao_pendente (0132).';

-- Alertas: "reposicao" usa a mesma conta da sugestão; "compra_atrasada" avisa
-- quando o estoque já está no ponto e a compra que viria está atrasada. Sem o
-- ramo de quarentena (0130). "reposicao_pendente" (0132): a sugestão está
-- zerada só porque há compra solicitada ou pedido interno ainda sem aprovação.
create or replace view public.v_alertas_estoque
with (security_invoker = on) as
 SELECT 'reposicao'::text AS tipo,
    p.insumo_id,
    p.especificacao,
    NULL::date AS validade,
    p.disponivel AS valor,
    p.ponto_reposicao_sugerido AS referencia,
    NULL::bigint AS lote_id
   FROM v_previsao_suprimentos p
  WHERE p.qtd_sugerida_compra > 0::numeric
UNION ALL
 SELECT 'compra_atrasada'::text AS tipo,
    p.insumo_id,
    p.especificacao,
    p.compra_atrasada_desde AS validade,
    p.disponivel AS valor,
    p.ponto_reposicao_sugerido AS referencia,
    NULL::bigint AS lote_id
   FROM v_previsao_suprimentos p
  WHERE p.qtd_compra_atrasada > 0::numeric AND p.disponivel <= p.ponto_reposicao_sugerido
UNION ALL
 SELECT 'reposicao_pendente'::text AS tipo,
    p.insumo_id,
    p.especificacao,
    NULL::date AS validade,
    p.disponivel AS valor,
    p.ponto_reposicao_sugerido AS referencia,
    NULL::bigint AS lote_id
   FROM v_previsao_suprimentos p
  WHERE p.qtd_sugerida_compra <= 0::numeric AND p.qtd_reposicao_pendente > 0::numeric
UNION ALL
 SELECT 'sem_validade'::text AS tipo,
    l.insumo_id,
    i.especificacao,
    NULL::date AS validade,
    l.quantidade_atual AS valor,
    NULL::numeric AS referencia,
    l.id AS lote_id
   FROM lotes_estoque l
     JOIN insumos i ON i.id = l.insumo_id
  WHERE l.quantidade_atual > 0::numeric AND (l.status = ANY (ARRAY['aceito'::text, 'em_uso'::text])) AND l.validade IS NULL AND i.categoria_compra = 'critico'::text
UNION ALL
 SELECT
        CASE
            WHEN menor_validade(l.validade, l.validade_apos_abertura) < CURRENT_DATE THEN 'vencido'::text
            ELSE 'vencimento'::text
        END AS tipo,
    l.insumo_id,
    i.especificacao,
    menor_validade(l.validade, l.validade_apos_abertura) AS validade,
    l.quantidade_atual AS valor,
    NULL::numeric AS referencia,
    l.id AS lote_id
   FROM lotes_estoque l
     JOIN insumos i ON i.id = l.insumo_id
  WHERE l.quantidade_atual > 0::numeric AND (l.status = ANY (ARRAY['aceito'::text, 'em_uso'::text])) AND menor_validade(l.validade, l.validade_apos_abertura) IS NOT NULL AND menor_validade(l.validade, l.validade_apos_abertura) <= (CURRENT_DATE + COALESCE((( SELECT parametros.valor
           FROM parametros
          WHERE parametros.chave = 'janela_vencimento_dias'::text))::integer, 60));

revoke all on public.v_previsao_suprimentos, public.v_alertas_estoque from anon;
grant select on public.v_previsao_suprimentos, public.v_alertas_estoque to authenticated, service_role;

commit;
