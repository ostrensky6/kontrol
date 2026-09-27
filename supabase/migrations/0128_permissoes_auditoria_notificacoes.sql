-- Permissões, auditoria e notificações por usuário (auditoria de 2026-09-26,
-- terceira rodada; decisão do dono "a caixinha manda", §9 do relatório).
--
-- O que muda e por quê:
--  1. CAD2-2/CAD2-3 — auditoria aditiva: perfis (papel, permissões e suspensão
--     mudavam sem rastro), análises, etapas, insumos por análise, equipamentos
--     por análise, equipamentos, unidades e manutenção de equipamentos, locais,
--     overhead e parâmetros. public.fn_auditoria aceita, opcionalmente, o nome
--     da coluna-chave (análises usam "codigo"; parâmetros, "chave"); o
--     comportamento dos gatilhos existentes não muda. Nenhuma dessas tabelas
--     guarda salário: a auditoria mascarada de tecnicos (0112) não é tocada.
--  2. PER2-14 — suspenso deixa de ter papel em current_papel() e, por
--     consequência, em papel_minimo() (admin suspenso ainda gravava perfis).
--  3. PER2-2 — pedidos_internos_aprovacoes só é gravada pelas RPCs de etapa
--     (security definer); pela API ninguém insere, altera nem apaga. Quem não
--     tem "Aprovar pedidos internos" só altera o próprio pedido, só em
--     rascunho/ajuste e nunca as colunas de aprovação. O carimbo de envio
--     para validação passa a ser gravado junto com a troca de status.
--  4. PER2-4 — eventos_status: cada usuário ativo registra eventos só em seu
--     próprio nome.
--  5. PER2-7 — orçamento só é excluído com "Cancelar orçamentos" e em rascunho.
--  6. PER2-8 — unidades, planos e manutenções de equipamento: escrita com
--     "Editar cadastros"; o histórico de status só pelo gatilho.
--  7. PER2-17 — identificadores, triagem de códigos e leituras do scanner
--     deixam de aceitar escrita de qualquer logado (a regra "for all true"
--     anulava a política existente).
--  8. PER2-15 — exceções individuais iguais ao padrão da categoria são
--     removidas (o acesso não muda); cada uma é listada em NOTICE.
--  9. PER-4/PER2-9/PER2-10 — notificações por destinatário: leitura e
--     arquivamento por usuário (tabela nova notificacoes_leituras), destino
--     por usuário, papel ou permissão (coluna nova permissao_destino), visão
--     v_minhas_notificacoes e avisos automáticos nas passagens de etapa
--     (gatilhos AFTER; nenhuma RPC é redefinida). RPC aguardando_voce() para
--     a página inicial e destinatarios_notificacao() para o e-mail.
-- 10. PER2-5 — views passam a respeitar a RLS de quem consulta
--     (security_invoker): o painel não mostra mais números de orçamento a
--     quem não tem "Orçamentos: Visualizar".
--
-- Não remove tabelas, colunas, dados, RLS nem gatilhos de auditoria.
-- Políticas trocadas: pedidos_internos_aprovacoes (escrita), pedidos_internos
-- (insert), eventos_status (insert), orcamentos (delete),
-- equipamento_unidades/_manutencoes/_planos_manutencao/_status_log,
-- identificadores, cadastros_triagem, scan_eventos e notificacoes.
--
-- Rollback: recriar as políticas anteriores (0124 para pedidos e orçamentos;
-- "authenticated_all_*" com using/with check true para equipamentos,
-- identificadores, triagem, scan e notificações; identificadores_write_coordenador;
-- rls_tecnico_insert_eventos_status com papel_minimo('tecnico')); reaplicar
-- current_papel() e fn_auditoria() anteriores (sem "and not suspenso" / sem
-- tg_argv); remover os gatilhos aud_*, trg_proteger_pedido_interno_direto,
-- trg_carimbar_envio_pedido_interno, trg_ignorar_notificacao_repetida e
-- trg_avisar_etapa_* criados aqui; "alter view ... reset (security_invoker)";
-- reaplicar as exceções listadas em NOTICE (ou restaurar perfis.permissoes do
-- backup lógico). A tabela notificacoes_leituras e a coluna permissao_destino
-- são aditivas e podem ficar.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '180s';

