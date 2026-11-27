-- Executar apenas em banco descartavel, como owner de migrations, com psql -v ON_ERROR_STOP=1.
-- 0186: reprovar encerra o pedido; apagar pedido em qualquer etapa. Pedido de
-- Antonio em 27/11/2026: "Reprovar encerra o pedido" (vermelho no quadro;
-- devolver, amarelo, continua) e "um botão de apagar ao longo de todo o
-- processo".
--   * só quem decide a etapa reprova: coordenador do projeto, coordenação do
--     laboratório, administrativo (Aprovar pedidos); outra pessoa, não;
--   * o motivo é obrigatório, o pedido vai para "cancelado", a compra ligada é
--     cancelada junto, a decisão fica gravada com o nome da etapa e o aviso ao
--     solicitante diz quem reprovou e por quê;
--   * fora de uma etapa de aprovação (rascunho), não se reprova;
--   * apagar exige "Aprovar pedidos", vale em qualquer etapa (inclusive com a
--     compra criada), apaga a compra junto e deixa o registro em eventos_status;
--   * material que já chegou ao estoque impede apagar.
-- Tudo e revertido no ROLLBACK final.
begin;
-- 0188: este teste cobre a ordem antiga de aprovações (pedidos que já estavam no meio quando a nova entrou)
alter table public.pedidos_internos alter column fluxo set default 1;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- hoje fixo no começo do mês: o ciclo é o do mês corrente (sem trava do dia 10)
create or replace function kontrol_private.hoje_brasilia() returns date
  language sql stable set search_path = '' as $$ select date '2026-11-05' $$;

create function pg_temp.como(p_rotulo text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', md5('kontrol-ra-' || p_rotulo)::uuid::text, true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', md5('kontrol-ra-' || p_rotulo)::uuid,
                      'email', 'ts-ra-' || p_rotulo || '@example.invalid',
                      'role', 'authenticated')::text, true);
end $$;

create function pg_temp.uid(p_rotulo text) returns uuid language sql as $$
  select md5('kontrol-ra-' || p_rotulo)::uuid
$$;

create function pg_temp.id(p_chave text) returns bigint language sql as $$
  select current_setting('tra.' || p_chave)::bigint
$$;

