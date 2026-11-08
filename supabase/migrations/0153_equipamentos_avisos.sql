-- ORD99. Depende da interface de permissões da 0151. Sem backfill, grants
-- de negócio, configuração inicial, abertura em leitura ou efeitos no equipamento.
begin;
set local lock_timeout = '5s';

-- Sem USAGE para papéis de API: os wrappers invoker têm o corpo SQL já
-- resolvido na criação (PG17); clientes não resolvem nomes do núcleo.
create schema kontrol_aviso_api;
revoke all on schema kontrol_aviso_api from public, anon, authenticated, service_role;

create table kontrol_private.equipamento_aviso_direitos (
  papel text not null check (kontrol_private.papel_catalogado(papel)),
  operacao text not null check (operacao in ('configurar','avaliar','reconhecer','encaminhar')),
  primary key (papel, operacao)
);

create table kontrol_private.equipamento_aviso_regras (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  equipamento_unidade_id bigint not null check (equipamento_unidade_id between 1 and 9007199254740991),
  tipo text not null check (tipo in ('preventiva','corretiva','calibracao','qualificacao','verificacao','limpeza_tecnica')),
  versao integer not null check (versao > 0),
  operacao_id uuid not null unique,
  ocorrencia_id bigint not null check (ocorrencia_id between 1 and 9007199254740991),
  data_referencia date not null check (data_referencia between date '0001-01-01' and date '9999-12-31'),
  antecedencia_dias integer not null check (antecedencia_dias >= 0),
  responsavel_id uuid not null,
  motivo text not null check (pg_catalog.btrim(motivo) <> ''),
  autor_id uuid not null,
  criado_em timestamptz not null default pg_catalog.statement_timestamp(),
  unique (equipamento_unidade_id, tipo, versao)
);
-- IDs de cadastros existentes são snapshots validados na transação. Não impor
-- cascata/veto novo a exclusões do legado, nem apagar a origem da trilha.

create table kontrol_private.equipamento_avisos (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  equipamento_unidade_id bigint not null,
  tipo text not null,
  ocorrencia_id bigint not null,
  regra_id uuid not null references kontrol_private.equipamento_aviso_regras(id),
  estado text not null check (estado in ('pendente','reconhecido','encaminhado')),
  aberto_em timestamptz not null default pg_catalog.statement_timestamp(),
  unique (equipamento_unidade_id, tipo, ocorrencia_id)
);
create index equipamento_avisos_regra_idx on kontrol_private.equipamento_avisos (regra_id);

-- Uma chave de operação identifica um único ator, ação e payload. Guardar o
-- resultado original permite replay mesmo depois de revisão/encaminhamento.
create table kontrol_private.equipamento_aviso_eventos (
  operacao_id uuid primary key,
  aviso_id uuid references kontrol_private.equipamento_avisos(id),
  acao text not null check (acao in ('configurar','avaliar','reconhecer','encaminhar','governar')),
  ator_id uuid not null,
  payload jsonb not null,
  resultado jsonb not null,
  criado_em timestamptz not null default pg_catalog.statement_timestamp()
);
create index equipamento_aviso_eventos_aviso_idx on kontrol_private.equipamento_aviso_eventos (aviso_id)
  where aviso_id is not null;

alter table kontrol_private.equipamento_aviso_direitos enable row level security;
alter table kontrol_private.equipamento_aviso_regras enable row level security;
alter table kontrol_private.equipamento_avisos enable row level security;
alter table kontrol_private.equipamento_aviso_eventos enable row level security;
revoke all on table kontrol_private.equipamento_aviso_direitos, kontrol_private.equipamento_aviso_regras,
  kontrol_private.equipamento_avisos, kontrol_private.equipamento_aviso_eventos
  from public, anon, authenticated, service_role;

create function kontrol_private.aviso_bloquear_reescrita()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'Histórico de avisos é append-only.' using errcode = '42501';
end $$;
create trigger equipamento_aviso_regras_imutaveis before update or delete or truncate
  on kontrol_private.equipamento_aviso_regras for each statement
  execute function kontrol_private.aviso_bloquear_reescrita();
