-- Executar apenas em banco descartavel, como owner de migrations, com psql -v ON_ERROR_STOP=1.
-- Valida a 0122: proposta aprovada gera o plano em rascunho (uma vez por
-- proposta) e as movimentacoes registram quem retirou. Revertido no ROLLBACK.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
declare
  v_uid uuid := md5('kontrol-0122-coordenador')::uuid;
  v_demanda bigint;
  v_orc bigint;
  v_item_a bigint;
  v_item_b bigint;
  v_analises text[];
begin
  -- não depende do seed: o CI cria o banco sem dados
  insert into public.analises (codigo, nome_simplificado) values ('TS-0122-A', 'TS 0122 A'), ('TS-0122-B', 'TS 0122 B');
  v_analises := array['TS-0122-A', 'TS-0122-B'];

  insert into auth.users(instance_id, id, aud, role, email, created_at, updated_at)
  values ('00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated',
          'ts-0122-coordenador@example.invalid', now(), now());
  update public.perfis set papel = 'coordenador', suspenso = false where id = v_uid;

  insert into public.demandas_propostas (titulo, cliente_nome)
  values ('TS-0122 proposta', 'Cliente TS-0122') returning id into v_demanda;
  -- modulo em rascunho: desde a 0126, modulo enviado nao aceita itens novos
  insert into public.orcamentos (demanda_id, cliente_nome, status)
  values (v_demanda, 'Cliente TS-0122', 'rascunho') returning id into v_orc;
  insert into public.orcamento_itens (orcamento_id, codigo_analise, n_amostras)
  values (v_orc, v_analises[1], 10) returning id into v_item_a;
  insert into public.orcamento_itens (orcamento_id, codigo_analise, n_amostras)
  values (v_orc, v_analises[2], 4) returning id into v_item_b;

  insert into public.orcamento_final_versoes (demanda_id, versao, numero, status, validade_dias, snapshot)
  values (
    v_demanda, 1, 'TS-0122-v1', 'emitido', 30,
    jsonb_build_object(
      'demanda', jsonb_build_object('id', v_demanda, 'titulo', 'TS-0122 proposta', 'cliente_nome', 'Cliente TS-0122'),
      'orcamentos_analises', jsonb_build_array(jsonb_build_object(
        'id', v_orc,
        'orcamento_itens', jsonb_build_array(
          jsonb_build_object('id', v_item_a, 'n_amostras', 10),
          jsonb_build_object('id', v_item_b, 'n_amostras', 4)
        )
      )),
      'orcamentos_projeto', '[]'::jsonb
    )
  );
  perform set_config('ts0122.analises', array_to_string(v_analises, ','), true);
end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub', md5('kontrol-0122-coordenador')::uuid::text, true);
select set_config('request.jwt.claims',
  json_build_object('sub', md5('kontrol-0122-coordenador')::uuid, 'email', 'ts-0122-coordenador@example.invalid',
                    'role', 'authenticated')::text, true);

select public.transicionar_orcamento_final(
  (select id from public.orcamento_final_versoes where numero = 'TS-0122-v1'), 'aprovado', 'cliente aprovou por e-mail');

reset role;

do $$
declare
  v_versao bigint := (select id from public.orcamento_final_versoes where numero = 'TS-0122-v1');
  v_plano public.planejamento%rowtype;
  v_analises text[] := string_to_array(current_setting('ts0122.analises'), ',');
begin
  select * into v_plano from public.planejamento where orcamento_final_versao_id = v_versao;
  if not found then
    raise exception '0122: aprovar a proposta nao gerou o planejamento';
  end if;
  if v_plano.status_operacional <> 'rascunho' or v_plano.origem_planejamento <> 'orcamento' then
    raise exception '0122: plano deveria nascer em rascunho com origem orcamento (obtido % %)',
      v_plano.status_operacional, v_plano.origem_planejamento;
  end if;
  if (select n_amostras from public.planejamento_itens
      where planejamento_id = v_plano.id and codigo_analise = v_analises[1]) <> 10
     or (select n_amostras from public.planejamento_itens
      where planejamento_id = v_plano.id and codigo_analise = v_analises[2]) <> 4 then
    raise exception '0122: itens do plano nao correspondem a proposta';
  end if;
  if not exists (select 1 from public.notificacoes
                 where tipo = 'sistema' and entidade_id = v_plano.id and papel_destino = 'coordenador') then
    raise exception '0122: coordenador nao foi avisado';
  end if;
end $$;

-- Segunda versao da mesma proposta: desde a 0126 nao e aprovada enquanto a v1
-- estiver aprovada (uma versao viva por proposta) e nao duplica o plano.
insert into public.orcamento_final_versoes (demanda_id, versao, numero, status, validade_dias, snapshot)
select demanda_id, 2, 'TS-0122-v2', 'emitido', 30, snapshot
from public.orcamento_final_versoes where numero = 'TS-0122-v1';
set local role authenticated;
do $$
begin
  perform public.transicionar_orcamento_final(
    (select id from public.orcamento_final_versoes where numero = 'TS-0122-v2'), 'aprovado', 'nova versao aprovada');
  raise exception '0122/0126: segunda versao aprovada com a v1 ainda aprovada';
exception when invalid_parameter_value then null;
end $$;

-- Retirada registra quem movimentou
insert into public.insumos (especificacao, unidade, fator_conversao) values ('TS-0122 Insumo', 'un', 1);
reset role;
insert into public.lotes_estoque (insumo_id, codigo_lote, quantidade_inicial, quantidade_atual, status)
select id, 'TS-0122-L', 5, 5, 'aceito' from public.insumos where especificacao = 'TS-0122 Insumo';
set local role authenticated;
select public.baixa_manual_lote((select id from public.lotes_estoque where codigo_lote = 'TS-0122-L'), 1, 'uso');
reset role;

do $$
declare
  v_demanda bigint := (select demanda_id from public.orcamento_final_versoes where numero = 'TS-0122-v1');
begin
  if (select count(*) from public.planejamento p
      join public.orcamento_final_versoes v on v.id = p.orcamento_final_versao_id
      where v.demanda_id = v_demanda) <> 1 then
    raise exception '0122: segunda aprovacao duplicou o plano';
  end if;
  if (select usuario from public.estoque_movimentacoes m
      join public.lotes_estoque l on l.id = m.lote_id
      where l.codigo_lote = 'TS-0122-L' and m.motivo like 'baixa manual%') <> 'ts-0122-coordenador@example.invalid' then
    raise exception '0122: movimentacao sem o usuario que retirou';
  end if;
end $$;

rollback;
