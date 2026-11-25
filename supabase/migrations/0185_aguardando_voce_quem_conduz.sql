-- 0185 — "Aguardando você" mostra a quem conduz a compra inteira o pedido
-- travado no ciclo seguinte.
--
-- Pedido de Antonio em 25/11/2026 (thread das rodadas de usabilidade), depois
-- da pergunta da Rafaela ("Aqui ainda tá aguardando a data"): "Nada pode
-- travar administrador porque ele pode tudo." No cartão ele escolheu "Mostrar
-- para quem conduz".
--
-- Desde a 0184, o Administrador e quem tem "Conduzir a compra inteira"
-- (compras.conduzir) seguem para compras antes do ciclo do dia 10 abrir, e a
-- tela e a lista de Pedidos já mostram isso (2.3.4). Só o "Aguardando você"
-- (0176) ainda escondia o pedido travado até o dia 1 do mês do ciclo.
--
-- O que muda em public.aguardando_voce():
--   * a fila "Pedidos para formalizar e autorizar" mostra o pedido travado no
--     ciclo seguinte a quem conduz a compra inteira;
--   * as filas de Compras (formalizar e autorizar; orçamentos e aprovação
--     final; pagamento) aparecem também para quem conduz a compra inteira,
--     além do Administrador e dos responsáveis do administrativo e do
--     pagamento.
--
-- O que não muda: o responsável do administrativo sem a caixinha continua
-- vendo o pedido travado só quando o ciclo abrir; a trava da formalização
-- (travar_ciclo_seguinte, 0184) e os avisos não mudam; nenhuma permissão muda.
--
-- Só recria uma função de leitura (mesmo corpo da 0176, com a caixinha nova
-- em três pontos). Não apaga dado, coluna, RLS nem auditoria.
--
-- Rollback: reaplicar public.aguardando_voce() da 0176 (seção 5) e os mesmos
-- revoke/grant do fim deste arquivo.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if to_regprocedure('kontrol_private.conduz_compra()') is null then
    raise exception '0185: requer a migration 0184';
  end if;
  if to_regprocedure('public.aguardando_voce()') is null
     or to_regprocedure('kontrol_private.ciclo_libera_em(date,text,text)') is null then
    raise exception '0185: requer a migration 0176';
  end if;
end $$;

create or replace function public.aguardando_voce()
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_saida jsonb := '[]'::jsonb;
  v_qtd bigint;
  v_itens jsonb;
  v_uid uuid := auth.uid();
  v_admin boolean := coalesce(public.current_papel(), '') = 'admin';
  -- 0185: quem conduz a compra inteira (o Administrador tem todas as caixinhas)
  v_conduz boolean := coalesce(kontrol_private.conduz_compra(), false);
