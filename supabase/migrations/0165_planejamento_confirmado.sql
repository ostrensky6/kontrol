-- 0165 — proposta aprovada não cria mais o planejamento sozinha.
--
-- Decisão de Antonio (08/11/2026, item 15 do plano de evolução): ao aprovar
-- (pela equipe ou pelo link do cliente) o banco deixa de criar o plano em
-- rascunho. Em vez disso, o Coordenador (ou acima) recebe um aviso
-- "Aguardando ação" que abre a proposta, onde o botão "Gerar planejamento
-- desta proposta" (gerar_planejamento_da_proposta, 0126) cria o plano. Evita
-- plano criado por engano quando a aprovação é corrigida depois.
--
-- Continua igual:
-- - a demanda passa a 'aprovada' junto com a proposta;
-- - se a demanda já tem plano ativo (versão anterior aprovada e cancelada),
--   o plano passa a acompanhar a versão nova e o Coordenador é avisado
--   (kontrol_private.criar_plano_da_versao só religa, não cria);
-- - gerar_planejamento_da_proposta e criar_plano_da_versao não mudam.
--
-- Aditivo: só troca o corpo da função do gatilho (mesma assinatura).
-- Rollback: recriar kontrol_private.gerar_plano_da_versao_aprovada() com o
-- corpo da 0126 (perform kontrol_private.criar_plano_da_versao(new.id, null);
-- seguido do update de demandas_propostas).
begin;
set local lock_timeout = '10s';

create or replace function kontrol_private.gerar_plano_da_versao_aprovada()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rotulo text := coalesce(new.numero, '#' || new.id);
begin
  if exists (
    select 1
      from public.planejamento p
      join public.orcamento_final_versoes vv on vv.id = p.orcamento_final_versao_id
     where vv.demanda_id = new.demanda_id
       and p.status_operacional <> 'cancelado'
  ) then
    -- Já há plano ativo: só religa à versão aprovada e avisa (não cria outro).
    perform kontrol_private.criar_plano_da_versao(new.id, null);
  else
    insert into public.notificacoes (
      tipo, titulo, corpo, entidade_tipo, entidade_id, papel_destino, dedupe_key
    ) values (
      'aprovacao_pendente',
      'Proposta ' || v_rotulo || ' aprovada: criar o planejamento?',
      'A proposta foi aprovada. Abra a proposta e clique em "Gerar planejamento desta proposta" '
        || 'quando a execução for começar. Nada é criado sem esse clique.',
      'proposta_final', new.id, 'coordenador', 'plano_confirmar_' || new.id
    )
    on conflict do nothing;
  end if;

  -- Item 9: a demanda acompanha a proposta aprovada.
  update public.demandas_propostas
     set status = 'aprovada'
   where id = new.demanda_id
     and status in ('nova', 'em_analise', 'orcada');
  return new;
end $$;
revoke all on function kontrol_private.gerar_plano_da_versao_aprovada() from public, anon, authenticated;

comment on function kontrol_private.gerar_plano_da_versao_aprovada() is
  'Gatilho da aprovação (0165): avisa o Coordenador para gerar o planejamento; só religa um plano ativo já existente.';

commit;