do $$
begin
  if to_regprocedure('kontrol_private.exigir_permissao(text)') is null
    or to_regprocedure('public.minhas_permissoes()') is null then
    raise exception '0128: requer a migration 0124';
  end if;
end $$;

-- ---- 1. Auditoria -----------------------------------------------------------
-- Mesma função dos gatilhos aud_*; a chave do registro vem de tg_argv[0]
-- (padrão "id"), para auditar tabelas cuja chave não se chama id.
create or replace function public.fn_auditoria()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_user text;
  v_chave text := coalesce(nullif(tg_argv[0], ''), 'id');
begin
  begin
    v_user := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email';
  exception when others then
    v_user := null;
  end;
  v_user := coalesce(v_user, current_setting('app.usuario', true));

  insert into auditoria(tabela, registro_id, acao, valor_anterior, valor_novo, usuario)
  values (
    tg_table_name,
    (case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end) ->> v_chave,
    lower(tg_op),
    case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) else null end,
    case when tg_op in ('UPDATE','INSERT') then to_jsonb(new) else null end,
    v_user
  );
  return case when tg_op = 'DELETE' then old else new end;
end $function$;

do $$
declare
  v_alvo record;
begin
  for v_alvo in
    select * from (values
      ('perfis', 'id'),
      ('analises', 'codigo'),
      ('etapas', 'id'),
      ('insumo_analise', 'id'),
      ('equipamento_analise', 'id'),
      ('equipamentos', 'id'),
      ('equipamento_unidades', 'id'),
      ('equipamento_manutencoes', 'id'),
      ('equipamento_planos_manutencao', 'id'),
      ('locais', 'id'),
      ('overhead', 'id'),
      ('parametros', 'chave')
    ) as t(tabela, chave)
  loop
    if to_regclass(format('public.%I', v_alvo.tabela)) is null then
      raise notice '0128: tabela % não existe; auditoria ignorada', v_alvo.tabela;
      continue;
    end if;
    if not exists (
      select 1 from pg_trigger
      where tgrelid = format('public.%I', v_alvo.tabela)::regclass
        and tgname = 'aud_' || v_alvo.tabela
    ) then
      execute format(
        'create trigger %I after insert or update or delete on public.%I for each row execute function public.fn_auditoria(%L)',
        'aud_' || v_alvo.tabela, v_alvo.tabela, v_alvo.chave);
    end if;
  end loop;
end $$;

-- ---- 2. Suspenso não tem papel ----------------------------------------------
create or replace function public.current_papel()
returns text
language sql
stable
security definer
set search_path to 'public'
as $function$
  select papel from perfis where id = auth.uid() and not suspenso;
$function$;

-- ---- 3. Pedido interno: aprovações só pelas RPCs; edição pelo solicitante ---
do $$
declare
  v_pol record;
begin
  for v_pol in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'pedidos_internos_aprovacoes'
      and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL') and permissive = 'PERMISSIVE'
  loop
    execute format('drop policy %I on public.pedidos_internos_aprovacoes', v_pol.policyname);
  end loop;
end $$;

-- As RPCs de etapa (transicionar_pedido_interno, formalizar_pedido_interno,
-- cancelar_pedido_interno_operacional) são security definer e gravam aqui.
create policy somente_rpc_insert_pedidos_internos_aprovacoes on public.pedidos_internos_aprovacoes
  for insert to authenticated with check (false);
create policy somente_rpc_update_pedidos_internos_aprovacoes on public.pedidos_internos_aprovacoes
  for update to authenticated using (false) with check (false);
create policy somente_rpc_delete_pedidos_internos_aprovacoes on public.pedidos_internos_aprovacoes
  for delete to authenticated using (false);

