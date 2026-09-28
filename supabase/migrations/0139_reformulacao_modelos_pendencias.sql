-- =====================================================================
-- 0139 — Orçamento de projeto: reabrir e reformular, modelos, pendências de
-- pessoal e importação do catálogo (fases D e E do desenho
-- docs/superpowers/specs/2026-09-28-orcamento-projeto-catalogo-vivo-design.md)
--
-- O que muda:
--   1. Trava no banco das linhas de custo de projeto: módulo concluído
--      (enviado), aprovado ou cancelado não aceita inserir, alterar ou
--      remover custo (antes só o app impedia).
--   2. Reabrir a revisão dos custos (reabrir_revisao_custos_projeto): de
--      enviado, recusado ou aprovado volta para edição. Com proposta aprovada
--      é uma REFORMULAÇÃO (DC4, dono 28/09): exige motivo e marca o módulo.
--   3. Reformulação: a emissão aceita nova versão com proposta aprovada só
--      quando o módulo foi reaberto como reformulação; a versão nasce com
--      reformulacao_de. Aprovada (pela equipe ou pelo link), ela SUBSTITUI a
--      aprovada anterior: a anterior vira "substituido" (fica no histórico),
--      o acompanhamento de fundos passa para a nova e o planejamento em curso
--      passa a acompanhar a nova versão (regra já existente na 0126).
--   4. aplicar_modelo_orcamento_projeto: usa um modelo dentro da proposta;
--      os valores vêm do catálogo no momento do uso.
--   5. Pendências de pessoal: listar e aplicar/descartar os valores de PE
--      concluídos por quem não tinha a permissão de pessoal (0137).
--   6. catalogo_projeto_importar: prévia e importação de planilha para o
--      catálogo, com a identidade do item da 0137 (vale a última linha).
--
-- Impacto: aditiva (colunas novas anuláveis, funções novas; três funções de
-- emissão/aprovação recriadas com o mesmo contrato e a exceção da
-- reformulação). Nada é apagado.
--
-- Rollback (com backup lógico de orcamento_final_versoes, orcamento_projetos
-- e orcamento_fundos_acompanhamento):
--   reaplicar as definições de emitir_orcamento_final_transacional,
--   transicionar_orcamento_final e aprovar_orcamento_publico da 0126;
--   drop trigger if exists kontrol_proteger_custos_projeto on public.orcamento_projeto_custos;
--   drop function if exists public.reabrir_revisao_custos_projeto(bigint, text);
--   drop function if exists public.aplicar_modelo_orcamento_projeto(bigint, bigint);
--   drop function if exists public.catalogo_projeto_pendencias();
--   drop function if exists public.catalogo_projeto_resolver_pendencia(bigint, boolean);
--   drop function if exists public.catalogo_projeto_importar(jsonb, boolean);
--   drop function if exists kontrol_private.substituir_versao_reformulada(bigint, bigint, text);
--   drop function if exists kontrol_private.proteger_custos_projeto();
--   As colunas novas podem ficar (anuláveis, ignoradas pelo código antigo).
-- =====================================================================

begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $$
begin
  if to_regprocedure('public.concluir_revisao_custos_projeto(bigint,text)') is null
    or to_regprocedure('public.catalogo_projeto_salvar_item(text,text,text,text,text,numeric)') is null
    or to_regprocedure('kontrol_private.criar_plano_da_versao(bigint,text)') is null then
    raise exception '0139: requer as migrations 0126, 0137 e 0138';
  end if;
end $$;

-- ---- 1. Trava das linhas de custo de projeto ----------------------------------
create or replace function kontrol_private.proteger_custos_projeto()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids bigint[] := '{}';
  v_id bigint;
  v_status text;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    v_ids := v_ids || old.orcamento_projeto_id;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    v_ids := v_ids || new.orcamento_projeto_id;
  end if;
  foreach v_id in array v_ids loop
    continue when v_id is null;
    select p.status into v_status from public.orcamento_projetos p where p.id = v_id;
    -- Módulo já apagado (exclusão em cascata): nada a proteger.
    continue when not found;
    if v_status in ('enviado', 'aprovado', 'cancelado') then
      raise exception 'Os custos deste orçamento de projeto estão travados (revisão concluída, aprovado ou cancelado). Use "Reabrir revisão" para alterar.'
        using errcode = '22023';
    end if;
  end loop;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end $$;

revoke all on function kontrol_private.proteger_custos_projeto() from public, anon, authenticated, service_role;

drop trigger if exists kontrol_proteger_custos_projeto on public.orcamento_projeto_custos;
create trigger kontrol_proteger_custos_projeto
  before insert or delete
      or update of rubrica, categoria, descricao, unidade, quantidade, custo_unitario, preco_unitario,
                   meses_selecionados, orcamento_projeto_id
  on public.orcamento_projeto_custos
  for each row execute function kontrol_private.proteger_custos_projeto();

-- ---- 2. Colunas da reformulação e das pendências ------------------------------
alter table public.orcamento_projetos
  add column if not exists reformulacao_de_versao_id bigint
    references public.orcamento_final_versoes(id) on delete set null;
comment on column public.orcamento_projetos.reformulacao_de_versao_id is
  'Versão aprovada que está sendo reformulada (revisão reaberta com proposta aprovada). Limpa quando a reformulação é aprovada.';

alter table public.orcamento_final_versoes
  add column if not exists reformulacao_de bigint
    references public.orcamento_final_versoes(id) on delete restrict;
comment on column public.orcamento_final_versoes.reformulacao_de is
  'Versão aprovada que esta versão reformula; ao ser aprovada, a substitui.';

alter table public.orcamento_projeto_catalogo_valores
  add column if not exists resolucao text,
  add column if not exists resolvido_em timestamptz,
  add column if not exists resolvido_por text;
alter table public.orcamento_projeto_catalogo_valores
  drop constraint if exists orcamento_projeto_catalogo_valores_resolucao_check,
  add constraint orcamento_projeto_catalogo_valores_resolucao_check
    check (resolucao is null or resolucao in ('aplicado', 'descartado'));

