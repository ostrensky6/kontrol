-- Executar apenas em banco local/descartavel, com psql -v ON_ERROR_STOP=1.
-- Uma unica conexao reproduz a sessao reutilizada: SET LOCAL seguido de
-- COMMIT deixa request.jwt.claims vazio. As fixtures comecam somente depois
-- desse COMMIT e sao desfeitas no ROLLBACK final.
begin;
select set_config('request.jwt.claims', '{}', true);
commit;

begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if current_setting('request.jwt.claims', true) is distinct from '' then
    raise exception '0131: a sessao deveria ter claims vazios apos o commit';
  end if;
end $$;

create function pg_temp.exigir_erro(p_chamada text, p_sqlstate text)
returns void language plpgsql as $$
declare
  v_estado text;
  v_mensagem text;
begin
  begin
    execute p_chamada;
  exception when others then
    get stacked diagnostics v_estado = returned_sqlstate, v_mensagem = message_text;
    if v_estado = p_sqlstate then
      return;
    end if;
    raise exception '0131: % deveria retornar %, retornou %: %',
      p_chamada, p_sqlstate, v_estado, v_mensagem;
  end;
  raise exception '0131: % deveria retornar %, mas nao houve erro', p_chamada, p_sqlstate;
end $$;

insert into auth.users(instance_id, id, aud, role, email, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', md5('kontrol-0131-admin')::uuid,
        'authenticated', 'authenticated', 'ts-0131-admin@example.invalid', now(), now());
update public.perfis set papel = 'admin', suspenso = false, permissoes = '{}'::jsonb
where id = md5('kontrol-0131-admin')::uuid;

-- O sub identifica o usuario, mas claims permanece vazio, sem email.
select set_config('request.jwt.claim.sub', md5('kontrol-0131-admin')::uuid::text, true);
set local role authenticated;

-- As nove RPCs devem chegar as validacoes normais, nunca falhar no cast JSON.
-- IDs NULL garantem que nenhum registro existente seja alterado.
select pg_temp.exigir_erro('select public.aceitar_lote(null)', 'P0002');
select pg_temp.exigir_erro('select public.criar_pedido_faltas_planejamento(null, ''[]''::jsonb)', '22023');
select pg_temp.exigir_erro('select public.criar_pedido_reposicao_estoque(null, null, null, null, ''[]''::jsonb)', '22023');
select pg_temp.exigir_erro('select public.formalizar_pedido_interno(null)', 'P0002');
select pg_temp.exigir_erro('select public.registrar_etapa_pedido_interno(null, ''analise_administrativa'', null, ''registrado'', null, ''{}''::jsonb)', '22023');
select pg_temp.exigir_erro('select public.transicionar_orcamento(null, ''enviado'', null)', 'P0002');
select pg_temp.exigir_erro('select public.transicionar_orcamento_projeto(null, ''enviado'', null)', 'P0002');
select pg_temp.exigir_erro('select public.transicionar_pedido_interno(null, ''em_validacao'', null, ''registrado'', null)', 'P0002');
select pg_temp.exigir_erro('select public.validar_planejamento_executivo(null)', 'P0002');

-- Claims ausentes nao devem liberar uma acao a quem nao tem permissao.
select set_config('request.jwt.claim.sub', md5('kontrol-0131-sem-perfil')::uuid::text, true);
select pg_temp.exigir_erro('select public.aceitar_lote(null)', '42501');
reset role;

-- Exercita a decima funcao como trigger real, sem gravar planejamento real.
create temporary table claims_0131_planejamento (
  status_operacional text,
  reservado_por text
) on commit drop;
create trigger preencher_reservado
before update on claims_0131_planejamento
for each row execute function public.preencher_reservado_por_planejamento();

insert into claims_0131_planejamento values ('rascunho', null);
update claims_0131_planejamento set status_operacional = 'reservado';
do $$
begin
  if (select reservado_por from claims_0131_planejamento) is not null then
    raise exception '0131: claims vazios deveriam deixar reservado_por nulo';
  end if;
end $$;

-- Claims validos continuam fornecendo o email; autor informado e preservado.
select set_config('request.jwt.claims', '{"email":"ts-0131-admin@example.invalid"}', true);
update claims_0131_planejamento set status_operacional = 'rascunho';
update claims_0131_planejamento set status_operacional = 'reservado';
do $$
begin
  if (select reservado_por from claims_0131_planejamento)
     is distinct from 'ts-0131-admin@example.invalid' then
    raise exception '0131: claims validos deveriam preencher reservado_por';
  end if;
end $$;

update claims_0131_planejamento
set status_operacional = 'rascunho', reservado_por = 'responsavel informado';
update claims_0131_planejamento set status_operacional = 'reservado';
do $$
begin
  if (select reservado_por from claims_0131_planejamento)
     is distinct from 'responsavel informado' then
    raise exception '0131: o responsavel informado deveria ser preservado';
  end if;
end $$;

rollback;