-- Inclusão direta pela API: quem só cria pedidos abre em rascunho e em seu nome.
drop policy if exists perm_insert_pedidos_internos on public.pedidos_internos;
create policy perm_insert_pedidos_internos on public.pedidos_internos
  for insert to authenticated
  with check (
    kontrol_private.tem_permissao_efetiva('pedido.aprovar')
    or (
      kontrol_private.tem_permissao_efetiva('pedido.criar')
      and coalesce(status, 'rascunho') = 'rascunho'
      and lower(coalesce(solicitante, '')) = lower(coalesce(auth.jwt() ->> 'email', '-'))
    )
  );

-- Alteração direta pela API por quem não aprova: só o solicitante, só em
-- rascunho/ajuste e sem tocar nas colunas de aprovação. Não é security
-- definer de propósito: dentro das RPCs (security definer) o current_user é o
-- dono delas e a checagem não se aplica. Mensagens claras em vez de "0 linhas".
create or replace function kontrol_private.proteger_pedido_interno_direto()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  v_editaveis constant text[] := array['rascunho', 'ajuste_solicitante', 'ajuste_compras'];
  v_protegidas constant text[] := array[
    'status', 'solicitante', 'pedido_compra_id', 'validado_em', 'formalizado_em', 'analisado_em',
    'orcamentos_em', 'fechado_em', 'encaminhado_em', 'aprovacao_final_em', 'pagamento_nf_em',
    'concluido_em', 'recebido_em', 'recebido_por', 'rubrica', 'conformidade_admin',
    'observacao_compras', 'comprador_responsavel', 'aprovador_coordenador',
    'aprovado_coordenador_em', 'aprovador_coordenador_diferente', 'modalidade_compra',
    'modalidade_definida_em', 'modalidade_definida_por', 'instituicao_destino',
    'protocolo_externo', 'data_envio_instituicao', 'data_retorno_instituicao',
    'observacao_administrativa', 'origem'
  ];
  v_novo jsonb;
  v_antigo jsonb;
  v_coluna text;
begin
  if current_user <> 'authenticated'
    or kontrol_private.tem_permissao_efetiva('pedido.aprovar') then
    return new;
  end if;

  if lower(coalesce(old.solicitante, '')) <> lower(coalesce(auth.jwt() ->> 'email', '-')) then
    raise exception 'Só quem abriu o pedido interno pode alterá-lo. Quem aprova pedidos usa as etapas do pedido.'
      using errcode = '42501';
  end if;

  v_novo := to_jsonb(new) - 'atualizado_em' - 'enviado_validacao_em';
  v_antigo := to_jsonb(old) - 'atualizado_em' - 'enviado_validacao_em';

  if not (old.status = any (v_editaveis)) then
    -- O app ainda regrava o carimbo de envio logo depois da RPC; o carimbo já
    -- foi gravado na troca de status, então a repetição vira no-op.
    if v_novo = v_antigo then
      new.enviado_validacao_em := old.enviado_validacao_em;
      return new;
    end if;
    raise exception 'O pedido interno só pode ser alterado em rascunho ou em ajuste.'
      using errcode = '42501';
  end if;

  foreach v_coluna in array v_protegidas loop
    if (v_novo -> v_coluna) is distinct from (v_antigo -> v_coluna) then
      raise exception 'O campo % só muda pelas etapas do pedido interno.', v_coluna
        using errcode = '42501';
    end if;
  end loop;
  return new;
end $function$;

revoke all on function kontrol_private.proteger_pedido_interno_direto() from public, anon;

create or replace function kontrol_private.carimbar_envio_pedido_interno()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if new.status = 'em_validacao' and old.status is distinct from 'em_validacao' then
    new.enviado_validacao_em := now();
  end if;
  return new;
end $function$;

revoke all on function kontrol_private.carimbar_envio_pedido_interno() from public, anon;

drop trigger if exists trg_proteger_pedido_interno_direto on public.pedidos_internos;
create trigger trg_proteger_pedido_interno_direto
  before update on public.pedidos_internos
  for each row execute function kontrol_private.proteger_pedido_interno_direto();

