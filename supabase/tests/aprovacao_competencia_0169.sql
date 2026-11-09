-- Executar apenas em banco descartavel, como owner de migrations, com psql -v ON_ERROR_STOP=1.
-- Valida a 0169 (aprovação por competência, decisões de 09/11/2026):
--   * envio trava sem coordenador (projeto sem coordenador, pedido sem projeto
--     sem Supervisão, material de laboratório sem laboratório ou sem coordenação);
--   * só o coordenador competente valida (Admin como substituto);
--   * material de consumo de laboratório não segue sem a coordenação do
--     laboratório, que aprova ou devolve pela RPC (substituto vale);
--   * avisos para o coordenador, a Supervisão e a coordenação do laboratório;
--   * cada novo envio pede a aprovação do laboratório de novo;
--   * cadastro de laboratórios só pelo Administrador, com auditoria.
-- Tudo e revertido no ROLLBACK final.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create function pg_temp.como(p_rotulo text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', md5('kontrol-0169-' || p_rotulo)::uuid::text, true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', md5('kontrol-0169-' || p_rotulo)::uuid,
                      'email', 'ts-0169-' || p_rotulo || '@example.invalid',
                      'role', 'authenticated')::text, true);
end $$;

create function pg_temp.uid(p_rotulo text) returns uuid language sql as $$
  select md5('kontrol-0169-' || p_rotulo)::uuid
$$;

create function pg_temp.ninguem() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
end $$;

