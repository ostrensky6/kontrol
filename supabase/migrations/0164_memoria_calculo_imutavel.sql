-- 0164 — memória de cálculo da proposta emitida fica congelada.
--
-- A versão final emitida (orcamento_final_versoes) já é imutável no conteúdo
-- econômico (0101/0126). A memória de cálculo que a acompanha
-- (orcamento_parametros_aplicados: taxas aplicadas, fórmula, subtotais) ainda
-- aceitava UPDATE e DELETE direto de quem tem "orcamentos.emitir", pela API.
-- Assim, uma proposta já enviada podia ter as taxas registradas trocadas sem
-- nova versão. O app nunca grava essa tabela direto: só a emissão
-- (emitir_orcamento_final_transacional, security definer) insere nela.
--
-- Esta migration acrescenta um gatilho:
-- - INSERT só de dentro da emissão (função do banco), nunca direto pela API;
-- - UPDATE só a ação referencial das FKs (ON DELETE SET NULL), que zera
--   vínculos sem mexer em valores;
-- - DELETE recusado.
-- Ajustar taxas continua livre na proposta (param_* em demandas_propostas):
-- vale para a próxima versão emitida, nunca para a já enviada.
--
-- Aditivo: uma função e um gatilho. Políticas, RLS e auditoria ficam como estão.
-- Rollback: drop trigger trg_proteger_memoria_calculo on public.orcamento_parametros_aplicados;
-- drop function kontrol_private.proteger_memoria_calculo();
begin;
set local lock_timeout = '10s';

create function kontrol_private.proteger_memoria_calculo()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_vinculos text[] := array['demanda_id', 'orcamento_laboratorial_id', 'orcamento_projeto_id',
                             'orcamento_final_versao_id', 'criado_por'];
  v_coluna text;
begin
  if tg_op = 'INSERT' then
    if current_user in ('anon', 'authenticated', 'service_role') then
      raise exception 'A memória de cálculo só é gravada pela emissão da proposta.'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    raise exception 'A memória de cálculo de uma proposta emitida não pode ser apagada.'
      using errcode = '42501';
  end if;

  -- UPDATE: só a ação referencial (FK ON DELETE SET NULL) passa, e só zerando vínculos.
  if pg_catalog.pg_trigger_depth() > 1
     and (pg_catalog.to_jsonb(new) - v_vinculos) = (pg_catalog.to_jsonb(old) - v_vinculos) then
    foreach v_coluna in array v_vinculos loop
      if (pg_catalog.to_jsonb(new) -> v_coluna) is distinct from (pg_catalog.to_jsonb(old) -> v_coluna)
         and pg_catalog.jsonb_typeof(pg_catalog.to_jsonb(new) -> v_coluna) <> 'null' then
        raise exception 'A memória de cálculo de uma proposta emitida é imutável.' using errcode = '42501';
      end if;
    end loop;
    return new;
  end if;
  raise exception 'A memória de cálculo de uma proposta emitida é imutável. Ajuste as taxas e emita nova versão.'
    using errcode = '42501';
end $$;
revoke all on function kontrol_private.proteger_memoria_calculo() from public, anon, authenticated;

comment on function kontrol_private.proteger_memoria_calculo() is
  'Congela orcamento_parametros_aplicados (0164): inserção só pela emissão, sem alteração nem exclusão; FKs ainda podem zerar vínculos.';

create trigger trg_proteger_memoria_calculo
  before insert or update or delete on public.orcamento_parametros_aplicados
  for each row execute function kontrol_private.proteger_memoria_calculo();

commit;