create trigger equipamento_aviso_eventos_imutaveis before update or delete or truncate
  on kontrol_private.equipamento_aviso_eventos for each statement
  execute function kontrol_private.aviso_bloquear_reescrita();

create function kontrol_private.aviso_ator()
returns uuid language plpgsql stable set search_path = '' as $$
declare
  v_ator uuid := auth.uid();
  v_sessao text := auth.jwt() ->> 'session_id';
begin
  if v_ator is null or auth.jwt() ->> 'role' is distinct from 'authenticated'
     or auth.jwt() ->> 'is_anonymous' = 'true'
     or v_sessao is null or v_sessao !~ '^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$' then
    raise exception 'Avisos não acessíveis para esta sessão e escopo.' using errcode = '42501';
  end if;
  if not exists (select 1 from auth.sessions s where s.id = v_sessao::uuid
    and s.user_id = v_ator and (s.not_after is null or s.not_after > pg_catalog.statement_timestamp()))
    or not exists (select 1 from public.perfis p where p.id = v_ator
      and not p.suspenso and not p.senha_provisoria and kontrol_private.papel_catalogado(p.papel)) then
    raise exception 'Avisos não acessíveis para esta sessão e escopo.' using errcode = '42501';
  end if;
  return v_ator;
end $$;

-- Invoker: preservar o RLS real do cadastro na entrada da API. O núcleo
-- privado repete a guarda independente do estoque e da identidade da unidade.
create function kontrol_private.aviso_unidade_visivel(p_unidade_id bigint)
returns bigint language plpgsql stable security invoker set search_path = '' as $$
begin
  if p_unidade_id is null or p_unidade_id not between 1 and 9007199254740991
     or not kontrol_private.tem_permissao_efetiva('estoque.ver')
     or not exists (select 1 from public.equipamento_unidades u where u.id = p_unidade_id) then
    raise exception 'Avisos não acessíveis para esta sessão e escopo.' using errcode = '42501';
  end if;
  return p_unidade_id;
end $$;

create function kontrol_private.aviso_direito(p_ator uuid, p_operacao text)
returns boolean language sql stable set search_path = '' as $$
  select exists (
    select 1 from public.perfis p
    join kontrol_private.equipamento_aviso_direitos d on d.papel = p.papel
    where p.id = p_ator and not p.suspenso and not p.senha_provisoria and d.operacao = p_operacao
  );
$$;

-- Evidência produzida dentro do wrapper invoker, nunca recebida pela API.
-- Sem FOR SHARE aqui: leitura por RLS não depende de permissão de edição.
create function kontrol_private.aviso_origens_visiveis(p_unidade_id bigint, p_tipo text, p_ocorrencia_id bigint)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  v_unidade bigint := kontrol_private.aviso_unidade_visivel(p_unidade_id);
  v_origens jsonb;
begin
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'id', m.id, 'tipo', m.tipo, 'status', m.status, 'proxima_data', m.proxima_data,
    'xmin_token', m.xmin::text, 'ctid_token', m.ctid::text
  )), '[]'::jsonb) into v_origens
  from public.equipamento_manutencoes m
  where m.equipamento_unidade_id = v_unidade
    and (p_tipo is null or m.tipo = p_tipo)
    and (p_ocorrencia_id is null or m.id = p_ocorrencia_id);
  return v_origens;
end $$;