create function pg_temp.exigir_erro(p_sql text, p_codigo text, p_trecho text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'reprovar_apagar_0186: deveria falhar (%): %', p_codigo, p_sql;
exception when others then
  if sqlstate <> p_codigo or sqlerrm not like '%' || p_trecho || '%' then
    raise exception 'reprovar_apagar_0186: erro inesperado em "%": % %', p_sql, sqlstate, sqlerrm;
  end if;
end $$;

create function pg_temp.etapa(p_pedido bigint, p_para text, p_decisao text default 'registrado', p_dados jsonb default '{}')
returns void language plpgsql as $$
begin
  perform public.registrar_etapa_pedido_interno(p_pedido, p_para, p_para, p_decisao, null, p_dados);
end $$;

-- pedido em rascunho, com um item ligado ao insumo, pedido pelo "solic"
create function pg_temp.novo_pedido(p_titulo text, p_natureza text) returns bigint language plpgsql as $$
declare
  v_pedido bigint;
begin
  insert into public.pedidos_internos (titulo, status, solicitante, projeto_id, natureza, objetivo, justificativa, area_id)
  values (p_titulo, 'rascunho', 'ts-ra-solic@example.invalid', pg_temp.id('projeto'),
          p_natureza, 'projeto', 'Teste de reprovar e apagar.', pg_temp.id('area'))
  returning id into v_pedido;
  insert into public.pedidos_internos_itens (pedido_interno_id, tipo, especificacao, quantidade, unidade, insumo_id, orcamento_previo)
  values (v_pedido, 'material', 'TS-RA luva nitrílica', 2, 'cx', pg_temp.id('insumo'), 45);
  return v_pedido;
end $$;

-- ---- pessoas, projeto, laboratório e insumo ------------------------------------------------
do $$
declare
  v_rotulo text;
  v_projeto bigint;
  v_area bigint;
  v_insumo bigint;
begin
  -- solic: pede (Gestor); coord: coordena o projeto; labc: coordena o
  -- laboratório; adm: Administrador; lab2: função Laboratório, sem coordenar nada
  foreach v_rotulo in array array['solic', 'coord', 'labc', 'adm', 'lab2'] loop
    insert into auth.users(instance_id, id, aud, role, email, raw_app_meta_data, created_at, updated_at)
    values ('00000000-0000-0000-0000-000000000000', pg_temp.uid(v_rotulo), 'authenticated', 'authenticated',
            'ts-ra-' || v_rotulo || '@example.invalid', '{"cadastrado_pelo_admin": true}'::jsonb, now(), now());
    update public.perfis
       set nome = 'TS-RA ' || v_rotulo,
           papel = case v_rotulo when 'adm' then 'admin' when 'coord' then 'coordenador'
                                 when 'labc' then 'laboratorio' when 'lab2' then 'laboratorio' else 'gestor' end,
           suspenso = false, senha_provisoria = false, permissoes = '{}'::jsonb
     where id = pg_temp.uid(v_rotulo);
  end loop;

  insert into public.projetos (nome, coordenador_id) values ('TS-RA projeto', pg_temp.uid('coord'))
  returning id into v_projeto;
  perform set_config('tra.projeto', v_projeto::text, true);
  insert into public.coordenacoes_area (nome, coordenador_id) values ('TS-RA laboratório', pg_temp.uid('labc'))
  returning id into v_area;
  perform set_config('tra.area', v_area::text, true);
  insert into public.insumos (especificacao, unidade, ativo, categoria_compra)
  values ('TS-RA luva nitrílica', 'cx', true, 'operacional') returning id into v_insumo;
  perform set_config('tra.insumo', v_insumo::text, true);
end $$;

-- ---- 1. Coordenador do projeto reprova; outra pessoa não consegue -------------------------
select pg_temp.como('solic');
set local role authenticated;
select set_config('tra.p1', pg_temp.novo_pedido('TS-RA reprovado pelo projeto', 'material_consumo_geral')::text, true);
select pg_temp.etapa(pg_temp.id('p1'), 'em_validacao');
reset role;

select pg_temp.como('lab2');
set local role authenticated;
select pg_temp.exigir_erro(format('select public.reprovar_pedido_interno(%s, %L)', pg_temp.id('p1'), 'não quero'),
  '42501', 'Este pedido é decidido por');
reset role;

select pg_temp.como('coord');
set local role authenticated;
select pg_temp.exigir_erro(format('select public.reprovar_pedido_interno(%s, %L)', pg_temp.id('p1'), '   '),
  '22023', 'Escreva o motivo');
select public.reprovar_pedido_interno(pg_temp.id('p1'), 'Já temos luvas suficientes para o semestre');
reset role;

do $$
declare
  v record;
begin
  if (select status from public.pedidos_internos where id = pg_temp.id('p1')) <> 'cancelado' then
    raise exception 'reprovar_apagar_0186: reprovado, o pedido deveria estar cancelado';
  end if;
  select etapa, decisao, comentario, status_origem into v
    from public.pedidos_internos_aprovacoes
   where pedido_interno_id = pg_temp.id('p1') and decisao = 'reprovado';
  if v.etapa is distinct from 'Validação das especificações técnicas'
     or v.comentario is distinct from 'Já temos luvas suficientes para o semestre'
     or v.status_origem is distinct from 'em_validacao' then
    raise exception 'reprovar_apagar_0186: a reprovação deveria ficar gravada na etapa do projeto: %', to_jsonb(v);
  end if;
  if not exists (
    select 1 from public.notificacoes
     where entidade_tipo = 'pedido_interno' and entidade_id = pg_temp.id('p1')
       and usuario_destino = pg_temp.uid('solic')
       and titulo = 'Seu pedido interno foi reprovado'
       and corpo like '%Reprovado por TS-RA coord%Motivo: Já temos luvas suficientes para o semestre.%') then
    raise exception 'reprovar_apagar_0186: o solicitante deveria receber o aviso com quem reprovou e o motivo: %',
      (select jsonb_agg(jsonb_build_object('titulo', titulo, 'corpo', corpo)) from public.notificacoes
        where entidade_tipo = 'pedido_interno' and entidade_id = pg_temp.id('p1'));
  end if;
end $$;

-- ---- 2. Coordenação do laboratório reprova na vez dela -----------------------------------
select pg_temp.como('solic');
set local role authenticated;
select set_config('tra.p2', pg_temp.novo_pedido('TS-RA reprovado pelo laboratório', 'material_consumo_lab')::text, true);
select pg_temp.etapa(pg_temp.id('p2'), 'em_validacao');
reset role;
select pg_temp.como('coord');
set local role authenticated;
select pg_temp.etapa(pg_temp.id('p2'), 'validado', 'aprovado');
reset role;
-- o coordenador do projeto não decide a vez do laboratório
select pg_temp.como('coord');
set local role authenticated;
select pg_temp.exigir_erro(format('select public.reprovar_pedido_interno(%s, %L)', pg_temp.id('p2'), 'não'),
  '42501', 'coordenação do laboratório');
reset role;
select pg_temp.como('labc');
set local role authenticated;
select public.reprovar_pedido_interno(pg_temp.id('p2'), 'Material já existe no estoque do laboratório.');
reset role;

do $$
begin
  if (select status from public.pedidos_internos where id = pg_temp.id('p2')) <> 'cancelado'
     or not exists (select 1 from public.pedidos_internos_aprovacoes
                     where pedido_interno_id = pg_temp.id('p2') and decisao = 'reprovado'
                       and etapa = 'Aprovação da coordenação do laboratório') then
    raise exception 'reprovar_apagar_0186: a coordenação do laboratório deveria reprovar e encerrar o pedido';
  end if;
end $$;

-- ---- 3. Administrativo reprova depois da formalização: a compra é cancelada junto ----------
select pg_temp.como('solic');
set local role authenticated;
select set_config('tra.p3', pg_temp.novo_pedido('TS-RA reprovado pelo administrativo', 'material_consumo_geral')::text, true);
select pg_temp.etapa(pg_temp.id('p3'), 'em_validacao');
reset role;
select pg_temp.como('coord');
set local role authenticated;
select pg_temp.etapa(pg_temp.id('p3'), 'validado', 'aprovado');
reset role;
select pg_temp.como('adm');
set local role authenticated;
select public.formalizar_pedido_interno(pg_temp.id('p3'));
select set_config('tra.c3', (select pedido_compra_id from public.pedidos_internos where id = pg_temp.id('p3'))::text, true);
select public.reprovar_pedido_interno(pg_temp.id('p3'), 'Sem recurso na rubrica');
reset role;

do $$
begin
  if (select status from public.pedidos_internos where id = pg_temp.id('p3')) <> 'cancelado'
     or (select status from public.pedidos_compra where id = pg_temp.id('c3')) <> 'cancelado' then
    raise exception 'reprovar_apagar_0186: reprovado no administrativo, o pedido e a compra deveriam ficar cancelados: % %',
      (select status from public.pedidos_internos where id = pg_temp.id('p3')),
      (select status from public.pedidos_compra where id = pg_temp.id('c3'));
  end if;
end $$;

-- ---- 4. Rascunho não se reprova (ainda não pediu aprovação) ------------------------------
select pg_temp.como('solic');
set local role authenticated;
select set_config('tra.p4', pg_temp.novo_pedido('TS-RA rascunho', 'material_consumo_geral')::text, true);
reset role;
select pg_temp.como('adm');
set local role authenticated;
select pg_temp.exigir_erro(format('select public.reprovar_pedido_interno(%s, %L)', pg_temp.id('p4'), 'não'),
  '22023', 'não está esperando aprovação');
reset role;

-- ---- 5. Apagar: sem "Aprovar pedidos", não; com ela, em qualquer etapa --------------------
select pg_temp.como('lab2');
set local role authenticated;
select pg_temp.exigir_erro(format('select public.excluir_pedido_interno(%s, null)', pg_temp.id('p4')),
  '42501', '');
reset role;

-- em validação
select pg_temp.como('solic');
set local role authenticated;
select set_config('tra.p5', pg_temp.novo_pedido('TS-RA apagado em validação', 'material_consumo_geral')::text, true);
select pg_temp.etapa(pg_temp.id('p5'), 'em_validacao');
reset role;
select pg_temp.como('adm');
set local role authenticated;
select public.excluir_pedido_interno(pg_temp.id('p5'), 'Pedido de teste');
reset role;

-- formalizado, com a compra ligada
select pg_temp.como('solic');
set local role authenticated;
select set_config('tra.p6', pg_temp.novo_pedido('TS-RA apagado com compra', 'material_consumo_geral')::text, true);
select pg_temp.etapa(pg_temp.id('p6'), 'em_validacao');
reset role;
select pg_temp.como('coord');
set local role authenticated;
select pg_temp.etapa(pg_temp.id('p6'), 'validado', 'aprovado');
reset role;
select pg_temp.como('adm');
set local role authenticated;
select public.formalizar_pedido_interno(pg_temp.id('p6'));
select set_config('tra.c6', (select pedido_compra_id from public.pedidos_internos where id = pg_temp.id('p6'))::text, true);
select pg_temp.etapa(pg_temp.id('p6'), 'analise_administrativa', 'registrado',
  '{"fonte_recurso": "FUNPAR", "rubrica": "Material de consumo", "conformidade_admin": "Conforme"}');
reset role;
-- o que depende do pedido (como owner): uma previsão de equipamento ligada e um aviso da compra
insert into public.previsao_equipamentos (nome, situacao, pedido_interno_id)
values ('TS-RA centrífuga prevista', 'pedido', pg_temp.id('p6'));
insert into public.notificacoes (tipo, titulo, corpo, entidade_tipo, entidade_id, permissao_destino, dedupe_key)
values ('sistema', 'TS-RA compra', 'aviso da compra', 'pedido_compra', pg_temp.id('c6'), 'compras.ver', 'ts-ra-compra-c6');
select pg_temp.como('adm');
set local role authenticated;
select public.excluir_pedido_interno(pg_temp.id('p6'), null);
-- o já reprovado (cancelado) também sai
select public.excluir_pedido_interno(pg_temp.id('p1'), null);
reset role;

do $$
begin
  if exists (select 1 from public.pedidos_internos where id in (pg_temp.id('p5'), pg_temp.id('p6'), pg_temp.id('p1'))) then
    raise exception 'reprovar_apagar_0186: os pedidos apagados não deveriam existir mais';
  end if;
  if exists (select 1 from public.pedidos_compra where id = pg_temp.id('c6')) then
    raise exception 'reprovar_apagar_0186: a compra do pedido apagado deveria sair junto';
  end if;
  if exists (select 1 from public.pedidos_internos_itens where pedido_interno_id = pg_temp.id('p6'))
     or exists (select 1 from public.pedidos_internos_aprovacoes where pedido_interno_id = pg_temp.id('p6'))
     or exists (select 1 from public.notificacoes where entidade_tipo = 'pedido_interno' and entidade_id = pg_temp.id('p6')) then
    raise exception 'reprovar_apagar_0186: itens, aprovações e avisos do pedido apagado deveriam sair junto';
  end if;
  if not exists (select 1 from public.eventos_status
                  where entidade = 'pedido_interno' and entidade_id = pg_temp.id('p5')
                    and para_status = 'excluido' and observacao like 'Pedido apagado: TS-RA apagado em validação.%Motivo: Pedido de teste') then
    raise exception 'reprovar_apagar_0186: apagar deveria deixar o registro em eventos_status';
  end if;
  -- a cadeia do que dependia do pedido
  if (select situacao from public.previsao_equipamentos where nome = 'TS-RA centrífuga prevista') <> 'previsto' then
    raise exception 'reprovar_apagar_0186: a previsão de equipamento do pedido apagado deveria voltar a prevista';
  end if;
  if exists (select 1 from public.notificacoes where entidade_tipo = 'pedido_compra' and entidade_id = pg_temp.id('c6')) then
    raise exception 'reprovar_apagar_0186: os avisos da compra apagada deveriam sair junto';
  end if;
  if not exists (select 1 from public.notificacoes
                  where usuario_destino = pg_temp.uid('solic') and titulo = 'Seu pedido interno foi apagado'
                    and corpo like '%TS-RA apagado em validação%Motivo: Pedido de teste'
                    and entidade_tipo is null) then
    raise exception 'reprovar_apagar_0186: quem pediu deveria ser avisado de que o pedido foi apagado';
  end if;
end $$;

-- ---- 6. Material que já chegou ao estoque impede apagar ----------------------------------
-- a chegada é simulada direto no item (como owner): só a trava importa aqui
do $$
begin
  alter table public.pedidos_internos_itens disable trigger user;
  update public.pedidos_internos_itens set recebido_em = now() where pedido_interno_id = pg_temp.id('p4');
  alter table public.pedidos_internos_itens enable trigger user;
end $$;
select pg_temp.como('adm');
set local role authenticated;
select pg_temp.exigir_erro(format('select public.excluir_pedido_interno(%s, null)', pg_temp.id('p4')),
  '22023', 'Já chegou material deste pedido no estoque');
reset role;

select 'reprovar_apagar_pedido_0186: ok' as resultado;

rollback;
