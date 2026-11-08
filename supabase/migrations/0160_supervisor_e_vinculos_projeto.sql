-- 0160: Supervisor passa a ser uma função utilizável e Coordenador/Gestor
-- passam a agir só nos projetos a que estão ligados.
--
-- Hierarquia do plano aprovado (07/11/2026): Admin > Supervisor > Coordenador
-- e Gestor. A 0151 já aceitou 'supervisor' nos CHECKs e criou a categoria
-- vazia; aqui:
--   * nivel_papel ganha Supervisor (3) e Admin sobe para 4. Só comparações
--     relativas usam o nível, então ninguém que já existe muda de acesso:
--     Supervisor alcança tudo que pede "Gestor ou acima", e nada que pede Admin;
--   * a categoria Supervisor nasce com as caixinhas atuais do Gestor (as que
--     o Admin já ajustou em Governança → Privilégios), só se ainda estiver vazia.
--   * vínculos de projeto (decisão de Antonio, 08/11/2026: "ninguém perde
--     acesso hoje"): todo Coordenador e Gestor atual é ligado a todos os
--     projetos existentes. Daí em diante, Coordenador e Gestor só alteram um
--     projeto e só validam pedido interno de projeto a que estão ligados (ou
--     de que são o coordenador cadastrado). Quem cria um projeto fica ligado.
--     A leitura continua igual. O Admin liga e desliga pela tela do projeto.
-- Não destrutiva. Rollback: recriar nivel_papel da 0146; update
--   permissoes_categorias set permissoes='{}' where papel='supervisor';
--   drop trigger projetos_exigir_vinculo, projetos_vincular_criador on
--   public.projetos; drop trigger pedidos_internos_exigir_vinculo on
--   public.pedidos_internos; drop function public.vinculos_projeto(bigint),
--   kontrol_private.{pode_agir_no_projeto, projetos_exigir_vinculo,
--   projetos_vincular_criador, pedidos_internos_exigir_vinculo}. Os vínculos
--   semeados podem ficar (sem os gatilhos, não restringem nada).

create or replace function kontrol_private.nivel_papel(p_papel text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case p_papel
    when 'admin' then 4
    when 'supervisor' then 3
    when 'gestor' then 2
    when 'coordenador' then 1
    when 'laboratorio' then 0
    when 'compra' then 0
    when 'cadastro' then 0
    -- 0146: nome antigo de Laboratório (corpos de função e avisos antigos)
    when 'tecnico' then 0
  end;
$$;

comment on function kontrol_private.nivel_papel(text) is
  'Nível da função (0160): laboratorio/compra/cadastro 0, coordenador 1, gestor 2, supervisor 3, admin 4; tecnico = 0 (nome antigo). Desconhecido: NULL.';

update public.permissoes_categorias s
   set permissoes = g.permissoes
  from public.permissoes_categorias g
 where s.papel = 'supervisor'
   and g.papel = 'gestor'
   and (s.permissoes is null or s.permissoes = '{}'::jsonb);

-- ---- Vínculos de projeto ---------------------------------------------------
-- Semeadura: ninguém perde acesso no dia da migration.
insert into kontrol_private.projetos_vinculos (projeto_id, usuario_id)
select pr.id, pf.id
  from public.projetos pr
 cross join public.perfis pf
 where pf.papel in ('coordenador', 'gestor')
on conflict do nothing;

-- Coordenador e Gestor agem no projeto se estão ligados ou são o coordenador
-- cadastrado. As demais funções seguem só pelas caixinhas, como antes.
create function kontrol_private.pode_agir_no_projeto(p_projeto_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_projeto_id is null
      or coalesce(public.current_papel(), '') not in ('coordenador', 'gestor')
      or exists (select 1 from kontrol_private.projetos_vinculos v
                  where v.projeto_id = p_projeto_id and v.usuario_id = auth.uid())
      or exists (select 1 from public.projetos pr
                  where pr.id = p_projeto_id and pr.coordenador_id = auth.uid());
$$;
revoke all on function kontrol_private.pode_agir_no_projeto(bigint) from public, anon;
grant execute on function kontrol_private.pode_agir_no_projeto(bigint) to authenticated, service_role;

create function kontrol_private.projetos_exigir_vinculo()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is not null and not kontrol_private.pode_agir_no_projeto(old.id) then
    raise exception 'Você não está ligado a este projeto. Peça ao Administrador para ligar você na página do projeto.'
      using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

create trigger projetos_exigir_vinculo
  before update or delete on public.projetos
  for each row execute function kontrol_private.projetos_exigir_vinculo();

create function kontrol_private.projetos_vincular_criador()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is not null and coalesce(public.current_papel(), '') in ('coordenador', 'gestor') then
    insert into kontrol_private.projetos_vinculos (projeto_id, usuario_id)
    values (new.id, auth.uid()) on conflict do nothing;
  end if;
  return new;
end $$;

create trigger projetos_vincular_criador
  after insert on public.projetos
  for each row execute function kontrol_private.projetos_vincular_criador();

-- Validar (ou devolver/reprovar) pedido interno em validação.
create function kontrol_private.pedidos_internos_exigir_vinculo()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'em_validacao' and new.status is distinct from old.status
     and auth.uid() is not null and not kontrol_private.pode_agir_no_projeto(new.projeto_id) then
    raise exception 'Você não está ligado ao projeto deste pedido. Peça ao Administrador para ligar você na página do projeto.'
      using errcode = '42501';
  end if;
  return new;
end $$;

create trigger pedidos_internos_exigir_vinculo
  before update of status on public.pedidos_internos
  for each row execute function kontrol_private.pedidos_internos_exigir_vinculo();

-- Quem atua no projeto (tela do projeto). Só o Admin vê a lista completa.
create function public.vinculos_projeto(p_projeto_id bigint)
returns table (usuario_id uuid, nome text, email text, papel text, vinculado boolean, coordenador_cadastrado boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if coalesce(public.current_papel(), '') <> 'admin' then
    raise exception 'Somente o Administrador vê e altera quem atua no projeto.' using errcode = '42501';
  end if;
  return query
    select pf.id, pf.nome, pf.email, pf.papel,
           exists (select 1 from kontrol_private.projetos_vinculos v
                    where v.projeto_id = p_projeto_id and v.usuario_id = pf.id),
           coalesce(pr.coordenador_id = pf.id, false)
      from public.perfis pf
      left join public.projetos pr on pr.id = p_projeto_id
     where (pf.papel in ('coordenador', 'gestor') and not pf.suspenso)
        or exists (select 1 from kontrol_private.projetos_vinculos v
                    where v.projeto_id = p_projeto_id and v.usuario_id = pf.id)
     order by pf.papel, coalesce(pf.nome, pf.email);
end $$;
revoke all on function public.vinculos_projeto(bigint) from public, anon;
grant execute on function public.vinculos_projeto(bigint) to authenticated;
