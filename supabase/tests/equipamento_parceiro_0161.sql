-- SOMENTE clone sintético local. Valida a 0161: custo por amostra de
-- equipamento de parceiro. Termina em ROLLBACK.
\if :{?kontrol_test_local}
\else
  \echo '0161: falta acknowledgement explícito de banco descartável local.'
  \quit 3
\endif
begin;
set local lock_timeout = '3s';
set local statement_timeout = '60s';
do $$
declare v_id bigint;
begin
  if inet_server_addr() is not null
     and inet_server_addr() not in ('127.0.0.1'::inet, '::1'::inet) then
    raise exception '0161: conexão não local.';
  end if;
  insert into public.equipamentos (nome, possui, quantidade, custo_unitario, custo_parceiro_por_amostra, custo_parceiro_estimado, custo_parceiro_fonte)
  values ('TS-0161 sequenciador parceiro', false, 0, 0, 35, true, 'Proposta do parceiro 11/2026') returning id into v_id;
  if (select custo_parceiro_por_amostra from public.equipamentos where id = v_id) <> 35 then
    raise exception '0161: custo do parceiro não gravou';
  end if;
  if (select custo_parceiro_estimado from public.equipamentos where nome = 'TS-0161 sem parceiro' ) is not null then
    raise exception '0161: consulta inesperada';
  end if;
  insert into public.equipamentos (nome) values ('TS-0161 sem parceiro');
  if (select custo_parceiro_estimado from public.equipamentos where nome = 'TS-0161 sem parceiro') is distinct from false then
    raise exception '0161: padrão de estimado deveria ser false';
  end if;
  begin
    update public.equipamentos set custo_parceiro_por_amostra = -1 where id = v_id;
    raise exception '0161: aceitou custo negativo';
  exception when check_violation then null;
  end;
end $$;
rollback;
