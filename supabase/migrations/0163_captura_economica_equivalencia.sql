-- ORD156: autoria local; não aplicada. Não emite/aprova nem cria projeto/plano.
-- 0101/0154/0160/0161 e caminhos legados permanecem intactos.
begin;
set local lock_timeout = '5s';

-- Recibo econômico imutável, não outro cadastro de equivalência.
create table kontrol_private.orcamento_capturas_equivalencia (
  operacao_id uuid primary key,
  orcamento_id bigint not null references public.orcamentos(id),
  ator_id uuid not null,
  entrada jsonb not null,
  snapshot jsonb not null,
  recibo jsonb not null,
  criado_em timestamptz not null default clock_timestamp()
);
alter table kontrol_private.orcamento_capturas_equivalencia enable row level security;
create index orcamento_capturas_equivalencia_orcamento_idx
  on kontrol_private.orcamento_capturas_equivalencia(orcamento_id);
revoke all on kontrol_private.orcamento_capturas_equivalencia from public,anon,authenticated,service_role;

-- ORD160: origem transitória privada, não configuração de sessão nem catálogo.
-- Só o executor insere após autorizar/calcular; remove antes de retornar.
-- Erro/rollback remove a inserção junto com os efeitos. Nenhum setter de API.
create table kontrol_private.orcamento_captura_em_curso (
  backend_pid integer not null,
  transacao_id bigint not null,
  orcamento_id bigint not null,
  ator_id uuid not null,
  operacao_id uuid not null,
  snapshot jsonb not null,
  primary key (backend_pid,transacao_id,orcamento_id)
);
alter table kontrol_private.orcamento_captura_em_curso enable row level security;
revoke all on kontrol_private.orcamento_captura_em_curso from public,anon,authenticated,service_role;

create function kontrol_private.captura_equivalencia_imutavel()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'Captura econômica histórica é imutável.' using errcode='42501';
end $$;
create trigger captura_equivalencia_imutavel before update or delete or truncate
on kontrol_private.orcamento_capturas_equivalencia for each statement
execute function kontrol_private.captura_equivalencia_imutavel();
revoke all on function kontrol_private.captura_equivalencia_imutavel() from public,anon,authenticated,service_role;