drop trigger if exists trg_carimbar_envio_pedido_interno on public.pedidos_internos;
create trigger trg_carimbar_envio_pedido_interno
  before update of status on public.pedidos_internos
  for each row execute function kontrol_private.carimbar_envio_pedido_interno();

-- ---- 4. Linha do tempo: cada um registra em seu nome ------------------------
drop policy if exists rls_tecnico_insert_eventos_status on public.eventos_status;
drop policy if exists eventos_status_insert_proprio on public.eventos_status;
create policy eventos_status_insert_proprio on public.eventos_status
  for insert to authenticated
  with check (
    public.papel_minimo('tecnico')
    and lower(coalesce(usuario, '')) = lower(coalesce(auth.jwt() ->> 'email', '-'))
  );

-- ---- 5. Exclusão de orçamento -----------------------------------------------
drop policy if exists perm_delete_orcamentos on public.orcamentos;
create policy perm_delete_orcamentos on public.orcamentos
  for delete to authenticated
  using (kontrol_private.tem_permissao_efetiva('orcamentos.cancelar') and status = 'rascunho');

-- ---- 6. Equipamentos (unidades, planos, manutenções, histórico) -------------
do $$
declare
  v_alvo record;
begin
  for v_alvo in
    select * from (values
      ('equipamento_unidades', 'authenticated_all_equipamento_unidades'),
      ('equipamento_manutencoes', 'authenticated_all_manutencoes'),
      ('equipamento_planos_manutencao', 'authenticated_all_planos_manutencao')
    ) as t(tabela, antiga)
  loop
    execute format('drop policy if exists %I on public.%I', v_alvo.antiga, v_alvo.tabela);
    execute format('drop policy if exists %I on public.%I', 'perm_read_' || v_alvo.tabela, v_alvo.tabela);
    execute format('drop policy if exists %I on public.%I', 'perm_insert_' || v_alvo.tabela, v_alvo.tabela);
    execute format('drop policy if exists %I on public.%I', 'perm_update_' || v_alvo.tabela, v_alvo.tabela);
    execute format('drop policy if exists %I on public.%I', 'perm_delete_' || v_alvo.tabela, v_alvo.tabela);
    execute format('create policy %I on public.%I for select to authenticated using (true)',
      'perm_read_' || v_alvo.tabela, v_alvo.tabela);
    execute format('create policy %I on public.%I for insert to authenticated with check (kontrol_private.tem_permissao_efetiva(''cadastros.editar''))',
      'perm_insert_' || v_alvo.tabela, v_alvo.tabela);
    execute format('create policy %I on public.%I for update to authenticated using (kontrol_private.tem_permissao_efetiva(''cadastros.editar'')) with check (kontrol_private.tem_permissao_efetiva(''cadastros.editar''))',
      'perm_update_' || v_alvo.tabela, v_alvo.tabela);
    execute format('create policy %I on public.%I for delete to authenticated using (kontrol_private.tem_permissao_efetiva(''cadastros.editar''))',
      'perm_delete_' || v_alvo.tabela, v_alvo.tabela);
  end loop;
end $$;

-- O histórico de status é gravado pelo gatilho fn_log_equipamento_status_change
-- (security definer); pela API, só leitura.
drop policy if exists authenticated_all_status_log on public.equipamento_status_log;
drop policy if exists perm_read_equipamento_status_log on public.equipamento_status_log;
create policy perm_read_equipamento_status_log on public.equipamento_status_log
  for select to authenticated using (true);

-- ---- 7. Identificadores, triagem de códigos e leituras do scanner -----------
-- A regra antiga (coordenador ou acima) vira a caixinha equivalente
-- "Editar insumos" (padrão: coordenador e gestor).
drop policy if exists authenticated_all_identificadores on public.identificadores;
drop policy if exists identificadores_write_coordenador on public.identificadores;
drop policy if exists perm_insert_identificadores on public.identificadores;
drop policy if exists perm_update_identificadores on public.identificadores;
drop policy if exists perm_delete_identificadores on public.identificadores;
create policy perm_insert_identificadores on public.identificadores
  for insert to authenticated with check (kontrol_private.tem_permissao_efetiva('insumos.editar'));
