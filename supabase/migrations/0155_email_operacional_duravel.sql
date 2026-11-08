-- ORD109: transporte operacional de e-mail, protocolo v1 (ORD85/95/104).
-- Corte: parar o dispatcher legado antes de habilitar o novo; não há backfill.
begin;
set local lock_timeout = '5s';

-- Um transporte (e-mail), uma versão inicial por aviso. Não há API para reenvio.
create table kontrol_private.email_operacional_v1 (
  notificacao_id bigint not null references public.notificacoes(id) on delete restrict,
  versao bigint not null default 1 check (versao = 1),
  contexto jsonb not null,
  -- Autorização operacional por aviso/versão, não fornecida pelo dispatcher.
  -- NULL por padrão; somente o proprietário do banco pode provisionar, sob
  -- ordem própria, destinatários de fallback para aviso SEM destino definido.
  -- Nenhuma RPC/grant permite ao cliente ou service_role escrever esta coluna.
  fallback_destinatarios_autorizados text[],
  estado text not null default 'PENDENTE' check (estado in (
    'PENDENTE', 'POST_INICIADO', 'INCERTO', 'REVISAO_NECESSARIA',
    'RECUSA_CONFIRMADA', 'ACEITO_MARCADOR_PENDENTE', 'ACEITE_REGISTRADO'
  )),
  operacao_id uuid unique,
  geracao bigint not null default 0,
  payload text,
  payload_sha256 text,
  chave_idempotencia text unique,
  post_iniciado_em timestamptz,
  lease_ate timestamptz,
  resultado text,
  codigo_http integer,
  id_provedor uuid,
  resultado_em timestamptz,
  primary key (notificacao_id, versao),
  check (
    (operacao_id is null and geracao = 0 and payload is null and payload_sha256 is null
      and chave_idempotencia is null and post_iniciado_em is null and lease_ate is null
      and estado in ('PENDENTE','REVISAO_NECESSARIA'))
    or (operacao_id is not null and geracao = 1 and payload is not null and payload_sha256 is not null
      and chave_idempotencia is not null and post_iniciado_em is not null and lease_ate is not null
      and lease_ate > post_iniciado_em and estado <> 'PENDENTE')
  ),
  check (resultado is null or resultado in ('ACEITO','RECUSA_CONFIRMADA','INCERTO','REVISAO_NECESSARIA')),
  check (codigo_http is null or codigo_http between 200 and 599)
);
alter table kontrol_private.email_operacional_v1 enable row level security;
revoke all on table kontrol_private.email_operacional_v1 from public, anon, authenticated, service_role;
create index email_operacional_v1_pendentes_idx
  on kontrol_private.email_operacional_v1(notificacao_id) where estado = 'PENDENTE';

-- Contexto da versão: o resolver de destinatários continua sendo o da 0146.
-- A projeção de transporte não divulga os campos de destino.
create function kontrol_private.contexto_email_operacional_v1(p_n public.notificacoes)
returns jsonb language sql stable set search_path = '' set timezone = 'UTC' as $$
  select pg_catalog.jsonb_build_object(
    'id', p_n.id, 'tipo', p_n.tipo, 'titulo', p_n.titulo, 'corpo', p_n.corpo,
    'entidade_tipo', p_n.entidade_tipo, 'entidade_id', p_n.entidade_id, 'criado_em', p_n.criado_em,
    'usuario_destino', p_n.usuario_destino, 'papel_destino', p_n.papel_destino,
    'permissao_destino', p_n.permissao_destino, 'canal', p_n.canal
  );
$$;

create function kontrol_private.enfileirar_email_operacional_v1()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- Apenas INSERT efetivo. Não transformar importação com sinal legado em envio.
  if new.status <> 'arquivada' and new.email_enviado_em is null
     and new.email_tentativas = 0 and new.email_erro is null then
    insert into kontrol_private.email_operacional_v1(notificacao_id, contexto)
    values (new.id, kontrol_private.contexto_email_operacional_v1(new));
  end if;
  return new;
end $$;

create trigger enfileirar_email_operacional_v1
  after insert on public.notificacoes for each row
  execute function kontrol_private.enfileirar_email_operacional_v1();

