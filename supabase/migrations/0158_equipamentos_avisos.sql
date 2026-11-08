-- 0158 — avisos de manutenção e calibração de equipamentos.
--
-- Usa o que já existe (0052): planos de manutenção (periodicidade) e o
-- histórico de manutenções. Para cada unidade ativa e cada plano ativo,
-- calcula o próximo vencimento:
--   * a "próxima data" registrada na última manutenção concluída do tipo; ou
--   * a última conclusão do tipo + periodicidade do plano;
--   * sem nenhuma conclusão, o aviso é "sem registro".
-- O aviso aparece quando falta menos que a antecedência (do plano ou, sem
-- ela, do parâmetro equipamento_aviso_antecedencia_dias) e continua visível
-- até alguém encaminhar. Agendar a manutenção do tipo já conta como
-- encaminhado. Nada é bloqueado automaticamente: quem decide é a pessoa.
--
-- Aditivo: uma coluna opcional no plano, um parâmetro, uma tabela nova de
-- encaminhamentos (só inserção, auditada) e uma view SECURITY INVOKER.
-- Rollback: drop view public.v_equipamento_avisos; drop table
-- public.equipamento_aviso_encaminhamentos; alter table
-- public.equipamento_planos_manutencao drop column antecedencia_aviso_dias
-- (coluna nova, vazia até alguém preencher); delete do parâmetro.
begin;
set local lock_timeout = '10s';

alter table public.equipamento_planos_manutencao
  add column antecedencia_aviso_dias integer
    check (antecedencia_aviso_dias is null or antecedencia_aviso_dias between 0 and 730);
comment on column public.equipamento_planos_manutencao.antecedencia_aviso_dias is
  'Dias de antecedência do aviso para este plano. Vazio usa o parâmetro equipamento_aviso_antecedencia_dias.';

insert into public.parametros (chave, valor, unidade, descricao) values
  ('equipamento_aviso_antecedencia_dias', 90, 'dias',
   'Com quantos dias de antecedência o aviso de manutenção ou calibração aparece, quando o plano não define outro prazo.')
on conflict (chave) do nothing;

create table public.equipamento_aviso_encaminhamentos (
  id bigint generated always as identity primary key,
  equipamento_unidade_id bigint not null references public.equipamento_unidades(id) on delete cascade,
  tipo varchar(30) not null check (tipo in ('preventiva','corretiva','calibracao','qualificacao','verificacao','limpeza_tecnica')),
  -- Vencimento ao qual o encaminhamento se refere; vazio = "sem registro".
  vencimento date,
  decisao text not null check (decisao in ('agendar','em_andamento','fora_de_uso','dispensado','outro')),
  observacao text not null check (char_length(btrim(observacao)) between 1 and 1000),
  criado_por uuid not null default auth.uid(),
  criado_em timestamptz not null default now()
);
comment on table public.equipamento_aviso_encaminhamentos is
  'O que foi decidido sobre cada aviso de equipamento. Só inserção; um novo encaminhamento substitui o anterior na tela.';
create index equipamento_aviso_encaminhamentos_alvo_idx
  on public.equipamento_aviso_encaminhamentos (equipamento_unidade_id, tipo, vencimento, criado_em desc);

alter table public.equipamento_aviso_encaminhamentos enable row level security;
revoke all on table public.equipamento_aviso_encaminhamentos from public, anon, authenticated;
grant select, insert on table public.equipamento_aviso_encaminhamentos to authenticated;

create policy equipamento_aviso_encaminhamentos_leitura
  on public.equipamento_aviso_encaminhamentos for select to authenticated
  using (kontrol_private.tem_permissao_efetiva('estoque.ver') or kontrol_private.tem_permissao_efetiva('cadastros.ver'));
-- Mesma permissão que registra manutenções (0052).
create policy equipamento_aviso_encaminhamentos_insercao
  on public.equipamento_aviso_encaminhamentos for insert to authenticated
  with check (kontrol_private.tem_permissao_efetiva('cadastros.editar') and criado_por = auth.uid());

