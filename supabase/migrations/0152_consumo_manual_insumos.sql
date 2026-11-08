-- ORD93 / ORD83: revisões manuais de consumo, sem cálculo ou efeito no estoque.
-- Dependência: 0151 fornece estoque.ver por função e o papel literal supervisor.
begin;
set local lock_timeout = '5s';

create table kontrol_private.consumo_manual_insumos (
  insumo_id bigint not null references public.insumos(id) on delete restrict,
  revisao bigint not null check (revisao > 0),
  operacao_id uuid not null unique,
  quantidade_embalagens_mes numeric not null
    check (quantidade_embalagens_mes >= 0 and quantidade_embalagens_mes < 'Infinity'::numeric),
  conteudo_embalagem numeric not null
    check (conteudo_embalagem > 0 and conteudo_embalagem < 'Infinity'::numeric),
  unidade_conteudo text not null check (unidade_conteudo <> ''),
  fonte text not null check (char_length(fonte) between 1 and 240),
  motivo text not null check (char_length(motivo) between 1 and 1000),
  data_referencia date not null check (isfinite(data_referencia)),
  ator_id uuid not null, -- snapshot do ator; excluir conta não apaga a trilha
  registrado_em timestamptz not null default now(),
  primary key (insumo_id, revisao)
);
comment on table kontrol_private.consumo_manual_insumos is
  'Histórico append-only; cada linha afirma confirmação explícita da apresentação declarada. Zero é estimativa, nunca consumo observado. Inativar em vez de excluir insumo com revisões.';
alter table kontrol_private.consumo_manual_insumos enable row level security;
revoke all on table kontrol_private.consumo_manual_insumos from public, anon, authenticated, service_role;

-- Leitura via SECURITY INVOKER; o catálogo/estoque continua sob as próprias
-- policies da sessão. A tabela fica em schema não exposto pelo PostgREST.
create policy consumo_manual_estoque_leitura
  on kontrol_private.consumo_manual_insumos for select to authenticated
  using (kontrol_private.tem_permissao_efetiva('estoque.ver') and exists (
    select 1 from public.v_estoque_saldo s where s.insumo_id = consumo_manual_insumos.insumo_id
  ));
grant select on table kontrol_private.consumo_manual_insumos to authenticated;

create function public.ler_consumo_manual_insumo(
  p_insumo_id bigint,
  p_antes_da_revisao bigint default null,
  p_limite integer default 25
)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  v_vigente jsonb;
  v_historico jsonb;
  v_proxima bigint;
begin
  if auth.uid() is null or not kontrol_private.tem_permissao_efetiva('estoque.ver')
     or not exists (select 1 from public.v_estoque_saldo s where s.insumo_id = p_insumo_id) then
    raise exception 'Insumo não disponível no estoque para esta sessão.' using errcode = '42501';
  end if;
  if p_limite is null or p_limite not between 1 and 100
     or (p_antes_da_revisao is not null and p_antes_da_revisao <= 0) then
    raise exception 'Página de revisões inválida.' using errcode = '22023';
  end if;
  select pg_catalog.to_jsonb(r) - 'operacao_id' into v_vigente
  from kontrol_private.consumo_manual_insumos r
  where r.insumo_id = p_insumo_id order by r.revisao desc limit 1;

  with pagina as (
    select r.*, row_number() over (order by r.revisao desc) as posicao
    from kontrol_private.consumo_manual_insumos r
    where r.insumo_id = p_insumo_id
      and (p_antes_da_revisao is null or r.revisao < p_antes_da_revisao)
    order by r.revisao desc limit p_limite + 1
  )
  select coalesce(jsonb_agg(pg_catalog.to_jsonb(p) - 'operacao_id' - 'posicao' order by p.revisao desc)
             filter (where p.posicao <= p_limite), '[]'::jsonb),
         case when count(*) > p_limite then min(p.revisao) filter (where p.posicao <= p_limite) end
  into v_historico, v_proxima from pagina p;
  return pg_catalog.jsonb_build_object(
    'estado', case when v_vigente is null then 'nenhuma' else 'registrada' end,
    'vigente', v_vigente, 'historico', v_historico, 'proxima_antes_da_revisao', v_proxima);
end $$;

