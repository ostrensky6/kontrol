-- Documento da proposta: empresas emissoras, textos padrão por seção e textos
-- editáveis por proposta e por versão emitida (reorganização do módulo
-- Orçamentos, 28/09; docs/superpowers/specs/2026-09-28-reorganizacao-modulo-orcamentos-design.md §4).
--
-- O que muda e por quê:
--
--  1. public.empresas_emissoras: dados de quem emite a proposta (ATGC e GIA):
--     nome legal, CNPJ, endereço, telefone, e-mail e site, para o cabeçalho
--     do documento. Semeada com as duas empresas (nomes legais da
--     identidade-institucional.ts; demais campos vazios, preenchidos em
--     Cadastros). Leitura para qualquer usuário autenticado; escrita com
--     "cadastros.editar"; auditada.
--  2. public.proposta_secoes_padrao: textos padrão das seções do documento
--     por empresa (prazos, responsabilidades, condições comerciais,
--     confidencialidade), em texto formatado (JSON, subconjunto do TipTap).
--     Semeada para ATGC e GIA; escrita com "orcamentos.emitir"; auditada.
--  3. demandas_propostas ganha e-mail, telefone e endereço do cliente e
--     textos_proposta (textos editados da proposta em elaboração).
--     Condições de pagamento ficam no texto da seção "Condições comerciais".
--  4. orcamento_final_versoes.textos_proposta: textos editados depois da
--     emissão (nulo = usar os do snapshot). O gatilho de imutabilidade
--     (proteger_orcamento_final_emitido) não protege esta coluna, e a escrita
--     direta continua bloqueada pelas políticas restritivas da 0101: só o
--     RPC atualizar_textos_versao_final grava, com "orcamentos.emitir",
--     versão viva (emitido, enviado, alterado_reenviado) e dentro da validade.
--     O gatilho aud_orcamento_final_versoes registra cada alteração.
--  5. ler_orcamento_publico passa a devolver versao.textos_proposta (o link
--     público mostra o texto editado). Corpo idêntico ao vigente (0126), com
--     os grants da 0132 (só service_role).
--
-- Impacto: aditiva. Não remove tabelas, colunas, dados, RLS nem gatilhos de
-- auditoria; nenhum dado existente é alterado. As colunas novas nascem nulas.
-- atualizado_em das tabelas novas é gravado pelo app (não há gatilho genérico
-- de "tocar" no repositório).
--
-- Rollback: reaplicar ler_orcamento_publico da 0126 (com os grants da 0132);
-- drop function public.atualizar_textos_versao_final(bigint, jsonb);
-- drop table public.proposta_secoes_padrao; drop table public.empresas_emissoras;
-- alter table public.demandas_propostas drop column cliente_email,
--   drop column cliente_telefone, drop column cliente_endereco,
--   drop column textos_proposta;
-- alter table public.orcamento_final_versoes drop column textos_proposta.
-- Se já houver dados nas colunas/tabelas novas, exportá-los antes.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if to_regprocedure('kontrol_private.exigir_permissao(text)') is null
    or to_regprocedure('kontrol_private.tem_permissao_efetiva(text)') is null
    or to_regprocedure('kontrol_private.senha_provisoria_pendente()') is null
    or to_regprocedure('public.fn_auditoria()') is null then
    raise exception '0135: requer as migrations 0124, 0128 e 0132';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. Empresas emissoras
-- ---------------------------------------------------------------------------
create table if not exists public.empresas_emissoras (
  id bigint generated always as identity primary key,
  codigo text not null unique check (codigo in ('ATGC', 'GIA')),
  nome_legal text not null check (btrim(nome_legal) <> ''),
  cnpj text,
  endereco text,
  telefone text,
  email text,
  site text,
  atualizado_em timestamptz not null default now()
);

comment on table public.empresas_emissoras is
  'Empresa que emite a proposta (ATGC ou GIA): dados do cabeçalho do documento. Editada em Cadastros (0135).';
comment on column public.empresas_emissoras.codigo is
  'ATGC ou GIA; o mesmo código da identidade institucional do app.';

alter table public.empresas_emissoras enable row level security;
revoke all on table public.empresas_emissoras from anon, public;
grant select, insert, update, delete on table public.empresas_emissoras to authenticated;
grant all on table public.empresas_emissoras to service_role;

