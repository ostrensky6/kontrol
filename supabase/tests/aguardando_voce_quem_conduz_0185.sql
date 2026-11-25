-- Executar apenas em banco descartavel, como owner de migrations, com psql -v ON_ERROR_STOP=1.
-- 0185: "Aguardando você" mostra a quem conduz a compra inteira o pedido
-- travado no ciclo seguinte. Pedido de Antonio em 25/11/2026: "Nada pode
-- travar administrador porque ele pode tudo."
--   * hoje fixo em 24/11/2026 (depois do dia 10): o pedido aprovado cai no
--     ciclo de dezembro e fica travado na formalização para quem não conduz;
--   * o Administrador e a pessoa da função Compra (que conduz) veem o pedido
--     em "Pedidos para formalizar e autorizar" desde já;
--   * quem não tem a caixinha (Gestor sem ajuste, ou a Compra com a caixinha
--     desmarcada) não vê; marcando a caixinha só para o Gestor, ele passa a ver.
-- Tudo e revertido no ROLLBACK final.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create or replace function kontrol_private.hoje_brasilia() returns date
  language sql stable set search_path = '' as $$ select date '2026-11-24' $$;

create function pg_temp.como(p_rotulo text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', md5('kontrol-av-' || p_rotulo)::uuid::text, true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', md5('kontrol-av-' || p_rotulo)::uuid,
                      'email', 'ts-av-' || p_rotulo || '@example.invalid',
                      'role', 'authenticated')::text, true);
end $$;

create function pg_temp.uid(p_rotulo text) returns uuid language sql as $$
  select md5('kontrol-av-' || p_rotulo)::uuid
$$;

create function pg_temp.id(p_chave text) returns bigint language sql as $$
  select current_setting('tav.' || p_chave)::bigint
$$;

-- quantos pedidos a fila "formalizar e autorizar" mostra a quem está na sessão
-- (null quando a fila não aparece). Conta a fila inteira: a lista do cartão
-- traz só os 3 mais antigos, e num banco com pedidos o de teste fica de fora.
create function pg_temp.qtd_fila() returns bigint language sql as $$
  select (e ->> 'quantidade')::bigint
    from jsonb_array_elements(public.aguardando_voce()) e
   where e ->> 'chave' = 'pedidos_administrativo'
$$;

-- ---- pessoas, projeto, laboratório e insumo ------------------------------------------------
do $$
declare
  v_rotulo text;
  v_projeto bigint;
  v_area bigint;
  v_insumo bigint;
begin
  -- compras: função Compra (conduz); adm: Administrador; gestor2: função
  -- Gestor, sem a caixinha; coord e labc: coordenam o projeto e o laboratório
  foreach v_rotulo in array array['compras', 'adm', 'gestor2', 'coord', 'labc'] loop
    insert into auth.users(instance_id, id, aud, role, email, raw_app_meta_data, created_at, updated_at)
    values ('00000000-0000-0000-0000-000000000000', pg_temp.uid(v_rotulo), 'authenticated', 'authenticated',
            'ts-av-' || v_rotulo || '@example.invalid', '{"cadastrado_pelo_admin": true}'::jsonb, now(), now());
    update public.perfis
       set nome = 'TS-AV ' || v_rotulo,
           papel = case v_rotulo when 'compras' then 'compra' when 'adm' then 'admin'
                                 when 'coord' then 'coordenador' when 'labc' then 'laboratorio' else 'gestor' end,
           suspenso = false, senha_provisoria = false, permissoes = '{}'::jsonb
     where id = pg_temp.uid(v_rotulo);
  end loop;

  insert into public.projetos (nome, coordenador_id) values ('TS-AV projeto', pg_temp.uid('coord'))
  returning id into v_projeto;
  perform set_config('tav.projeto', v_projeto::text, true);
  insert into public.coordenacoes_area (nome, coordenador_id) values ('TS-AV laboratório', pg_temp.uid('labc'))
  returning id into v_area;
  perform set_config('tav.area', v_area::text, true);
  insert into public.insumos (especificacao, unidade, ativo, categoria_compra)
  values ('TS-AV luva nitrílica', 'cx', true, 'operacional') returning id into v_insumo;
  perform set_config('tav.insumo', v_insumo::text, true);
end $$;

-- ---- o coordenador e o laboratório aprovam em 24/11: o pedido cai no ciclo de dezembro ------
select pg_temp.como('gestor2');
set local role authenticated;
do $$
declare
  v_pedido bigint;