-- A leitura do catálogo sob RLS no chamador é requisito também para escrever.
-- O único caminho PostgREST de escrita é este wrapper invoker. O executor
-- privado repete a autorização, ACLs da sessão e o contrato de RLS da base
-- 0014/0144 (leitura interna por estoque.ver, saldo partindo de insumos).
create function kontrol_private.registrar_consumo_manual_insumo(
  p_insumo_id bigint, p_operacao_id uuid, p_revisao_esperada bigint,
  p_quantidade_embalagens_mes numeric, p_conteudo_embalagem_esperado numeric,
  p_unidade_conteudo_esperada text, p_apresentacao_confirmada boolean,
  p_fonte text, p_motivo text, p_data_referencia date
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_ator uuid := auth.uid();
  v_sessao text := auth.jwt() ->> 'session_id';
  v_papel text;
  v_insumo public.insumos%rowtype;
  v_revisao kontrol_private.consumo_manual_insumos%rowtype;
  v_atual bigint;
  v_unidade text := pg_catalog.btrim(p_unidade_conteudo_esperada);
  v_fonte text := pg_catalog.btrim(p_fonte);
  v_motivo text := pg_catalog.btrim(p_motivo);
begin
  if v_ator is null or auth.jwt() ->> 'role' is distinct from 'authenticated'
     or v_sessao is null or v_sessao !~ '^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$' then
    raise exception 'Sessão inválida para registrar estimativa manual.' using errcode = '42501';
  end if;
  if not exists (select 1 from auth.sessions s where s.id = v_sessao::uuid and s.user_id = v_ator
                   and (s.not_after is null or s.not_after > pg_catalog.now())) then
    raise exception 'Sessão inválida para registrar estimativa manual.' using errcode = '42501';
  end if;
  if pg_catalog.current_setting('transaction_isolation') not in ('read committed','read uncommitted') then
    raise exception 'A estimativa exige uma leitura atual da revisão.' using errcode = '25000';
  end if;

  select p.papel into v_papel from public.perfis p
    where p.id = v_ator and not p.suspenso and not p.senha_provisoria for share;
  if not found or v_papel not in ('laboratorio','gestor','coordenador','supervisor','admin')
     or not kontrol_private.tem_permissao_efetiva('estoque.ver') then
    raise exception 'Registro de estimativa manual não autorizado.' using errcode = '42501';
  end if;
  -- O dono da função não representa os grants do chamador. O JWT já foi
  -- validado como authenticated; medir o acesso efetivo desse papel, não
  -- current_user. Exigir SELECT de tabela inteira é deliberadamente fechado
  -- se a instalação usar somente grants de coluna.
  if not pg_catalog.has_schema_privilege('authenticated'::regrole, 'public', 'USAGE')
     or not pg_catalog.has_function_privilege(
       'authenticated'::regrole, 'public.menor_validade(date,date)'::regprocedure, 'EXECUTE')
     or exists (
       select 1 from (values ('public.v_estoque_saldo'::regclass), ('public.insumos'::regclass),
         ('public.tipo_insumos'::regclass), ('public.lotes_estoque'::regclass),
         ('public.reservas_estoque'::regclass)) as fontes(relacao)
       where not pg_catalog.has_table_privilege('authenticated'::regrole, fontes.relacao, 'SELECT')
     ) or not exists (
       select 1 from pg_catalog.pg_class c where c.oid = 'public.v_estoque_saldo'::regclass
         and 'security_invoker=true' = any(c.reloptions)
     ) then
    raise exception 'Insumo não disponível no estoque para esta sessão.' using errcode = '42501';
  end if;
  if not exists (
       select 1 from pg_catalog.pg_policy p
       where p.polrelid = 'public.insumos'::regclass and p.polname = 'rls_read_insumos'
         and p.polpermissive and p.polcmd = 'r' and 'authenticated'::regrole::oid = any(p.polroles)
         and pg_catalog.pg_get_expr(p.polqual, p.polrelid) = 'true'
     ) or exists (
       select 1 from pg_catalog.pg_policy p where p.polrelid = 'public.insumos'::regclass
         and not p.polpermissive and p.polcmd in ('r','*')
     ) then
    raise exception 'Escopo de estoque precisa ser reconciliado antes da escrita.' using errcode = '42501';
  end if;
  if p_insumo_id is null or p_insumo_id <= 0 or p_operacao_id is null
     or p_revisao_esperada is null or p_revisao_esperada < 0
     or p_quantidade_embalagens_mes is null or p_quantidade_embalagens_mes < 0
     or p_quantidade_embalagens_mes >= 'Infinity'::numeric
     or p_conteudo_embalagem_esperado is null or p_conteudo_embalagem_esperado <= 0
     or p_conteudo_embalagem_esperado >= 'Infinity'::numeric
     or v_unidade is null or v_unidade in ('', '-', '—')
     or v_fonte is null or pg_catalog.char_length(v_fonte) not between 1 and 240
     or v_motivo is null or pg_catalog.char_length(v_motivo) not between 1 and 1000
     or p_data_referencia is null or not pg_catalog.isfinite(p_data_referencia)
     or p_apresentacao_confirmada is distinct from true then
    raise exception 'Informe uma estimativa finita e confirme a apresentação e sua evidência.' using errcode = '22023';
  end if;

  -- Mesma UUID se serializa inclusive entre insumos. O lock do insumo
  -- serializa revisões diferentes e concorre com edição da apresentação.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_operacao_id::text, 152));
  select i.* into v_insumo from public.insumos i where i.id = p_insumo_id for no key update;
  if not found or not exists (select 1 from public.v_estoque_saldo s where s.insumo_id = p_insumo_id) then
    raise exception 'Insumo não disponível no estoque para esta sessão.' using errcode = '42501';
  end if;

  select r.* into v_revisao from kontrol_private.consumo_manual_insumos r where r.operacao_id = p_operacao_id;
  if found then
    -- Igualdade SQL tipada: escala decimal e espaços periféricos não criam
    -- operação nova. Replay vem antes das verificações de cadastro/CAS atuais.
    if (v_revisao.ator_id, v_revisao.insumo_id, v_revisao.revisao - 1,
        v_revisao.quantidade_embalagens_mes, v_revisao.conteudo_embalagem,
        v_revisao.unidade_conteudo, v_revisao.fonte, v_revisao.motivo, v_revisao.data_referencia)
       is distinct from
       (v_ator, p_insumo_id, p_revisao_esperada, p_quantidade_embalagens_mes,
        p_conteudo_embalagem_esperado, v_unidade, v_fonte, v_motivo, p_data_referencia) then
      raise exception 'Operação já usada com outra estimativa.' using errcode = '23505';
    end if;
    return pg_catalog.jsonb_build_object('repetida', true, 'registro', pg_catalog.to_jsonb(v_revisao) - 'operacao_id');
  end if;

  if v_insumo.quantidade_embalagem is distinct from p_conteudo_embalagem_esperado
     or pg_catalog.btrim(v_insumo.unidade) is distinct from v_unidade then
    raise exception 'Apresentação do cadastro mudou ou não foi comprovada.' using errcode = '22023';
  end if;

  select coalesce(max(r.revisao), 0) into v_atual
  from kontrol_private.consumo_manual_insumos r where r.insumo_id = p_insumo_id;
  if v_atual <> p_revisao_esperada then
    raise exception 'A revisão manual mudou; recarregue antes de salvar.' using errcode = '40001';
  end if;
  insert into kontrol_private.consumo_manual_insumos (
    insumo_id, revisao, operacao_id, quantidade_embalagens_mes, conteudo_embalagem,
    unidade_conteudo, fonte, motivo, data_referencia, ator_id
  ) values (
    p_insumo_id, v_atual + 1, p_operacao_id, p_quantidade_embalagens_mes,
    v_insumo.quantidade_embalagem, v_unidade, v_fonte, v_motivo, p_data_referencia, v_ator
  ) returning * into v_revisao;
  return pg_catalog.jsonb_build_object('repetida', false, 'registro', pg_catalog.to_jsonb(v_revisao) - 'operacao_id');
