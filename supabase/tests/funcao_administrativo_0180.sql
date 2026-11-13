-- SOMENTE clone sintético local. Valida a 0180: função Administrativo (nível,
-- caixinhas, dona das etapas administrativo/pagamento) e remoção de usuário
-- guardando o histórico. Termina em ROLLBACK.
\if :{?kontrol_test_local}
\else
  \echo '0180: falta acknowledgement explícito de banco descartável local.'
  \quit 3
\endif
begin;
set local lock_timeout = '3s';
set local statement_timeout = '60s';
do $$
begin
  if inet_server_addr() is not null
     and inet_server_addr() not in ('127.0.0.1'::inet, '::1'::inet) then
    raise exception '0180: conexão não local.';
  end if;
end $$;

do $$
declare
  v_adm uuid := md5('kontrol-0180-administrativo')::uuid;
  v_adm2 uuid := md5('kontrol-0180-administrativo-2')::uuid;
  v_resp uuid := md5('kontrol-0180-responsavel')::uuid;
  v_admin uuid := md5('kontrol-0180-admin')::uuid;
begin
  -- Nível e catálogo
  if kontrol_private.nivel_papel('administrativo') is distinct from 0 then
    raise exception '0180: nível do Administrativo deveria ser 0';
  end if;
  if not kontrol_private.papel_catalogado('administrativo') then
    raise exception '0180: Administrativo fora do catálogo';
  end if;

  -- Ninguém nas etapas: começa do zero, sem responsável indicado
  update public.responsaveis_compras set usuario_id = null, substituto_id = null;
  update public.perfis set suspenso = true where papel = 'administrativo';

  insert into auth.users(instance_id, id, aud, role, email, created_at, updated_at) values
    ('00000000-0000-0000-0000-000000000000', v_adm, 'authenticated', 'authenticated', 'ts-0180-adm@example.invalid', now(), now()),
    ('00000000-0000-0000-0000-000000000000', v_adm2, 'authenticated', 'authenticated', 'ts-0180-adm2@example.invalid', now(), now()),
    ('00000000-0000-0000-0000-000000000000', v_resp, 'authenticated', 'authenticated', 'ts-0180-resp@example.invalid', now(), now()),
    ('00000000-0000-0000-0000-000000000000', v_admin, 'authenticated', 'authenticated', 'ts-0180-admin@example.invalid', now(), now());
  update public.perfis set papel = 'admin', suspenso = false, senha_provisoria = false where id = v_admin;
  update public.perfis set papel = 'compra', suspenso = false, senha_provisoria = false, nome = 'TS Responsável' where id = v_resp;

  -- Sem ninguém na função: NULL (avisos vão para o Administrador, como antes)
  if kontrol_private.responsavel_compras('administrativo') is not null then
    raise exception '0180: sem Administrativo ativo deveria ser NULL';
  end if;

  -- Laboratório → Administrativo: troca de função aceita pelo CHECK
  update public.perfis set papel = 'administrativo', suspenso = false, senha_provisoria = false, nome = 'TS Adm B' where id = v_adm;
  update public.perfis set papel = 'administrativo', suspenso = false, senha_provisoria = false, nome = 'TS Adm A' where id = v_adm2;

  -- Caixinhas: compras, financeiro e planejamento sim; usuários e privilégios não
  perform set_config('request.jwt.claim.sub', v_adm::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_adm, 'role', 'authenticated')::text, true);
  if not (kontrol_private.tem_permissao_efetiva('pedido.aprovar')
          and kontrol_private.tem_permissao_efetiva('compras.aprovar')
          and kontrol_private.tem_permissao_efetiva('planejamento.editar')
          and kontrol_private.tem_permissao_efetiva('orcamentos.fundos')
          and kontrol_private.tem_permissao_efetiva('custeio.ver')) then
    raise exception '0180: Administrativo sem as caixinhas de compras/financeiro/planejamento';
  end if;
  if kontrol_private.tem_permissao_efetiva('usuarios.gerenciar')
     or kontrol_private.tem_permissao_efetiva('privilegios.gerenciar')
     or kontrol_private.tem_permissao_efetiva('backups.gerenciar') then
    raise exception '0180: Administrativo não administra o sistema';
  end if;
  if public.papel_minimo('coordenador') then
    raise exception '0180: Administrativo não alcança papel mínimo de Coordenador';
  end if;

  -- Dono natural das etapas: o primeiro Administrativo ativo por nome
  if kontrol_private.responsavel_compras('administrativo') is distinct from v_adm2
     or kontrol_private.responsavel_compras('pagamento') is distinct from v_adm2 then
    raise exception '0180: etapas deveriam ir ao Administrativo (TS Adm A)';
  end if;

  -- Responsável indicado manda
  update public.responsaveis_compras set usuario_id = v_resp where etapa = 'pagamento';
  if kontrol_private.responsavel_compras('pagamento') is distinct from v_resp then
    raise exception '0180: responsável indicado deveria mandar';
  end if;
  if kontrol_private.responsavel_compras('administrativo') is distinct from v_adm2 then
    raise exception '0180: etapa administrativo sem indicado deveria seguir no Administrativo';
  end if;

  -- Remover (login bloqueado + marca): sai das etapas, histórico fica
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  update public.perfis set suspenso = true, removido_em = now(), removido_por = v_admin where id = v_adm2;
  if kontrol_private.responsavel_compras('administrativo') is distinct from v_adm then
    raise exception '0180: removido não pode seguir como dono da etapa';
  end if;
  if not exists (select 1 from public.perfis where id = v_adm2 and removido_em is not null) then
    raise exception '0180: perfil removido deveria continuar existindo';
  end if;

  -- Removido sem login bloqueado é recusado
  begin
    update public.perfis set suspenso = false where id = v_adm2;
    raise exception '0180: removido com login liberado foi aceito';
  exception when check_violation then null;
  end;

  -- Reativar desfaz as duas coisas juntas
  update public.perfis set suspenso = false, removido_em = null, removido_por = null where id = v_adm2;
  if kontrol_private.responsavel_compras('administrativo') is distinct from v_adm2 then
    raise exception '0180: reativado deveria voltar a ser dono da etapa';
  end if;

  -- Pré-aprovado e categoria aceitam a função
  insert into public.usuarios_pre_aprovados (email, nome, papel)
  values ('ts-0180-pre@example.invalid', 'TS Pré', 'administrativo');
  if not exists (select 1 from public.permissoes_categorias where papel = 'administrativo') then
    raise exception '0180: categoria Administrativo ausente';
  end if;
end $$;

rollback;