create policy perm_update_identificadores on public.identificadores
  for update to authenticated
  using (kontrol_private.tem_permissao_efetiva('insumos.editar'))
  with check (kontrol_private.tem_permissao_efetiva('insumos.editar'));
create policy perm_delete_identificadores on public.identificadores
  for delete to authenticated using (kontrol_private.tem_permissao_efetiva('insumos.editar'));

-- Registrar um código desconhecido faz parte do manuseio do estoque; resolver
-- a triagem (vincular ou arquivar) é cadastro.
drop policy if exists authenticated_all_cadastros_triagem on public.cadastros_triagem;
drop policy if exists perm_read_cadastros_triagem on public.cadastros_triagem;
drop policy if exists perm_insert_cadastros_triagem on public.cadastros_triagem;
drop policy if exists perm_update_cadastros_triagem on public.cadastros_triagem;
create policy perm_read_cadastros_triagem on public.cadastros_triagem
  for select to authenticated using (true);
create policy perm_insert_cadastros_triagem on public.cadastros_triagem
  for insert to authenticated
  with check (kontrol_private.tem_permissao_efetiva('estoque.movimentar')
    or kontrol_private.tem_permissao_efetiva('insumos.editar'));
create policy perm_update_cadastros_triagem on public.cadastros_triagem
  for update to authenticated
  using (kontrol_private.tem_permissao_efetiva('insumos.editar'))
  with check (kontrol_private.tem_permissao_efetiva('insumos.editar'));

-- Leitura de código é um registro (log): só inclusão, por quem vê o estoque.
drop policy if exists authenticated_all_scan_eventos on public.scan_eventos;
drop policy if exists scan_eventos_insert_authenticated on public.scan_eventos;
drop policy if exists perm_insert_scan_eventos on public.scan_eventos;
create policy perm_insert_scan_eventos on public.scan_eventos
  for insert to authenticated with check (kontrol_private.tem_permissao_efetiva('estoque.ver'));

-- ---- 8. Exceções individuais iguais ao padrão da categoria ------------------
do $$
declare
  v_perfil record;
  v_categoria jsonb;
  v_chave text;
  v_total integer := 0;
begin
  for v_perfil in
    select id, email, papel, permissoes from public.perfis
    where papel in ('tecnico', 'coordenador', 'gestor') and permissoes <> '{}'::jsonb
    order by email
  loop
    select permissoes into v_categoria from public.permissoes_categorias where papel = v_perfil.papel;
    continue when v_categoria is null;
    for v_chave in select jsonb_object_keys(v_perfil.permissoes) loop
      if v_categoria ? v_chave and (v_categoria -> v_chave) = (v_perfil.permissoes -> v_chave) then
        update public.perfis set permissoes = permissoes - v_chave where id = v_perfil.id;
        v_total := v_total + 1;
        raise notice '0128: % (%) tinha a exceção % = % igual ao padrão da categoria; removida (acesso igual)',
          v_perfil.email, v_perfil.papel, v_chave, v_perfil.permissoes -> v_chave;
      end if;
    end loop;
  end loop;
  raise notice '0128: % exceção(ões) igual(is) ao padrão removida(s).', v_total;
end $$;

-- ---- 9. Notificações por destinatário ---------------------------------------
alter table public.notificacoes add column if not exists permissao_destino text;
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.notificacoes'::regclass and conname = 'notificacoes_permissao_destino_check'
  ) then
    alter table public.notificacoes add constraint notificacoes_permissao_destino_check
      check (permissao_destino is null or permissao_destino ~ '^[a-z_]+(\.[a-z_]+)+$');
  end if;