create function kontrol_aviso_api.ler_contextos_avisos(p_unidade_id bigint, p_origens_visiveis jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_ator uuid := kontrol_private.aviso_ator();
  v_hoje date := pg_catalog.timezone('America/Sao_Paulo', pg_catalog.statement_timestamp())::date;
  v_permissoes jsonb;
  v_contextos jsonb;
begin
  perform kontrol_private.aviso_unidade_visivel(p_unidade_id);
  v_permissoes := pg_catalog.jsonb_build_object(
    'configurar', kontrol_private.aviso_direito(v_ator, 'configurar'),
    'avaliar', kontrol_private.aviso_direito(v_ator, 'avaliar'),
    'reconhecer', kontrol_private.aviso_direito(v_ator, 'reconhecer'),
    'encaminhar', kontrol_private.aviso_direito(v_ator, 'encaminhar'));
  with origens as (
    select m.* from pg_catalog.jsonb_to_recordset(p_origens_visiveis)
      as m(id bigint, tipo text, status text, proxima_data date)
  )
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'equipamento_unidade_id', p_unidade_id, 'tipo', t.tipo, 'hoje_sp', v_hoje,
    'permissoes', v_permissoes,
    'regra', case when r.id is not null and m.id is null then '{"estado":"indisponivel"}'::jsonb
      else pg_catalog.jsonb_build_object('estado', 'confirmada', 'dado',
      case when r.id is not null then pg_catalog.jsonb_build_object(
        'id', r.id, 'versao', r.versao, 'equipamento_unidade_id', r.equipamento_unidade_id,
        'tipo', r.tipo, 'ocorrencia_id', r.ocorrencia_id, 'data_referencia', r.data_referencia,
        'antecedencia_dias', r.antecedencia_dias) end) end,
    'origem', case when r.id is not null and m.id is null then '{"estado":"indisponivel"}'::jsonb
      else pg_catalog.jsonb_build_object('estado', 'confirmada', 'dado',
      case when m.id is not null then pg_catalog.jsonb_build_object(
        'id', m.id, 'equipamento_unidade_id', p_unidade_id, 'tipo', m.tipo,
        'status', m.status, 'proxima_data', m.proxima_data) end) end,
    'avisos', pg_catalog.jsonb_build_object('estado', 'confirmada', 'dado', a.dados)
  ) order by t.tipo), '[]'::jsonb) into v_contextos
  from (
    select s.tipo from origens s
    union
    select s.tipo from kontrol_private.equipamento_aviso_regras s where s.equipamento_unidade_id = p_unidade_id
  ) t
  left join lateral (
    select s.* from kontrol_private.equipamento_aviso_regras s
    where s.equipamento_unidade_id = p_unidade_id and s.tipo = t.tipo order by s.versao desc limit 1
  ) r on true
  left join origens m on m.id = r.ocorrencia_id and m.tipo = t.tipo
  cross join lateral (
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id', n.id, 'ocorrencia_id', n.ocorrencia_id, 'regra_id', n.regra_id,
      'data_referencia', h.data_referencia, 'responsavel_id', h.responsavel_id,
      'aberto_em', n.aberto_em, 'estado', n.estado
    ) order by n.aberto_em desc, n.id), '[]'::jsonb) as dados
    from kontrol_private.equipamento_avisos n join kontrol_private.equipamento_aviso_regras h on h.id = n.regra_id
    where n.equipamento_unidade_id = p_unidade_id and n.tipo = t.tipo
  ) a;
  return v_contextos;
end $$;

