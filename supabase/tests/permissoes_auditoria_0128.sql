-- Executar apenas em banco descartavel, como owner de migrations, com psql -v ON_ERROR_STOP=1.
-- Valida a 0128: auditoria de perfis e cadastros (sem vazar salario), suspenso
-- sem papel, aprovacoes de pedido interno so pelas RPCs (e as RPCs seguem
-- gravando), edicao do pedido so pelo solicitante em rascunho/ajuste, linha do
-- tempo em nome proprio, exclusao de orcamento, escrita de equipamentos,
-- identificadores/triagem/scan, notificacoes por usuario, avisos das passagens
-- de etapa, "Aguardando voce" e views com security_invoker.
-- Tudo e revertido no ROLLBACK final.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Troca o usuario da sessao (sub + e-mail no JWT).
create function pg_temp.entrar(p_rotulo text)
returns void
language sql
as $$
  select set_config('request.jwt.claims', json_build_object(
    'sub', md5('kontrol-0128-' || p_rotulo)::uuid,
    'email', 'ts-0128-' || p_rotulo || '@example.invalid',
    'role', 'authenticated')::text, true);
  select null::void;
$$;
grant execute on function pg_temp.entrar(text) to authenticated;

do $$
declare
  v_rotulo text;
  v_uid uuid;
begin
  foreach v_rotulo in array array['tecnico', 'tecnico2', 'tecnico_sem_orcamento', 'coordenador', 'admin_suspenso'] loop
    v_uid := md5('kontrol-0128-' || v_rotulo)::uuid;
    insert into auth.users(instance_id, id, aud, role, email, created_at, updated_at)
    values ('00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated',
            'ts-0128-' || v_rotulo || '@example.invalid', now(), now());
    update public.perfis
       set papel = case
             when v_rotulo like 'tecnico%' then 'tecnico'
             when v_rotulo = 'admin_suspenso' then 'admin'
             else 'coordenador' end,
           suspenso = (v_rotulo = 'admin_suspenso'),
           permissoes = case v_rotulo
             when 'tecnico_sem_orcamento' then '{"orcamentos.visualizar": false}'::jsonb
             else '{}'::jsonb end
     where id = v_uid;
  end loop;

  -- CAD2-2: mudanca de perfil fica na auditoria
  if not exists (
    select 1 from public.auditoria
    where tabela = 'perfis' and registro_id = md5('kontrol-0128-admin_suspenso')::uuid::text
      and acao = 'update' and (valor_novo ->> 'suspenso')::boolean
  ) then
    raise exception '0128: suspensao do perfil nao foi auditada';
  end if;

  -- CAD2-3: tabelas com chave diferente de id
  insert into public.analises (codigo, nome) values ('TS-0128-AN', 'Analise TS-0128');
  -- O CI parte de banco sem seed: o parâmetro de teste é criado aqui.
  insert into public.parametros (chave, valor, descricao) values ('ts_0128_param', 1, 'TS-0128')
  on conflict (chave) do nothing;
  update public.parametros set descricao = coalesce(descricao, '') || ' ' where chave = 'ts_0128_param';
  if not exists (select 1 from public.auditoria where tabela = 'analises' and registro_id = 'TS-0128-AN' and acao = 'insert')
     or not exists (select 1 from public.auditoria where tabela = 'parametros' and registro_id = 'ts_0128_param' and acao = 'update') then
    raise exception '0128: analises/parametros sem auditoria pela chave';
  end if;
  insert into public.equipamentos (nome) values ('TS-0128 Equipamento');
  if not exists (select 1 from public.auditoria where tabela = 'equipamentos' and valor_novo ->> 'nome' = 'TS-0128 Equipamento') then
    raise exception '0128: equipamentos sem auditoria';
  end if;

  -- a mascara do salario (0112) continua valendo
  insert into public.tecnicos (nome, valor_mes) values ('TS-0128 Tecnico', 12345);
  if exists (
    select 1 from public.auditoria
    where tabela = 'tecnicos' and valor_novo ->> 'nome' = 'TS-0128 Tecnico'
      and jsonb_typeof(valor_novo -> 'valor_mes') = 'number'
  ) then
    raise exception '0128: salario vazou na auditoria de tecnicos';
  end if;

  insert into public.insumos (especificacao, unidade, fator_conversao) values ('TS-0128 Insumo', 'un', 1);
  insert into public.equipamentos (nome) values ('TS-0128 Eq base');
  -- Um orçamento por proposta: a 0126 proíbe dois módulos ativos na mesma proposta.
  insert into public.demandas_propostas (titulo)
  values ('TS-0128 proposta rascunho'), ('TS-0128 proposta enviado');
  insert into public.orcamentos (cliente_nome, status, demanda_id)
  select c, s, (select id from public.demandas_propostas where titulo = 'TS-0128 proposta ' || s)
  from (values ('TS-0128 rascunho', 'rascunho'), ('TS-0128 enviado', 'enviado')) v(c, s);
  insert into public.notificacoes (tipo, titulo, papel_destino, dedupe_key)
  values ('sistema', 'TS-0128 aviso do gestor', 'gestor', 'ts-0128-gestor'),
         ('sistema', 'TS-0128 aviso geral', null, 'ts-0128-geral');
  insert into public.notificacoes (tipo, titulo, usuario_destino, dedupe_key)
  values ('sistema', 'TS-0128 aviso pessoal tecnico2', md5('kontrol-0128-tecnico2')::uuid, 'ts-0128-pessoal');
