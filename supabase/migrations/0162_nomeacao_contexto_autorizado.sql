-- ORD149. Projeção de leitura da nomeação0151, sem nova autoridade.
begin;
set local lock_timeout='5s';

create function public.listar_contexto_nomeacao(
  p_apos_usuario_id uuid default null,p_limite integer default 50
)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  v_ator uuid:=kontrol_private.exigir_sessao_nomeacao();
  v_papel text;
  v_resultado jsonb;
begin
  select p.papel into v_papel from public.perfis p
    where p.id=v_ator and not p.suspenso and not p.senha_provisoria;
  if not found or v_papel not in ('admin','supervisor','coordenador') then
    raise exception 'Consulta de nomeação não autorizada.' using errcode='42501';
  end if;
  if p_limite is null or p_limite not between 1 and 100 then
    raise exception 'Informe limite entre 1 e 100.' using errcode='22023';
  end if;

  -- A0151 não limita nomeação por projeto nem por usuarios.gerenciar.
  -- Não adicionar tais filtros, nem ordenar funções operacionais sem nível.
  -- Destino igual ao atual aparece se a RPC o aceita como alterado=false;
  -- não é troca funcional e o consumidor deve desabilitar esse envio.
  with candidatos as materialized (
    select p.id as usuario_id,p.nome,p.papel as papel_atual_esperado,
      p.suspenso,p.senha_provisoria,d.papeis_destino
    from public.perfis p
    cross join lateral (
      select array_agg(x.papel order by x.ordem) as papeis_destino
      from unnest(array['laboratorio','compra','cadastro','gestor','coordenador','supervisor','admin'])
        with ordinality x(papel,ordem)
      where kontrol_private.papel_catalogado(x.papel)
        and (v_papel='admin' or coalesce(
          kontrol_private.nivel_nomeacao(p.papel)<kontrol_private.nivel_nomeacao(v_papel)
          and kontrol_private.nivel_nomeacao(x.papel)<kontrol_private.nivel_nomeacao(v_papel),false))
    ) d
    where p.id<>v_ator and kontrol_private.papel_catalogado(p.papel)
      and (p_apos_usuario_id is null or p.id>p_apos_usuario_id)
      and cardinality(d.papeis_destino)>0
    order by p.id limit p_limite+1
  ), pagina as (
    select * from candidatos order by usuario_id limit p_limite
  )
  select jsonb_build_object(
    'itens',coalesce((select jsonb_agg(to_jsonb(p) order by p.usuario_id) from pagina p),'[]'::jsonb),
    'proximo_usuario_id',case when (select count(*) from candidatos)>p_limite
      then (select p.usuario_id from pagina p order by p.usuario_id desc limit 1) end)
  into v_resultado;
  return v_resultado;
end $$;

revoke all on function public.listar_contexto_nomeacao(uuid,integer)
from public,anon,authenticated,service_role;
grant execute on function public.listar_contexto_nomeacao(uuid,integer) to authenticated;
comment on function public.listar_contexto_nomeacao(uuid,integer) is
  'Foto paginada da regra0151, nome nullable, CAS papel_atual_esperado. Ausência fora da página não prova negação; leitura não autoriza escrita futura. nomear_papel_usuario revalida sessão, hierarquia, CAS e guardas transacionais.';
commit;
