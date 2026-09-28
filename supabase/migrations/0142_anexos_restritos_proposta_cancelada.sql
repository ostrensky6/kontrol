-- 0142 — anexos restritos por permissão e proposta cancelada que volta a ser
-- aprovável (auditoria de 28/09/2026).
--
-- 1. Anexos no Storage. O bucket "orcamento-anexos" estava aberto para qualquer
--    usuário logado ler, gravar e apagar (0022), e qualquer técnico apagava o
--    anexo de qualquer pedido interno (0093). Agora vale a mesma permissão das
--    tabelas de metadados (0124, "a caixinha manda"):
--      orcamento-anexos: ler com "orcamentos.visualizar"; enviar, trocar e
--      apagar com "orcamentos.criar_editar";
--      pedidos-internos-anexos: ler com "pedido.ver", "pedido.criar" ou
--      "pedido.aprovar"; enviar com "pedido.criar" ou "pedido.aprovar"; apagar
--      só o próprio arquivo (com "pedido.criar") ou com "pedido.aprovar".
--
-- 2. Proposta aprovada e depois cancelada. O cancelamento não mexia no módulo
--    de projeto, que ficava "aprovado"; a nova versão emitida não podia ser
--    aprovada pelo link (aprovar_orcamento_publico exige o módulo em rascunho
--    ou enviado) e o cliente via "link indisponível". Agora, quando a última
--    versão aprovada é cancelada, o módulo volta para "enviado". A substituição
--    por reformulação (0139) marca a antiga como "substituido" e não passa por
--    aqui.
--
-- Rollback: recriar orcamento_anexos_auth_all (0022) e as três policies de
-- pedidos-internos-anexos da 0093; drop trigger kontrol_modulo_ao_cancelar_aprovada
-- on public.orcamento_final_versoes; drop function
-- kontrol_private.devolver_modulo_ao_cancelar_aprovada().

begin;

set local lock_timeout = '5s';

-- ---- 1. Storage ---------------------------------------------------------------

drop policy if exists orcamento_anexos_auth_all on storage.objects;
drop policy if exists orcamento_anexos_ler on storage.objects;
drop policy if exists orcamento_anexos_enviar on storage.objects;
drop policy if exists orcamento_anexos_trocar on storage.objects;
drop policy if exists orcamento_anexos_apagar on storage.objects;

create policy orcamento_anexos_ler on storage.objects
  for select to authenticated
  using (bucket_id = 'orcamento-anexos' and public.tem_permissao('orcamentos.visualizar'));

create policy orcamento_anexos_enviar on storage.objects
  for insert to authenticated
  with check (bucket_id = 'orcamento-anexos' and public.tem_permissao('orcamentos.criar_editar'));

create policy orcamento_anexos_trocar on storage.objects
  for update to authenticated
  using (bucket_id = 'orcamento-anexos' and public.tem_permissao('orcamentos.criar_editar'))
  with check (bucket_id = 'orcamento-anexos' and public.tem_permissao('orcamentos.criar_editar'));

create policy orcamento_anexos_apagar on storage.objects
  for delete to authenticated
  using (bucket_id = 'orcamento-anexos' and public.tem_permissao('orcamentos.criar_editar'));

drop policy if exists pedidos_internos_anexos_read on storage.objects;
drop policy if exists pedidos_internos_anexos_insert on storage.objects;
drop policy if exists pedidos_internos_anexos_delete on storage.objects;

create policy pedidos_internos_anexos_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'pedidos-internos-anexos'
    and (public.tem_permissao('pedido.ver')
         or public.tem_permissao('pedido.criar')
         or public.tem_permissao('pedido.aprovar'))
  );

create policy pedidos_internos_anexos_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'pedidos-internos-anexos'
    and (public.tem_permissao('pedido.criar') or public.tem_permissao('pedido.aprovar'))
  );

create policy pedidos_internos_anexos_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'pedidos-internos-anexos'
    and (public.tem_permissao('pedido.aprovar')
         or (owner_id = (select auth.uid())::text and public.tem_permissao('pedido.criar')))
  );

-- ---- 2. Proposta aprovada cancelada: módulo volta para "enviado" -----------------

create or replace function kontrol_private.devolver_modulo_ao_cancelar_aprovada()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_claims jsonb := coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
  v_ator text := coalesce(nullif(v_claims->>'email', ''), nullif(v_claims->>'sub', ''), 'sistema');
  v_projeto record;
begin
  if exists (select 1 from public.orcamento_final_versoes
              where demanda_id = new.demanda_id and id <> new.id
                and status in ('aprovado', 'convertido_projeto')) then
    return null;
  end if;

  perform set_config('app.orcamento_projeto_transicao', 'permitida', true);
  for v_projeto in
    update public.orcamento_projetos
       set status = 'enviado'
     where demanda_id = new.demanda_id and status = 'aprovado'
    returning id
  loop
    insert into public.eventos_status (entidade, entidade_id, de_status, para_status, usuario, observacao)
    values ('orcamento_projeto', v_projeto.id, 'aprovado', 'enviado', v_ator,
            'Proposta ' || new.numero || ' cancelada: a nova versão pode ser aprovada.');
  end loop;
  return null;
end
$function$;

revoke all on function kontrol_private.devolver_modulo_ao_cancelar_aprovada()
  from public, anon, authenticated, service_role;

drop trigger if exists kontrol_modulo_ao_cancelar_aprovada on public.orcamento_final_versoes;
create trigger kontrol_modulo_ao_cancelar_aprovada
  after update of status on public.orcamento_final_versoes
  for each row
  when (old.status = 'aprovado' and new.status = 'cancelado')
  execute function kontrol_private.devolver_modulo_ao_cancelar_aprovada();

-- Propostas já canceladas com o módulo preso em "aprovado" (o caso do achado).
do $$
declare
  v_projeto record;
begin
  perform set_config('app.orcamento_projeto_transicao', 'permitida', true);
  for v_projeto in
    update public.orcamento_projetos p
       set status = 'enviado'
     where p.status = 'aprovado'
       and exists (select 1
                     from public.orcamento_final_versoes v
                     join public.eventos_status e
                       on e.entidade = 'orcamento_final' and e.entidade_id = v.id
                      and e.de_status = 'aprovado' and e.para_status = 'cancelado'
                    where v.demanda_id = p.demanda_id and v.status = 'cancelado')
       and not exists (select 1 from public.orcamento_final_versoes v
                        where v.demanda_id = p.demanda_id
                          and v.status in ('aprovado', 'convertido_projeto'))
    returning p.id
  loop
    insert into public.eventos_status (entidade, entidade_id, de_status, para_status, usuario, observacao)
    values ('orcamento_projeto', v_projeto.id, 'aprovado', 'enviado', 'migration 0142',
            'Proposta aprovada tinha sido cancelada: módulo liberado para a nova versão.');
  end loop;
end $$;

commit;