-- Escrita única, sem SQL dinâmico. Wrappers públicos nomeados e tipados
-- delimitam o RPC; ator, data civil e estado efetivo são do servidor.
create function kontrol_aviso_api.operar_aviso_equipamento(
  p_acao text, p_unidade_id bigint, p_tipo text, p_operacao_id uuid, p_dados jsonb,
  p_origens_visiveis jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_ator uuid := kontrol_private.aviso_ator();
  v_hoje date := pg_catalog.timezone('America/Sao_Paulo', pg_catalog.statement_timestamp())::date;
  v_payload jsonb := pg_catalog.jsonb_build_object('unidade_id', p_unidade_id, 'tipo', p_tipo, 'dados', p_dados);
  v_evento kontrol_private.equipamento_aviso_eventos%rowtype;
  v_regra kontrol_private.equipamento_aviso_regras%rowtype;
  v_aviso kontrol_private.equipamento_avisos%rowtype;
  v_origem record;
  v_ocorrencia bigint;
  v_referencia date;
  v_dias integer;
  v_esperada integer;
  v_responsavel uuid;
  v_aviso_id uuid;
  v_estado_esperado text;
  v_estado_novo text;
  v_motivo text := pg_catalog.btrim(p_dados ->> 'motivo');
  v_destino text := pg_catalog.btrim(p_dados ->> 'destino');
  v_papel text;
  v_direito text;
  v_concedido boolean;
  v_atual boolean;
  v_divergencia text;
  v_resultado jsonb;
begin
  if p_operacao_id is null or p_acao is null
     or p_acao not in ('configurar','avaliar','reconhecer','encaminhar','governar')
     or pg_catalog.jsonb_typeof(p_dados) is distinct from 'object' then
    raise exception 'Operação de aviso inválida.' using errcode = '22023';
  end if;
  -- Mesmo isolamento exigido pela 0151: novo snapshot depois da trava de CAS.
  if pg_catalog.current_setting('transaction_isolation') not in ('read committed','read uncommitted') then
    raise exception 'Avisos exigem leitura atual para mutação.' using errcode = '25000';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(153, pg_catalog.hashtext(p_operacao_id::text));
  perform 1 from public.perfis p where p.id = v_ator and not p.suspenso and not p.senha_provisoria for share;
  if not found then raise exception 'Avisos não acessíveis para esta sessão e escopo.' using errcode = '42501'; end if;

  if p_acao = 'governar' then
    if not kontrol_private.tem_permissao_efetiva('privilegios.gerenciar') then
      raise exception 'Governança de avisos não autorizada.' using errcode = '42501';
    end if;
  else
    perform kontrol_private.aviso_unidade_visivel(p_unidade_id);
    perform 1 from kontrol_private.equipamento_aviso_direitos d
      join public.perfis p on p.papel = d.papel where p.id = v_ator and d.operacao = p_acao for share of d;
    if not found then
      raise exception 'Operação de aviso não concedida à função.' using errcode = '42501';
    end if;
    if p_tipo is null
      or p_tipo not in ('preventiva','corretiva','calibracao','qualificacao','verificacao','limpeza_tecnica') then
      raise exception 'Escopo de aviso inválido.' using errcode = '22023';
    end if;
  end if;

  select e.* into v_evento from kontrol_private.equipamento_aviso_eventos e where e.operacao_id = p_operacao_id;
  if found then
    if v_evento.ator_id is distinct from v_ator or v_evento.acao is distinct from p_acao
       or v_evento.payload is distinct from v_payload then
      raise exception 'Identificador de operação já usado com outro payload.' using errcode = '40001';
    end if;
    -- Replay não é uma concessão permanente de leitura da origem. Conferir
    -- a ocorrência da versão original, não a versão vigente de outro ciclo.
    if p_acao in ('configurar','avaliar') then
      select r.ocorrencia_id into v_ocorrencia
      from kontrol_private.equipamento_aviso_regras r
      where r.equipamento_unidade_id = p_unidade_id and r.tipo = p_tipo
        and r.versao = (p_dados ->> 'versao_esperada')::integer
          + case when p_acao = 'configurar' then 1 else 0 end;
      if found then
        perform 1 from pg_catalog.jsonb_to_recordset(p_origens_visiveis)
          as s(id bigint, tipo text, xmin_token text, ctid_token text)
          join public.equipamento_manutencoes m
            on m.id = s.id and m.tipo = s.tipo and m.equipamento_unidade_id = p_unidade_id
              and m.xmin::text = s.xmin_token and m.ctid::text = s.ctid_token
          where s.id = v_ocorrencia and s.tipo = p_tipo for share of m;
        if not found then
          raise exception 'Origem não acessível para replay nesta sessão e escopo.' using errcode = '42501';
        end if;
      elsif p_acao = 'configurar' or (p_dados ->> 'versao_esperada')::integer <> 0 then
        raise exception 'Origem do replay não confirmada.' using errcode = '42501';
      end if;
      -- Avaliação original sem configuração (versão zero) não tem origem.
    end if;
    return v_evento.resultado;
  end if;

  if p_acao = 'governar' then
    v_papel := p_dados ->> 'papel';
    v_direito := p_dados ->> 'operacao';
    v_concedido := (p_dados ->> 'concedido')::boolean;
    if not kontrol_private.papel_catalogado(v_papel) or v_direito is null
       or v_direito not in ('configurar','avaliar','reconhecer','encaminhar')
       or v_concedido is null or p_dados ->> 'concessao_esperada' is null or coalesce(v_motivo, '') = '' then
      raise exception 'Alteração de direito de aviso inválida.' using errcode = '22023';
    end if;
    perform pg_catalog.pg_advisory_xact_lock(-153, pg_catalog.hashtext('direito:' || v_papel || ':' || v_direito));
    select exists(select 1 from kontrol_private.equipamento_aviso_direitos d
      where d.papel = v_papel and d.operacao = v_direito) into v_atual;
    if v_atual is distinct from (p_dados ->> 'concessao_esperada')::boolean then
      raise exception 'Concessão divergiu; releia a configuração.' using errcode = '40001';
    end if;
    if v_concedido and not v_atual then
      insert into kontrol_private.equipamento_aviso_direitos(papel, operacao) values (v_papel, v_direito);
    elsif not v_concedido and v_atual then
      delete from kontrol_private.equipamento_aviso_direitos d where d.papel = v_papel and d.operacao = v_direito;
    end if;
    v_resultado := pg_catalog.jsonb_build_object('estado', 'direito_registrado', 'papel', v_papel,
      'operacao', v_direito, 'concessao_anterior', v_atual, 'concedido', v_concedido);
  else
    -- ponytail: serialização por par, inclusive primeira versão. Colisão de
    -- hash só serializa pares independentes; não altera suas identidades.
    perform pg_catalog.pg_advisory_xact_lock(-153, pg_catalog.hashtext('unidade:' || p_unidade_id || ':' || p_tipo));
    perform 1 from public.equipamento_unidades u where u.id = p_unidade_id for key share;
    if not found then raise exception 'Avisos não acessíveis para esta sessão e escopo.' using errcode = '42501'; end if;
    if p_acao in ('configurar','avaliar') then
      v_esperada := (p_dados ->> 'versao_esperada')::integer;
      if v_esperada is null or v_esperada < 0 then
        raise exception 'Informe a versão esperada; zero indica ausência confirmada.' using errcode = '22023';
      end if;
      select r.* into v_regra from kontrol_private.equipamento_aviso_regras r
        where r.equipamento_unidade_id = p_unidade_id and r.tipo = p_tipo order by r.versao desc limit 1;
      if coalesce(v_regra.versao, 0) <> v_esperada then
        raise exception 'Versão de aviso divergiu; releia a configuração.' using errcode = '40001';
      end if;

      if p_acao = 'configurar' then
        v_ocorrencia := (p_dados ->> 'ocorrencia_id')::bigint;
        v_referencia := (p_dados ->> 'data_referencia')::date;
        v_dias := (p_dados ->> 'antecedencia_dias')::integer;
        v_responsavel := (p_dados ->> 'responsavel_id')::uuid;
        if v_ocorrencia is null or v_ocorrencia not between 1 and 9007199254740991
           or v_referencia is null or v_referencia not between date '0001-01-01' and date '9999-12-31'
           or v_dias is null or v_dias < 0 or v_responsavel is null or coalesce(v_motivo, '') = '' then
          raise exception 'Referência, antecedência explícita, responsável e motivo são obrigatórios.' using errcode = '22023';
        end if;
        perform 1 from public.perfis p where p.id = v_responsavel and not p.suspenso for share;
        if not found then raise exception 'Responsável não disponível.' using errcode = '22023'; end if;
      elsif v_regra.id is null then
        v_resultado := pg_catalog.jsonb_build_object('estado', 'nao_configurado');
      else
        v_ocorrencia := v_regra.ocorrencia_id;
        v_referencia := v_regra.data_referencia;
        v_dias := v_regra.antecedencia_dias;
      end if;

      if v_resultado is null then
        select s.* into v_origem from pg_catalog.jsonb_to_recordset(p_origens_visiveis)
          as s(id bigint, tipo text, status text, proxima_data date, xmin_token text, ctid_token text)
          where s.id = v_ocorrencia and s.tipo = p_tipo;
        if not found then
          raise exception 'Origem não acessível para esta sessão e escopo.' using errcode = '42501';
        end if;
        -- O owner só trava a mesma versão vista pelo invoker. Se a linha foi
        -- trocada enquanto a RPC aguardava, não reler dados com RLS elevado.
        perform 1 from public.equipamento_manutencoes m
          where m.id = v_ocorrencia and m.equipamento_unidade_id = p_unidade_id and m.tipo = p_tipo
            and m.xmin::text = v_origem.xmin_token and m.ctid::text = v_origem.ctid_token for share;
        if not found then
          raise exception 'Origem mudou durante a operação; releia o contexto.' using errcode = '40001';
        end if;
        v_divergencia := case
          when v_origem.status = 'cancelada' then 'origem_cancelada'
          when v_origem.proxima_data is null then 'proxima_data_nao_informada'
          when v_origem.proxima_data not between date '0001-01-01' and date '9999-12-31' then 'proxima_data_invalida'
          when v_origem.proxima_data <> v_referencia then 'proxima_data_alterada'
        end;
        if v_divergencia is not null then
          if p_acao = 'configurar' then
            raise exception 'Referência da ocorrência não confirmada.' using errcode = '40001', detail = v_divergencia;
          end if;
          v_resultado := pg_catalog.jsonb_build_object('estado',
            case when v_divergencia = 'proxima_data_invalida' then 'indisponivel' else 'referencia_alterada' end,
            'motivo', v_divergencia);
        elsif p_acao = 'configurar' then
          insert into kontrol_private.equipamento_aviso_regras
            (equipamento_unidade_id, tipo, versao, operacao_id, ocorrencia_id, data_referencia,
             antecedencia_dias, responsavel_id, motivo, autor_id)
          values (p_unidade_id, p_tipo, v_esperada + 1, p_operacao_id, v_ocorrencia, v_referencia,
            v_dias, v_responsavel, v_motivo, v_ator)
          returning * into v_regra;
          v_resultado := pg_catalog.jsonb_build_object('estado', 'configurada', 'regra_id', v_regra.id,
            'versao', v_regra.versao, 'ocorrencia_id', v_ocorrencia, 'data_referencia', v_referencia,
            'antecedencia_dias', v_dias);
        elsif v_referencia - v_hoje > v_dias then
          v_resultado := pg_catalog.jsonb_build_object('estado', 'fora_janela', 'data_referencia', v_referencia);
        else
          insert into kontrol_private.equipamento_avisos (equipamento_unidade_id, tipo, ocorrencia_id, regra_id, estado)
          values (p_unidade_id, p_tipo, v_ocorrencia, v_regra.id, 'pendente')
          on conflict (equipamento_unidade_id, tipo, ocorrencia_id) do nothing returning * into v_aviso;
          if found then
            v_resultado := pg_catalog.jsonb_build_object('estado', 'aberto', 'estado_anterior', null,
              'estado_novo', 'pendente', 'aviso_id', v_aviso.id, 'regra_id', v_aviso.regra_id);
          else
            select n.* into strict v_aviso from kontrol_private.equipamento_avisos n
              where n.equipamento_unidade_id = p_unidade_id and n.tipo = p_tipo and n.ocorrencia_id = v_ocorrencia;
            v_resultado := pg_catalog.jsonb_build_object('estado', 'ja_existente', 'estado_atual', v_aviso.estado,
              'aviso_id', v_aviso.id, 'regra_id', v_aviso.regra_id);
          end if;
          v_aviso_id := v_aviso.id;
        end if;
      end if;
    else
      v_aviso_id := (p_dados ->> 'aviso_id')::uuid;
      v_estado_esperado := p_dados ->> 'estado_esperado';
      if v_aviso_id is null or v_estado_esperado is null or v_estado_esperado not in ('pendente','reconhecido')
         or (p_acao = 'reconhecer' and v_estado_esperado <> 'pendente')
         or coalesce(v_motivo, '') = '' or (p_acao = 'encaminhar' and coalesce(v_destino, '') = '') then
        raise exception 'Aviso, estado esperado, motivo e destino quando aplicável são obrigatórios.' using errcode = '22023';
      end if;
      select n.* into v_aviso from kontrol_private.equipamento_avisos n
        where n.id = v_aviso_id and n.equipamento_unidade_id = p_unidade_id and n.tipo = p_tipo for update;
      if not found then raise exception 'Aviso não encontrado no escopo.' using errcode = 'P0002'; end if;
      if v_aviso.estado is distinct from v_estado_esperado then
        raise exception 'Estado do aviso divergiu; releia o aviso.' using errcode = '40001';
      end if;
      v_estado_novo := case p_acao when 'reconhecer' then 'reconhecido' else 'encaminhado' end;
      update kontrol_private.equipamento_avisos set estado = v_estado_novo where id = v_aviso_id;
      v_resultado := pg_catalog.jsonb_build_object('estado', v_estado_novo, 'estado_anterior', v_estado_esperado,
        'estado_novo', v_estado_novo, 'aviso_id', v_aviso_id, 'regra_id', v_aviso.regra_id);
    end if;
  end if;

  insert into kontrol_private.equipamento_aviso_eventos (operacao_id, aviso_id, acao, ator_id, payload, resultado)
  values (p_operacao_id, v_aviso_id, p_acao, v_ator, v_payload, v_resultado);
  return v_resultado;
end $$;

create function public.contextos_avisos_equipamento(p_unidade_id bigint)
returns jsonb language sql stable security invoker set search_path = ''
return kontrol_aviso_api.ler_contextos_avisos(p_unidade_id,
  kontrol_private.aviso_origens_visiveis(p_unidade_id, null, null));

create function public.configurar_aviso_equipamento(
  p_unidade_id bigint, p_tipo text, p_versao_esperada integer, p_ocorrencia_id bigint,
  p_data_referencia date, p_antecedencia_dias integer, p_responsavel_id uuid, p_motivo text, p_operacao_id uuid
) returns jsonb language sql security invoker set search_path = ''
return kontrol_aviso_api.operar_aviso_equipamento('configurar', p_unidade_id,
    p_tipo, p_operacao_id, pg_catalog.jsonb_build_object('versao_esperada', p_versao_esperada,
    'ocorrencia_id', p_ocorrencia_id, 'data_referencia', p_data_referencia, 'antecedencia_dias', p_antecedencia_dias,
    'responsavel_id', p_responsavel_id, 'motivo', p_motivo),
  kontrol_private.aviso_origens_visiveis(p_unidade_id, p_tipo, p_ocorrencia_id));

create function public.avaliar_aviso_equipamento(
  p_unidade_id bigint, p_tipo text, p_versao_esperada integer, p_operacao_id uuid
) returns jsonb language sql security invoker set search_path = ''
return kontrol_aviso_api.operar_aviso_equipamento('avaliar', p_unidade_id,
    p_tipo, p_operacao_id, pg_catalog.jsonb_build_object('versao_esperada', p_versao_esperada),
  kontrol_private.aviso_origens_visiveis(p_unidade_id, p_tipo, null));

create function public.reconhecer_aviso_equipamento(
  p_unidade_id bigint, p_tipo text, p_aviso_id uuid, p_estado_esperado text, p_motivo text, p_operacao_id uuid
) returns jsonb language sql security invoker set search_path = ''
return kontrol_aviso_api.operar_aviso_equipamento('reconhecer', kontrol_private.aviso_unidade_visivel(p_unidade_id),
    p_tipo, p_operacao_id, pg_catalog.jsonb_build_object('aviso_id', p_aviso_id,
    'estado_esperado', p_estado_esperado, 'motivo', p_motivo), '[]'::jsonb);

create function public.encaminhar_aviso_equipamento(
  p_unidade_id bigint, p_tipo text, p_aviso_id uuid, p_estado_esperado text, p_motivo text,
  p_destino text, p_operacao_id uuid
) returns jsonb language sql security invoker set search_path = ''
return kontrol_aviso_api.operar_aviso_equipamento('encaminhar', kontrol_private.aviso_unidade_visivel(p_unidade_id),
    p_tipo, p_operacao_id, pg_catalog.jsonb_build_object('aviso_id', p_aviso_id,
    'estado_esperado', p_estado_esperado, 'motivo', p_motivo, 'destino', p_destino), '[]'::jsonb);

-- Entrada restrita à autoridade de governança já catalogada na 0151.
-- Não integra o catálogo central, não aceita conta-alvo e não semeia papéis.
create function public.governar_direito_aviso_equipamento(
  p_papel text, p_operacao text, p_concessao_esperada boolean, p_concedido boolean,
  p_motivo text, p_operacao_id uuid
) returns jsonb language sql security invoker set search_path = ''
return kontrol_aviso_api.operar_aviso_equipamento('governar', null, null, p_operacao_id,
    pg_catalog.jsonb_build_object('papel', p_papel, 'operacao', p_operacao,
    'concessao_esperada', p_concessao_esperada, 'concedido', p_concedido, 'motivo', p_motivo), '[]'::jsonb);

revoke all on function kontrol_private.aviso_bloquear_reescrita(), kontrol_private.aviso_ator(),
  kontrol_private.aviso_direito(uuid,text)
  from public, anon, authenticated, service_role;
revoke all on function
  kontrol_private.aviso_unidade_visivel(bigint), kontrol_private.aviso_origens_visiveis(bigint,text,bigint),
  kontrol_aviso_api.ler_contextos_avisos(bigint,jsonb),
  kontrol_aviso_api.operar_aviso_equipamento(text,bigint,text,uuid,jsonb,jsonb),
  public.contextos_avisos_equipamento(bigint),
  public.configurar_aviso_equipamento(bigint,text,integer,bigint,date,integer,uuid,text,uuid),
  public.avaliar_aviso_equipamento(bigint,text,integer,uuid),
  public.reconhecer_aviso_equipamento(bigint,text,uuid,text,text,uuid),
  public.encaminhar_aviso_equipamento(bigint,text,uuid,text,text,text,uuid),
  public.governar_direito_aviso_equipamento(text,text,boolean,boolean,text,uuid)
  from public, anon, authenticated, service_role;
grant execute on function
  kontrol_private.aviso_unidade_visivel(bigint), kontrol_private.aviso_origens_visiveis(bigint,text,bigint),
  kontrol_aviso_api.ler_contextos_avisos(bigint,jsonb),
  kontrol_aviso_api.operar_aviso_equipamento(text,bigint,text,uuid,jsonb,jsonb),
  public.contextos_avisos_equipamento(bigint),
  public.configurar_aviso_equipamento(bigint,text,integer,bigint,date,integer,uuid,text,uuid),
  public.avaliar_aviso_equipamento(bigint,text,integer,uuid),
  public.reconhecer_aviso_equipamento(bigint,text,uuid,text,text,uuid),
  public.encaminhar_aviso_equipamento(bigint,text,uuid,text,text,text,uuid),
  public.governar_direito_aviso_equipamento(text,text,boolean,boolean,text,uuid)
  to authenticated;
commit;