end $$;

-- aviso repetido e ignorado, sem derrubar o lote inteiro
insert into public.notificacoes (tipo, titulo, dedupe_key)
values ('sistema', 'TS-0128 repetido', 'ts-0128-geral'), ('sistema', 'TS-0128 novo', 'ts-0128-novo');
do $$
begin
  if (select count(*) from public.notificacoes where dedupe_key in ('ts-0128-geral', 'ts-0128-novo')) <> 2 then
    raise exception '0128: dedupe de notificacao falhou';
  end if;
end $$;

set local role authenticated;

-- ---- PER2-14: admin suspenso nao tem papel -------------------------------
select pg_temp.entrar('admin_suspenso');
do $$
begin
  if public.current_papel() is not null or public.papel_minimo('tecnico') then
    raise exception '0128: suspenso ainda tem papel';
  end if;
  update public.perfis set papel = 'gestor' where email = 'ts-0128-tecnico@example.invalid';
  if found then
    raise exception '0128: admin suspenso alterou perfil';
  end if;
  begin
    insert into public.eventos_status (entidade, entidade_id, para_status, usuario)
    values ('pedido_interno', 1, 'x', 'ts-0128-admin_suspenso@example.invalid');
    raise exception '0128: suspenso gravou evento';
  exception when insufficient_privilege then null;
  end;
end $$;

-- ---- PER2-2: tecnico abre pedido, envia; aprovacoes so via RPC ------------
select pg_temp.entrar('tecnico');
do $$
declare
  v_pedido bigint;