drop policy if exists perm_read_empresas_emissoras on public.empresas_emissoras;
drop policy if exists perm_insert_empresas_emissoras on public.empresas_emissoras;
drop policy if exists perm_update_empresas_emissoras on public.empresas_emissoras;
drop policy if exists perm_delete_empresas_emissoras on public.empresas_emissoras;
create policy perm_read_empresas_emissoras on public.empresas_emissoras
  for select to authenticated using (true);
create policy perm_insert_empresas_emissoras on public.empresas_emissoras
  for insert to authenticated
  with check (kontrol_private.tem_permissao_efetiva('cadastros.editar'));
create policy perm_update_empresas_emissoras on public.empresas_emissoras
  for update to authenticated
  using (kontrol_private.tem_permissao_efetiva('cadastros.editar'))
  with check (kontrol_private.tem_permissao_efetiva('cadastros.editar'));
create policy perm_delete_empresas_emissoras on public.empresas_emissoras
  for delete to authenticated
  using (kontrol_private.tem_permissao_efetiva('cadastros.editar'));

drop trigger if exists aud_empresas_emissoras on public.empresas_emissoras;
create trigger aud_empresas_emissoras
  after insert or update or delete on public.empresas_emissoras
  for each row execute function public.fn_auditoria();

insert into public.empresas_emissoras (codigo, nome_legal)
values ('ATGC', 'ATGC Genética Ambiental Ltda.'),
       ('GIA', 'Grupo Integrado de Aquicultura e Estudos Ambientais')
on conflict (codigo) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Textos padrão das seções da proposta, por empresa
-- ---------------------------------------------------------------------------
create table if not exists public.proposta_secoes_padrao (
  id bigint generated always as identity primary key,
  empresa_codigo text not null references public.empresas_emissoras(codigo),
  chave text not null check (chave ~ '^[a-z0-9_]{2,40}$'),
  titulo text not null check (length(trim(titulo)) between 2 and 120),
  texto jsonb not null default '{"type":"doc","content":[]}'::jsonb
    check (jsonb_typeof(texto) = 'object'),
  ordem integer not null default 100,
  ativo boolean not null default true,
  atualizado_em timestamptz not null default now(),
  unique (empresa_codigo, chave)
);

comment on table public.proposta_secoes_padrao is
  'Texto padrão de cada seção do documento da proposta, por empresa emissora. Editado em Parâmetros do orçamento (0135).';
comment on column public.proposta_secoes_padrao.chave is
  'Identificador estável da seção (prazos, responsabilidades, condicoes, confidencialidade ou criada pelo administrador).';
comment on column public.proposta_secoes_padrao.texto is
  'Texto formatado (JSON, subconjunto do TipTap: doc, paragraph, heading nível 3, bulletList, orderedList, listItem, hardBreak, text com bold).';
comment on column public.proposta_secoes_padrao.ordem is
  'Ordem da seção no documento (menor primeiro).';

alter table public.proposta_secoes_padrao enable row level security;
revoke all on table public.proposta_secoes_padrao from anon, public;
grant select, insert, update, delete on table public.proposta_secoes_padrao to authenticated;
grant all on table public.proposta_secoes_padrao to service_role;

drop policy if exists perm_read_proposta_secoes_padrao on public.proposta_secoes_padrao;
drop policy if exists perm_insert_proposta_secoes_padrao on public.proposta_secoes_padrao;
drop policy if exists perm_update_proposta_secoes_padrao on public.proposta_secoes_padrao;
drop policy if exists perm_delete_proposta_secoes_padrao on public.proposta_secoes_padrao;
create policy perm_read_proposta_secoes_padrao on public.proposta_secoes_padrao
  for select to authenticated using (true);
create policy perm_insert_proposta_secoes_padrao on public.proposta_secoes_padrao
  for insert to authenticated
  with check (kontrol_private.tem_permissao_efetiva('orcamentos.emitir'));
create policy perm_update_proposta_secoes_padrao on public.proposta_secoes_padrao
  for update to authenticated
  using (kontrol_private.tem_permissao_efetiva('orcamentos.emitir'))
  with check (kontrol_private.tem_permissao_efetiva('orcamentos.emitir'));
create policy perm_delete_proposta_secoes_padrao on public.proposta_secoes_padrao
  for delete to authenticated
  using (kontrol_private.tem_permissao_efetiva('orcamentos.emitir'));