end $$;

create function public.registrar_consumo_manual_insumo(
  p_insumo_id bigint, p_operacao_id uuid, p_revisao_esperada bigint,
  p_quantidade_embalagens_mes numeric, p_conteudo_embalagem_esperado numeric,
  p_unidade_conteudo_esperada text, p_apresentacao_confirmada boolean,
  p_fonte text, p_motivo text, p_data_referencia date
)
returns jsonb language plpgsql security invoker set search_path = '' as $$
begin
  if auth.uid() is null or not kontrol_private.tem_permissao_efetiva('estoque.ver')
     or not exists (select 1 from public.v_estoque_saldo s where s.insumo_id = p_insumo_id) then
    raise exception 'Insumo não disponível no estoque para esta sessão.' using errcode = '42501';
  end if;
  return kontrol_private.registrar_consumo_manual_insumo(
    p_insumo_id,p_operacao_id,p_revisao_esperada,p_quantidade_embalagens_mes,
    p_conteudo_embalagem_esperado,p_unidade_conteudo_esperada,p_apresentacao_confirmada,
    p_fonte,p_motivo,p_data_referencia);
end $$;

revoke all on function public.ler_consumo_manual_insumo(bigint,bigint,integer),
  public.registrar_consumo_manual_insumo(bigint,uuid,bigint,numeric,numeric,text,boolean,text,text,date),
  kontrol_private.registrar_consumo_manual_insumo(bigint,uuid,bigint,numeric,numeric,text,boolean,text,text,date)
  from public, anon, authenticated, service_role;
grant execute on function public.ler_consumo_manual_insumo(bigint,bigint,integer),
  public.registrar_consumo_manual_insumo(bigint,uuid,bigint,numeric,numeric,text,boolean,text,text,date),
  kontrol_private.registrar_consumo_manual_insumo(bigint,uuid,bigint,numeric,numeric,text,boolean,text,text,date)
  to authenticated;

commit;