create function public.listar_email_operacional_v1(p_limite integer)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_resultado jsonb;
begin
  if p_limite is null or p_limite not between 1 and 20 then
    raise exception 'Limite de candidatos inválido.' using errcode = '22023';
  end if;
  select coalesce(pg_catalog.jsonb_agg(
    (q.contexto - array['usuario_destino','papel_destino','permissao_destino','canal'])
      || pg_catalog.jsonb_build_object('versao', q.versao) order by q.criado_em, q.notificacao_id
  ), '[]'::jsonb) into v_resultado
  from (
    select e.notificacao_id, e.versao, e.contexto, n.criado_em
    from kontrol_private.email_operacional_v1 e
    join public.notificacoes n on n.id = e.notificacao_id
    where e.estado = 'PENDENTE' and n.status <> 'arquivada'
      and n.email_enviado_em is null and n.email_tentativas = 0 and n.email_erro is null
    order by n.criado_em, e.notificacao_id limit p_limite
  ) q;
  return v_resultado;
end $$;

create function public.iniciar_post_email_operacional_v1(
  p_notificacao_id bigint, p_versao bigint, p_operacao_id uuid, p_payload text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_negada jsonb := pg_catalog.jsonb_build_object(
    'notificacao_id', p_notificacao_id, 'versao', p_versao, 'operacao_id', p_operacao_id, 'autorizou_post', false);
  v_n public.notificacoes%rowtype;
  v_e kontrol_private.email_operacional_v1%rowtype;
  v_envelope jsonb;
  v_inicio timestamptz;
  v_destino_atual text[];
begin
  if p_notificacao_id is null or p_notificacao_id <= 0 or p_versao is distinct from 1::bigint
    or p_operacao_id is null or p_payload is null then
    raise exception 'Identidade ou envelope inválido.' using errcode = '22023';
  end if;
  begin
    v_envelope := p_payload::jsonb;
  exception when data_exception then
    raise exception 'Envelope inválido.' using errcode = '22023';
  end;
  if pg_catalog.jsonb_typeof(v_envelope) is distinct from 'object'
    or pg_catalog.jsonb_typeof(v_envelope -> 'from') is distinct from 'string'
    or nullif(pg_catalog.btrim(v_envelope ->> 'from'), '') is null
    or pg_catalog.jsonb_typeof(v_envelope -> 'to') is distinct from 'array'
    or pg_catalog.jsonb_typeof(v_envelope -> 'subject') is distinct from 'string'
    or pg_catalog.jsonb_typeof(v_envelope -> 'html') is distinct from 'string'
    or (v_envelope - array['from','to','subject','html']) <> '{}'::jsonb then
    raise exception 'Envelope inválido.' using errcode = '22023';
  end if;
  if pg_catalog.jsonb_array_length(v_envelope -> 'to') = 0 or exists (
    select 1 from pg_catalog.jsonb_array_elements(v_envelope -> 'to') as d(valor)
    where pg_catalog.jsonb_typeof(d.valor) is distinct from 'string'
      or (d.valor #>> '{}') !~ '^[^[:space:]@<>,;]+@[^[:space:]@<>,;]+$'
  ) then
    raise exception 'Envelope inválido.' using errcode = '22023';
  end if;

  -- Ordem de locks compartilhada com a finalização: aviso, depois transporte.
  select n.* into v_n from public.notificacoes n where n.id = p_notificacao_id for update;
  if not found or v_n.status = 'arquivada' or v_n.email_enviado_em is not null
    or v_n.email_tentativas <> 0 or v_n.email_erro is not null then return v_negada; end if;
  select e.* into v_e from kontrol_private.email_operacional_v1 e
    where e.notificacao_id = p_notificacao_id and e.versao = p_versao for update;
  if not found or v_e.estado <> 'PENDENTE' then return v_negada; end if;
  if v_e.contexto is distinct from kontrol_private.contexto_email_operacional_v1(v_n)
    or (v_envelope ->> 'subject') is distinct from ('[Kontrol] ' || v_n.titulo) then
    update kontrol_private.email_operacional_v1 set estado = 'REVISAO_NECESSARIA'
      where notificacao_id = p_notificacao_id and versao = p_versao;
    return v_negada;
  end if;
  -- Resolução vazia não dispensa autorização: pode representar revogação.
  -- Fallback exige autorização privada da versão E aviso sem destino definido;
  -- NOTIFICATION_EMAIL_TO/flags do chamador não são prova de autorização.
  select pg_catalog.array_agg(d.email order by d.email) into v_destino_atual
    from public.destinatarios_notificacao(p_notificacao_id) d(email);
  if v_destino_atual is null then
    if v_n.usuario_destino is not null or v_n.papel_destino is not null
      or v_n.permissao_destino is not null then return v_negada; end if;
    select pg_catalog.array_agg(d.email order by d.email) into v_destino_atual
      from pg_catalog.unnest(v_e.fallback_destinatarios_autorizados) d(email);
  end if;
  if v_destino_atual is distinct from (
    select pg_catalog.array_agg(d.email order by d.email)
      from pg_catalog.jsonb_array_elements_text(v_envelope -> 'to') d(email)
  ) then return v_negada; end if;

  v_inicio := pg_catalog.clock_timestamp();
  begin
    update kontrol_private.email_operacional_v1 e
      set estado = 'POST_INICIADO', operacao_id = p_operacao_id, geracao = e.geracao + 1,
        payload = p_payload,
        payload_sha256 = pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_payload, 'UTF8')), 'hex'),
        chave_idempotencia = 'kontrol-email-v1:' || p_operacao_id::text,
        post_iniciado_em = v_inicio, lease_ate = v_inicio + interval '60 seconds'
      where e.notificacao_id = p_notificacao_id and e.versao = p_versao and e.estado = 'PENDENTE'
      returning e.* into v_e;
    if not found then return v_negada; end if;
  exception when unique_violation then
    -- UUID concorrente/reutilizado jamais libera outro POST; erro sem envelope.
    return v_negada;
  end;
  return v_negada || pg_catalog.jsonb_build_object(
    'autorizou_post', true, 'estado', v_e.estado, 'geracao', v_e.geracao,
    'lease_ate', v_e.lease_ate, 'chave_idempotencia', v_e.chave_idempotencia,
    'payload_sha256', v_e.payload_sha256);