create trigger aud_equipamento_aviso_encaminhamentos
  after insert or update or delete on public.equipamento_aviso_encaminhamentos
  for each row execute function public.fn_auditoria();

create view public.v_equipamento_avisos with (security_invoker = true) as
with cfg as (
  select coalesce((select p.valor::integer from public.parametros p
                   where p.chave = 'equipamento_aviso_antecedencia_dias'), 90) as antecedencia,
         (now() at time zone 'America/Sao_Paulo')::date as hoje
), planos as (
  -- Plano da unidade vale sobre o plano do equipamento para o mesmo tipo.
  select distinct on (u.id, pl.tipo)
    u.id as equipamento_unidade_id, u.equipamento_id, pl.id as plano_id, pl.tipo::text as tipo,
    pl.periodicidade_dias, pl.tolerancia_dias, pl.obrigatorio, pl.antecedencia_aviso_dias
  from public.equipamento_unidades u
  join public.equipamento_planos_manutencao pl
    on pl.ativo and (pl.equipamento_unidade_id = u.id
                     or (pl.equipamento_unidade_id is null and pl.equipamento_id = u.equipamento_id))
  where u.ativo and u.status_operacional not in ('inativo', 'descartado')
  order by u.id, pl.tipo, (pl.equipamento_unidade_id is null), pl.id
), historico as (
  select p.*,
    (select m.data_conclusao from public.equipamento_manutencoes m
      where m.equipamento_unidade_id = p.equipamento_unidade_id and m.tipo = p.tipo
        and m.status = 'concluida' and m.data_conclusao is not null
      order by m.data_conclusao desc, m.id desc limit 1) as ultima_conclusao,
    (select m.proxima_data from public.equipamento_manutencoes m
      where m.equipamento_unidade_id = p.equipamento_unidade_id and m.tipo = p.tipo
        and m.status = 'concluida' and m.data_conclusao is not null
      order by m.data_conclusao desc, m.id desc limit 1) as proxima_registrada,
    (select m.data_programada from public.equipamento_manutencoes m
      where m.equipamento_unidade_id = p.equipamento_unidade_id and m.tipo = p.tipo
        and m.status in ('agendada', 'em_execucao')
      order by m.data_programada, m.id limit 1) as agendada_para
  from planos p
), calc as (
  select h.*,
    coalesce(h.proxima_registrada, h.ultima_conclusao + h.periodicidade_dias) as vencimento,
    coalesce(h.antecedencia_aviso_dias, cfg.antecedencia) as antecedencia_dias,
    cfg.hoje
  from historico h cross join cfg
), avisos as (
  select c.*,
    case
      when c.vencimento is null then 'sem_registro'
      when c.vencimento < c.hoje then 'vencido'
      when c.vencimento - c.antecedencia_dias <= c.hoje then 'proximo'
    end as situacao
  from calc c
)
select a.equipamento_unidade_id, a.equipamento_id, a.plano_id, a.tipo, a.obrigatorio,
  a.periodicidade_dias, a.tolerancia_dias, a.antecedencia_dias,
  a.ultima_conclusao, a.vencimento, a.situacao,
  case when a.vencimento is null then null else a.vencimento - a.hoje end as dias_para_vencer,
  a.agendada_para,
  e.decisao as encaminhamento_decisao, e.observacao as encaminhamento_observacao,
  e.criado_por as encaminhado_por, e.criado_em as encaminhado_em,
  (a.agendada_para is not null or e.id is not null) as encaminhado
from avisos a
left join lateral (
  select x.id, x.decisao, x.observacao, x.criado_por, x.criado_em
  from public.equipamento_aviso_encaminhamentos x
  where x.equipamento_unidade_id = a.equipamento_unidade_id and x.tipo = a.tipo
    and x.vencimento is not distinct from a.vencimento
  order by x.criado_em desc, x.id desc limit 1
) e on true
where a.situacao is not null;

comment on view public.v_equipamento_avisos is
  'Avisos de manutenção/calibração por unidade e tipo (0158). Encaminhado = manutenção agendada ou decisão registrada.';
revoke all on public.v_equipamento_avisos from public, anon;
grant select on public.v_equipamento_avisos to authenticated;

commit;
