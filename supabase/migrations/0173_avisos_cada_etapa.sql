-- 0173 — avisos em cada passagem do pedido e "Aguardando você" por competência.
--
-- Etapa 7 do plano de adaptação do fluxo de compras (decisão D8 de 09/11/2026:
-- Nathieli recebe os avisos do administrativo e do pagamento).
--
--   * Novo cadastro "Responsáveis do administrativo e do pagamento"
--     (responsaveis_compras): quem autoriza fonte e rubrica e quem paga, com
--     substituto. Liga Nathieli às duas etapas quando há exatamente um usuário
--     ativo com esse primeiro nome; nos demais casos o Administrador escolhe.
--   * Cada passagem do pedido interno avisa quem precisa agir (e o
--     solicitante nos marcos dele): validação (coordenador competente),
--     laboratório (coordenação do laboratório), formalização, autorização
--     administrativa, 3 orçamentos, aprovação final e fechamento (responsável
--     do administrativo; sem ele, o Administrador), pagamento (responsável do
--     pagamento; sem ele, o Administrador), compra a caminho, conclusão,
--     devolução e cancelamento (solicitante). O aviso vira e-mail pelo envio
--     já existente (notificacoes → destinatarios_notificacao); o app passa a
--     disparar o e-mail logo depois da ação, além do envio diário.
--   * Marcos sem troca de status também avisam: aprovação do laboratório
--     (pronto para formalizar) e entrega registrada (pronto para pagamento).
--   * Compra formal que nasce de pedido interno não avisa mais "aguardando
--     aprovação": ela é aprovada junto com o pedido (0170, caminho único).
--   * "Aguardando você" mostra só o que a pessoa pode decidir: validação para o
--     coordenador competente (ou Administrador), laboratório para a
--     coordenação do laboratório, formalização/autorização, compras e
--     pagamento para os responsáveis (ou Administrador), e Compras sem as
--     compras ligadas a pedido.
--
-- Não destrutiva: cria uma tabela, funções e um gatilho; recria
-- avisar_passagem_etapa (0169) e aguardando_voce (0130) mantendo tudo o que
-- elas já faziam. RLS e auditoria na tabela nova.
--
-- Rollback:
--   drop trigger pedidos_internos_avisar_marcos on public.pedidos_internos;
--   drop function kontrol_private.avisar_marcos_pedido();
--   recriar kontrol_private.avisar_passagem_etapa() da 0169 e
--   public.aguardando_voce() da 0130;
--   drop function kontrol_private.notificar_pedido(text, text, text, bigint, uuid, text, text, text);
--   drop function kontrol_private.usuario_por_email(text);
--   drop function kontrol_private.responsavel_compras(text);
--   drop trigger responsaveis_compras_tocar on public.responsaveis_compras;
--   drop function kontrol_private.tocar_responsaveis_compras();
--   (só depois de exportar, se houver dados) drop table public.responsaveis_compras.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '180s';

do $$
begin
  if to_regprocedure('kontrol_private.ciclo_para(timestamptz,boolean)') is null then
    raise exception '0173: requer a migration 0172';
  end if;
end $$;

-- ---- 1. Responsáveis do administrativo e do pagamento -------------------------------
create table if not exists public.responsaveis_compras (
  id bigint generated always as identity primary key,
  etapa text not null,
  usuario_id uuid references public.perfis(id) on delete set null,
  substituto_id uuid references public.perfis(id) on delete set null,
  observacoes text,
  atualizado_em timestamptz not null default now(),
  constraint responsaveis_compras_etapa_check check (etapa in ('administrativo', 'pagamento')),
  constraint responsaveis_compras_observacoes_check check (coalesce(char_length(observacoes), 0) <= 1000),
  constraint responsaveis_compras_substituto_check check (substituto_id is null or substituto_id is distinct from usuario_id)
);

create unique index if not exists responsaveis_compras_etapa_unica on public.responsaveis_compras (etapa);

comment on table public.responsaveis_compras is
  '0173 (D8): quem recebe os avisos e decide a autorização administrativa (fonte e rubrica) e o pagamento, com substituto.';

alter table public.responsaveis_compras enable row level security;

drop policy if exists responsaveis_compras_ler on public.responsaveis_compras;
create policy responsaveis_compras_ler on public.responsaveis_compras
  for select to authenticated using (true);
drop policy if exists responsaveis_compras_alterar on public.responsaveis_compras;
create policy responsaveis_compras_alterar on public.responsaveis_compras
  for update to authenticated
  using (kontrol_private.tem_permissao_efetiva('usuarios.gerenciar'))
  with check (kontrol_private.tem_permissao_efetiva('usuarios.gerenciar'));

