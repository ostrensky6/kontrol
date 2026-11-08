-- Base do catálogo de funções para a evolução integrada (etapa 1 do banco).
-- NÃO muda o acesso de ninguém: só cria o que as próximas migrations usam.
--   * aceita a função 'supervisor' nos CHECKs (ninguém é nomeado aqui;
--     a categoria nasce vazia);
--   * catálogo de funções, hierarquia de nomeação e chaves conhecidas;
--   * tabela de vínculos explícitos de projeto + operação do Administrador
--     para preenchê-la ANTES de qualquer regra de escopo usar os vínculos;
--   * proteção do último Administrador ativo.
-- Fica para a migration de funções e escopo (depende da decisão do Antonio):
-- permissão só pela função, recorte por projeto nas políticas, nomeação
-- delegada e travas de mudança de função.
-- Rollback: drop function public.configurar_vinculo_projeto(bigint,uuid,boolean),
--   kontrol_private.{papel_catalogado,nivel_nomeacao,chave_permissao_conhecida,
--   serializar_nomeacao,exigir_sessao_nomeacao,proteger_ultimo_admin};
--   drop trigger kontrol_proteger_ultimo_admin on public.perfis;
--   drop table kontrol_private.projetos_vinculos; delete from
--   permissoes_categorias where papel='supervisor'; CHECKs voltam à 0146.
begin;
set local lock_timeout = '5s';

alter table public.perfis drop constraint perfis_papel_check,
  add constraint perfis_papel_check check (papel in
    ('laboratorio','compra','cadastro','gestor','coordenador','supervisor','admin'));
alter table public.usuarios_pre_aprovados drop constraint usuarios_pre_aprovados_papel_check,
  add constraint usuarios_pre_aprovados_papel_check check (papel in
    ('laboratorio','compra','cadastro','gestor','coordenador','supervisor','admin'));
alter table public.permissoes_categorias drop constraint permissoes_categorias_papel_check,
  add constraint permissoes_categorias_papel_check check (papel in
    ('laboratorio','compra','cadastro','gestor','coordenador','supervisor','admin'));

-- A categoria nasce vazia; escopo geral não equivale a privilégios de Admin.
insert into public.permissoes_categorias(papel, permissoes)
values ('supervisor', '{}'::jsonb) on conflict (papel) do nothing;

-- Funções que listam os papéis com caixinha passam a reconhecer 'supervisor'
-- (mesma técnica da 0146). Com a categoria vazia, isso não concede nada:
-- só deixa o Supervisor ser avaliado pela matriz quando alguém for nomeado.
do $$
declare
  v_fn record;
  v_total integer := 0;
begin
  for v_fn in
    select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'kontrol_private') and p.prokind = 'f'
      and p.prosrc like '%(''laboratorio'', ''compra'', ''cadastro'', ''coordenador'', ''gestor'')%'
  loop
    execute replace(pg_get_functiondef(v_fn.oid),
      '(''laboratorio'', ''compra'', ''cadastro'', ''coordenador'', ''gestor'')',
      '(''laboratorio'', ''compra'', ''cadastro'', ''coordenador'', ''gestor'', ''supervisor'')');
    v_total := v_total + 1;
  end loop;
  if v_total = 0 then
    raise exception '0151: nenhuma função com a lista da 0146 encontrada';
  end if;
end $$;

create function kontrol_private.papel_catalogado(p_papel text)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(p_papel in
    ('laboratorio','compra','cadastro','gestor','coordenador','supervisor','admin'), false);
$$;

-- Não reordenar nivel_papel: ele ainda é usado por guardas legadas de
-- outras operações. Na nomeação, a posição dos operacionais não foi decidida.
create function kontrol_private.nivel_nomeacao(p_papel text)
returns integer language sql immutable set search_path = '' as $$
  select case p_papel
    when 'admin' then 4 when 'supervisor' then 3 when 'coordenador' then 2
    when 'gestor' then 1 end;
$$;

create function kontrol_private.chave_permissao_conhecida(p_chave text)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(p_chave = any(array[
    'analises.editar','analises.ver','auditoria.visualizar','backups.gerenciar',
    'cadastros.editar','cadastros.ver','compras.aprovar','compras.cancelar',
    'compras.receber','compras.solicitar','compras.ver','configuracoes.ver',
    'custeio.ver','estoque.descartar_bloquear','estoque.lote.aceitar',
    'estoque.lote.gerir','estoque.movimentar','estoque.ver','insumos.editar',
    'insumos.excluir_em_cascata','insumos.ver','orcamento.parametros.editar',
    'orcamentos.cancelar','orcamentos.criar_editar','orcamentos.emitir',
    'orcamentos.fundos','orcamentos.modelos','orcamentos.pessoal',
    'orcamentos.visualizar','pedido.aprovar','pedido.criar','pedido.ver',
    'planejamento.editar','planejamento.executar','planejamento.ver',
    'privilegios.gerenciar','projetos.editar','projetos.ver','recebimento.registrar',
    'recebimento.ver','tecnicos.salario.ver','usuarios.gerenciar'
  ]::text[]), false);
$$;

-- Vínculos explícitos, sem inferir membresia de e-mail/nome ou preenchê-la
-- no legado. Coordenador_id continua sendo vínculo existente e autoritativo.
create table kontrol_private.projetos_vinculos (
  projeto_id bigint not null references public.projetos(id) on delete cascade,
  usuario_id uuid not null references public.perfis(id) on delete cascade,
  primary key (projeto_id, usuario_id)
);
alter table kontrol_private.projetos_vinculos enable row level security;
revoke all on table kontrol_private.projetos_vinculos from public, anon, authenticated, service_role;