drop trigger if exists aud_proposta_secoes_padrao on public.proposta_secoes_padrao;
create trigger aud_proposta_secoes_padrao
  after insert or update or delete on public.proposta_secoes_padrao
  for each row execute function public.fn_auditoria();

insert into public.proposta_secoes_padrao (empresa_codigo, chave, titulo, texto, ordem)
select e.codigo, s.chave, s.titulo, s.texto, s.ordem
from public.empresas_emissoras e
cross join (values
  ('prazos', 'Prazos e entregas', 10, $json${"type":"doc","content":[
    {"type":"paragraph","content":[{"type":"text","text":"Os prazos contam a partir do recebimento das amostras no laboratório, em condições adequadas para análise, e do aceite desta proposta."}]},
    {"type":"bulletList","content":[
      {"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"O relatório técnico é entregue dentro do prazo técnico informado nesta proposta."}]}]},
      {"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"Amostras recebidas fora das condições combinadas (volume, conservação, temperatura ou identificação) podem ser recusadas; nesse caso, o prazo recomeça no novo envio."}]}]},
      {"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"Os resultados são enviados em formato digital ao contato indicado pelo cliente."}]}]}
    ]}
  ]}$json$::jsonb),
  ('responsabilidades', 'Responsabilidades das partes', 20, $json${"type":"doc","content":[
    {"type":"bulletList","content":[
      {"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"Cliente: coleta, acondicionamento, transporte e identificação das amostras, conforme as orientações do laboratório, salvo quando a coleta for contratada nesta proposta."}]}]},
      {"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"Cliente: informações necessárias à análise (origem, data de coleta e finalidade) e acesso aos locais de coleta, quando houver trabalho de campo."}]}]},
      {"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"Laboratório: recebimento, conservação e análise das amostras pelos métodos descritos, com controle de qualidade e rastreabilidade."}]}]},
      {"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"Laboratório: guarda das amostras remanescentes e dos registros da análise, conforme a seção de confidencialidade e resultados."}]}]}
    ]}
  ]}$json$::jsonb),
  ('condicoes', 'Condições comerciais', 30, $json${"type":"doc","content":[
    {"type":"paragraph","content":[{"type":"text","text":"Pagamento: 50% na aprovação da proposta e 50% na entrega do relatório, salvo acordo diferente."}]},
    {"type":"bulletList","content":[
      {"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"Impostos inclusos no valor total."}]}]},
      {"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"Alterações de escopo, quantidade de amostras, premissas técnicas ou cronograma podem exigir nova versão da proposta."}]}]}
    ]}
  ]}$json$::jsonb),
  ('confidencialidade', 'Confidencialidade e resultados', 40, $json${"type":"doc","content":[
    {"type":"bulletList","content":[
      {"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"Dados, amostras e resultados são tratados com sigilo e só são informados ao cliente ou a quem ele autorizar por escrito."}]}]},
      {"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"Os resultados valem apenas para as amostras analisadas e destinam-se ao uso do cliente."}]}]},
      {"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"Amostras remanescentes ficam guardadas por 90 dias após a entrega do relatório e depois são descartadas conforme as normas ambientais e de biossegurança; os registros da análise são mantidos pelo prazo do sistema de qualidade do laboratório."}]}]}
    ]}
  ]}$json$::jsonb)
) as s(chave, titulo, ordem, texto)
where e.codigo in ('ATGC', 'GIA')
on conflict (empresa_codigo, chave) do nothing;

-- ---------------------------------------------------------------------------
-- 3. Proposta em elaboração: contato do cliente e textos editados
-- ---------------------------------------------------------------------------
alter table public.demandas_propostas
  add column if not exists cliente_email text,
  add column if not exists cliente_telefone text,
  add column if not exists cliente_endereco text,
  add column if not exists textos_proposta jsonb;

comment on column public.demandas_propostas.cliente_email is
  'E-mail do cliente para o documento da proposta (0135).';
comment on column public.demandas_propostas.cliente_telefone is
  'Telefone do cliente para o documento da proposta (0135).';
comment on column public.demandas_propostas.cliente_endereco is
  'Endereço do cliente para o documento da proposta (0135).';
comment on column public.demandas_propostas.textos_proposta is
  'Textos editados do documento desta proposta (descrição e seções, texto formatado). Nulo = textos padrão da empresa emissora. Copiados para o snapshot na emissão (0135).';

-- ---------------------------------------------------------------------------
-- 4. Versão emitida: textos editáveis pelo RPC
-- ---------------------------------------------------------------------------
alter table public.orcamento_final_versoes
  add column if not exists textos_proposta jsonb;

comment on column public.orcamento_final_versoes.textos_proposta is
  'Textos do documento editados depois da emissão (descrição e seções). Nulo = usar os do snapshot. Grava só por atualizar_textos_versao_final (0135).';

create or replace function public.atualizar_textos_versao_final(p_versao_id bigint, p_textos jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_versao record;
begin
  perform kontrol_private.exigir_permissao('orcamentos.emitir');

  if p_versao_id is null or p_textos is null or jsonb_typeof(p_textos) <> 'object' then
    raise exception 'Textos da proposta inválidos.' using errcode = '22023';
  end if;
  if octet_length(p_textos::text) > 200000 then
    raise exception 'Textos da proposta muito longos: reduza o texto e tente de novo.' using errcode = '22023';
  end if;

  select v.id, v.status, v.valido_ate
    into v_versao
    from public.orcamento_final_versoes v
   where v.id = p_versao_id
   for update;
  if not found then
    raise exception 'Proposta não encontrada.' using errcode = 'P0002';
  end if;
  if v_versao.status not in ('emitido', 'enviado', 'alterado_reenviado') then
    raise exception 'Só dá para editar os textos de proposta emitida ou enviada, ainda não aprovada.'
      using errcode = '22023';
  end if;
  if v_versao.valido_ate is not null and v_versao.valido_ate < current_date then
    raise exception 'Proposta vencida: emita uma nova versão para mudar os textos.' using errcode = '22023';
  end if;

  -- O dono da função (dono da tabela) não passa pelas políticas restritivas
  -- da 0101; o gatilho de imutabilidade não protege textos_proposta.
  update public.orcamento_final_versoes
     set textos_proposta = p_textos
   where id = p_versao_id;

  return jsonb_build_object('id', p_versao_id, 'status', v_versao.status);
end $$;

comment on function public.atualizar_textos_versao_final(bigint, jsonb) is
  'Grava os textos editados do documento na própria versão emitida (sem novo número). Exige orcamentos.emitir, versão emitida/enviada/alterada e dentro da validade (0135).';

revoke all on function public.atualizar_textos_versao_final(bigint, jsonb) from public, anon;
grant execute on function public.atualizar_textos_versao_final(bigint, jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Link público devolve os textos editados (corpo da 0126 + textos_proposta)
-- ---------------------------------------------------------------------------
create or replace function public.ler_orcamento_publico(p_token text)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'pg_catalog', 'public', 'extensions'
as $function$
declare
  v_payload jsonb;
begin
  select jsonb_build_object(
           'snapshot', v.snapshot,
           'orcamento', v.snapshot,
           'versao', jsonb_build_object(
             'id', v.id,
             'numero', v.numero,
             'versao', v.versao,
             'status', v.status,
             'valido_ate', v.valido_ate,
             'total_final', v.total_final,
             'textos_proposta', v.textos_proposta
           ),
           'vencida', v.status = 'vencido' or (v.valido_ate is not null and v.valido_ate < current_date),
           'aprovado_em', l.aprovado_em,
           'aprovado_por', l.aprovado_por
         )
    into v_payload
    from public.orcamento_projeto_links l
    join public.orcamento_final_versoes v
      on v.id = l.orcamento_final_versao_id
    left join public.orcamento_projetos p
      on p.id = l.orcamento_projeto_id
     and p.demanda_id = v.demanda_id
   where l.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
     and not l.revogado
     and (l.expira_em is null or l.expira_em > now())
     and (l.orcamento_projeto_id is null or (p.id is not null and p.status not in ('recusado', 'cancelado')))
     and v.status in ('emitido', 'enviado', 'alterado_reenviado', 'aprovado', 'vencido')
   limit 1;

  return v_payload;
end
$function$;

-- Mesmos grants da 0132: leitura do link só pelo servidor do app.
revoke all on function public.ler_orcamento_publico(text) from public, anon, authenticated;
grant execute on function public.ler_orcamento_publico(text) to service_role;

commit;