grant select, update on public.responsaveis_compras to authenticated;

drop trigger if exists aud_responsaveis_compras on public.responsaveis_compras;
create trigger aud_responsaveis_compras
  after insert or update or delete on public.responsaveis_compras
  for each row execute function public.fn_auditoria('id');

-- etapa é fixa; a data da última troca vem do banco
create or replace function kontrol_private.tocar_responsaveis_compras()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  new.etapa := old.etapa;
  new.atualizado_em := now();
  return new;
end $function$;

revoke all on function kontrol_private.tocar_responsaveis_compras() from public, anon;

drop trigger if exists responsaveis_compras_tocar on public.responsaveis_compras;
create trigger responsaveis_compras_tocar
  before update on public.responsaveis_compras
  for each row execute function kontrol_private.tocar_responsaveis_compras();

insert into public.responsaveis_compras (etapa, observacoes)
select v.etapa, v.observacoes
  from (values
    ('administrativo', 'Autorização administrativa (fonte e rubrica). Indicada em 09/11/2026: Nathieli.'),
    ('pagamento', 'Pagamento e nota fiscal. Indicada em 09/11/2026: Nathieli.')
  ) as v(etapa, observacoes)
 where not exists (select 1 from public.responsaveis_compras r where r.etapa = v.etapa);

do $$
declare
  v_id uuid;
  v_n integer;
  v_nome text;
begin
  select (array_agg(pf.id))[1], count(*), max(coalesce(pf.nome, pf.email))
    into v_id, v_n, v_nome
    from public.perfis pf
   where not coalesce(pf.suspenso, false)
     and lower(split_part(btrim(coalesce(pf.nome, '')), ' ', 1)) = 'nathieli';
  if v_n = 1 then
    update public.responsaveis_compras set usuario_id = v_id where usuario_id is null;
    raise notice '0173: administrativo e pagamento -> %', v_nome;
  else
    raise notice '0173: administrativo e pagamento sem responsável (% usuário(s) Nathieli ativos); escolher em Cadastros', coalesce(v_n, 0);
  end if;
end $$;