end $$;
comment on column public.notificacoes.permissao_destino is
  'Permissão (caixinha) de quem deve receber o aviso. Precede papel_destino; usuario_destino precede ambos.';
comment on column public.notificacoes.status is
  'Legado (global). Desde a 0128 a leitura e o arquivamento são por usuário (notificacoes_leituras).';

create table if not exists public.notificacoes_leituras (
  notificacao_id bigint not null references public.notificacoes(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  lida_em timestamptz,
  arquivada_em timestamptz,
  primary key (notificacao_id, user_id)
);
create index if not exists notificacoes_leituras_user_idx on public.notificacoes_leituras (user_id);
alter table public.notificacoes_leituras enable row level security;
revoke all on table public.notificacoes_leituras from anon, public;
grant select, insert, update, delete on table public.notificacoes_leituras to authenticated;
grant all on table public.notificacoes_leituras to service_role;

drop policy if exists leituras_proprias on public.notificacoes_leituras;
create policy leituras_proprias on public.notificacoes_leituras
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create or replace function kontrol_private.notificacao_visivel(
  p_usuario_destino uuid,
  p_papel_destino text,
  p_permissao_destino text
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_papel text;
  v_ordem constant text[] := array['tecnico', 'coordenador', 'gestor', 'admin'];
begin
  if auth.uid() is null then
    return false;
  end if;
  select papel into v_papel from public.perfis where id = auth.uid() and not suspenso;
  if not found then
    return false;
  end if;
  if p_usuario_destino is not null then
    return p_usuario_destino = auth.uid();
  end if;
  if p_permissao_destino is not null then
    return kontrol_private.tem_permissao_efetiva(p_permissao_destino);
  end if;
  if p_papel_destino is not null then
    return v_papel = 'admin'
      or coalesce(array_position(v_ordem, v_papel) >= array_position(v_ordem, p_papel_destino), false);
  end if;
  return true;
end $function$;

revoke all on function kontrol_private.notificacao_visivel(uuid, text, text) from public, anon;
grant execute on function kontrol_private.notificacao_visivel(uuid, text, text) to authenticated;

drop policy if exists authenticated_all_notificacoes on public.notificacoes;
drop policy if exists notificacoes_ler_destino on public.notificacoes;
drop policy if exists notificacoes_criar on public.notificacoes;
create policy notificacoes_ler_destino on public.notificacoes
  for select to authenticated
  using (kontrol_private.notificacao_visivel(usuario_destino, papel_destino, permissao_destino));
-- O app ainda cria avisos de falta do plano; alteração e exclusão só pelo
-- servidor (service_role) e pelas rotinas do banco.
create policy notificacoes_criar on public.notificacoes
  for insert to authenticated
  with check (public.papel_minimo('tecnico'));

-- Aviso repetido (mesma dedupe_key) é ignorado em vez de derrubar o lote
-- inteiro: quem cria nem sempre enxerga o aviso já existente.
create or replace function kontrol_private.ignorar_notificacao_repetida()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.dedupe_key is not null
    and exists (select 1 from public.notificacoes where dedupe_key = new.dedupe_key) then
    return null;
  end if;
  return new;
end $function$;

revoke all on function kontrol_private.ignorar_notificacao_repetida() from public, anon;

drop trigger if exists trg_ignorar_notificacao_repetida on public.notificacoes;
create trigger trg_ignorar_notificacao_repetida
  before insert on public.notificacoes
  for each row execute function kontrol_private.ignorar_notificacao_repetida();

create or replace view public.v_minhas_notificacoes
with (security_invoker = on)
as
select
  n.id,
  n.tipo,
  n.titulo,
  n.corpo,
  n.entidade_tipo,
  n.entidade_id,
  n.papel_destino,
  n.permissao_destino,
  n.usuario_destino,
  n.canal,
  n.criado_em,
  case
    when l.arquivada_em is not null then 'arquivada'
    when l.lida_em is not null then 'lida'
    -- avisos lidos/arquivados antes da 0128 (estado global) continuam assim
    when l.notificacao_id is null and n.status <> 'nao_lida' then n.status
    else 'nao_lida'
  end as status,
  l.lida_em,
  l.arquivada_em
from public.notificacoes n
left join public.notificacoes_leituras l
  on l.notificacao_id = n.id and l.user_id = auth.uid();

revoke all on table public.v_minhas_notificacoes from anon, public;
grant select on table public.v_minhas_notificacoes to authenticated, service_role;

create or replace function public.marcar_todas_notificacoes_lidas()
returns integer
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_total integer;
begin
  if auth.uid() is null then
    return 0;
  end if;
  insert into public.notificacoes_leituras (notificacao_id, user_id, lida_em)
  select v.id, auth.uid(), now()
  from public.v_minhas_notificacoes v
  where v.status = 'nao_lida'
  on conflict (notificacao_id, user_id)
    do update set lida_em = coalesce(public.notificacoes_leituras.lida_em, excluded.lida_em);
  get diagnostics v_total = row_count;
  return v_total;
end $function$;

revoke all on function public.marcar_todas_notificacoes_lidas() from public, anon;
grant execute on function public.marcar_todas_notificacoes_lidas() to authenticated;

-- Permissão efetiva de um usuário qualquer (mesma regra da 0112), para o
-- envio de e-mail pelo servidor.
create or replace function kontrol_private.tem_permissao_do_usuario(p_user uuid, p_chave text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_papel text;
  v_permissoes jsonb;
  v_valor jsonb;
begin
  if p_user is null or p_chave is null or p_chave !~ '^[a-z_]+(\.[a-z_]+)+$' then
    return false;
  end if;
  select papel, permissoes into v_papel, v_permissoes
  from public.perfis where id = p_user and not suspenso;
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
  return coalesce(jsonb_typeof(v_valor) = 'boolean' and v_valor = 'true'::jsonb, false);
end $function$;

revoke all on function kontrol_private.tem_permissao_do_usuario(uuid, text) from public, anon, authenticated;

-- E-mails de quem deve receber o aviso (usada só pelo servidor).
create or replace function public.destinatarios_notificacao(p_notificacao_id bigint)
returns setof text
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_n record;
  v_ordem constant text[] := array['tecnico', 'coordenador', 'gestor', 'admin'];
begin
  select usuario_destino, papel_destino, permissao_destino into v_n
  from public.notificacoes where id = p_notificacao_id;
  if not found then
    return;
  end if;
  return query
    select distinct p.email
    from public.perfis p
    where not p.suspenso
      and p.email is not null
      and case
        when v_n.usuario_destino is not null then p.id = v_n.usuario_destino
        when v_n.permissao_destino is not null
          then kontrol_private.tem_permissao_do_usuario(p.id, v_n.permissao_destino)
        when v_n.papel_destino is not null
          then p.papel = 'admin'
            or coalesce(array_position(v_ordem, p.papel) >= array_position(v_ordem, v_n.papel_destino), false)
        else false
      end;
end $function$;

revoke all on function public.destinatarios_notificacao(bigint) from public, anon, authenticated;
grant execute on function public.destinatarios_notificacao(bigint) to service_role;

-- Avisos nas passagens de etapa. Nunca derrubam a transição: se o aviso
-- falhar, fica só um WARNING no log.
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
    v_permissao := 'pedido.aprovar';
    v_titulo := 'Pedido interno aguardando validação';
    v_corpo := format('Pedido interno #%s: %s. Solicitante: %s.', v_id,
      coalesce(v_novo_reg ->> 'titulo', 'sem título'), coalesce(v_novo_reg ->> 'solicitante', '—'));
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
    insert into public.notificacoes (tipo, titulo, corpo, entidade_tipo, entidade_id, permissao_destino, dedupe_key)
    values ('aprovacao_pendente', v_titulo, v_corpo, v_entidade_tipo, v_entidade_id, v_permissao, v_chave)
    on conflict do nothing;
  exception when others then
    raise warning 'Kontrol: aviso de etapa não gravado (% #%): %', tg_table_name, v_id, sqlerrm;
  end;
  return null;
end $function$;

revoke all on function kontrol_private.avisar_passagem_etapa() from public, anon, authenticated;

do $$
declare
  v_alvo record;
begin
  for v_alvo in
    select * from (values
      ('pedidos_internos', 'status'),
      ('pedidos_compra', 'status'),
      ('lotes_estoque', 'status'),
      ('orcamentos', 'status_operacional'),
      ('orcamento_projetos', 'status')
    ) as t(tabela, coluna)
  loop
    execute format('drop trigger if exists %I on public.%I', 'trg_avisar_etapa_' || v_alvo.tabela, v_alvo.tabela);
    execute format(
      'create trigger %I after insert or update of %I on public.%I for each row execute function kontrol_private.avisar_passagem_etapa(%L)',
      'trg_avisar_etapa_' || v_alvo.tabela, v_alvo.coluna, v_alvo.tabela, v_alvo.coluna);
  end loop;
end $$;

-- ---- 10. "Aguardando você" (página inicial) ---------------------------------
-- Contagens do que o usuário pode agir, pelas permissões dele. Roda com os
-- direitos de quem chama: a RLS de cada tabela continua valendo.
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
begin
  if auth.uid() is null then
    return v_saida;
  end if;

  if kontrol_private.tem_permissao_efetiva('pedido.aprovar') then
    select count(*) into v_qtd from public.pedidos_internos where status = 'em_validacao';
    select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'rotulo', s.rotulo)), '[]'::jsonb) into v_itens
    from (
      select id, '#' || id || ' · ' || coalesce(titulo, 'sem título') as rotulo
      from public.pedidos_internos where status = 'em_validacao'
      order by coalesce(enviado_validacao_em, atualizado_em, criado_em) limit 3
    ) s;
    v_saida := v_saida || jsonb_build_array(jsonb_build_object('chave', 'pedidos_validacao', 'quantidade', v_qtd, 'itens', v_itens));
  end if;

  if kontrol_private.tem_permissao_efetiva('compras.aprovar') then
    select count(*) into v_qtd from public.pedidos_compra where status = 'solicitado';
    select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'rotulo', s.rotulo)), '[]'::jsonb) into v_itens
    from (
      select id, 'Compra #' || id || coalesce(' · ' || nullif(projeto, ''), '') as rotulo
      from public.pedidos_compra where status = 'solicitado'
      order by criado_em limit 3
    ) s;
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

  if kontrol_private.tem_permissao_efetiva('estoque.lote.aceitar') then
    select count(*) into v_qtd from public.lotes_estoque where status = 'quarentena';
    select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'rotulo', s.rotulo)), '[]'::jsonb) into v_itens
    from (
      select l.id, coalesce(i.especificacao, 'Insumo') || ' · lote ' || coalesce(l.codigo_lote, '#' || l.id) as rotulo
      from public.lotes_estoque l left join public.insumos i on i.id = l.insumo_id
      where l.status = 'quarentena'
      order by l.criado_em limit 3
    ) s;
    v_saida := v_saida || jsonb_build_array(jsonb_build_object('chave', 'lotes_quarentena', 'quantidade', v_qtd, 'itens', v_itens));
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

-- ---- 11. Views respeitam a RLS de quem consulta ------------------------------
-- As tabelas de base são legíveis por qualquer logado, exceto orçamentos
-- (0124: "Orçamentos: Visualizar"); só essa parte passa a ser filtrada.
do $$
declare
  v_view text;
begin
  foreach v_view in array array[
    'v_dashboard_executivo', 'v_margem_real_planejamento', 'v_custo_real_consumo',
    'v_custo_estoque_vigente', 'v_alertas_estoque', 'v_estoque_saldo_tipo',
    'v_insumo_analise_pendencias'
  ] loop
    if to_regclass(format('public.%I', v_view)) is not null then
      execute format('alter view public.%I set (security_invoker = on)', v_view);
    end if;
  end loop;
end $$;

commit;
