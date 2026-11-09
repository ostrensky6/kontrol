-- 0172 — ciclo de pagamento do dia 10 e urgência justificada.
--
-- Etapa 6 do plano de adaptação do fluxo de compras (decisão D1 de Antonio em
-- 09/11/2026):
--   * solicitações e aprovações da coordenação valem para o ciclo de pagamento
--     do mês quando a aprovação sai até o dia 10; depois disso o pedido passa
--     ao ciclo do mês seguinte;
--   * se o dia 10 cair no sábado ou no domingo, o prazo vai para a segunda;
--   * urgência fura o ciclo, com justificativa obrigatória.
--
-- O ciclo é gravado no pedido (pedidos_internos.ciclo_pagamento, primeiro dia
-- do mês do ciclo) quando a última aprovação de coordenação acontece: a
-- validação do coordenador e, para material de consumo de laboratório, a
-- aprovação da coordenação do laboratório. Reenvio para validação limpa o
-- ciclo. O horário usado é o de Brasília. Feriados não entram na conta (não
-- houve decisão sobre eles).
--
-- Esta migration registra e mostra o ciclo; ela não impede o administrativo de
-- adiantar um pedido do ciclo seguinte.
--
-- Não destrutiva: duas colunas que aceitam vazio, funções e um gatilho. O
-- passo 4 preenche o ciclo dos pedidos já aprovados, a partir da data da
-- validação (o app ainda não está em uso real; autorizado em 09/11).
--
-- Rollback:
--   drop trigger pedidos_internos_definir_ciclo on public.pedidos_internos;
--   drop function kontrol_private.definir_ciclo_pagamento();
--   drop function public.ciclo_pagamento_para(timestamptz, boolean);
--   drop function kontrol_private.ciclo_para(timestamptz, boolean);
--   drop function kontrol_private.prazo_do_ciclo(date);
--   (só depois de exportar, se houver dados) alter table public.pedidos_internos
--     drop column ciclo_pagamento, drop column urgencia_justificativa.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '180s';

do $$
begin
  if to_regclass('public.pedidos_internos_cotacoes') is null then
    raise exception '0172: requer a migration 0171';
  end if;
end $$;

-- ---- 1. Colunas ------------------------------------------------------------------
alter table public.pedidos_internos
  add column if not exists ciclo_pagamento date,
  add column if not exists urgencia_justificativa text;

alter table public.pedidos_internos
  drop constraint if exists pedidos_internos_ciclo_0172_check,
  add constraint pedidos_internos_ciclo_0172_check check (
    (ciclo_pagamento is null or extract(day from ciclo_pagamento) = 1)
    and coalesce(char_length(urgencia_justificativa), 0) <= 1000
  );

comment on column public.pedidos_internos.ciclo_pagamento is
  '0172 (D1): mês do ciclo de pagamento (primeiro dia). Gravado pelo banco na última aprovação de coordenação: até o dia 10 (sábado/domingo vão para a segunda) é o ciclo do mês; depois, o seguinte. Urgência fica no ciclo do mês.';
comment on column public.pedidos_internos.urgencia_justificativa is
  '0172 (D1): por que o pedido é urgente. Obrigatória para urgência alta ou crítica, que fura o ciclo do dia 10.';

-- ---- 2. Regras do ciclo ------------------------------------------------------------
-- Prazo do ciclo: dia 10; sábado e domingo passam para a segunda.
create or replace function kontrol_private.prazo_do_ciclo(p_ciclo date)
returns date
language sql
immutable
set search_path = ''
as $function$
  select d + case extract(isodow from d)::integer when 6 then 2 when 7 then 1 else 0 end
    from (select (date_trunc('month', p_ciclo)::date + 9) as d) x
$function$;

-- Ciclo de um pedido aprovado no momento indicado (horário de Brasília).
create or replace function kontrol_private.ciclo_para(p_momento timestamptz, p_urgente boolean)
returns date
language sql
stable
set search_path = ''
as $function$
  select case
           when coalesce(p_urgente, false) or dia <= kontrol_private.prazo_do_ciclo(mes) then mes
           else (mes + interval '1 month')::date
         end
    from (select (p_momento at time zone 'America/Sao_Paulo')::date as dia,
                 date_trunc('month', (p_momento at time zone 'America/Sao_Paulo')::date)::date as mes) x
$function$;