-- ---- 2. Funções de apoio -------------------------------------------------------------
create or replace function kontrol_private.responsavel_compras(p_etapa text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $function$
  select case
           when u.id is not null and not coalesce(u.suspenso, false) then u.id
           when s.id is not null and not coalesce(s.suspenso, false) then s.id
         end
    from public.responsaveis_compras r
    left join public.perfis u on u.id = r.usuario_id
    left join public.perfis s on s.id = r.substituto_id
   where r.etapa = p_etapa
$function$;

create or replace function kontrol_private.usuario_por_email(p_email text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $function$
  select pf.id from public.perfis pf
   where lower(pf.email) = lower(btrim(coalesce(p_email, '')))
     and not coalesce(pf.suspenso, false)
   limit 1
$function$;

create or replace function kontrol_private.notificar_pedido(
  p_tipo text,
  p_titulo text,
  p_corpo text,
  p_pedido_id bigint,
  p_usuario uuid,
  p_permissao text,
  p_chave text,
  p_papel text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  -- destino: a pessoa; sem ela, quem tem a permissão; sem permissão, o papel
  if p_usuario is null and p_permissao is null and p_papel is null then
    return;
  end if;
  insert into public.notificacoes (tipo, titulo, corpo, entidade_tipo, entidade_id,
                                   usuario_destino, permissao_destino, papel_destino, dedupe_key)
  values (p_tipo, p_titulo, p_corpo, 'pedido_interno', p_pedido_id, p_usuario,
          case when p_usuario is null then p_permissao end,
          case when p_usuario is null and p_permissao is null then p_papel end,
          p_chave)
  on conflict do nothing;
exception when others then
  raise warning 'Kontrol: aviso do pedido interno #% não gravado: %', p_pedido_id, sqlerrm;
end $function$;

revoke all on function kontrol_private.responsavel_compras(text) from public, anon;
revoke all on function kontrol_private.usuario_por_email(text) from public, anon, authenticated;
revoke all on function kontrol_private.notificar_pedido(text, text, text, bigint, uuid, text, text, text) from public, anon, authenticated;
grant execute on function kontrol_private.responsavel_compras(text) to authenticated, service_role;

-- ---- 3. Avisos das passagens (recria a da 0169, com todas as etapas do pedido) -------
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
  v_solicitante uuid;
  v_pedido text;
  v_admin_resp uuid;
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

  -- ---- pedido interno: cada passagem avisa quem age (e o solicitante nos marcos) ----
  if tg_table_name = 'pedidos_internos' then
    v_pedido := format('Pedido interno #%s: %s.', v_id, coalesce(v_novo_reg ->> 'titulo', 'sem título'));
    v_solicitante := kontrol_private.usuario_por_email(v_novo_reg ->> 'solicitante');
    -- etapas de compras: o responsável do administrativo (D8); sem ele, o Administrador (D3)
    v_admin_resp := kontrol_private.responsavel_compras('administrativo');

    if v_novo = 'em_validacao' then
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
      perform kontrol_private.notificar_pedido('aprovacao_pendente', 'Pedido interno aguardando validação',
        format('%s Solicitante: %s.', v_pedido, coalesce(v_novo_reg ->> 'solicitante', '—')),
        v_id, v_usuario, 'pedido.aprovar', v_chave);

    elsif v_novo = 'validado' and coalesce(v_novo_reg ->> 'natureza', '') = 'material_consumo_lab' then
      select c.coordenador_id, c.nome into v_usuario, v_rotulo
        from public.coordenacoes_area c
       where c.id = nullif(v_novo_reg ->> 'area_id', '')::bigint;
      perform kontrol_private.notificar_pedido('aprovacao_pendente', 'Pedido interno aguardando a coordenação do laboratório',
        format('%s Laboratório: %s. O coordenador do projeto já validou.', v_pedido, coalesce(v_rotulo, 'não informado')),
        v_id, v_usuario, 'pedido.aprovar', v_chave);

    elsif v_novo = 'validado' then
      perform kontrol_private.notificar_pedido('aprovacao_pendente', 'Pedido interno validado: formalizar a compra',
        format('%s O coordenador validou. Formalize para seguir à autorização administrativa.', v_pedido),
        v_id, v_admin_resp, null, v_chave, 'admin');

    elsif v_novo in ('ajuste_solicitante', 'ajuste_compras') then
      perform kontrol_private.notificar_pedido('aprovacao_pendente', 'Pedido interno devolvido para ajuste',
        format('%s Devolvido %s. Ajuste e envie de novo.', v_pedido,
               case v_novo when 'ajuste_solicitante' then 'pela validação' else 'pelo administrativo' end),
        v_id, v_solicitante, null, v_chave);

    elsif v_novo in ('formalizado', 'analise_administrativa') and v_antigo is distinct from 'formalizado' then
      perform kontrol_private.notificar_pedido('aprovacao_pendente', 'Pedido interno aguardando autorização administrativa',
        format('%s Defina fonte e rubrica e autorize a compra.', v_pedido),
        v_id, v_admin_resp, null, v_chave, 'admin');

    elsif v_novo = 'aprovado_compra' then
      perform kontrol_private.notificar_pedido('aprovacao_pendente', 'Compra autorizada: pedir os 3 orçamentos',
        format('%s Autorizado pelo administrativo (fonte: %s; rubrica: %s).', v_pedido,
               coalesce(v_novo_reg ->> 'fonte_recurso', '—'), coalesce(v_novo_reg ->> 'rubrica', '—')),
        v_id, v_admin_resp, null, v_chave, 'admin');

    elsif v_novo = 'orcamentos_recebidos' then
      perform kontrol_private.notificar_pedido('aprovacao_pendente', 'Orçamentos recebidos: escolher o orçamento',
        format('%s Os 3 orçamentos foram registrados. Escolha um e envie para a aprovação final.', v_pedido),
        v_id, v_admin_resp, null, v_chave, 'admin');

    elsif v_novo = 'aguardando_aprovacao_final' then
      perform kontrol_private.notificar_pedido('aprovacao_pendente', 'Pedido interno aguardando aprovação final',
        format('%s Orçamento escolhido; falta a aprovação final da compra.', v_pedido),
        v_id, v_admin_resp, null, v_chave, 'admin');

    elsif v_novo = 'aprovado_para_compra' then
      perform kontrol_private.notificar_pedido('aprovacao_pendente', 'Compra aprovada: fechar com o fornecedor',
        format('%s Feche com o fornecedor ou encaminhe à instituição.', v_pedido),
        v_id, v_admin_resp, null, v_chave, 'admin');
      perform kontrol_private.notificar_pedido('sistema', 'Seu pedido interno foi aprovado para compra',
        format('%s A compra foi aprovada.', v_pedido), v_id, v_solicitante, null, v_chave || ':solicitante');

    elsif v_novo in ('compra_fechada', 'encaminhado_instituicao') then
      perform kontrol_private.notificar_pedido('sistema', 'Seu pedido interno está a caminho',
        format('%s %s Quando chegar (ou o serviço for prestado), registre no pedido: o pagamento só sai depois disso.', v_pedido,
               case v_novo when 'compra_fechada' then 'A compra foi fechada com o fornecedor.' else 'Foi encaminhado à instituição.' end),
        v_id, v_solicitante, null, v_chave);

    elsif v_novo = 'aguardando_pagamento_nf' then
      perform kontrol_private.notificar_pedido('aprovacao_pendente', 'Pedido interno aguardando pagamento e nota fiscal',
        format('%s Entrega registrada. Faça o pagamento e anexe a nota fiscal.', v_pedido),
        v_id, kontrol_private.responsavel_compras('pagamento'), null, v_chave, 'admin');

    elsif v_novo = 'compra_concluida' then
      perform kontrol_private.notificar_pedido('sistema', 'Seu pedido interno foi concluído',
        format('%s Compra concluída e paga.', v_pedido), v_id, v_solicitante, null, v_chave);

    elsif v_novo = 'cancelado' then
      perform kontrol_private.notificar_pedido('sistema', 'Seu pedido interno foi cancelado',
        format('%s O motivo está no histórico do pedido.', v_pedido), v_id, v_solicitante, null, v_chave);
    end if;
    return null;
  end if;

  if tg_table_name = 'pedidos_compra' and v_novo = 'solicitado' then
    -- 0173: a compra que nasce de pedido interno é aprovada junto com ele (0170)
    if coalesce(v_novo_reg ->> 'observacao', '') like 'Formalizado a partir do pedido interno #%' then
      return null;
    end if;
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

-- ---- 4. Marcos sem troca de status -----------------------------------------------------
create or replace function kontrol_private.avisar_marcos_pedido()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_pedido text := format('Pedido interno #%s: %s.', new.id, coalesce(new.titulo, 'sem título'));
begin
  -- laboratório aprovou: o pedido pode ser formalizado
  if new.aprovacao_area_em is not null and old.aprovacao_area_em is null and new.status = 'validado' then
    perform kontrol_private.notificar_pedido('aprovacao_pendente', 'Laboratório aprovou: formalizar a compra',
      format('%s A coordenação do laboratório aprovou. Formalize para seguir à autorização administrativa.', v_pedido),
      new.id, kontrol_private.responsavel_compras('administrativo'), null,
      format('marco:pedido:%s:laboratorio:%s', new.id, new.aprovacao_area_em), 'admin');
  end if;

  -- entrega registrada: o pedido pode ir para pagamento
  if new.status in ('compra_fechada', 'encaminhado_instituicao')
     and ((new.recebido_em is not null and old.recebido_em is null)
          or (new.entrega_confirmada_em is not null and old.entrega_confirmada_em is null)
          or (new.excecao_pagamento_em is not null and old.excecao_pagamento_em is null))
     and kontrol_private.pendencia_pagamento(new.id) is null then
    perform kontrol_private.notificar_pedido('aprovacao_pendente', 'Entrega registrada: pedido pronto para pagamento',
      format('%s %s Siga para "Aguardar pagamento/NF".', v_pedido,
             case when new.excecao_pagamento_em is not null and old.excecao_pagamento_em is null
                  then 'Exceção registrada: pagamento antes da entrega.' else 'A entrega foi registrada.' end),
      new.id, kontrol_private.responsavel_compras('pagamento'), null,
      format('marco:pedido:%s:pagamento:%s', new.id, (extract(epoch from clock_timestamp()) * 1000)::bigint), 'admin');
  end if;
  return null;
end $function$;

revoke all on function kontrol_private.avisar_marcos_pedido() from public, anon, authenticated;

drop trigger if exists pedidos_internos_avisar_marcos on public.pedidos_internos;
create trigger pedidos_internos_avisar_marcos
  after update of aprovacao_area_em, recebido_em, entrega_confirmada_em, excecao_pagamento_em on public.pedidos_internos
  for each row execute function kontrol_private.avisar_marcos_pedido();

-- ---- 5. "Aguardando você" por competência (recria a da 0130, sem lotes em quarentena) ---------------------------
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
  if v_admin or v_uid is not distinct from kontrol_private.responsavel_compras('administrativo') then
    -- formalizar e autorizar (fonte e rubrica)
    with fila as (
      select p.id, '#' || p.id || ' · ' || coalesce(p.titulo, 'sem título') as rotulo, p.atualizado_em as desde
        from public.pedidos_internos p
       where p.status in ('formalizado', 'analise_administrativa')
          or (p.status = 'validado'
              and (coalesce(p.natureza, '') <> 'material_consumo_lab' or p.aprovacao_area_em is not null))
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
  if v_admin or v_uid is not distinct from kontrol_private.responsavel_compras('pagamento') then
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

notify pgrst, 'reload schema';

commit;