begin
  insert into public.pedidos_internos (titulo, solicitante, fonte_recurso)
  values ('TS-0128 pedido', 'ts-0128-tecnico@example.invalid', 'Projeto X')
  returning id into v_pedido;
  perform set_config('ts.pedido', v_pedido::text, true);

  begin
    insert into public.pedidos_internos (titulo, solicitante, status)
    values ('TS-0128 outro nome', 'outra@example.invalid', 'rascunho');
    raise exception '0128: tecnico abriu pedido em nome de outra pessoa';
  exception when insufficient_privilege then null;
  end;

  update public.pedidos_internos set justificativa = 'uso em campo' where id = v_pedido;
  begin
    update public.pedidos_internos set aprovador_coordenador = 'eu mesmo' where id = v_pedido;
    raise exception '0128: tecnico gravou coluna de aprovacao';
  exception when insufficient_privilege then null;
  end;

  begin
    insert into public.pedidos_internos_aprovacoes (pedido_interno_id, etapa, decisao, status_destino)
    values (v_pedido, 'forjada', 'aprovado', 'validado');
    raise exception '0128: tecnico inseriu aprovacao direto';
  exception when insufficient_privilege then null;
  end;

  -- caminho legitimo: a RPC grava a aprovacao e o evento
  perform public.transicionar_pedido_interno(v_pedido, 'em_validacao', 'Envio', 'registrado', null);
  if (select count(*) from public.pedidos_internos_aprovacoes where pedido_interno_id = v_pedido) <> 1
     or (select enviado_validacao_em from public.pedidos_internos where id = v_pedido) is null then
    raise exception '0128: RPC de envio nao gravou aprovacao/carimbo';
  end if;

  -- a regravacao do carimbo pelo app vira no-op; qualquer outra alteracao e recusada
  update public.pedidos_internos set enviado_validacao_em = now() + interval '1 day' where id = v_pedido;
  begin
    update public.pedidos_internos set fonte_recurso = 'Outra fonte' where id = v_pedido;
    raise exception '0128: tecnico alterou pedido em validacao';
  exception when insufficient_privilege then null;
  end;

  update public.pedidos_internos_aprovacoes set comentario = 'x' where pedido_interno_id = v_pedido;
  delete from public.pedidos_internos_aprovacoes where pedido_interno_id = v_pedido;
  if (select count(*) from public.pedidos_internos_aprovacoes where pedido_interno_id = v_pedido and comentario is null) <> 1 then
    raise exception '0128: tecnico alterou/apagou aprovacao';
  end if;

  -- linha do tempo so em nome proprio
  insert into public.eventos_status (entidade, entidade_id, para_status, usuario)
  values ('pedido_interno', v_pedido, 'em_validacao', 'ts-0128-tecnico@example.invalid');
  begin
    insert into public.eventos_status (entidade, entidade_id, para_status, usuario)
    values ('pedido_interno', v_pedido, 'validado', 'ts-0128-coordenador@example.invalid');
    raise exception '0128: tecnico registrou evento em nome de outro';
  exception when insufficient_privilege then null;
  end;
end $$;

select pg_temp.entrar('tecnico2');
do $$
begin
  begin
    update public.pedidos_internos set justificativa = 'mexendo no dos outros'
    where id = current_setting('ts.pedido')::bigint;
    raise exception '0128: tecnico alterou pedido de outra pessoa';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Coordenador: ve o aviso, valida pela RPC e grava os "extras"
select pg_temp.entrar('coordenador');
do $$
declare
  v_pedido bigint := current_setting('ts.pedido')::bigint;
  v_aguardando jsonb := public.aguardando_voce();
begin
  if not exists (
    select 1 from public.v_minhas_notificacoes
    where entidade_tipo = 'pedido_interno' and entidade_id = v_pedido
      and permissao_destino = 'pedido.aprovar' and status = 'nao_lida'
  ) then
    raise exception '0128: aviso de pedido em validacao nao chegou ao aprovador';
  end if;
  if not exists (
    select 1 from jsonb_array_elements(v_aguardando) e
    where e ->> 'chave' = 'pedidos_validacao' and (e ->> 'quantidade')::int >= 1
      and e -> 'itens' @> jsonb_build_array(jsonb_build_object('id', v_pedido))
  ) then
    raise exception '0128: aguardando_voce sem o pedido em validacao: %', v_aguardando;
  end if;

  perform public.transicionar_pedido_interno(v_pedido, 'validado', 'Validacao', 'aprovado', 'ok');
  update public.pedidos_internos
     set aprovador_coordenador = 'Coordenador TS', aprovado_coordenador_em = now(), validado_em = now()
   where id = v_pedido;
  if (select count(*) from public.pedidos_internos_aprovacoes where pedido_interno_id = v_pedido) <> 2
     or (select aprovador_coordenador from public.pedidos_internos where id = v_pedido) <> 'Coordenador TS' then
    raise exception '0128: validacao do coordenador nao gravou';
  end if;

  -- cancelamento operacional (RPC) tambem grava a aprovacao
  perform public.cancelar_pedido_interno_operacional(v_pedido, null, 'teste');
  if (select count(*) from public.pedidos_internos_aprovacoes where pedido_interno_id = v_pedido) <> 3 then
    raise exception '0128: cancelamento nao gravou aprovacao';
  end if;

  if not exists (select 1 from public.v_minhas_notificacoes where titulo = 'TS-0128 aviso geral') then
    raise exception '0128: aviso sem destino deveria aparecer para todos';
  end if;
  if exists (select 1 from public.v_minhas_notificacoes where titulo = 'TS-0128 aviso do gestor')
     or exists (select 1 from public.v_minhas_notificacoes where titulo = 'TS-0128 aviso pessoal tecnico2') then
    raise exception '0128: coordenador viu aviso de outro destino';
  end if;
