-- ORD130. Leitura para a operação configurar_vinculo_projeto da 0151.
-- Não concede vínculo, papel ou acesso direto ao schema/tabela privados.
begin;
set local lock_timeout='5s';

create function public.listar_vinculos_projeto(
  p_projeto_id bigint,p_apos_usuario_id uuid default null,p_limite integer default 50
)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  v_ator uuid:=kontrol_private.exigir_sessao_nomeacao();
  v_coordenador uuid;
  v_resultado jsonb;
begin
  -- Mesma elegibilidade de governança da escrita 0151: Admin real, ativo,
  -- não provisório e sessão Auth existente. Nenhuma chave genérica substitui.
  if not exists(select 1 from public.perfis p where p.id=v_ator
      and p.papel='admin' and not p.suspenso and not p.senha_provisoria) then
    raise exception 'Somente Administrador pode consultar os vínculos.' using errcode='42501';
  end if;
  if p_projeto_id is null or p_projeto_id<=0 or p_limite is null or p_limite not between 1 and 100 then
    raise exception 'Informe projeto e limite entre 1 e 100.' using errcode='22023';
  end if;
  select p.coordenador_id into v_coordenador from public.projetos p where p.id=p_projeto_id;
  if not found then raise exception 'Projeto não encontrado.' using errcode='P0002'; end if;

  -- Keyset de UUID, ordenação total estável. Ler limite+1 decide se existe
  -- continuação; ausência desta página NÃO significa ausência do vínculo.
  -- Perfil que mudou de papel continua aparecendo se tem vínculo removível.
  with candidatos as materialized (
    select p.id as usuario_id,p.nome,p.papel,p.suspenso,p.senha_provisoria,
      (v.usuario_id is not null) as vinculado,
      coalesce(p.papel='coordenador' and p.id=v_coordenador,false) as coordenacao_direta
    from public.perfis p
    left join kontrol_private.projetos_vinculos v on v.usuario_id=p.id and v.projeto_id=p_projeto_id
    where (p.papel in ('coordenador','gestor') or v.usuario_id is not null)
      and (p_apos_usuario_id is null or p.id>p_apos_usuario_id)
    order by p.id limit p_limite+1
  ), pagina as (
    select * from candidatos order by usuario_id limit p_limite
  )
  select jsonb_build_object('projeto_id',p_projeto_id,
    'itens',coalesce((select jsonb_agg(to_jsonb(p) order by p.usuario_id) from pagina p),'[]'::jsonb),
    'proximo_usuario_id',case when (select count(*) from candidatos)>p_limite
      then (select p.usuario_id from pagina p order by p.usuario_id desc limit 1) end)
  into v_resultado;
  return v_resultado;
end $$;

revoke all on function public.listar_vinculos_projeto(bigint,uuid,integer)
from public,anon,authenticated,service_role;
grant execute on function public.listar_vinculos_projeto(bigint,uuid,integer) to authenticated;

comment on function public.listar_vinculos_projeto(bigint,uuid,integer) is
  'Admin com sessão real: candidatos e vínculos explícitos do projeto. Paginação UUID; nome pode ser null. Ausência da página não prova desvínculo. Leitura não nomeia nem concede poderes.';
commit;