-- espera erro com o código e um trecho da mensagem
create function pg_temp.exigir_erro(p_sql text, p_codigo text, p_trecho text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception '0169: deveria falhar (%): %', p_codigo, p_sql;
exception when others then
  if sqlstate <> p_codigo or sqlerrm not like '%' || p_trecho || '%' then
    raise exception '0169: erro inesperado em "%": % %', p_sql, sqlstate, sqlerrm;
  end if;
end $$;

create function pg_temp.pedido(p_projeto bigint, p_natureza text, p_area bigint) returns bigint language plpgsql as $$
declare v_id bigint;
begin
  insert into public.pedidos_internos (titulo, status, solicitante, projeto_id, natureza, objetivo, area_id, justificativa)
  values ('TS-0169 pedido', 'rascunho', 'ts-0169-pedinte@example.invalid', p_projeto, p_natureza, 'projeto', p_area, 'teste')
  returning id into v_id;
  return v_id;
end $$;

do $$
declare
  v_rotulo text;
  v_com bigint;
  v_sem bigint;
  v_lab bigint;
  v_vazio bigint;
begin
  if (select count(*) from public.coordenacoes_area
       where nome in ('Genética', 'LAPOA', 'LHM', 'LQA', 'Campo')) <> 5 then
    raise exception '0169: laboratórios indicados não foram semeados';
  end if;

  -- pedinte: abre pedidos; coord: coordenador do projeto; outro: aprovador
  -- qualquer ligado ao projeto; sup: Supervisão; lab/labsub: coordenação do
  -- laboratório e substituto (sem "Aprovar pedidos internos"); chefe: admin.
  foreach v_rotulo in array array['pedinte', 'coord', 'outro', 'sup', 'lab', 'labsub', 'chefe'] loop
    insert into auth.users(instance_id, id, aud, role, email, raw_app_meta_data, created_at, updated_at)
    values ('00000000-0000-0000-0000-000000000000', pg_temp.uid(v_rotulo), 'authenticated', 'authenticated',
            'ts-0169-' || v_rotulo || '@example.invalid', '{"cadastrado_pelo_admin": true}'::jsonb, now(), now());
    update public.perfis
       set nome = 'TS-0169 ' || v_rotulo,
           papel = case v_rotulo
             when 'chefe' then 'admin'
             when 'sup' then 'laboratorio' -- vira supervisor depois
             when 'pedinte' then 'laboratorio'
             when 'lab' then 'laboratorio'
             when 'labsub' then 'laboratorio'
             else 'coordenador' end,
           suspenso = false, senha_provisoria = false,
           permissoes = case
             when v_rotulo in ('lab', 'labsub') then '{"pedido.criar": true}'::jsonb
             when v_rotulo = 'pedinte' then '{"pedido.criar": true}'::jsonb
             else '{"pedido.criar": true, "pedido.aprovar": true}'::jsonb end
     where id = pg_temp.uid(v_rotulo);
  end loop;

  -- nenhum Supervisor ativo no começo (o banco de teste pode ter outros)
  update public.perfis set suspenso = true where papel = 'supervisor' and id <> pg_temp.uid('sup');

  insert into public.projetos (nome, coordenador_id) values ('TS-0169 com coordenador', pg_temp.uid('coord')) returning id into v_com;
  insert into public.projetos (nome) values ('TS-0169 sem coordenador') returning id into v_sem;
  if to_regclass('kontrol_private.projetos_vinculos') is not null then
    execute 'insert into kontrol_private.projetos_vinculos (projeto_id, usuario_id) values ($1, $2), ($1, $3) on conflict do nothing'
      using v_com, pg_temp.uid('outro'), pg_temp.uid('coord');
  end if;
  insert into public.coordenacoes_area (nome, coordenador_id, substituto_id)
  values ('TS-0169 Lab', pg_temp.uid('lab'), pg_temp.uid('labsub')) returning id into v_lab;
  insert into public.coordenacoes_area (nome) values ('TS-0169 Vazio') returning id into v_vazio;

  perform set_config('t0169.com', v_com::text, true);
  perform set_config('t0169.sem', v_sem::text, true);
  perform set_config('t0169.lab', v_lab::text, true);
  perform set_config('t0169.vazio', v_vazio::text, true);
  perform set_config('t0169.p_sem_coord', pg_temp.pedido(v_sem, 'material_consumo_geral', null)::text, true);
  perform set_config('t0169.p_sem_projeto', pg_temp.pedido(null, 'servico', null)::text, true);
  perform set_config('t0169.p_lab', pg_temp.pedido(v_com, 'material_consumo_lab', null)::text, true);
  perform set_config('t0169.p_lab2', pg_temp.pedido(v_com, 'material_consumo_lab', v_lab)::text, true);
end $$;

-- ---- envio trava sem coordenador --------------------------------------------------
set local role authenticated;
select pg_temp.como('pedinte');

select pg_temp.exigir_erro(
  format('select public.transicionar_pedido_interno(%s, ''em_validacao'', ''Envio'', ''registrado'', null)',
         current_setting('t0169.p_sem_coord')),
  '22023', 'não tem coordenador cadastrado');
select pg_temp.exigir_erro(
  format('select public.transicionar_pedido_interno(%s, ''em_validacao'', ''Envio'', ''registrado'', null)',
         current_setting('t0169.p_sem_projeto')),
  '22023', 'Supervis');
select pg_temp.exigir_erro(
  format('select public.transicionar_pedido_interno(%s, ''em_validacao'', ''Envio'', ''registrado'', null)',
         current_setting('t0169.p_lab')),
  '22023', 'precisa indicar o laboratório');

-- a tela lê a mesma regra
do $$
declare
  v jsonb := public.aprovadores_pedido_interno(current_setting('t0169.p_lab')::bigint);
begin
  if v -> 'coordenador' ->> 'nome' <> 'TS-0169 coord' or (v ->> 'laboratorio_exigido')::boolean is not true
     or v ->> 'falta_laboratorio' is null then
    raise exception '0169: aprovadores_pedido_interno inesperado: %', v;
  end if;
end $$;

-- laboratório sem coordenação também trava
reset role;
update public.pedidos_internos set area_id = current_setting('t0169.vazio')::bigint
 where id = current_setting('t0169.p_lab')::bigint;
set local role authenticated;
select pg_temp.como('pedinte');
select pg_temp.exigir_erro(
  format('select public.transicionar_pedido_interno(%s, ''em_validacao'', ''Envio'', ''registrado'', null)',
         current_setting('t0169.p_lab')),
  '22023', 'não tem coordenação cadastrada');

reset role;
select pg_temp.ninguem();
update public.pedidos_internos set area_id = current_setting('t0169.lab')::bigint
 where id = current_setting('t0169.p_lab')::bigint;
update public.perfis set papel = 'supervisor' where id = pg_temp.uid('sup');
update public.perfis set permissoes = '{"pedido.criar": true, "pedido.aprovar": true}'::jsonb where id = pg_temp.uid('sup');

-- ---- envio com quem valide; avisos ---------------------------------------------
set local role authenticated;
select pg_temp.como('pedinte');
select public.transicionar_pedido_interno(current_setting('t0169.p_sem_projeto')::bigint, 'em_validacao', 'Envio', 'registrado', null);
select public.transicionar_pedido_interno(current_setting('t0169.p_lab')::bigint, 'em_validacao', 'Envio', 'registrado', null);
select public.transicionar_pedido_interno(current_setting('t0169.p_lab2')::bigint, 'em_validacao', 'Envio', 'registrado', null);

reset role;
do $$
begin
  if not exists (select 1 from public.notificacoes
                  where entidade_tipo = 'pedido_interno' and entidade_id = current_setting('t0169.p_sem_projeto')::bigint
                    and usuario_destino = pg_temp.uid('sup')) then
    raise exception '0169: aviso do pedido sem projeto não foi para a Supervisão';
  end if;
  if not exists (select 1 from public.notificacoes
                  where entidade_tipo = 'pedido_interno' and entidade_id = current_setting('t0169.p_lab')::bigint
                    and usuario_destino = pg_temp.uid('coord')) then
    raise exception '0169: aviso de validação não foi para o coordenador do projeto';
  end if;
end $$;

-- ---- só o coordenador competente valida ------------------------------------------
set local role authenticated;
select pg_temp.como('outro');
select pg_temp.exigir_erro(
  format('select public.transicionar_pedido_interno(%s, ''validado'', ''Validação'', ''aprovado'', null)',
         current_setting('t0169.p_lab')),
  '42501', 'validado por TS-0169 coord');
select pg_temp.como('coord');
select pg_temp.exigir_erro(
  format('select public.transicionar_pedido_interno(%s, ''validado'', ''Validação'', ''aprovado'', null)',
         current_setting('t0169.p_sem_projeto')),
  '42501', 'Supervisão');
select public.transicionar_pedido_interno(current_setting('t0169.p_lab')::bigint, 'validado', 'Validação', 'aprovado', null);
select public.transicionar_pedido_interno(current_setting('t0169.p_lab2')::bigint, 'validado', 'Validação', 'aprovado', null);
select pg_temp.como('sup');
select public.transicionar_pedido_interno(current_setting('t0169.p_sem_projeto')::bigint, 'validado', 'Validação', 'aprovado', null);

-- ---- coordenação do laboratório -------------------------------------------------
select pg_temp.como('coord');
select pg_temp.exigir_erro(
  format('select public.transicionar_pedido_interno(%s, ''formalizado'', ''Formalização'', ''registrado'', null)',
         current_setting('t0169.p_lab')),
  '42501', 'coordenação do laboratório');
select pg_temp.exigir_erro(
  format('update public.pedidos_internos set aprovacao_area_em = now() where id = %s', current_setting('t0169.p_lab')),
  '42501', 'botão do pedido');
select pg_temp.exigir_erro(
  format('update public.pedidos_internos set area_id = %s where id = %s', current_setting('t0169.vazio'), current_setting('t0169.p_lab')),
  '42501', 'só mudam');
select pg_temp.exigir_erro(
  format('select public.decidir_coordenacao_laboratorio(%s, ''aprovado'', null)', current_setting('t0169.p_lab')),
  '42501', 'coordenação do laboratório TS-0169 Lab');

reset role;
do $$
begin
  if not exists (select 1 from public.notificacoes
                  where entidade_tipo = 'pedido_interno' and entidade_id = current_setting('t0169.p_lab')::bigint
                    and usuario_destino = pg_temp.uid('lab')
                    and titulo = 'Pedido interno aguardando a coordenação do laboratório') then
    raise exception '0169: aviso não foi para a coordenação do laboratório';
  end if;
end $$;

set local role authenticated;
select pg_temp.como('lab');
select pg_temp.exigir_erro(
  format('select public.decidir_coordenacao_laboratorio(%s, ''devolvido'', ''  '')', current_setting('t0169.p_lab2')),
  '22023', 'motivo');
select public.decidir_coordenacao_laboratorio(current_setting('t0169.p_lab2')::bigint, 'devolvido', 'Use o tubo low binding');
-- o substituto aprova na ausência
select pg_temp.como('labsub');
select public.decidir_coordenacao_laboratorio(current_setting('t0169.p_lab')::bigint, 'aprovado', null);
select pg_temp.exigir_erro(
  format('select public.decidir_coordenacao_laboratorio(%s, ''aprovado'', null)', current_setting('t0169.p_lab')),
  '22023', 'já aprovou');

reset role;
do $$
declare
  v_pedido bigint := current_setting('t0169.p_lab')::bigint;
  v_dev bigint := current_setting('t0169.p_lab2')::bigint;
begin
  if (select aprovacao_area_em from public.pedidos_internos where id = v_pedido) is null
     or (select aprovacao_area_por from public.pedidos_internos where id = v_pedido) <> 'ts-0169-labsub@example.invalid'
     or not exists (select 1 from public.pedidos_internos_aprovacoes
                     where pedido_interno_id = v_pedido and etapa = 'Aprovação da coordenação do laboratório'
                       and decisao = 'aprovado' and responsavel = 'ts-0169-labsub@example.invalid') then
    raise exception '0169: aprovação do laboratório não ficou registrada';
  end if;
  if (select status from public.pedidos_internos where id = v_dev) <> 'ajuste_solicitante'
     or not exists (select 1 from public.pedidos_internos_aprovacoes
                     where pedido_interno_id = v_dev and decisao = 'devolvido' and comentario = 'Use o tubo low binding'
                       and status_origem = 'validado' and status_destino = 'ajuste_solicitante')
     or not exists (select 1 from public.eventos_status
                     where entidade = 'pedido_interno' and entidade_id = v_dev
                       and de_status = 'validado' and para_status = 'ajuste_solicitante') then
    raise exception '0169: devolução do laboratório não ficou registrada';
  end if;
end $$;

-- aprovado pelo laboratório, segue para compras; devolvido e reenviado, pede tudo de novo
set local role authenticated;
select pg_temp.como('coord');
select public.transicionar_pedido_interno(current_setting('t0169.p_lab')::bigint, 'formalizado', 'Formalização', 'registrado', null);
select public.transicionar_pedido_interno(current_setting('t0169.p_lab')::bigint, 'analise_administrativa', 'Análise', 'registrado', null);
select public.transicionar_pedido_interno(current_setting('t0169.p_lab')::bigint, 'ajuste_compras', 'Análise', 'devolvido', 'ajustar');
select pg_temp.como('pedinte');
select public.transicionar_pedido_interno(current_setting('t0169.p_lab')::bigint, 'em_validacao', 'Envio', 'registrado', null);
-- o Administrador valida como substituto do coordenador
select pg_temp.como('chefe');
select public.transicionar_pedido_interno(current_setting('t0169.p_lab')::bigint, 'validado', 'Validação', 'aprovado', null);
select pg_temp.exigir_erro(
  format('select public.transicionar_pedido_interno(%s, ''formalizado'', ''Formalização'', ''registrado'', null)',
         current_setting('t0169.p_lab')),
  '42501', 'coordenação do laboratório');

reset role;
do $$
begin
  if (select aprovacao_area_em from public.pedidos_internos where id = current_setting('t0169.p_lab')::bigint) is not null then
    raise exception '0169: reenvio não limpou a aprovação do laboratório';
  end if;
  if not exists (select 1 from public.pedidos_internos_aprovacoes
                  where pedido_interno_id = current_setting('t0169.p_lab')::bigint
                    and status_destino = 'validado' and papel = 'admin') then
    raise exception '0169: validação pelo Administrador não ficou registrada com o papel';
  end if;
end $$;

-- ---- cadastro de laboratórios: só o Administrador; auditado ----------------------
set local role authenticated;
select pg_temp.como('coord');
select pg_temp.exigir_erro(
  'insert into public.coordenacoes_area (nome) values (''TS-0169 Proibido'')',
  '42501', 'row-level security');
select pg_temp.como('chefe');
insert into public.coordenacoes_area (nome, coordenador_id) values ('TS-0169 Novo', pg_temp.uid('lab'));

reset role;
do $$
begin
  if not exists (select 1 from public.auditoria
                  where tabela = 'coordenacoes_area' and acao = 'insert'
                    and valor_novo ->> 'nome' = 'TS-0169 Novo') then
    raise exception '0169: cadastro de laboratório sem auditoria';
  end if;
end $$;

rollback;