-- ---- 3. Substituição da aprovada pela reformulação ----------------------------
create or replace function kontrol_private.substituir_versao_reformulada(
  p_nova bigint,
  p_antiga bigint,
  p_ator text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_numero_nova text;
  v_status_antiga text;
begin
  select v.numero into v_numero_nova from public.orcamento_final_versoes v where v.id = p_nova;
  select v.status into v_status_antiga from public.orcamento_final_versoes v where v.id = p_antiga for update;
  if not found then
    return;
  end if;

  perform set_config('app.orcamento_final_transicao', 'permitida', true);
  update public.orcamento_final_versoes set status = 'substituido' where id = p_antiga;
  insert into public.eventos_status (entidade, entidade_id, de_status, para_status, usuario, observacao)
  values ('orcamento_final', p_antiga, v_status_antiga, 'substituido', p_ator,
          'Substituída pela reformulação ' || coalesce(v_numero_nova, '#' || p_nova) || '.');

  -- Link ainda não usado da versão antiga deixa de abrir.
  update public.orcamento_projeto_links
     set revogado = true
   where orcamento_final_versao_id = p_antiga
     and not revogado
     and aprovado_em is null;

  -- Recebimentos, impostos pagos e fundos seguem a versão aprovada vigente.
  update public.orcamento_fundos_acompanhamento
     set orcamento_final_versao_id = p_nova
   where orcamento_final_versao_id = p_antiga
     and not exists (select 1 from public.orcamento_fundos_acompanhamento f
                      where f.orcamento_final_versao_id = p_nova);

  -- A reformulação terminou.
  update public.orcamento_projetos
     set reformulacao_de_versao_id = null
   where reformulacao_de_versao_id = p_antiga;
end $$;

revoke all on function kontrol_private.substituir_versao_reformulada(bigint, bigint, text)
  from public, anon, authenticated, service_role;

-- ---- 4. Emissão e aprovação com a exceção da reformulação ----------------------
CREATE OR REPLACE FUNCTION public.emitir_orcamento_final_transacional(p_demanda_id bigint, p_validade_dias integer, p_total_laboratorio_custo numeric, p_total_laboratorio_preco numeric, p_total_projeto_custo numeric, p_total_projeto_final numeric, p_total_final numeric, p_snapshot jsonb, p_parametros jsonb, p_criado_por uuid, p_usuario_email text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_status      text;
  v_versao      integer;
  v_numero      text;
  v_valido_ate  date;
  v_versao_id   bigint;
  v_de_status   text;
  v_lab_ativos  integer;
  v_proj_ativos integer;
  v_aprovada    text;
  v_aprovada_id bigint;
  v_reformulacao bigint;
  v_substituidas bigint[];
begin
  -- EXIGÊNCIA DE SEGURANÇA: permissão efetiva no nível de banco de dados
  perform kontrol_private.exigir_permissao('orcamentos.emitir');

  -- 1. Lock da demanda + existência.
  select status into v_status
    from demandas_propostas
   where id = p_demanda_id
   for update;
  if not found then
    raise exception 'Orçamento % não encontrado.', p_demanda_id using errcode = 'no_data_found';
  end if;

  -- 2. Integridade: não emitir com duplicidade ativa inesperada.
  select count(*) into v_lab_ativos
    from orcamentos
   where demanda_id = p_demanda_id
     and coalesce(status, '') <> 'cancelado'
     and coalesce(status_operacional, '') <> 'cancelado';
  select count(*) into v_proj_ativos
    from orcamento_projetos
   where demanda_id = p_demanda_id
     and coalesce(status, '') <> 'cancelado';
  if v_lab_ativos > 1 or v_proj_ativos > 1 then
    raise exception 'Há orçamentos duplicados neste registro (laboratório=%, projeto=%). Peça revisão ao gestor antes de emitir.',
      v_lab_ativos, v_proj_ativos using errcode = 'raise_exception';
  end if;

  -- 3. Uma versão viva (0126), com uma exceção (0139): a reformulação aberta ao
  --    reabrir os custos de uma proposta aprovada. A nova versão nasce ligada à
  --    aprovada e, quando for aprovada, a substitui (a anterior fica no histórico).
  select id, numero into v_aprovada_id, v_aprovada
    from orcamento_final_versoes
   where demanda_id = p_demanda_id and status in ('aprovado', 'convertido_projeto')
   order by versao desc
   limit 1;
  if v_aprovada is not null then
    if not exists (select 1 from orcamento_projetos
                    where demanda_id = p_demanda_id
                      and coalesce(status, '') <> 'cancelado'
                      and reformulacao_de_versao_id = v_aprovada_id) then
      raise exception 'A proposta % já está aprovada. Para mudar, reabra a revisão dos custos como reformulação (ou cancele a aprovação) antes de emitir nova versão.', v_aprovada
        using errcode = '22023';
    end if;
    v_reformulacao := v_aprovada_id;
  end if;

  -- 4. Próxima versão SOB LOCK (serializa emissões concorrentes da mesma demanda).
  select coalesce(max(versao), 0) + 1 into v_versao
    from orcamento_final_versoes
   where demanda_id = p_demanda_id;
  v_numero := 'OF-' || extract(year from now())::int || '-' || lpad(p_demanda_id::text, 4, '0') || '-v' || v_versao;
  v_valido_ate := current_date + (coalesce(p_validade_dias, 30))::int;

  -- de_status do evento = versão viva anterior, se houver.
  select 'v' || versao into v_de_status
    from orcamento_final_versoes
   where demanda_id = p_demanda_id and status in ('emitido', 'enviado', 'alterado_reenviado')
   order by versao desc
   limit 1;

  -- 5. Substitui TODAS as versões vivas não aprovadas e revoga os links delas.
  with substituidas as (
    update orcamento_final_versoes
       set status = 'substituido'
     where demanda_id = p_demanda_id and status in ('emitido', 'enviado', 'alterado_reenviado')
    returning id
  )
  select coalesce(array_agg(id), '{}') into v_substituidas from substituidas;

  update orcamento_projeto_links
     set revogado = true
   where orcamento_final_versao_id = any(v_substituidas)
     and not revogado
     and aprovado_em is null;

  -- 6. Insere a nova versão.
  insert into orcamento_final_versoes (
    demanda_id, versao, numero, validade_dias, valido_ate,
    total_laboratorio_custo, total_laboratorio_preco, total_projeto_custo,
    total_projeto_final, total_final, snapshot, criado_por, reformulacao_de
  ) values (
    p_demanda_id, v_versao, v_numero, coalesce(p_validade_dias, 30), v_valido_ate,
    coalesce(p_total_laboratorio_custo, 0), coalesce(p_total_laboratorio_preco, 0),
    coalesce(p_total_projeto_custo, 0), coalesce(p_total_projeto_final, 0),
    coalesce(p_total_final, 0), coalesce(p_snapshot, '{}'::jsonb), p_criado_por, v_reformulacao
  ) returning id into v_versao_id;

  -- 7. Parâmetros aplicados (quando a engine produziu um snapshot válido).
  if p_parametros is not null and p_parametros <> 'null'::jsonb then
    insert into orcamento_parametros_aplicados (
      demanda_id, orcamento_laboratorial_id, orcamento_projeto_id, orcamento_final_versao_id, versao,
      metodo_calculo, laboratorio_modo, subtotal_laboratorio, subtotal_projeto, subtotal_custos,
      total_parametros, total_final, parametros_snapshot, formula_snapshot, alertas_snapshot, criado_por
    ) values (
      p_demanda_id,
      nullif(p_parametros->>'orcamento_laboratorial_id', '')::bigint,
      nullif(p_parametros->>'orcamento_projeto_id', '')::bigint,
      v_versao_id, v_versao,
      coalesce(p_parametros->>'metodo_calculo', 'GROSS_UP'),
      coalesce(p_parametros->>'laboratorio_modo', 'CUSTO_TECNICO'),
      coalesce((p_parametros->>'subtotal_laboratorio')::numeric, 0),
      coalesce((p_parametros->>'subtotal_projeto')::numeric, 0),
      coalesce((p_parametros->>'subtotal_custos')::numeric, 0),
      coalesce((p_parametros->>'total_parametros')::numeric, 0),
      coalesce((p_parametros->>'total_final')::numeric, 0),
      coalesce(p_parametros->'parametros_snapshot', '[]'::jsonb),
      coalesce(p_parametros->'formula_snapshot', '{}'::jsonb),
      coalesce(p_parametros->'alertas_snapshot', '[]'::jsonb),
      p_criado_por
    );
  end if;

  -- 8. Status da demanda → 'orcada' apenas a partir de nova/em_analise.
  if v_status in ('nova', 'em_analise') then
    update demandas_propostas set status = 'orcada' where id = p_demanda_id;
  end if;

  -- 9. Evento/auditoria DENTRO da transação.
  insert into eventos_status (entidade, entidade_id, de_status, para_status, usuario, observacao)
  values (
    'orcamento_final', p_demanda_id, v_de_status, 'v' || v_versao, p_usuario_email,
    'Orcamento final ' || v_numero || ' emitido para demanda #' || p_demanda_id || '.'
      || case when cardinality(v_substituidas) > 0
           then ' Versões substituídas: ' || cardinality(v_substituidas) || '.' else '' end
  );

  return jsonb_build_object('id', v_versao_id, 'numero', v_numero, 'versao', v_versao,
                            'reformulacao_de', v_reformulacao);
end
$function$;

CREATE OR REPLACE FUNCTION public.transicionar_orcamento_final(p_versao_id bigint, p_status_destino text, p_motivo text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_atual record;
  v_claims jsonb;
  v_ator text;
  v_ator_id uuid;
  v_demanda_id bigint;
  v_outra text;
  v_outra_id bigint;
  v_substituir bigint;
  v_plano record;
  v_motivo_plano text;
begin
  perform kontrol_private.exigir_permissao(case when p_status_destino = 'cancelado' then 'orcamentos.cancelar' else 'orcamentos.emitir' end);
  v_claims := coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
  v_ator := coalesce(nullif(v_claims->>'email', ''), nullif(v_claims->>'sub', ''));
  if v_ator is null then
    raise exception 'Ator autenticado obrigatorio.' using errcode = '42501';
  end if;
  if coalesce(v_claims->>'sub', '') ~ '^[0-9a-fA-F-]{36}$' then
    v_ator_id := (v_claims->>'sub')::uuid;
  end if;

  -- ORC2-12: trava a proposta antes da versão (mesma ordem da emissão e do link).
  select demanda_id into v_demanda_id
    from public.orcamento_final_versoes
   where id = p_versao_id;
  if not found then
    raise exception 'Versao final nao encontrada.' using errcode = 'P0002';
  end if;
  perform 1 from public.demandas_propostas where id = v_demanda_id for update;

  select id, demanda_id, status, versao, numero, valido_ate, reformulacao_de
    into v_atual
    from public.orcamento_final_versoes
   where id = p_versao_id
   for update;
  if not found then
    raise exception 'Versao final nao encontrada.' using errcode = 'P0002';
  end if;

  if v_atual.status = p_status_destino then
    return jsonb_build_object(
      'id', p_versao_id,
      'status_origem', v_atual.status,
      'status_destino', p_status_destino,
      'alterado', false
    );
  end if;

  if not (
    (v_atual.status = 'emitido' and p_status_destino in
      ('enviado', 'alterado_reenviado', 'aprovado', 'recusado', 'rejeitado', 'cancelado', 'vencido'))
    or (v_atual.status in ('enviado', 'alterado_reenviado') and p_status_destino in
      ('alterado_reenviado', 'aprovado', 'recusado', 'rejeitado', 'cancelado', 'vencido'))
    or (v_atual.status in ('recusado', 'rejeitado') and p_status_destino in
      ('alterado_reenviado', 'cancelado'))
    or (v_atual.status = 'aprovado' and p_status_destino in
      ('convertido_projeto', 'cancelado'))
  ) then
    raise exception 'Transicao de versao final nao permitida: % -> %.',
      v_atual.status, p_status_destino using errcode = '22023';
  end if;

  -- Uma versão viva por proposta (decisões do dono, 26/09).
  if p_status_destino = 'aprovado' then
    if v_atual.valido_ate is not null and v_atual.valido_ate < current_date then
      raise exception 'A proposta % venceu em %: não pode ser aprovada. Emita uma nova versão.',
        v_atual.numero, to_char(v_atual.valido_ate, 'DD/MM/YYYY') using errcode = '22023';
    end if;
    select id, numero into v_outra_id, v_outra
      from public.orcamento_final_versoes
     where demanda_id = v_atual.demanda_id and id <> v_atual.id
       and status in ('aprovado', 'convertido_projeto')
     limit 1;
    if v_outra is not null then
      -- 0139: a reformulação da aprovada a substitui; qualquer outra continua recusada.
      if v_atual.reformulacao_de is distinct from v_outra_id then
        raise exception 'A versão % desta proposta já está aprovada. Cancele-a antes de aprovar outra.', v_outra
          using errcode = '22023';
      end if;
      v_substituir := v_outra_id;
    end if;
  end if;
  if p_status_destino in ('enviado', 'alterado_reenviado', 'aprovado') then
    select numero into v_outra
      from public.orcamento_final_versoes
     where demanda_id = v_atual.demanda_id and id <> v_atual.id
       and status in ('emitido', 'enviado', 'alterado_reenviado', 'aprovado', 'convertido_projeto')
       and (versao > v_atual.versao or v_atual.status in ('recusado', 'rejeitado'))
     order by versao desc
     limit 1;
    if v_outra is not null then
      raise exception 'A versão % desta proposta está em vigor. Use a versão em vigor.', v_outra
        using errcode = '22023';
    end if;
  end if;

  if p_status_destino = 'cancelado' and v_atual.status = 'aprovado'
     and exists (select 1 from public.planejamento
                  where orcamento_final_versao_id = p_versao_id
                    and status_operacional in ('rascunho', 'reservado'))
     and not kontrol_private.tem_permissao_efetiva('planejamento.editar') then
    raise exception 'Cancelar esta proposta também cancela o planejamento dela. Seu perfil precisa da permissão de editar planejamento.'
      using errcode = '42501';
  end if;

  -- 0139: antes de aprovar a reformulação, a aprovada anterior vira substituída
  -- (o plano e os fundos passam a acompanhar a nova versão).
  if v_substituir is not null then
    perform kontrol_private.substituir_versao_reformulada(p_versao_id, v_substituir, v_ator);
  end if;

  perform set_config('app.orcamento_final_transicao', 'permitida', true);
  update public.orcamento_final_versoes
     set status = p_status_destino,
         classificado_em = case
           when p_status_destino in ('enviado', 'alterado_reenviado', 'aprovado', 'recusado', 'rejeitado')
             then now()
           else classificado_em
         end,
         classificado_por = case
           when p_status_destino in ('enviado', 'alterado_reenviado', 'aprovado', 'recusado', 'rejeitado')
             then v_ator_id
           else classificado_por
         end,
         classificacao_motivo = case
           when p_status_destino in ('enviado', 'alterado_reenviado', 'aprovado', 'recusado', 'rejeitado')
             then p_motivo
           else classificacao_motivo
         end,
         cancelado_em = case when p_status_destino = 'cancelado' then now() else cancelado_em end,
         cancelado_motivo = case when p_status_destino = 'cancelado' then p_motivo else cancelado_motivo end
   where id = p_versao_id;

  insert into public.eventos_status
    (entidade, entidade_id, de_status, para_status, usuario, observacao)
  values
    ('orcamento_final', p_versao_id, v_atual.status, p_status_destino, v_ator, p_motivo);

  if p_status_destino = 'cancelado' then
    -- Link de versão cancelada deixa de abrir (o aprovado fica como registro).
    update public.orcamento_projeto_links
       set revogado = true
     where orcamento_final_versao_id = p_versao_id
       and not revogado
       and aprovado_em is null;
  end if;

  -- Cancelar proposta aprovada (decisão do dono): plano em rascunho ou
  -- reservado é cancelado com as reservas liberadas; em execução continua e o
  -- coordenador é avisado.
  if p_status_destino = 'cancelado' and v_atual.status = 'aprovado' then
    v_motivo_plano := 'Proposta ' || v_atual.numero || ' cancelada'
      || coalesce(': ' || nullif(btrim(p_motivo), ''), '') || '.';
    for v_plano in
      select id, status_operacional
        from public.planejamento
       where orcamento_final_versao_id = p_versao_id
         and status_operacional in ('rascunho', 'reservado', 'em_execucao')
       order by id
    loop
      if v_plano.status_operacional in ('rascunho', 'reservado') then
        perform public.cancelar_planejamento(v_plano.id, v_motivo_plano);
      else
        begin
          insert into public.notificacoes (
            tipo, titulo, corpo, entidade_tipo, entidade_id, papel_destino, dedupe_key
          ) values (
            'sistema',
            'Proposta cancelada com o planejamento #' || v_plano.id || ' em execução',
            'A proposta ' || v_atual.numero || ' foi cancelada, mas o planejamento #' || v_plano.id
              || ' já está em execução e continua. Decida se ele deve ser concluído ou cancelado.',
            'planejamento', v_plano.id, 'coordenador',
            'proposta_cancelada_' || p_versao_id || '_plano_' || v_plano.id
          )
          on conflict do nothing;
        exception when others then
          raise warning '0126: aviso do plano em execucao nao registrado: %', sqlerrm;
        end;
      end if;
    end loop;

    if not exists (select 1 from public.orcamento_final_versoes
                    where demanda_id = v_atual.demanda_id
                      and status in ('aprovado', 'convertido_projeto')) then
      update public.demandas_propostas
         set status = 'orcada'
       where id = v_atual.demanda_id and status = 'aprovada';
    end if;
  end if;

  return jsonb_build_object(
    'id', p_versao_id,
    'status_origem', v_atual.status,
    'status_destino', p_status_destino,
    'alterado', true
  );
end
$function$;

CREATE OR REPLACE FUNCTION public.aprovar_orcamento_publico(p_token text, p_nome text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
declare
  v_hash text := encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex');
  v_demanda_id bigint;
  v_link record;
  v_projeto_status text;
  v_outra_id bigint;
  v_ator text := coalesce(nullif(btrim(p_nome), ''), 'Aprovador externo');
begin
  -- Trava a proposta primeiro (mesma ordem de transicionar_orcamento_final).
  select v.demanda_id into v_demanda_id
    from public.orcamento_projeto_links l
    join public.orcamento_final_versoes v on v.id = l.orcamento_final_versao_id
   where l.token_hash = v_hash;
  if not found then
    return jsonb_build_object('aprovado', false, 'repetido', false, 'motivo', 'indisponivel');
  end if;
  perform 1 from public.demandas_propostas where id = v_demanda_id for update;

  select
    l.id as link_id,
    l.aprovado_em,
    l.aprovado_por,
    l.orcamento_projeto_id as projeto_id,
    v.id as versao_id,
    v.status as versao_status,
    v.numero as versao_numero,
    v.versao,
    v.valido_ate,
    v.demanda_id
  into v_link
  from public.orcamento_projeto_links l
  join public.orcamento_final_versoes v
    on v.id = l.orcamento_final_versao_id
  where l.token_hash = v_hash
    and not l.revogado
    and (l.aprovado_em is not null or l.expira_em is null or l.expira_em > now())
  for update of l, v;

  if not found then
    return jsonb_build_object('aprovado', false, 'repetido', false, 'motivo', 'indisponivel');
  end if;

  if v_link.aprovado_em is not null then
    -- Contrato de compatibilidade: retry aprovado deve "return true" semanticamente,
    -- agora acompanhado de repetido=true no retorno estruturado.
    return jsonb_build_object(
      'aprovado', true,
      'repetido', true,
      'versao_id', v_link.versao_id,
      'numero', v_link.versao_numero
    );
  end if;

  if v_link.projeto_id is not null then
    select status into v_projeto_status
      from public.orcamento_projetos
     where id = v_link.projeto_id and demanda_id = v_link.demanda_id
     for update;
    if not found or v_projeto_status not in ('rascunho', 'enviado') then
      return jsonb_build_object('aprovado', false, 'repetido', false, 'motivo', 'indisponivel');
    end if;
  end if;

  if v_link.versao_status not in ('emitido', 'enviado', 'alterado_reenviado') then
    return jsonb_build_object('aprovado', false, 'repetido', false,
      'motivo', case when v_link.versao_status = 'vencido' then 'vencida' else 'indisponivel' end);
  end if;
  if v_link.valido_ate is not null and v_link.valido_ate < current_date then
    return jsonb_build_object('aprovado', false, 'repetido', false, 'motivo', 'vencida');
  end if;
  select id into v_outra_id
    from public.orcamento_final_versoes
   where demanda_id = v_link.demanda_id and id <> v_link.versao_id
     and status in ('aprovado', 'convertido_projeto')
   limit 1;
  -- 0139: a reformulação da aprovada pode ser aprovada pelo link e a substitui.
  if v_outra_id is not null
     and (select reformulacao_de from public.orcamento_final_versoes where id = v_link.versao_id)
         is distinct from v_outra_id then
    return jsonb_build_object('aprovado', false, 'repetido', false, 'motivo', 'outra_aprovada');
  end if;
  if exists (select 1 from public.orcamento_final_versoes
              where demanda_id = v_link.demanda_id and versao > v_link.versao
                and status in ('emitido', 'enviado', 'alterado_reenviado')) then
    return jsonb_build_object('aprovado', false, 'repetido', false, 'motivo', 'versao_nova');
  end if;

  perform set_config('app.orcamento_projeto_transicao', 'permitida', true);
  perform set_config('app.orcamento_final_transicao', 'permitida', true);
  perform set_config('app.orcamento_link_aprovacao', 'permitida', true);

  if v_link.projeto_id is not null then
    update public.orcamento_projetos
       set status = 'aprovado'
     where id = v_link.projeto_id;
  end if;

  if v_outra_id is not null then
    perform kontrol_private.substituir_versao_reformulada(v_link.versao_id, v_outra_id, v_ator);
  end if;

  update public.orcamento_final_versoes
     set status = 'aprovado',
         classificado_em = now(),
         classificacao_motivo = 'Aprovacao por link publico versionado.'
   where id = v_link.versao_id;

  update public.orcamento_projeto_links
     set aprovado_em = now(),
         aprovado_por = v_ator
   where id = v_link.link_id;

  -- Contrato auditavel: o comando "insert into eventos_status" abaixo usa
  -- qualificacao explicita do schema para nao depender do search_path.
  if v_link.projeto_id is not null then
    insert into public.eventos_status
      (entidade, entidade_id, de_status, para_status, usuario, observacao)
    values
      ('orcamento_projeto', v_link.projeto_id, v_projeto_status, 'aprovado', v_ator,
       'Aprovacao publica vinculada a versao final #' || v_link.versao_id || '.');
  end if;
  insert into public.eventos_status
    (entidade, entidade_id, de_status, para_status, usuario, observacao)
  values
    ('orcamento_final', v_link.versao_id, v_link.versao_status, 'aprovado', v_ator,
     'Versao ' || v_link.versao_numero || ' aprovada por link publico versionado.');

  -- Ninguém era avisado da aprovação pelo link (auditoria, §3).
  begin
    insert into public.notificacoes (
      tipo, titulo, corpo, entidade_tipo, entidade_id, papel_destino, dedupe_key
    ) values (
      'sistema',
      'Cliente aprovou a proposta ' || v_link.versao_numero,
      v_ator || ' aprovou a proposta ' || v_link.versao_numero || ' pelo link.',
      'orcamento_final', v_link.versao_id, 'coordenador', 'aprovacao_link_' || v_link.versao_id
    )
    on conflict do nothing;
  exception when others then
    raise warning '0126: aviso da aprovacao pelo link nao registrado: %', sqlerrm;
  end;

  return jsonb_build_object(
    'aprovado', true,
    'repetido', false,
    'versao_id', v_link.versao_id,
    'numero', v_link.versao_numero
  );
end
$function$;

-- ---- 5. Reabrir a revisão dos custos (e reformulação) -------------------------
create or replace function public.reabrir_revisao_custos_projeto(
  p_orcamento_projeto_id bigint,
  p_motivo text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_email text := nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'email';
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
  v_status text;
  v_demanda bigint;
  v_aprovada_id bigint;
  v_aprovada text;
begin
  perform kontrol_private.exigir_permissao('orcamentos.emitir');

  select p.demanda_id into v_demanda from public.orcamento_projetos p where p.id = p_orcamento_projeto_id;
  if not found then
    raise exception 'Orçamento de projeto não encontrado.' using errcode = 'P0002';
  end if;
  -- Mesma ordem de travas da emissão: proposta, depois módulo.
  if v_demanda is not null then
    perform 1 from public.demandas_propostas where id = v_demanda for update;
  end if;
  select p.status into v_status from public.orcamento_projetos p where p.id = p_orcamento_projeto_id for update;

  if v_status = 'rascunho' then
    raise exception 'Os custos já estão em edição.' using errcode = '22023';
  end if;
  if v_status = 'cancelado' then
    raise exception 'Orçamento de projeto cancelado não volta para edição.' using errcode = '22023';
  end if;

  select v.id, v.numero into v_aprovada_id, v_aprovada
    from public.orcamento_final_versoes v
   where v.demanda_id = v_demanda and v.status in ('aprovado', 'convertido_projeto')
   order by v.versao desc
   limit 1;
  if v_aprovada_id is not null and (v_motivo is null or length(v_motivo) < 5) then
    raise exception 'A proposta % está aprovada: informe o motivo da reformulação.', v_aprovada
      using errcode = '22023';
  end if;

  perform set_config('app.orcamento_projeto_transicao', 'permitida', true);
  update public.orcamento_projetos
     set status = 'rascunho',
         reformulacao_de_versao_id = v_aprovada_id
   where id = p_orcamento_projeto_id;

  insert into public.eventos_status (entidade, entidade_id, de_status, para_status, usuario, observacao)
  values ('orcamento_projeto', p_orcamento_projeto_id, v_status, 'rascunho', v_email,
          case when v_aprovada_id is not null
               then 'Reformulação da proposta aprovada ' || v_aprovada || ': ' || v_motivo
               else coalesce('Revisão dos custos reaberta: ' || v_motivo, 'Revisão dos custos reaberta.') end);

  return jsonb_build_object(
    'status_origem', v_status,
    'reformulacao', v_aprovada_id is not null,
    'versao_aprovada', v_aprovada
  );
end $$;

comment on function public.reabrir_revisao_custos_projeto(bigint, text) is
  'Volta os custos de projeto para edição (de enviado, recusado ou aprovado). Com proposta aprovada é reformulação: exige motivo; a nova versão emitida substitui a aprovada quando for aprovada.';

-- ---- 6. Usar modelo dentro da proposta ----------------------------------------
create or replace function public.aplicar_modelo_orcamento_projeto(
  p_orcamento_projeto_id bigint,
  p_template_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_status text;
  v_meses integer;
  v_itens jsonb;
  v_pode_pessoal boolean := kontrol_private.pode_ver_pessoal_orcamento();
  v_linha record;
  v_rubrica text;
  v_descricao text;
  v_unidade text;
  v_quantidade numeric;
  v_item text;
  v_catalogo record;
  v_valor numeric;
  v_base numeric;
  v_meses_linha integer[];
  v_do_catalogo integer := 0;
  v_sem_catalogo integer := 0;
  v_pessoal_ignorado integer := 0;
begin
  perform kontrol_private.exigir_permissao('orcamentos.criar_editar');

  select p.status, greatest(1, coalesce(p.project_months, 12))
    into v_status, v_meses
    from public.orcamento_projetos p
   where p.id = p_orcamento_projeto_id
   for update;
  if not found then
    raise exception 'Orçamento de projeto não encontrado.' using errcode = 'P0002';
  end if;
  if v_status is distinct from 'rascunho' then
    raise exception 'Os custos não estão em edição. Reabra a revisão para usar um modelo.' using errcode = '22023';
  end if;

  select t.itens into v_itens from public.orcamento_projeto_templates t where t.id = p_template_id;
  if not found then
    raise exception 'Modelo não encontrado.' using errcode = 'P0002';
  end if;

  for v_linha in
    select e.item from jsonb_array_elements(coalesce(v_itens, '[]'::jsonb)) as e(item)
  loop
    v_rubrica := upper(btrim(coalesce(v_linha.item->>'rubrica', '')));
    if v_rubrica not in ('PE', 'MC', 'MP', 'ST', 'VD', 'OU') then
      v_rubrica := 'OU';
    end if;
    v_descricao := nullif(btrim(coalesce(v_linha.item->>'descricao', '')), '');
    continue when v_descricao is null;
    v_unidade := nullif(btrim(coalesce(v_linha.item->>'unidade', '')), '');

    if v_rubrica = 'PE' and not v_pode_pessoal then
      v_pessoal_ignorado := v_pessoal_ignorado + 1;
      continue;
    end if;

    v_item := coalesce(
      kontrol_private.item_catalogo_vigente(nullif(v_linha.item->>'catalogo_item_id', '')),
      (select k.id from public.orcamento_projeto_catalogo k
        where k.substituido_por is null
          and k.rubrica = v_rubrica
          and k.chave_descricao = kontrol_private.normalizar_texto_catalogo(v_descricao)
          and k.chave_unidade = kontrol_private.normalizar_unidade_catalogo(v_unidade))
    );

    if v_item is not null then
      select k.descricao, k.unidade, k.preco_unitario into v_catalogo
        from public.orcamento_projeto_catalogo k where k.id = v_item;
      v_descricao := v_catalogo.descricao;
      v_unidade := v_catalogo.unidade;
      v_valor := v_catalogo.preco_unitario;
      v_base := v_catalogo.preco_unitario;
      v_do_catalogo := v_do_catalogo + 1;
    else
      v_valor := case when jsonb_typeof(v_linha.item->'custo_unitario') = 'number'
                      then greatest(0, (v_linha.item->>'custo_unitario')::numeric) else 0 end;
      v_base := null;
      v_sem_catalogo := v_sem_catalogo + 1;
    end if;

    v_quantidade := case when jsonb_typeof(v_linha.item->'quantidade') = 'number'
                         then (v_linha.item->>'quantidade')::numeric else 1 end;
    if v_quantidade is null or v_quantidade <= 0 then
      v_quantidade := 1;
    end if;
    select coalesce(array_agg(distinct m order by m), '{}')
      into v_meses_linha
      from (select (x.valor)::integer as m
              from jsonb_array_elements_text(
                     case when jsonb_typeof(v_linha.item->'meses_selecionados') = 'array'
                          then v_linha.item->'meses_selecionados' else '[]'::jsonb end) as x(valor)
             where x.valor ~ '^[0-9]+$') s
     where s.m between 1 and v_meses;

    insert into public.orcamento_projeto_custos
      (orcamento_projeto_id, categoria, rubrica, descricao, quantidade, unidade, custo_unitario, preco_unitario,
       meses_selecionados, catalogo_item_id, catalogo_valor_base, origem, etapa, atividade, entrega,
       categoria_institucional, nomenclatura_origem)
    values
      (p_orcamento_projeto_id,
       case v_rubrica when 'PE' then 'mao_obra' when 'MC' then 'materiais' when 'MP' then 'equipamentos'
                      when 'ST' then 'terceiros' when 'VD' then 'deslocamento' else 'outros' end,
       v_rubrica, v_descricao, v_quantidade, v_unidade, v_valor, v_valor,
       v_meses_linha, v_item, v_base, 'template',
       coalesce(nullif(v_linha.item->>'etapa', ''),
                case v_rubrica when 'PE' then 'Equipe' when 'VD' then 'Campo e logistica' when 'MC' then 'Materiais e consumo'
                               when 'MP' then 'Equipamentos' when 'ST' then 'Terceiros' else 'Projeto' end),
       nullif(v_linha.item->>'atividade', ''),
       coalesce(nullif(v_linha.item->>'entrega', ''), 'Entrega principal'),
       coalesce(nullif(v_linha.item->>'categoria_institucional', ''),
                case v_rubrica when 'PE' then 'Pessoal' when 'MC' then 'Material de consumo'
                               when 'MP' then 'Material permanente' when 'ST' then 'Servicos de terceiros'
                               when 'VD' then 'Viagens e diarias' else 'Outros custos' end),
       case when v_item is not null then 'catalogo_institucional' else 'kontrol' end);
  end loop;

  return jsonb_build_object(
    'itens', v_do_catalogo + v_sem_catalogo,
    'do_catalogo', v_do_catalogo,
    'sem_catalogo', v_sem_catalogo,
    'pessoal_ignorado', v_pessoal_ignorado
  );
end $$;

comment on function public.aplicar_modelo_orcamento_projeto(bigint, bigint) is
  'Acrescenta os itens de um modelo ao orçamento de projeto em edição. Valores vêm do catálogo no momento do uso; item fora do catálogo usa o valor guardado no modelo. Pessoal sem a permissão de pessoal fica de fora.';

-- ---- 7. Pendências de pessoal --------------------------------------------------
create or replace function public.catalogo_projeto_pendencias()
returns table (
  pendencia_id bigint,
  rubrica text,
  descricao text,
  unidade text,
  preco_unitario numeric,
  catalogo_item_id text,
  preco_atual numeric,
  demanda_titulo text,
  usuario text,
  registrado_em timestamptz
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
begin
  perform kontrol_private.exigir_permissao('orcamentos.visualizar');
  if not kontrol_private.pode_ver_pessoal_orcamento() then
    return;
  end if;
  return query
    select v.id,
           v.rubrica,
           v.descricao,
           v.unidade,
           v.preco_unitario,
           alvo.item_id,
           k.preco_unitario,
           d.titulo,
           v.usuario,
           v.registrado_em
      from public.orcamento_projeto_catalogo_valores v
      left join lateral (
        select coalesce(
          kontrol_private.item_catalogo_vigente(v.catalogo_item_id),
          (select k2.id from public.orcamento_projeto_catalogo k2
            where k2.substituido_por is null
              and k2.rubrica = v.rubrica
              and k2.chave_descricao = kontrol_private.normalizar_texto_catalogo(v.descricao)
              and k2.chave_unidade = kontrol_private.normalizar_unidade_catalogo(v.unidade))
        ) as item_id
      ) alvo on true
      left join public.orcamento_projeto_catalogo k on k.id = alvo.item_id
      left join public.demandas_propostas d on d.id = v.demanda_id
     where v.evento = 'pendente_permissao'
       and not v.aplicado
       and v.resolucao is null
     order by v.registrado_em, v.id;
end $$;

create or replace function public.catalogo_projeto_resolver_pendencia(p_pendencia_id bigint, p_aplicar boolean)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_email text := nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'email';
  v_p public.orcamento_projeto_catalogo_valores%rowtype;
  v_item text;
  v_anterior numeric;
begin
  perform kontrol_private.exigir_permissao('orcamentos.modelos');
  if not kontrol_private.pode_ver_pessoal_orcamento() then
    raise exception 'Valores de pessoal exigem a permissão "Valores de pessoal no orçamento".' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtext('kontrol.orcamento_projeto_catalogo'));

  select * into v_p from public.orcamento_projeto_catalogo_valores v where v.id = p_pendencia_id for update;
  if not found or v_p.evento <> 'pendente_permissao' or v_p.aplicado or v_p.resolucao is not null then
    raise exception 'Pendência não encontrada ou já resolvida.' using errcode = '22023';
  end if;

  if not coalesce(p_aplicar, false) then
    update public.orcamento_projeto_catalogo_valores
       set resolucao = 'descartado', resolvido_em = now(), resolvido_por = v_email
     where id = p_pendencia_id;
    return null;
  end if;

  v_item := coalesce(
    kontrol_private.item_catalogo_vigente(v_p.catalogo_item_id),
    (select k.id from public.orcamento_projeto_catalogo k
      where k.substituido_por is null
        and k.rubrica = v_p.rubrica
        and k.chave_descricao = kontrol_private.normalizar_texto_catalogo(v_p.descricao)
        and k.chave_unidade = kontrol_private.normalizar_unidade_catalogo(v_p.unidade))
  );

  if v_item is null then
    v_item := v_p.rubrica || '-' || nextval('public.orcamento_projeto_catalogo_id_seq');
    insert into public.orcamento_projeto_catalogo
      (id, rubrica, descricao, unidade, preco_unitario, ativo, origem, valor_atualizado_em, valor_atualizado_por,
       valor_origem_orcamento_projeto_id, valor_origem_demanda_id)
    values
      (v_item, v_p.rubrica, v_p.descricao, v_p.unidade, v_p.preco_unitario, true, 'revisao_custos', now(), v_email,
       v_p.orcamento_projeto_id, v_p.demanda_id);
    insert into public.orcamento_projeto_catalogo_valores
      (catalogo_item_id, rubrica, descricao, unidade, evento, preco_unitario, orcamento_projeto_id, demanda_id,
       usuario, observacao)
    values
      (v_item, v_p.rubrica, v_p.descricao, v_p.unidade, 'item_novo', v_p.preco_unitario, v_p.orcamento_projeto_id,
       v_p.demanda_id, v_email, 'Pendência de pessoal aplicada.');
  else
    select k.preco_unitario into v_anterior from public.orcamento_projeto_catalogo k where k.id = v_item for update;
    update public.orcamento_projeto_catalogo k
       set preco_unitario = v_p.preco_unitario,
           ativo = true,
           atualizado_em = now(),
           valor_atualizado_em = now(),
           valor_atualizado_por = v_email,
           valor_origem_orcamento_projeto_id = v_p.orcamento_projeto_id,
           valor_origem_demanda_id = v_p.demanda_id
     where k.id = v_item;
    insert into public.orcamento_projeto_catalogo_valores
      (catalogo_item_id, rubrica, descricao, unidade, evento, preco_unitario, preco_anterior, orcamento_projeto_id,
       demanda_id, usuario, observacao)
    values
      (v_item, v_p.rubrica, v_p.descricao, v_p.unidade, 'valor_alterado', v_p.preco_unitario, v_anterior,
       v_p.orcamento_projeto_id, v_p.demanda_id, v_email, 'Pendência de pessoal aplicada.');
  end if;

  update public.orcamento_projeto_catalogo_valores
     set aplicado = true,
         resolucao = 'aplicado',
         resolvido_em = now(),
         resolvido_por = v_email,
         catalogo_item_id = coalesce(catalogo_item_id, v_item)
   where id = p_pendencia_id;
  return v_item;
end $$;

-- ---- 8. Importar planilha para o catálogo -------------------------------------
create or replace function public.catalogo_projeto_importar(p_itens jsonb, p_aplicar boolean default false)
returns table (
  linha integer,
  rubrica text,
  descricao text,
  unidade text,
  preco numeric,
  categoria text,
  acao text,
  catalogo_item_id text,
  preco_atual numeric,
  mensagem text
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
#variable_conflict use_column
declare
  v_email text := nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'email';
  v_pode boolean := kontrol_private.pode_ver_pessoal_orcamento();
  v_r record;
  v_item text;
begin
  perform kontrol_private.exigir_permissao('orcamentos.modelos');
  if jsonb_typeof(coalesce(p_itens, '[]'::jsonb)) <> 'array' then
    raise exception 'Planilha inválida.' using errcode = '22023';
  end if;
  if jsonb_array_length(coalesce(p_itens, '[]'::jsonb)) > 3000 then
    raise exception 'A planilha tem mais de 3.000 linhas; divida em partes.' using errcode = '22023';
  end if;
  if coalesce(p_aplicar, false) then
    perform pg_advisory_xact_lock(hashtext('kontrol.orcamento_projeto_catalogo'));
  end if;

  for v_r in
    with entrada as (
      select e.ord::integer as n,
             upper(btrim(coalesce(e.item->>'rubrica', ''))) as rub,
             nullif(btrim(coalesce(e.item->>'descricao', '')), '') as des,
             nullif(btrim(coalesce(e.item->>'unidade', '')), '') as uni,
             case when jsonb_typeof(e.item->'preco') = 'number' then (e.item->>'preco')::numeric end as pre,
             nullif(btrim(coalesce(e.item->>'categoria', '')), '') as cat
        from jsonb_array_elements(coalesce(p_itens, '[]'::jsonb)) with ordinality as e(item, ord)
    ),
    chaves as (
      select en.*,
             kontrol_private.normalizar_texto_catalogo(en.des) as ch_d,
             kontrol_private.normalizar_unidade_catalogo(en.uni) as ch_u
        from entrada en
    ),
    alvo as (
      select c.*,
             k.id as item_id,
             k.preco_unitario as preco_k,
             row_number() over (partition by c.rub, c.ch_d, c.ch_u order by c.n desc) as ordem
        from chaves c
        left join public.orcamento_projeto_catalogo k
          on k.substituido_por is null and k.rubrica = c.rub and k.chave_descricao = c.ch_d and k.chave_unidade = c.ch_u
    )
    select a.n, a.rub, a.des, a.uni, a.pre, a.cat, a.item_id, a.preco_k,
           case
             when a.rub not in ('PE', 'MC', 'MP', 'ST', 'VD', 'OU') then 'erro'
             when a.des is null then 'erro'
             when a.pre is null or a.pre < 0 then 'erro'
             when a.ordem > 1 then 'repetido'
             when a.rub = 'PE' and not v_pode then 'sem_permissao'
             when a.item_id is null then 'novo'
             when a.pre = a.preco_k then 'igual'
             else 'atualizar'
           end as decisao,
           case
             when a.rub not in ('PE', 'MC', 'MP', 'ST', 'VD', 'OU') then 'Rubrica inválida (use PE, MC, MP, ST, VD ou OU).'
             when a.des is null then 'Sem descrição.'
             when a.pre is null or a.pre < 0 then 'Valor ausente ou negativo.'
             when a.ordem > 1 then 'O mesmo item aparece mais abaixo na planilha; vale a última linha.'
             when a.rub = 'PE' and not v_pode then 'Pessoal exige a permissão "Valores de pessoal no orçamento".'
           end as aviso
      from alvo a
     order by a.n
  loop
    v_item := v_r.item_id;
    if coalesce(p_aplicar, false) and v_r.decisao = 'novo' then
      v_item := v_r.rub || '-' || nextval('public.orcamento_projeto_catalogo_id_seq');
      insert into public.orcamento_projeto_catalogo
        (id, rubrica, descricao, unidade, categoria, preco_unitario, ativo, origem, valor_atualizado_em, valor_atualizado_por)
      values
        (v_item, v_r.rub, v_r.des, v_r.uni, v_r.cat, v_r.pre, true, 'importacao_planilha', now(), v_email);
      insert into public.orcamento_projeto_catalogo_valores
        (catalogo_item_id, rubrica, descricao, unidade, evento, preco_unitario, usuario, observacao)
      values
        (v_item, v_r.rub, v_r.des, v_r.uni, 'item_novo', v_r.pre, v_email, 'Importado de planilha.');
    elsif coalesce(p_aplicar, false) and v_r.decisao = 'atualizar' then
      update public.orcamento_projeto_catalogo k
         set preco_unitario = v_r.pre,
             categoria = coalesce(v_r.cat, k.categoria),
             ativo = true,
             atualizado_em = now(),
             valor_atualizado_em = now(),
             valor_atualizado_por = v_email,
             valor_origem_orcamento_projeto_id = null,
             valor_origem_demanda_id = null
       where k.id = v_r.item_id;
      insert into public.orcamento_projeto_catalogo_valores
        (catalogo_item_id, rubrica, descricao, unidade, evento, preco_unitario, preco_anterior, usuario, observacao)
      values
        (v_r.item_id, v_r.rub, v_r.des, v_r.uni, 'edicao_catalogo', v_r.pre, v_r.preco_k, v_email, 'Importado de planilha.');
    end if;

    linha := v_r.n;
    rubrica := v_r.rub;
    descricao := v_r.des;
    unidade := v_r.uni;
    preco := v_r.pre;
    categoria := v_r.cat;
    acao := v_r.decisao;
    catalogo_item_id := v_item;
    preco_atual := case when v_r.rub = 'PE' and not v_pode then null else v_r.preco_k end;
    mensagem := v_r.aviso;
    return next;
  end loop;
end $$;

comment on function public.catalogo_projeto_importar(jsonb, boolean) is
  'Prévia (p_aplicar = false) ou importação da planilha do catálogo: cada linha vira novo, atualizar, igual, repetido, sem_permissao ou erro. Mesma identidade do item da 0137; vale a última linha repetida.';

-- ---- 9. Grants ----------------------------------------------------------------
revoke all on function public.reabrir_revisao_custos_projeto(bigint, text) from public, anon;
revoke all on function public.aplicar_modelo_orcamento_projeto(bigint, bigint) from public, anon;
revoke all on function public.catalogo_projeto_pendencias() from public, anon;
revoke all on function public.catalogo_projeto_resolver_pendencia(bigint, boolean) from public, anon;
revoke all on function public.catalogo_projeto_importar(jsonb, boolean) from public, anon;
grant execute on function public.reabrir_revisao_custos_projeto(bigint, text) to authenticated, service_role;
grant execute on function public.aplicar_modelo_orcamento_projeto(bigint, bigint) to authenticated, service_role;
grant execute on function public.catalogo_projeto_pendencias() to authenticated, service_role;
grant execute on function public.catalogo_projeto_resolver_pendencia(bigint, boolean) to authenticated, service_role;
grant execute on function public.catalogo_projeto_importar(jsonb, boolean) to authenticated, service_role;

commit;