-- A função é privada: só recebe seletores, nunca preços ou JSON de cálculo.
-- O chamador mantém os locks de fonte até gravar o snapshot/recibo.
create function kontrol_private.calcular_captura_equivalencia_v1(
  p_codigo text, p_metodo text, p_amostras bigint
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  f jsonb; d jsonb; n record; e record; i record; c record; a record;
  opcoes jsonb; melhor jsonb; linha jsonb; fontes jsonb := '[]';
  rastro jsonb := '[]'; proveniencia jsonb := '[]'; etapas jsonb; params jsonb; fontes_equip jsonb := '[]';
  equipamento_contexto jsonb; equipamento_primeiro boolean;
  lote double precision; lote_n double precision; exec_dia double precision;
  quantidade double precision; bruto double precision; normalizado double precision;
  total double precision; reagentes double precision := 0; equip_dia double precision := 0;
  equipamento double precision; horas double precision; pessoal_h double precision;
  overhead_h double precision; pessoal double precision; overhead double precision;
  custo double precision; preco double precision; fatores double precision; dias double precision;
  fonte text; referencia text; base_etapas jsonb; totais jsonb; composicao jsonb;
begin
  if p_amostras is null or p_amostras<1 or p_amostras>9007199254740991 then
    raise exception 'CAPTURA_FONTE_INCOMPLETA' using errcode='22023';
  end if;
  f := public.ler_equivalencia_contextual_v1(p_codigo,p_metodo);
  if f->>'estado' is distinct from 'disponivel'
     or not exists(select 1 from public.analises where codigo=p_codigo and ativo and ofertavel) then
    raise exception 'CAPTURA_CONTEXTO_DIVERGENTE' using errcode='22023';
  end if;
  select jsonb_agg(to_jsonb(t) order by t.id) into etapas from public.etapas t where codigo_analise=p_codigo;
  if etapas is null or exists(select 1 from jsonb_array_elements(etapas) x where
    jsonb_typeof(x->'execucoes_por_dia') is distinct from 'number'
    or jsonb_typeof(x->'amostras_por_execucao') is distinct from 'number'
    or jsonb_typeof(x->'tempo_bancada_h') is distinct from 'number'
    or jsonb_typeof(x->'tempo_maquina_h') is distinct from 'number'
    or (x->>'execucoes_por_dia')::numeric<=0 or (x->>'amostras_por_execucao')::numeric<=0
    or trunc((x->>'amostras_por_execucao')::numeric)<>(x->>'amostras_por_execucao')::numeric
    or trunc((x->>'execucoes_por_dia')::numeric)<>(x->>'execucoes_por_dia')::numeric
    or (x->>'tempo_bancada_h')::numeric<0 or (x->>'tempo_maquina_h')::numeric<0) then
    raise exception 'CAPTURA_LOTE_INCOMPLETO' using errcode='22023';
  end if;
  -- Mesma base do engine: laboratório; fallback todas; Qubit só se não houver outra.
  select jsonb_agg(x) into base_etapas from jsonb_array_elements(etapas) x
  where coalesce(x->>'escopo_operacional','')<>'pos_analise'
    and concat(x->>'nome_etapa',' ',x->>'nome_atividade') !~* 'bioinform';
  base_etapas:=coalesce(base_etapas,etapas);
  select coalesce(jsonb_agg(x) filter(where coalesce(x->>'nome_atividade','') !~* 'qubit'),base_etapas)
    into base_etapas from jsonb_array_elements(base_etapas) x;
  select min((x->>'amostras_por_execucao')::double precision),
         min((x->>'execucoes_por_dia')::double precision),
         sum((x->>'tempo_bancada_h')::double precision * ceil(p_amostras::double precision/(x->>'amostras_por_execucao')::double precision))
    into lote,exec_dia,horas from jsonb_array_elements(base_etapas) x;
  select jsonb_object_agg(chave,valor) into params from public.parametros where chave in
    ('dias_uteis_ano','margem_lucro','impostos','taxas','fundo_reserva','fundo_investimento');
  if params is null or (select count(*) from jsonb_each(params))<>6
     or exists(select 1 from jsonb_each(params) x where jsonb_typeof(x.value)<>'number' or x.value::text::numeric<0)
     or (params->>'dias_uteis_ano')::numeric<=0 then
    raise exception 'CAPTURA_PARAMETROS_INCOMPLETOS' using errcode='22023';
  end if;
  dias:=(params->>'dias_uteis_ano')::double precision;
  fatores:=((params->>'margem_lucro')::double precision+(params->>'impostos')::double precision
    +(params->>'taxas')::double precision+(params->>'fundo_reserva')::double precision
    +(params->>'fundo_investimento')::double precision)/100;
  -- Ausência não é gratuidade. Zero só é aceito de linhas explicitamente cadastradas.
  if not exists(select 1 from public.tecnicos where ativo) or exists(select 1 from public.tecnicos t where ativo and
    (jsonb_typeof(to_jsonb(t)->'valor_mes') is distinct from 'number'
     or jsonb_typeof(to_jsonb(t)->'horas_mes_base') is distinct from 'number'
     or jsonb_typeof(to_jsonb(t)->'percentual_dedicado') is distinct from 'number'
     or valor_mes<0 or horas_mes_base<=0 or percentual_dedicado not between 0 and 100))
     or not exists(select 1 from public.overhead) or exists(select 1 from public.overhead t where
    jsonb_typeof(to_jsonb(t)->'custo_mensal') is distinct from 'number'
    or jsonb_typeof(to_jsonb(t)->'horas_bancada_mes') is distinct from 'number'
    or jsonb_typeof(to_jsonb(t)->'percentual_compensada') is distinct from 'number'
    or custo_mensal<0 or horas_bancada_mes<=0 or percentual_compensada not between 0 and 100) then
    raise exception 'CAPTURA_FONTE_INCOMPLETA' using errcode='22023';
  end if;
  pessoal_h:=public.valor_hora_pessoal_total()::double precision;
  select sum(custo_mensal::double precision/horas_bancada_mes::double precision*percentual_compensada::double precision/100)
    into overhead_h from public.overhead;
  if exists(select 1 from public.equipamento_analise where codigo_analise=p_codigo group by equipamento_id having count(*)<>1) then
    raise exception 'CAPTURA_EQUIPAMENTO_AMBIGUO' using errcode='22023';
  end if;
  for a in select * from public.equipamento_analise where codigo_analise=p_codigo order by equipamento_id loop
    select * into e from public.equipamentos where id=a.equipamento_id;
    if not found or a.peso_alocacao is null or a.peso_alocacao<=0
       or e.quantidade is null or e.quantidade<=0 or e.custo_unitario is null or e.custo_unitario<0
       or e.vida_util_anos is null or e.vida_util_anos<=0
       or (e.manutencao_anual_fixa is null and e.percentual_manutencao_anual is null)
       or e.manutencao_anual_fixa<0 or e.percentual_manutencao_anual<0 then
      raise exception 'CAPTURA_EQUIPAMENTO_INCOMPLETO' using errcode='22023';
    end if;
    if jsonb_typeof(to_jsonb(a.peso_alocacao)) is distinct from 'number'
       or jsonb_typeof(to_jsonb(e.quantidade)) is distinct from 'number'
       or jsonb_typeof(to_jsonb(e.custo_unitario)) is distinct from 'number'
       or jsonb_typeof(to_jsonb(e.vida_util_anos)) is distinct from 'number'
       or (e.manutencao_anual_fixa is not null and jsonb_typeof(to_jsonb(e.manutencao_anual_fixa))<>'number')
       or (e.percentual_manutencao_anual is not null and jsonb_typeof(to_jsonb(e.percentual_manutencao_anual))<>'number') then
      raise exception 'CAPTURA_EQUIPAMENTO_INCOMPLETO' using errcode='22023';
    end if;
    equip_dia:=equip_dia+a.peso_alocacao::double precision*(
      e.quantidade::double precision*e.custo_unitario::double precision/e.vida_util_anos::double precision
      +coalesce(e.manutencao_anual_fixa::double precision,
        e.quantidade::double precision*e.custo_unitario::double precision*e.percentual_manutencao_anual::double precision))/dias;
    fontes_equip:=fontes_equip||jsonb_build_array(jsonb_build_object('equipamento_id',e.id,'peso',a.peso_alocacao,
      'quantidade',e.quantidade,'custo_unitario',e.custo_unitario,'vida_util_anos',e.vida_util_anos,
      'manutencao_anual_fixa',e.manutencao_anual_fixa,'percentual_manutencao_anual',e.percentual_manutencao_anual));
  end loop;
  if not exists(select 1 from public.insumo_analise where codigo_analise=p_codigo) then
    raise exception 'CAPTURA_RECEITA_INCOMPLETA' using errcode='22023';
  end if;
  for n in select * from public.insumo_analise where codigo_analise=p_codigo order by id loop
    if n.quantidade_por_amostra is null or n.quantidade_por_amostra<=0
       or n.modo_cobranca is null or n.modo_cobranca not in ('por_amostra','por_execucao')
       or nullif(btrim(n.unidade),'') is null or nullif(btrim(n.grupo_escolha),'') is not null
       or (n.base_calculo is not null and n.base_calculo<>n.modo_cobranca) then
      raise exception 'CAPTURA_RECEITA_INCOMPLETA' using errcode='22023';
    end if;
    lote_n:=lote;
    if n.etapa_id is not null then
      select amostras_por_execucao into lote_n from public.etapas where id=n.etapa_id and codigo_analise=p_codigo;
      if not found then raise exception 'CAPTURA_LOTE_INCOMPLETO' using errcode='22023'; end if;
    end if;
    quantidade:=n.quantidade_por_amostra::double precision * case n.modo_cobranca
      when 'por_execucao' then ceil(p_amostras::double precision/lote_n) else p_amostras::double precision end;
    opcoes:='[]'; melhor:=null; equipamento_primeiro:=true;
    for d in select x from jsonb_array_elements(f->'decisoes') x
      where (x->>'necessidade_id')::bigint=n.id and x->'etapa_id' is not distinct from coalesce(to_jsonb(n.etapa_id),'null'::jsonb)
        and x->>'estado'='validada' and (x->>'vigente_desde')::numeric<=(f->>'instante')::numeric
        and (x->>'vigente_ate' is null or (x->>'vigente_ate')::numeric>(f->>'instante')::numeric)
      order by (x->>'insumo_id')::bigint,x->>'apresentacao_ref' collate "C"
    loop
      if equipamento_primeiro then equipamento_contexto:=d->'equipamento_ref'; equipamento_primeiro:=false;
      elsif equipamento_contexto is distinct from d->'equipamento_ref' then
        raise exception 'CAPTURA_EQUIPAMENTO_AMBIGUO' using errcode='22023';
      end if;
      if d->>'equipamento_ref' is not null and not exists(select 1 from public.equipamento_analise
        where codigo_analise=p_codigo and 'equipamento:'||equipamento_id=d->>'equipamento_ref') then
        raise exception 'CAPTURA_EQUIPAMENTO_INCOMPLETO' using errcode='22023';
      end if;
      select * into i from public.insumos where id=(d->>'insumo_id')::bigint and ativo;
      if not found then raise exception 'CAPTURA_SKU_INCOMPLETO' using errcode='22023'; end if;
      select * into c from public.v_custo_estoque_vigente where insumo_id=i.id;
      if not found or i.unidade is distinct from c.unidade_estoque
         or i.unidade_consumo is distinct from c.unidade_consumo or i.fator_conversao is distinct from c.fator_conversao
         or i.unidade is distinct from d->>'unidade_estoque' or i.unidade_consumo is distinct from n.unidade
         or i.unidade_consumo is distinct from d->>'unidade_consumo'
         or i.fator_conversao is distinct from (d->>'fator_conversao')::numeric or i.fator_conversao<=0 then
        raise exception 'CAPTURA_DIMENSAO_DIVERGENTE' using errcode='22023';
      end if;
      bruto:=coalesce(c.custo_medio_ponderado,c.custo_padrao)::double precision;
      fonte:=case when c.custo_medio_ponderado is not null then 'custo_medio_ponderado' else 'custo_padrao_fallback' end;
      referencia:=case when c.custo_medio_ponderado is not null then 'lotes_estoque_liberados' else 'insumos:'||i.id end;
      if bruto is null or bruto<0 or bruto in ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)
         or (not(c.custo_medio_ponderado is null and c.custo_padrao=0) and
           (c.custo_origem::double precision is distinct from bruto or c.fonte_custo is distinct from fonte or c.referencia_custo is distinct from referencia)) then
        raise exception 'CAPTURA_PRECO_INCOMPLETO' using errcode='22023';
      end if;
      normalizado:=bruto/i.fator_conversao::double precision;
      total:=(normalizado*n.quantidade_por_amostra::double precision)*case n.modo_cobranca
        when 'por_execucao' then ceil(p_amostras::double precision/lote_n) else p_amostras::double precision end;
      if quantidade<=0 or quantidade/i.fator_conversao::double precision<=0 or (bruto>0 and normalizado=0)
         or total in ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision) then
        raise exception 'CAPTURA_PRECO_INCOMPLETO' using errcode='22023';
      end if;
      linha:=jsonb_build_object('insumo_id',i.id,'unidade_estoque',i.unidade,'unidade_consumo',i.unidade_consumo,
        'fator_conversao',i.fator_conversao,'fonte_custo',fonte,'referencia_custo',referencia,
        'custo_unitario_estoque',bruto,'custo_unitario_consumo',normalizado,
        'quantidade_consumo',n.quantidade_por_amostra,'quantidade_estoque',n.quantidade_por_amostra/i.fator_conversao,
        'necessidade_id',n.id,'etapa_id',n.etapa_id,'modo_cobranca',n.modo_cobranca,'lote',lote_n,
        'quantidade_total_consumo',quantidade,'quantidade_total_estoque',quantidade/i.fator_conversao::double precision,
        'custo_total_insumo',total,'decisao',d);
      opcoes:=opcoes||jsonb_build_array(linha);
      if melhor is null or total>(melhor->>'custo_total_insumo')::double precision then melhor:=linha; end if;
    end loop;
    if melhor is null then raise exception 'CAPTURA_SEM_VALIDACAO_ATIVA' using errcode='22023'; end if;
    fontes:=fontes||jsonb_build_array(jsonb_build_object('necessidade',to_jsonb(n),'alternativas',opcoes));
    proveniencia:=proveniencia||jsonb_build_array(melhor);
    rastro:=rastro||jsonb_build_array(jsonb_build_object('necessidade_id',n.id,'etapa_id',n.etapa_id,
      'insumo_id',melhor->'insumo_id','apresentacao_ref',melhor->'decisao'->'apresentacao_ref',
      'decisao_ref',melhor->'decisao'->'decisao_ref','evidencia_ref',melhor->'decisao'->'evidencia_ref',
      'quantidade_consumo',melhor->'quantidade_total_consumo','quantidade_estoque',melhor->'quantidade_total_estoque',
      'custo_total_insumo',melhor->'custo_total_insumo'));
    reagentes:=reagentes+(melhor->>'custo_total_insumo')::double precision;
  end loop;
  equipamento:=equip_dia/(lote*exec_dia)*p_amostras::double precision;
  pessoal:=horas*pessoal_h; overhead:=horas*overhead_h;
  custo:=reagentes+equipamento+pessoal+overhead; preco:=custo*(1+fatores);
  if custo is null or preco is null or custo<0 or preco<0
     or custo in ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)
     or preco in ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision) then
    raise exception 'CAPTURA_TOTAL_INVALIDO' using errcode='22023';
  end if;
  totais:=jsonb_build_object('reagentes',reagentes,'equipamento',equipamento,'pessoal',pessoal,'overhead',overhead,
    'custoAnalitico',reagentes+equipamento+pessoal,'custoTotal',custo,'preco',preco);
  composicao:=jsonb_build_object('reagentes',reagentes/p_amostras,'equipamento',equipamento/p_amostras,
    'pessoal',pessoal/p_amostras,'overhead',overhead/p_amostras,'custoAnalitico',(reagentes+equipamento+pessoal)/p_amostras,
    'custoTotal',custo/p_amostras,'preco',preco/p_amostras);
  return jsonb_build_object('codigo_analise',p_codigo,'n_amostras',p_amostras,
    'custo_unitario',custo/p_amostras,'preco_unitario',preco/p_amostras,
    'valor_snapshot',jsonb_build_object('versao','equivalencia-economica-v1','metodo_revisao_ref',p_metodo,
      'fonte_custo_insumos','custo_medio_ponderado',
      'lote_padrao',lote,'numero_execucoes',ceil(p_amostras::double precision/lote),'composicao',composicao,
      'composicao_totais',totais,'proveniencia_dimensional',proveniencia,'selecao',rastro,
      'fontes',jsonb_build_object('instante',f->'instante','necessidades',fontes,'etapas',etapas,
        'parametros',params,'equipamentos',fontes_equip,'equipamento_dia',equip_dia,
        'valor_hora_pessoal',pessoal_h,'custo_hora_overhead',overhead_h)));