-- ponytail: um lock transacional de nomeações. Ele serializa também remoções
-- de Admin ativo; sem snapshot antigo que possa mascarar o último Admin.
create function kontrol_private.serializar_nomeacao()
returns void language plpgsql set search_path = '' as $$
begin
  if pg_catalog.current_setting('transaction_isolation') not in ('read committed','read uncommitted') then
    raise exception 'Nomeação exige leitura atual do catálogo.' using errcode = '25000';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(151, 1907);
end $$;

create function kontrol_private.exigir_sessao_nomeacao()
returns uuid language plpgsql set search_path = '' as $$
declare
  v_ator uuid := auth.uid();
  v_sessao text := auth.jwt() ->> 'session_id';
begin
  if v_ator is null or auth.jwt() ->> 'role' is distinct from 'authenticated'
     or v_sessao is null or v_sessao !~ '^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$' then
    raise exception 'Sessão de nomeação inválida.' using errcode = '42501';
  end if;
  if not exists (
    select 1 from auth.sessions s where s.id = v_sessao::uuid and s.user_id = v_ator
      and (s.not_after is null or s.not_after > pg_catalog.now())
  ) then
    raise exception 'Sessão de nomeação inválida.' using errcode = '42501';
  end if;
  return v_ator;
end $$;

-- Admin gerencia somente o vínculo explícito, não muda o papel do alvo ou
-- o vínculo de coordenação canônico (projetos.coordenador_id).
create function public.configurar_vinculo_projeto(
  p_projeto_id bigint, p_usuario_id uuid, p_vinculado boolean
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_ator uuid := kontrol_private.exigir_sessao_nomeacao();
  v_email text;
  v_papel text;
  v_coordenador uuid;
  v_alterado boolean;
  v_trilha jsonb;
begin
  if p_projeto_id is null or p_projeto_id <= 0 or p_usuario_id is null or p_vinculado is null then
    raise exception 'Informe projeto, usuário e estado do vínculo.' using errcode = '22023';
  end if;
  perform kontrol_private.serializar_nomeacao();
  select coalesce(p.email,p.id::text) into v_email from public.perfis p
    where p.id = v_ator and p.papel = 'admin' and not p.suspenso and not p.senha_provisoria for update;
  if not found then
    raise exception 'Somente Administrador pode configurar o vínculo.' using errcode = '42501';
  end if;
  select p.papel into v_papel from public.perfis p where p.id = p_usuario_id for update;
  if not found then raise exception 'Perfil de destino não encontrado.' using errcode = 'P0002'; end if;
  select p.coordenador_id into v_coordenador from public.projetos p where p.id = p_projeto_id for update;
  if not found then raise exception 'Projeto não encontrado.' using errcode = 'P0002'; end if;
  if p_vinculado and v_papel not in ('coordenador','gestor') then
    raise exception 'Vínculo explícito exige Coordenador ou Gestor.' using errcode = '22023';
  end if;
  if p_vinculado then
    insert into kontrol_private.projetos_vinculos(projeto_id,usuario_id)
    values (p_projeto_id,p_usuario_id) on conflict do nothing;
    v_alterado := found;
  else
    delete from kontrol_private.projetos_vinculos
    where projeto_id = p_projeto_id and usuario_id = p_usuario_id;
    v_alterado := found;
  end if;
  if v_alterado then
    v_trilha := pg_catalog.jsonb_build_object('projeto_id',p_projeto_id,'usuario_id',p_usuario_id,'ator_id',v_ator);
    insert into public.auditoria(tabela,registro_id,acao,valor_anterior,valor_novo,usuario)
    values ('projetos_vinculos',p_projeto_id::text || ':' || p_usuario_id::text,
      case when p_vinculado then 'insert' else 'delete' end,
      case when not p_vinculado then v_trilha end,
      case when p_vinculado then v_trilha end, v_email);
  end if;
  return pg_catalog.jsonb_build_object('projeto_id',p_projeto_id,'usuario_id',p_usuario_id,
    'vinculado',p_vinculado,'alterado',v_alterado,
    'coordenacao_direta',coalesce(v_papel='coordenador' and v_coordenador=p_usuario_id,false));
end $$;

-- Só Admin efetivamente apto conta como alternativa.
create function kontrol_private.proteger_ultimo_admin()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.papel = 'admin' and not old.suspenso and not old.senha_provisoria and
     (tg_op = 'DELETE' or new.papel is distinct from 'admin' or new.suspenso or new.senha_provisoria) then
    perform kontrol_private.serializar_nomeacao();
    if not exists (
      select 1 from public.perfis p where p.id <> old.id and p.papel = 'admin'
        and not p.suspenso and not p.senha_provisoria
    ) then
      raise exception 'Não é permitido remover o último Administrador ativo.' using errcode = '42501';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
create trigger kontrol_proteger_ultimo_admin before update of papel, suspenso, senha_provisoria or delete on public.perfis
  for each row execute function kontrol_private.proteger_ultimo_admin();
revoke truncate on public.perfis from public, anon, authenticated, service_role;

revoke all on function kontrol_private.nivel_nomeacao(text),
  kontrol_private.papel_catalogado(text),
  kontrol_private.chave_permissao_conhecida(text),
  kontrol_private.serializar_nomeacao(),
  kontrol_private.exigir_sessao_nomeacao(),
  kontrol_private.proteger_ultimo_admin()
  from public, anon, authenticated, service_role;
revoke all on function public.configurar_vinculo_projeto(bigint,uuid,boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.configurar_vinculo_projeto(bigint,uuid,boolean) to authenticated;

commit;