end $$;

-- ---- Notificacoes: leitura por usuario -------------------------------------
select pg_temp.entrar('tecnico');
do $$
declare
  v_marcadas integer;
begin
  if exists (select 1 from public.v_minhas_notificacoes where permissao_destino = 'pedido.aprovar')
     or exists (select 1 from public.notificacoes where titulo = 'TS-0128 aviso do gestor') then
    raise exception '0128: tecnico viu aviso de aprovador/gestor';
  end if;
  v_marcadas := public.marcar_todas_notificacoes_lidas();
  if v_marcadas < 1 or exists (select 1 from public.v_minhas_notificacoes where status = 'nao_lida') then
    raise exception '0128: marcar todas nao marcou para o tecnico';
  end if;
  update public.notificacoes set status = 'arquivada' where titulo = 'TS-0128 aviso geral';
  if found then
    raise exception '0128: tecnico alterou o estado global do aviso';
  end if;
  begin
    insert into public.notificacoes_leituras (notificacao_id, user_id, lida_em)
    select id, md5('kontrol-0128-tecnico2')::uuid, now() from public.notificacoes where dedupe_key = 'ts-0128-geral';
    raise exception '0128: tecnico marcou leitura por outro usuario';
  exception when insufficient_privilege then null;
  end;
  -- 0127: o tecnico registra chegada de compra (linha com zero itens); nada pendente de fato
  if exists (select 1 from jsonb_array_elements(public.aguardando_voce()) e
             where (e ->> 'quantidade')::bigint > 0) then
    raise exception '0128: tecnico nao deveria ter nada aguardando: %', public.aguardando_voce();
  end if;
end $$;

select pg_temp.entrar('tecnico2');
do $$
begin
  if (select status from public.v_minhas_notificacoes where titulo = 'TS-0128 aviso geral') <> 'nao_lida' then
    raise exception '0128: leitura de um usuario marcou para outro';
  end if;
  if not exists (select 1 from public.v_minhas_notificacoes where titulo = 'TS-0128 aviso pessoal tecnico2') then
    raise exception '0128: aviso pessoal nao chegou ao destinatario';
  end if;
end $$;

-- ---- PER2-7: exclusao de orcamento -----------------------------------------
select pg_temp.entrar('tecnico');
do $$
begin
  delete from public.orcamentos where cliente_nome = 'TS-0128 rascunho';
  if found then
    raise exception '0128: tecnico sem Cancelar orcamentos excluiu';
  end if;
end $$;

select pg_temp.entrar('coordenador');
do $$
begin
  delete from public.orcamentos where cliente_nome = 'TS-0128 enviado';
  if found then
    raise exception '0128: orcamento enviado foi excluido';
  end if;
  delete from public.orcamentos where cliente_nome = 'TS-0128 rascunho';
  if not found then
    raise exception '0128: coordenador nao excluiu rascunho';
  end if;
end $$;

-- ---- PER2-8 e PER2-17: equipamentos, identificadores, triagem, scan -----------
select pg_temp.entrar('tecnico');
do $$
declare
  v_eq bigint := (select id from public.equipamentos where nome = 'TS-0128 Eq base');
begin
  begin
    insert into public.equipamento_unidades (equipamento_id, codigo_patrimonio) values (v_eq, 'TS-0128-T');
    raise exception '0128: tecnico criou unidade de equipamento';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.equipamento_status_log (equipamento_unidade_id, status_novo) values (1, 'x');
    raise exception '0128: log de status gravado pela API';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.identificadores (tipo, valor, entidade_tipo, entidade_id, codigo, codigo_normalizado)
    values ('manual', 'TS0128', 'equipamento', v_eq, 'TS0128', 'TS0128');
    raise exception '0128: tecnico criou identificador';
  exception when insufficient_privilege then null;
  end;
  insert into public.cadastros_triagem (codigo, codigo_normalizado) values ('TS0128-X', 'TS0128X');
  update public.cadastros_triagem set status = 'arquivado' where codigo = 'TS0128-X';
  if found then
    raise exception '0128: tecnico resolveu triagem';
  end if;
  insert into public.scan_eventos (codigo, valor_lido) values ('TS0128-X', 'TS0128-X');
end $$;