end $$;
revoke all on function kontrol_private.calcular_captura_equivalencia_v1(text,text,bigint) from public,anon,authenticated,service_role;

create function public.capturar_orcamento_equivalencia_v1(
  p_orcamento_id bigint, p_revisao_esperada integer, p_metodos jsonb, p_operacao_id uuid
) returns jsonb language plpgsql security definer set search_path = '' set lock_timeout = '1s' as $$
declare
  ator uuid:=auth.uid(); sessao text:=auth.jwt()->>'session_id'; papel text;
  b public.orcamentos%rowtype; item record; x jsonb; itens jsonb:='[]'; linhas jsonb:='[]';
  anterior kontrol_private.orcamento_capturas_equivalencia%rowtype; entrada jsonb; snap jsonb; recibo jsonb;
  q integer; total_custo double precision:=0; total_preco double precision:=0; total_amostras double precision:=0;
  reagentes double precision:=0; equipamento double precision:=0; pessoal double precision:=0; overhead double precision:=0;
begin
  if ator is null or auth.jwt()->>'role' is distinct from 'authenticated'
     or sessao is null or sessao !~ '^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$' then
    raise exception 'Sessão inválida.' using errcode='42501';
  end if;
  if current_setting('transaction_isolation') not in ('read committed','read uncommitted') then
    raise exception 'Captura exige leitura atual.' using errcode='25000';
  end if;
  perform 1 from auth.sessions where id=sessao::uuid and user_id=ator and (not_after is null or not_after>now()) for share nowait;
  if not found then raise exception 'Sessão inválida.' using errcode='42501'; end if;
  select p.papel into papel from public.perfis p where id=ator and not suspenso and not senha_provisoria for share nowait;
  if not found then raise exception 'Perfil inválido.' using errcode='42501'; end if;
  lock table public.permissoes_categorias in share mode nowait;
  perform kontrol_private.exigir_permissao('orcamentos.criar_editar');
  perform kontrol_private.exigir_permissao('custeio.ver');
  perform kontrol_private.exigir_permissao('tecnicos.salario.ver');
  perform kontrol_private.exigir_permissao('analises.ver');
  perform kontrol_private.exigir_permissao('insumos.ver');
  if p_orcamento_id is null or p_orcamento_id<=0 or p_revisao_esperada is null or p_revisao_esperada<0
     or p_operacao_id is null or jsonb_typeof(p_metodos) is distinct from 'object' then
    raise exception 'Identifique orçamento, revisão, métodos e operação.' using errcode='22023';
  end if;
  if exists(select 1 from jsonb_each(p_metodos) where length(key) not between 1 and 100
    or jsonb_typeof(value)<>'string' or length(btrim(value#>>'{}')) not between 1 and 160) then
    raise exception 'Método explícito obrigatório.' using errcode='22023';
  end if;
  entrada:=jsonb_build_object('orcamento_id',p_orcamento_id,'revisao_esperada',p_revisao_esperada,'metodos',p_metodos);
  if not pg_try_advisory_xact_lock(hashtextextended('captura-economica:'||p_operacao_id,0)) then
    raise exception 'Captura concorrente.' using errcode='55P03';
  end if;
  select * into anterior from kontrol_private.orcamento_capturas_equivalencia where operacao_id=p_operacao_id;
  if found then
    if anterior.ator_id<>ator or anterior.entrada is distinct from entrada then
      raise exception 'IDEMPOTENCY_CONFLICT' using errcode='22023';
    end if;
    return anterior.recibo||'{"replay":true}'::jsonb;
  end if;
  -- ponytail: locks de conjunto NOWAIT cobrem também phantoms. Limite: serializa
  -- capturas e manutenção das fontes; só trocar por revisão global compartilhada
  -- por TODOS os escritores quando houver necessidade de throughput comprovada.
  lock table public.analises,public.insumo_analise,public.etapas,public.insumos,
    public.equipamento_analise,public.equipamentos,public.parametros,public.tecnicos,
    public.overhead,public.lotes_estoque,kontrol_private.equivalencia_insumos_decisoes in share mode nowait;
  lock table public.orcamento_itens in share row exclusive mode nowait;
  select * into b from public.orcamentos where id=p_orcamento_id for update nowait;
  if not found then raise exception 'Orçamento inexistente.' using errcode='P0002'; end if;
  -- Apenas documento ainda não emitido; não converte versões/histórico.
  perform 1 from public.demandas_propostas where id=b.demanda_id for update nowait;
  if not found or b.status is distinct from 'rascunho' or coalesce(b.status_operacional,'') not in ('pendente','preenchido')
     or exists(select 1 from public.orcamento_final_versoes where demanda_id=b.demanda_id) then
    raise exception 'CAPTURA_EXIGE_ORCAMENTO_NOVO' using errcode='22023';
  end if;
  if b.custo_revisao<>p_revisao_esperada then raise exception 'CAPTURA_REVISAO_OBSOLETA' using errcode='40001'; end if;
  select count(*) into q from public.orcamento_itens where orcamento_id=b.id;
  if q=0 or q>100 or q<>(select count(*) from jsonb_each(p_metodos))
     or exists(select 1 from public.orcamento_itens where orcamento_id=b.id
       group by codigo_analise having count(*)<>1) then
    raise exception 'CAPTURA_CONJUNTO_INCOMPLETO' using errcode='22023';
  end if;
  for item in select * from public.orcamento_itens where orcamento_id=b.id order by codigo_analise collate "C" loop
    if not(p_metodos ? item.codigo_analise) or item.n_amostras<>trunc(item.n_amostras)
       or item.n_amostras>9007199254740991 then raise exception 'CAPTURA_CONJUNTO_INCOMPLETO' using errcode='22023'; end if;
    x:=kontrol_private.calcular_captura_equivalencia_v1(item.codigo_analise,p_metodos->>item.codigo_analise,item.n_amostras::bigint);
    itens:=itens||jsonb_build_array(x);
    total_custo:=total_custo+(x->'valor_snapshot'->'composicao_totais'->>'custoTotal')::double precision;
    total_preco:=total_preco+(x->'valor_snapshot'->'composicao_totais'->>'preco')::double precision;
    total_amostras:=total_amostras+item.n_amostras::double precision;
    reagentes:=reagentes+(x->'valor_snapshot'->'composicao_totais'->>'reagentes')::double precision;
    equipamento:=equipamento+(x->'valor_snapshot'->'composicao_totais'->>'equipamento')::double precision;
    pessoal:=pessoal+(x->'valor_snapshot'->'composicao_totais'->>'pessoal')::double precision;
    overhead:=overhead+(x->'valor_snapshot'->'composicao_totais'->>'overhead')::double precision;
    linhas:=linhas||jsonb_build_array(jsonb_build_object('codigo_analise',item.codigo_analise,'quantidade',item.n_amostras,
      'reagentes',x->'valor_snapshot'->'composicao_totais'->'reagentes','materiais',x->'valor_snapshot'->'composicao_totais'->'reagentes',
      'equipamentos',x->'valor_snapshot'->'composicao_totais'->'equipamento','mao_obra',x->'valor_snapshot'->'composicao_totais'->'pessoal',
      'overhead',x->'valor_snapshot'->'composicao_totais'->'overhead','terceiros',0,
      'custo',x->'valor_snapshot'->'composicao_totais'->'custoTotal','preco',x->'valor_snapshot'->'composicao_totais'->'preco',
      'lote',x->'valor_snapshot'->'lote_padrao','numero_execucoes',x->'valor_snapshot'->'numero_execucoes',
      'composicao_unitaria',x->'valor_snapshot'->'composicao',
      'proveniencia_dimensional',x->'valor_snapshot'->'proveniencia_dimensional'));
  end loop;
  snap:=jsonb_build_object('versao','equivalencia-economica-v1','operacao_id',p_operacao_id,
    'gerado_em',statement_timestamp(),'fonte_custo_insumos','custo_medio_ponderado','itens',itens,'linhas',linhas,
    'totais',jsonb_build_object('reagentes',reagentes,'materiais',reagentes,'equipamentos',equipamento,'mao_obra',pessoal,
      'overhead',overhead,'terceiros',0,'custo',total_custo,'preco',total_preco,'amostras',total_amostras));
  insert into kontrol_private.orcamento_captura_em_curso
    values(pg_backend_pid(),txid_current(),b.id,ator,p_operacao_id,snap);
  for x in select value from jsonb_array_elements(itens) loop
    perform public.salvar_item_orcamento(b.id,x->>'codigo_analise',(x->>'n_amostras')::numeric,
      (x->>'custo_unitario')::numeric,(x->>'preco_unitario')::numeric,x->'valor_snapshot',snap);
  end loop;
  update public.orcamentos set fonte_custo_insumos='custo_medio_ponderado' where id=b.id;
  recibo:=jsonb_build_object('versao','equivalencia-economica-v1','operacao_id',p_operacao_id,'orcamento_id',b.id,
    'revisao_anterior',b.custo_revisao,'revisao_aplicada',b.custo_revisao+q,'quantidade_itens',q,
    'custo_total',total_custo,'preco_total',total_preco,'snapshot_hash',md5(snap::text),'replay',false);
  insert into kontrol_private.orcamento_capturas_equivalencia values(p_operacao_id,b.id,ator,entrada,snap,recibo,clock_timestamp());
  delete from kontrol_private.orcamento_captura_em_curso
    where backend_pid=pg_backend_pid() and transacao_id=txid_current()
      and orcamento_id=b.id and ator_id=ator and operacao_id=p_operacao_id;
  return recibo;
end $$;
revoke all on function public.capturar_orcamento_equivalencia_v1(bigint,integer,jsonb,uuid) from public,anon,authenticated,service_role;
grant execute on function public.capturar_orcamento_equivalencia_v1(bigint,integer,jsonb,uuid) to authenticated;

-- Depois da adesão explícita, não permitir rebaixamento silencioso ao cálculo
-- legado. Nada muda para módulos sem captura; estados/emissão ficam existentes.
create function kontrol_private.proteger_modo_captura_equivalencia()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  alvo bigint; alvos bigint[]; modo text; marcado boolean; novo jsonb:=to_jsonb(new);
  origem kontrol_private.orcamento_captura_em_curso%rowtype;
begin
  if tg_table_name='orcamentos' then
    alvos:=array[(to_jsonb(old)->>'id')::bigint,(novo->>'id')::bigint];
    marcado:=coalesce(to_jsonb(old)->'custo_snapshot'->>'versao'='equivalencia-economica-v1',false)
      or coalesce(to_jsonb(new)->'custo_snapshot'->>'versao'='equivalencia-economica-v1',false);
  else
    alvos:=array[(to_jsonb(old)->>'orcamento_id')::bigint,(novo->>'orcamento_id')::bigint];
    marcado:=coalesce(to_jsonb(old)->'valor_snapshot'->>'versao'='equivalencia-economica-v1',false)
      or coalesce(to_jsonb(new)->'valor_snapshot'->>'versao'='equivalencia-economica-v1',false);
  end if;
  foreach alvo in array alvos loop
    continue when alvo is null;
    select custo_snapshot->>'versao' into modo from public.orcamentos where id=alvo;
    if marcado or modo='equivalencia-economica-v1' then
      select * into origem from kontrol_private.orcamento_captura_em_curso
        where backend_pid=pg_backend_pid() and transacao_id=txid_current()
          and orcamento_id=alvo and ator_id=auth.uid();
      if not found then
        raise exception 'Módulo exige captura econômica revisionada.' using errcode='42501';
      end if;
      -- Autoriza só a saída calculada pelo executor, não qualquer escrita
      -- privilegiada que eventualmente ocorra na mesma transação.
      if tg_table_name='orcamentos' then
        if tg_op<>'UPDATE' or (novo->>'id')::bigint<>alvo
           or novo->'custo_snapshot' is distinct from origem.snapshot then
          raise exception 'Snapshot diverge da captura em curso.' using errcode='42501';
        end if;
      elsif tg_op not in ('INSERT','UPDATE') or (novo->>'orcamento_id')::bigint<>alvo
         or not exists(select 1 from jsonb_array_elements(origem.snapshot->'itens') esperado
           where novo->'codigo_analise'=esperado->'codigo_analise'
             and novo->'n_amostras'=esperado->'n_amostras'
             and novo->'custo_unitario'=esperado->'custo_unitario'
             and novo->'preco_unitario'=esperado->'preco_unitario'
             and novo->'valor_snapshot'=esperado->'valor_snapshot') then
        raise exception 'Item diverge da captura em curso.' using errcode='42501';
      end if;
    end if;
  end loop;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
-- Definer exclusivamente para consultar a origem privada; sem permissão de
-- chamada direta, setter público, dependência de owner compartilhado ou GUC.
revoke all on function kontrol_private.proteger_modo_captura_equivalencia() from public,anon,authenticated,service_role;
create trigger proteger_modo_captura_equivalencia before insert or delete or update of custo_snapshot,fonte_custo_insumos
on public.orcamentos for each row execute function kontrol_private.proteger_modo_captura_equivalencia();
create trigger proteger_modo_captura_equivalencia before insert or delete or update
on public.orcamento_itens for each row execute function kontrol_private.proteger_modo_captura_equivalencia();
commit;
