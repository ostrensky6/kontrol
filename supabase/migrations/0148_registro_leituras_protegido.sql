-- 0148 — registro de leituras protegido e auditoria do que a exclusão em
-- cascata apaga (auditoria de 06/11/2026).
--
-- 1. desfazer_leitura_estoque (0143) acha a operação a desfazer em
--    scan_eventos, e qualquer usuário com "estoque.ver" podia gravar ali
--    direto (0128). Dava para inventar uma "saida_leitura" ou uma
--    "entrada_leitura" e desfazê-la: somar frascos a um lote ou descartar um
--    lote intacto. Agora as ações de movimento (entrada_leitura,
--    entrada_pedido_leitura, saida_leitura, desfazer_leitura) só entram pelas
--    funções do banco, e a gravação direta sempre leva o usuário e a hora reais.
--    As leituras simples do app (buscar, leitura_estoque) continuam iguais.
--
-- 2. A exclusão em cascata (0145/0147) apaga contagens de inventário,
--    conferências de lote do planejamento e leituras sem deixar rastro. Essas
--    três tabelas passam a ter gatilho de auditoria (scan_eventos só na
--    exclusão, para não duplicar cada leitura na trilha).
--
-- Rollback: drop trigger kontrol_proteger_scan_evento on public.scan_eventos;
-- drop function kontrol_private.proteger_scan_evento(); drop trigger
-- aud_inventario_contagens on public.inventario_contagens; drop trigger
-- aud_planejamento_lote_conferencias on public.planejamento_lote_conferencias;
-- drop trigger aud_scan_eventos on public.scan_eventos.

begin;

set local lock_timeout = '5s';

-- ---- 1. Registro de leituras -------------------------------------------------

create or replace function kontrol_private.proteger_scan_evento()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Dentro das funções SECURITY DEFINER o usuário corrente é o dono delas;
  -- só a gravação direta pela API chega aqui como authenticated ou anon.
  if current_user in ('authenticated', 'anon') then
    if new.acao in ('entrada_leitura', 'entrada_pedido_leitura', 'saida_leitura', 'desfazer_leitura') then
      raise exception 'Entrada, saída e desfazer por leitura só pelo Kontrol.'
        using errcode = '42501';
    end if;
    new.usuario_id := auth.uid();
    new.criado_em := now();
  end if;
  return new;
end $$;

revoke all on function kontrol_private.proteger_scan_evento() from public, anon, authenticated;

drop trigger if exists kontrol_proteger_scan_evento on public.scan_eventos;
create trigger kontrol_proteger_scan_evento
  before insert or update on public.scan_eventos
  for each row execute function kontrol_private.proteger_scan_evento();

-- ---- 2. Auditoria do que a cascata apaga ------------------------------------------

drop trigger if exists aud_inventario_contagens on public.inventario_contagens;
create trigger aud_inventario_contagens
  after insert or update or delete on public.inventario_contagens
  for each row execute function public.fn_auditoria('id');

drop trigger if exists aud_planejamento_lote_conferencias on public.planejamento_lote_conferencias;
create trigger aud_planejamento_lote_conferencias
  after insert or update or delete on public.planejamento_lote_conferencias
  for each row execute function public.fn_auditoria('id');

drop trigger if exists aud_scan_eventos on public.scan_eventos;
create trigger aud_scan_eventos
  after delete on public.scan_eventos
  for each row execute function public.fn_auditoria('id');

commit;