begin
  if v_uid is null then
    return v_saida;
  end if;

  -- 0173: validação só para quem decide (coordenador competente ou Administrador)
  with minhas as (
    select p.id, '#' || p.id || ' · ' || coalesce(p.titulo, 'sem título') as rotulo,
           coalesce(p.enviado_validacao_em, p.atualizado_em, p.criado_em) as desde
      from public.pedidos_internos p
     where p.status = 'em_validacao'
       and (v_admin or coalesce(
             (kontrol_private.aprovadores_pedido(p.projeto_id, p.natureza, p.area_id) -> 'coordenador' -> 'ids') ? v_uid::text,
             false))
  )
  select (select count(*) from minhas),
         coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'rotulo', s.rotulo))
                     from (select id, rotulo from minhas order by desde limit 3) s), '[]'::jsonb)
    into v_qtd, v_itens;
  if v_qtd > 0 or kontrol_private.tem_permissao_efetiva('pedido.aprovar') then
    v_saida := v_saida || jsonb_build_array(jsonb_build_object('chave', 'pedidos_validacao', 'quantidade', v_qtd, 'itens', v_itens));
  end if;

  -- 0173: coordenação do laboratório (coordenador ou substituto)
  with minhas as (
    select p.id, '#' || p.id || ' · ' || coalesce(p.titulo, 'sem título') as rotulo, p.atualizado_em as desde
      from public.pedidos_internos p
      join public.coordenacoes_area c on c.id = p.area_id
     where p.status = 'validado' and p.natureza = 'material_consumo_lab' and p.aprovacao_area_em is null
       and (v_admin or v_uid in (c.coordenador_id, c.substituto_id))
  )
  select (select count(*) from minhas),
         coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'rotulo', s.rotulo))
                     from (select id, rotulo from minhas order by desde limit 3) s), '[]'::jsonb)
    into v_qtd, v_itens;
  if v_qtd > 0 then
    v_saida := v_saida || jsonb_build_array(jsonb_build_object('chave', 'pedidos_laboratorio', 'quantidade', v_qtd, 'itens', v_itens));
  end if;

  -- 0173: etapas de compras (responsável do administrativo; sem ele, o Administrador)
  -- 0185: e quem conduz a compra inteira
  if v_admin or v_conduz or v_uid is not distinct from kontrol_private.responsavel_compras('administrativo') then
    -- formalizar e autorizar (fonte e rubrica)
    with fila as (
      select p.id, '#' || p.id || ' · ' || coalesce(p.titulo, 'sem título') as rotulo, p.atualizado_em as desde
        from public.pedidos_internos p
       where p.status in ('formalizado', 'analise_administrativa')
          or (p.status = 'validado'
              and (coalesce(p.natureza, '') <> 'material_consumo_lab' or p.aprovacao_area_em is not null)
              -- 0176: pedido do ciclo seguinte aparece quando o ciclo dele abrir;
              -- 0185: para quem conduz a compra inteira, que segue antes, aparece já
              and (v_conduz
                   or kontrol_private.ciclo_libera_em(p.ciclo_pagamento, p.urgencia, p.urgencia_justificativa) is null))
    )
    select (select count(*) from fila),
           coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'rotulo', s.rotulo))
                       from (select id, rotulo from fila order by desde limit 3) s), '[]'::jsonb)
      into v_qtd, v_itens;
    if v_qtd > 0 then
      v_saida := v_saida || jsonb_build_array(jsonb_build_object('chave', 'pedidos_administrativo', 'quantidade', v_qtd, 'itens', v_itens));
    end if;
    -- 3 orçamentos, aprovação final e fechamento da compra
    with fila as (
      select p.id, '#' || p.id || ' · ' || coalesce(p.titulo, 'sem título') as rotulo, p.atualizado_em as desde
        from public.pedidos_internos p
       where p.status in ('aprovado_compra', 'orcamentos', 'orcamentos_recebidos', 'aguardando_aprovacao_final', 'aprovado_para_compra')
    )
    select (select count(*) from fila),
           coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'rotulo', s.rotulo))
                       from (select id, rotulo from fila order by desde limit 3) s), '[]'::jsonb)
      into v_qtd, v_itens;
    if v_qtd > 0 then
      v_saida := v_saida || jsonb_build_array(jsonb_build_object('chave', 'pedidos_compras', 'quantidade', v_qtd, 'itens', v_itens));
    end if;
  end if;
  if v_admin or v_conduz or v_uid is not distinct from kontrol_private.responsavel_compras('pagamento') then
    with prontos as (
      select p.id, '#' || p.id || ' · ' || coalesce(p.titulo, 'sem título') as rotulo, p.atualizado_em as desde
        from public.pedidos_internos p
       where p.status = 'aguardando_pagamento_nf'
          or (p.status in ('compra_fechada', 'encaminhado_instituicao') and kontrol_private.pendencia_pagamento(p.id) is null)
    )
    select (select count(*) from prontos),
           coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'rotulo', s.rotulo))
                       from (select id, rotulo from prontos order by desde limit 3) s), '[]'::jsonb)
      into v_qtd, v_itens;
    if v_qtd > 0 then
      v_saida := v_saida || jsonb_build_array(jsonb_build_object('chave', 'pedidos_pagamento', 'quantidade', v_qtd, 'itens', v_itens));
    end if;
  end if;

  if kontrol_private.tem_permissao_efetiva('compras.aprovar') then
    -- 0173: compra ligada a pedido interno é aprovada junto com ele (0170)
    with soltas as (
      select pc.id, 'Compra #' || pc.id || coalesce(' · ' || nullif(pc.projeto, ''), '') as rotulo, pc.criado_em
        from public.pedidos_compra pc
       where pc.status = 'solicitado'
         and coalesce(pc.observacao, '') not like 'Formalizado a partir do pedido interno #%'
         and not exists (select 1 from public.pedidos_internos pi where pi.pedido_compra_id = pc.id)
    )
    select (select count(*) from soltas),
           coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'rotulo', s.rotulo))
                       from (select id, rotulo from soltas order by criado_em limit 3) s), '[]'::jsonb)
      into v_qtd, v_itens;
    v_saida := v_saida || jsonb_build_array(jsonb_build_object('chave', 'compras_aprovar', 'quantidade', v_qtd, 'itens', v_itens));
  end if;

  if kontrol_private.tem_permissao_efetiva('compras.receber') then
    select count(*) into v_qtd from public.pedidos_compra where status in ('aprovado', 'enviado', 'em_transito');
    select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'rotulo', s.rotulo)), '[]'::jsonb) into v_itens
    from (
      select id, 'Compra #' || id || coalesce(' · ' || nullif(projeto, ''), '') as rotulo
      from public.pedidos_compra where status in ('aprovado', 'enviado', 'em_transito')
      order by criado_em limit 3
    ) s;
    v_saida := v_saida || jsonb_build_array(jsonb_build_object('chave', 'compras_receber', 'quantidade', v_qtd, 'itens', v_itens));
  end if;

  if kontrol_private.tem_permissao_efetiva('orcamentos.emitir') then
    with prontas as (
      select d.id, coalesce(d.titulo, 'Proposta #' || d.id) as rotulo, d.criado_em
      from public.demandas_propostas d
      where d.status in ('nova', 'em_analise')
        and (
          exists (select 1 from public.orcamentos o where o.demanda_id = d.id and o.status_operacional = 'revisado')
          or exists (select 1 from public.orcamento_projetos p where p.demanda_id = d.id and p.status = 'enviado')
        )
        and not exists (
          select 1 from public.orcamento_final_versoes f
          where f.demanda_id = d.id and f.status not in ('cancelado', 'substituido')
        )
    )
    select (select count(*) from prontas),
      coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'rotulo', s.rotulo))
        from (select id, rotulo from prontas order by criado_em limit 3) s), '[]'::jsonb)
    into v_qtd, v_itens;
    v_saida := v_saida || jsonb_build_array(jsonb_build_object('chave', 'propostas_emitir', 'quantidade', v_qtd, 'itens', v_itens));
  end if;

  if kontrol_private.tem_permissao_efetiva('planejamento.editar') then
    select count(*) into v_qtd from public.planejamento where coalesce(status_operacional, 'rascunho') = 'rascunho';
    select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'rotulo', s.rotulo)), '[]'::jsonb) into v_itens
    from (
      select id, coalesce(nome, 'Plano #' || id) as rotulo
      from public.planejamento where coalesce(status_operacional, 'rascunho') = 'rascunho'
      order by coalesce(data_alvo, criado_em::date), id limit 3
    ) s;
    v_saida := v_saida || jsonb_build_array(jsonb_build_object('chave', 'planos_rascunho', 'quantidade', v_qtd, 'itens', v_itens));
  end if;

  return v_saida;
end $function$;

revoke all on function public.aguardando_voce() from public, anon;
grant execute on function public.aguardando_voce() to authenticated;

commit;