select pg_temp.entrar('coordenador');
do $$
declare
  v_eq bigint := (select id from public.equipamentos where nome = 'TS-0128 Eq base');
  v_unidade bigint;
begin
  insert into public.equipamento_unidades (equipamento_id, codigo_patrimonio) values (v_eq, 'TS-0128-C')
  returning id into v_unidade;
  update public.equipamento_unidades set status_operacional = 'em_manutencao' where id = v_unidade;
  if (select count(*) from public.equipamento_status_log where equipamento_unidade_id = v_unidade) < 2 then
    raise exception '0128: gatilho deixou de registrar o historico de status';
  end if;
  insert into public.identificadores (tipo, valor, entidade_tipo, entidade_id, codigo, codigo_normalizado)
  values ('manual', 'TS0128', 'equipamento', v_eq, 'TS0128', 'TS0128');
end $$;

-- ---- Avisos das passagens de etapa -----------------------------------------
reset role;
do $$
declare
  v_insumo bigint := (select id from public.insumos where especificacao = 'TS-0128 Insumo');
  v_lote bigint;
  v_compra bigint;
begin
  insert into public.lotes_estoque (insumo_id, codigo_lote, quantidade_inicial, quantidade_atual, status)
  values (v_insumo, 'TS-0128-Q', 1, 1, 'quarentena') returning id into v_lote;
  if not exists (
    select 1 from public.notificacoes
    where entidade_tipo = 'lote' and entidade_id = v_lote and permissao_destino = 'estoque.lote.aceitar'
  ) then
    raise exception '0128: lote em quarentena sem aviso';
  end if;

  insert into public.pedidos_compra (status, projeto) values ('solicitado', 'TS-0128') returning id into v_compra;
  if not exists (
    select 1 from public.notificacoes
    where entidade_tipo = 'pedido_compra' and entidade_id = v_compra and permissao_destino = 'compras.aprovar'
  ) then
    raise exception '0128: compra solicitada sem aviso';
  end if;
  perform set_config('app.pedido_compra_transicao', 'permitida', true);
  update public.pedidos_compra set status = 'aprovado' where id = v_compra;
  if not exists (
    select 1 from public.notificacoes
    where entidade_tipo = 'pedido_compra' and entidade_id = v_compra and permissao_destino = 'compras.receber'
  ) then
    raise exception '0128: compra aprovada sem aviso a quem recebe';
  end if;

  if not exists (
    select 1 from public.destinatarios_notificacao(
      (select id from public.notificacoes where entidade_tipo = 'lote' and entidade_id = v_lote)
    ) e where e = 'ts-0128-coordenador@example.invalid'
  ) or exists (
    select 1 from public.destinatarios_notificacao(
      (select id from public.notificacoes where entidade_tipo = 'lote' and entidade_id = v_lote)
    ) e where e in ('ts-0128-tecnico@example.invalid', 'ts-0128-admin_suspenso@example.invalid')
  ) then
    raise exception '0128: destinatarios do e-mail nao seguem a permissao';
  end if;
end $$;

-- ---- PER2-5: views respeitam a permissao de quem consulta ------------------
set local role authenticated;
select pg_temp.entrar('tecnico_sem_orcamento');
do $$
begin
  if coalesce((select orcamentos_enviados from public.v_dashboard_executivo), 0) <> 0
     or coalesce((select orcamentos_rascunho from public.v_dashboard_executivo), 0) <> 0 then
    raise exception '0128: painel mostra orcamentos a quem nao tem Orcamentos: Visualizar';
  end if;
end $$;

select pg_temp.entrar('coordenador');
do $$
declare
  v_view text;
begin
  if coalesce((select orcamentos_enviados from public.v_dashboard_executivo), 0) < 1 then
    raise exception '0128: coordenador deveria ver o orcamento enviado no painel';
  end if;
  -- todas as views com security_invoker continuam legiveis por quem tem acesso
  foreach v_view in array array[
    'v_dashboard_executivo', 'v_margem_real_planejamento', 'v_custo_real_consumo',
    'v_custo_estoque_vigente', 'v_alertas_estoque', 'v_estoque_saldo_tipo',
    'v_insumo_analise_pendencias', 'v_minhas_notificacoes'
  ] loop
    execute format('select count(*) from public.%I', v_view);
  end loop;
end $$;

reset role;
rollback;