revoke all on function kontrol_private.prazo_do_ciclo(date) from public, anon;
revoke all on function kontrol_private.ciclo_para(timestamptz, boolean) from public, anon;
grant execute on function kontrol_private.prazo_do_ciclo(date) to authenticated, service_role;
grant execute on function kontrol_private.ciclo_para(timestamptz, boolean) to authenticated, service_role;

-- Consulta para a tela (mesma regra do banco).
create or replace function public.ciclo_pagamento_para(p_momento timestamptz default now(), p_urgente boolean default false)
returns jsonb
language sql
stable
set search_path = ''
as $function$
  select jsonb_build_object('ciclo', c, 'prazo', kontrol_private.prazo_do_ciclo(c))
    from (select kontrol_private.ciclo_para(p_momento, p_urgente) as c) x
$function$;

revoke all on function public.ciclo_pagamento_para(timestamptz, boolean) from public, anon;
grant execute on function public.ciclo_pagamento_para(timestamptz, boolean) to authenticated, service_role;

-- ---- 3. Gatilho: urgência justificada e ciclo gravado ------------------------------
create or replace function kontrol_private.definir_ciclo_pagamento()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  v_urgente boolean := coalesce(new.urgencia, 'normal') in ('alta', 'critica');
begin
  if tg_op = 'INSERT' then
    -- reposição automática de insumo crítico já nasce justificada
    if v_urgente and nullif(btrim(coalesce(new.urgencia_justificativa, '')), '') is null
       and new.origem = 'reposicao_estoque' then
      new.urgencia_justificativa := 'Reposição de insumo crítico abaixo do mínimo (gerada pelo painel de estoque).';
    end if;
    if current_user = 'authenticated' then
      new.ciclo_pagamento := null;
    end if;
    return new;
  end if;

  if current_user = 'authenticated' and new.ciclo_pagamento is distinct from old.ciclo_pagamento then
    raise exception 'O ciclo de pagamento é definido pelo sistema na aprovação da coordenação.' using errcode = '42501';
  end if;

  -- envio (ou reenvio) para validação: urgência precisa de justificativa; ciclo recomeça
  if new.status = 'em_validacao' and new.status is distinct from old.status then
    if v_urgente and char_length(btrim(coalesce(new.urgencia_justificativa, ''))) < 15 then
      raise exception 'Pedido urgente fura o ciclo do dia 10 e precisa de justificativa: escreva por que não pode esperar o próximo ciclo.'
        using errcode = '22023';
    end if;
    new.ciclo_pagamento := null;
    return new;
  end if;

  -- validação do coordenador: define o ciclo (material de laboratório redefine
  -- na aprovação do laboratório, que é a última aprovação de coordenação)
  if old.status = 'em_validacao' and new.status = 'validado' then
    new.ciclo_pagamento := kontrol_private.ciclo_para(now(), v_urgente);
    return new;
  end if;
  if new.aprovacao_area_em is not null and old.aprovacao_area_em is null then
    new.ciclo_pagamento := kontrol_private.ciclo_para(new.aprovacao_area_em, v_urgente);
  end if;
  return new;
end $function$;

revoke all on function kontrol_private.definir_ciclo_pagamento() from public, anon;

drop trigger if exists pedidos_internos_definir_ciclo on public.pedidos_internos;
create trigger pedidos_internos_definir_ciclo
  before insert or update on public.pedidos_internos
  for each row execute function kontrol_private.definir_ciclo_pagamento();

-- ---- 4. Pedidos já aprovados recebem o ciclo -----------------------------------------
do $$
declare
  v_n integer;
begin
  update public.pedidos_internos pi
     set ciclo_pagamento = kontrol_private.ciclo_para(a.aprovado_em, coalesce(pi.urgencia, 'normal') in ('alta', 'critica'))
    from (
      select p.id,
             greatest(coalesce(p.validado_em, v.em), p.aprovacao_area_em) as aprovado_em
        from public.pedidos_internos p
        left join lateral (
          select max(ap.criado_em) as em
            from public.pedidos_internos_aprovacoes ap
           where ap.pedido_interno_id = p.id and ap.status_destino = 'validado'
        ) v on true
    ) a
   where a.id = pi.id
     and a.aprovado_em is not null
     and pi.ciclo_pagamento is null
     and pi.status not in ('rascunho', 'em_validacao', 'ajuste_solicitante', 'cancelado');
  get diagnostics v_n = row_count;
  raise notice '0172: % pedido(s) aprovado(s) receberam o ciclo de pagamento', v_n;
end $$;

commit;