end $$;

create function public.registrar_resultado_email_operacional_v1(
  p_notificacao_id bigint, p_versao bigint, p_operacao_id uuid, p_geracao bigint,
  p_resultado text, p_codigo_http integer, p_id_provedor uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_e kontrol_private.email_operacional_v1%rowtype;
  v_agora timestamptz;
  v_marcador timestamptz;
  v_recusas constant integer[] := array[400,401,403,404,405,413,415,422];
begin
  if p_notificacao_id is null or p_notificacao_id <= 0 or p_versao is distinct from 1::bigint
    or p_operacao_id is null or p_geracao is distinct from 1::bigint
    or (p_id_provedor is not null and p_resultado is distinct from 'ACEITO')
    or not coalesce(case p_resultado
      when 'ACEITO' then p_codigo_http between 200 and 299
      when 'RECUSA_CONFIRMADA' then p_codigo_http = any(v_recusas)
      when 'REVISAO_NECESSARIA' then p_codigo_http = 409
      when 'INCERTO' then p_codigo_http is null or
        (p_codigo_http between 300 and 599 and p_codigo_http <> 409 and not (p_codigo_http = any(v_recusas)))
      else false end, false) then
    raise exception 'Resultado de transporte inválido.' using errcode = '22023';
  end if;

  perform 1 from public.notificacoes n where n.id = p_notificacao_id for update;
  select e.* into v_e from kontrol_private.email_operacional_v1 e
    where e.notificacao_id = p_notificacao_id and e.versao = p_versao for update;
  if not found or v_e.operacao_id is distinct from p_operacao_id or v_e.geracao is distinct from p_geracao then
    raise exception 'Posse não confirmada.' using errcode = '42501';
  end if;
  v_agora := pg_catalog.clock_timestamp();
  if v_e.estado = 'POST_INICIADO' then
    if v_e.lease_ate <= v_agora then
      -- A projeção deriva INCERTO do prazo vencido; não reabre a fila.
      raise exception 'Posse expirada; reconciliação necessária.' using errcode = '42501';
    end if;
    update kontrol_private.email_operacional_v1 e set
      estado = case when p_resultado = 'ACEITO' then 'ACEITO_MARCADOR_PENDENTE' else p_resultado end,
      resultado = p_resultado, codigo_http = p_codigo_http, id_provedor = p_id_provedor, resultado_em = v_agora
      where e.notificacao_id = p_notificacao_id and e.versao = p_versao returning e.* into v_e;

    if p_resultado = 'ACEITO' then
      -- Subtransação: só confirma registro se o próprio marcador foi gravado.
      -- Falha ordinária deixa evidência de aceite sem marcar entrega ou liberar POST.
      begin
        update public.notificacoes set email_enviado_em = v_agora,
          email_erro = null, email_tentativas = email_tentativas + 1
          where id = p_notificacao_id and email_enviado_em is null
          returning email_enviado_em into v_marcador;
        if found then
          if v_marcador is distinct from v_agora then
            raise exception 'Marcador não confirmado.';
          end if;
          update kontrol_private.email_operacional_v1 e set estado = 'ACEITE_REGISTRADO'
            where e.notificacao_id = p_notificacao_id and e.versao = p_versao returning e.* into v_e;
        end if;
      exception when others then
        -- Não persistir SQLERRM: pode conter detalhes privados. Sem retry nesta RPC.
        v_e.estado := 'ACEITO_MARCADOR_PENDENTE';
      end;
    end if;
  elsif (v_e.resultado, v_e.codigo_http, v_e.id_provedor)
      is distinct from (p_resultado, p_codigo_http, p_id_provedor) then
    raise exception 'Resultado já registrado com outra evidência.' using errcode = '40001';
  end if;
  -- Replay idêntico de resultado é somente leitura, inclusive após lease vencido.
  return pg_catalog.jsonb_build_object(
    'notificacao_id', p_notificacao_id, 'versao', p_versao, 'operacao_id', p_operacao_id,
    'geracao', p_geracao, 'estado', v_e.estado, 'marcador_confirmado', v_e.estado = 'ACEITE_REGISTRADO');
end $$;

-- SELECT por coluna e sob a mesma RLS da view invoker. Nenhum papel de app
-- recebe payload, IDs externos ou DML na tabela privada.
create policy email_operacional_v1_projecao on kontrol_private.email_operacional_v1
  for select to authenticated using (
    (select auth.uid()) is not null and exists (
      select 1 from public.v_minhas_notificacoes n
      where n.id = email_operacional_v1.notificacao_id and n.status <> 'arquivada'
    )
  );
grant select (notificacao_id, estado, lease_ate)
  on table kontrol_private.email_operacional_v1 to authenticated;

create function public.meus_estados_email_operacional_v1(p_notificacao_ids bigint[])
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  v_resultado jsonb;
begin
  if auth.uid() is null then raise exception 'Sessão inválida.' using errcode = '42501'; end if;
  if p_notificacao_ids is null or pg_catalog.cardinality(p_notificacao_ids) > 80
    or exists (select 1 from pg_catalog.unnest(p_notificacao_ids) i(id) where i.id is null or i.id <= 0) then
    raise exception 'Recorte de avisos inválido.' using errcode = '22023';
  end if;
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'notificacao_id', v.id,
    'estado', case
      when e.estado = 'POST_INICIADO' and e.lease_ate <= pg_catalog.statement_timestamp() then 'INCERTO'
      when e.estado = 'POST_INICIADO' then 'PENDENTE'
      when e.estado = 'PENDENTE' and (n.status = 'arquivada' or n.email_enviado_em is not null
        or n.email_tentativas <> 0 or n.email_erro is not null) then 'REVISAO_NECESSARIA'
      when e.estado is not null then e.estado
      when n.email_enviado_em is not null then 'ACEITE_REGISTRADO'
      else 'REVISAO_NECESSARIA' -- Legado sem marcador não prova que nunca houve aceite.
    end
  ) order by v.id), '[]'::jsonb) into v_resultado
  from public.v_minhas_notificacoes v
  join public.notificacoes n on n.id = v.id
  left join kontrol_private.email_operacional_v1 e on e.notificacao_id = v.id
  where v.id = any(p_notificacao_ids) and v.status <> 'arquivada';
  return v_resultado;
end $$;

revoke all on function kontrol_private.contexto_email_operacional_v1(public.notificacoes),
  kontrol_private.enfileirar_email_operacional_v1(),
  public.listar_email_operacional_v1(integer),
  public.iniciar_post_email_operacional_v1(bigint,bigint,uuid,text),
  public.registrar_resultado_email_operacional_v1(bigint,bigint,uuid,bigint,text,integer,uuid),
  public.meus_estados_email_operacional_v1(bigint[])
  from public, anon, authenticated, service_role;
grant execute on function public.listar_email_operacional_v1(integer),
  public.iniciar_post_email_operacional_v1(bigint,bigint,uuid,text),
  public.registrar_resultado_email_operacional_v1(bigint,bigint,uuid,bigint,text,integer,uuid)
  to service_role;
grant execute on function public.meus_estados_email_operacional_v1(bigint[]) to authenticated;

comment on table kontrol_private.email_operacional_v1 is
  'Estado durável inicial. POST_INICIADO e lease vencido nunca se tornam candidatos. Aceite não comprova entrega.';

commit;