begin
  insert into public.pedidos_internos (titulo, status, solicitante, projeto_id, natureza, objetivo, justificativa, area_id)
  values ('TS-AV pedido do ciclo seguinte', 'rascunho', 'ts-av-gestor2@example.invalid', pg_temp.id('projeto'),
          'material_consumo_lab', 'projeto', 'Teste do Aguardando você de quem conduz.', pg_temp.id('area'))
  returning id into v_pedido;
  insert into public.pedidos_internos_itens (pedido_interno_id, tipo, especificacao, quantidade, unidade, insumo_id, orcamento_previo)
  values (v_pedido, 'material', 'TS-AV luva nitrílica', 2, 'cx', pg_temp.id('insumo'), 45);
  perform set_config('tav.pedido', v_pedido::text, true);
end $$;
select public.registrar_etapa_pedido_interno(pg_temp.id('pedido'), 'em_validacao', 'em_validacao', 'registrado', null, '{}');
reset role;
-- antes da aprovação: quantos pedidos a fila já tem para o Administrador
select pg_temp.como('adm');
set local role authenticated;
select set_config('tav.antes', coalesce(pg_temp.qtd_fila(), 0)::text, true);
reset role;
select pg_temp.como('coord');
set local role authenticated;
select public.registrar_etapa_pedido_interno(pg_temp.id('pedido'), 'validado', 'validado', 'aprovado', null, '{}');
reset role;
select pg_temp.como('labc');
set local role authenticated;
select public.decidir_coordenacao_laboratorio(pg_temp.id('pedido'), 'aprovado', null);
reset role;

do $$
begin
  if (select status from public.pedidos_internos where id = pg_temp.id('pedido')) <> 'validado'
     or (select ciclo_pagamento from public.pedidos_internos where id = pg_temp.id('pedido')) <> date '2026-12-01' then
    raise exception 'aguardando_voce_0185: o pedido deveria estar validado no ciclo de dezembro/2026: % %',
      (select status from public.pedidos_internos where id = pg_temp.id('pedido')),
      (select ciclo_pagamento from public.pedidos_internos where id = pg_temp.id('pedido'));
  end if;
  if (select kontrol_private.ciclo_libera_em(p.ciclo_pagamento, p.urgencia, p.urgencia_justificativa)
        from public.pedidos_internos p where p.id = pg_temp.id('pedido')) is null then
    raise exception 'aguardando_voce_0185: o pedido deveria estar travado no ciclo seguinte';
  end if;
end $$;

-- ---- quem conduz vê já; quem não conduz, não ----------------------------------------------
-- quem conduz conta o pedido travado: a fila tem um a mais que antes da aprovação
create function pg_temp.exigir_qtd(p_quem text, p_esperado bigint, p_msg text) returns void language plpgsql as $$
declare
  v_qtd bigint;
begin
  perform pg_temp.como(p_quem);
  set local role authenticated;
  v_qtd := pg_temp.qtd_fila();
  reset role;
  if v_qtd is distinct from p_esperado then
    raise exception 'aguardando_voce_0185: % (esperado %, veio %)', p_msg, p_esperado, v_qtd;
  end if;
end $$;

select pg_temp.exigir_qtd('adm', pg_temp.id('antes') + 1,
  'o Administrador deveria ver o pedido travado na fila de formalizar');
select pg_temp.exigir_qtd('compras', pg_temp.id('antes') + 1,
  'quem conduz a compra inteira deveria ver o pedido travado na fila de formalizar');
-- o Gestor sem a caixinha não é do administrativo: a fila nem aparece para ele
select pg_temp.exigir_qtd('gestor2', null,
  'sem a caixinha, o Gestor não deveria ver a fila de formalizar');

-- a caixinha marcada só para o Gestor vale; desmarcada na pessoa da Compra, não vale
update public.perfis set permissoes = '{"compras.conduzir": true}'::jsonb where id = pg_temp.uid('gestor2');
update public.perfis set permissoes = '{"compras.conduzir": false}'::jsonb where id = pg_temp.uid('compras');

select pg_temp.exigir_qtd('gestor2', pg_temp.id('antes') + 1,
  'com a caixinha, o Gestor deveria ver o pedido travado na fila de formalizar');
select pg_temp.exigir_qtd('compras', null,
  'com a caixinha desmarcada, a Compra não deveria ver a fila de formalizar');

select 'aguardando_voce_quem_conduz_0185: ok' as resultado;

rollback;
