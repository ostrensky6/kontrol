import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { test } from 'node:test';
import { spawn } from 'node:child_process';

const root = new URL('../migrations/', import.meta.url);
const target = new URL('0144_inativacao_insumos.sql', root);
const sql = existsSync(target) ? readFileSync(target, 'utf8').replaceAll('\r', '') : '';
const history = readdirSync(root).filter(n => /^\d{4}_.*\.sql$/.test(n) && n < '0144_').sort();
const functions = [];
for (const name of history) {
  const source = readFileSync(new URL(name, root), 'utf8').replaceAll('\r', '');
  const pattern = /create\s+or\s+replace\s+function\s+(public\.\w+)\s*\(([\s\S]*?)\)[\s\S]*?\bas\s+(\$[\w]*\$)([\s\S]*?)\3/gi;
  for (const match of source.matchAll(pattern)) functions.push({ name: match[1], args: match[2], body: match[4], file: name });
}

test('0144 existe e acrescenta estado sem apagar histórico', () => {
  assert.ok(sql, 'RED: migration 0144 de inativação ainda não materializada');
  assert.match(sql, /add column ativo boolean not null default true/i);
  assert.doesNotMatch(sql, /\b(?:drop\s+(?:table|column|schema)|truncate|delete\s+from)\b/i);
  assert.match(sql, /select anterior\.\*, i\.ativo from \(%s\) anterior join public\.insumos i/);
  assert.match(sql, /v_previsao_suprimentos', 'v_alertas_estoque'/);
  assert.match(sql, /where i\.ativo'/);
});

test('guarda independente de owner trava o insumo antes da nova operação', () => {
  assert.match(sql, /select i\.ativo[^;]*for update;/i, 'o helper deve obter o lock final antes das RPCs, sem conversão SHARE → UPDATE');
  assert.doesNotMatch(sql, /select i\.ativo[^;]*for share;/i);
  assert.match(sql, /security definer\s+set search_path = ''/i);
  assert.doesNotMatch(sql, /current_user|session_user|set_config\s*\(/i);
  assert.match(sql, /revoke all on function kontrol_private\.exigir_insumo_ativo\(bigint\) from public, anon, authenticated/);
  for (const verb of ['insert', 'update', 'delete']) {
    assert.match(sql, new RegExp(`create policy rls_permissao_${verb}_insumos[\\s\\S]*?tem_permissao_efetiva\\('insumos.editar'\\)`));
  }
  assert.doesNotMatch(sql, /drop policy.*select|grant.*insumos/i);
  assert.equal((sql.match(/as restrictive for insert to authenticated/g) ?? []).length, 2, 'DML direta não contorna portas controladas');
});

test('cada patch possui âncora única no corpo vigente e preserva retries/histórico', () => {
  const patches = [...sql.matchAll(/\('([^']+)',\s*\$anchor\$([\s\S]*?)\$anchor\$,\s*\$guard\$([\s\S]*?)\$guard\$\)/g)];
  assert.equal(patches.length, 13, '12 portas novas + filtro da notificação de compra atrasada');
  const names = new Set();
  for (const [, signature, anchor, replacement] of patches) {
    const name = signature.slice(0, signature.indexOf('('));
    const arity = signature.slice(signature.indexOf('(') + 1, -1).split(',').filter(Boolean).length;
    const previous = functions.filter(f => f.name === name && f.args.split(',').filter(Boolean).length === arity).at(-1);
    assert.ok(previous, `definição prévia de ${signature}`);
    assert.equal(previous.body.split(anchor).length - 1, 1, `âncora única: ${signature} em ${previous.file}`);
    if (replacement.includes('exigir_insumo_ativo')) {
      assert.ok(replacement.indexOf('exigir_insumo_ativo') < replacement.indexOf(anchor), `${name}: validação antes da escrita/seleção`);
      const before = previous.body.slice(0, previous.body.indexOf(anchor));
      assert.doesNotMatch(before.replace(/--[^\n]*/g, ''), /\b(?:insert\s+into|update\s+(?:public\.)?\w+\s+set|delete\s+from)\b/i, `${name}: não escreve antes da guarda`);
      if (previous.body.includes("'{repetido}'")) assert.ok(before.includes("'{repetido}'"), `${name}: retry termina antes de revalidar ativo`);
    }
    names.add(name);
  }
  assert.equal(names.size, 12);
  for (const name of ['receber_item_pedido_compra', 'receber_item_pedido_interno', 'dar_baixa_plano', 'estornar_recebimento', 'desfazer_leitura', 'aplicar_ajuste_inventario']) {
    assert.ok(!names.has(`public.${name}`), `${name}: contrato histórico não redefinido`);
  }
  assert.match(sql, /array_length\(string_to_array\(v_def, r\.ancora\), 1\) <> 2/);
});

test('novos vínculos bloqueados, atualização do mesmo ID histórico continua', () => {
  for (const table of ['insumo_analise', 'pedidos_compra_itens', 'pedidos_internos_itens', 'reservas_estoque']) {
    assert.match(sql, new RegExp(`before insert or update of insumo_id on public\\.${table}`));
  }
  assert.match(sql, /new\.insumo_id is not distinct from old\.insumo_id then\s+return new/);
  assert.match(sql, /new\.entidade_tipo is not distinct from old\.entidade_tipo/);
  assert.doesNotMatch(sql, /create trigger[^;]+on public\.(?:lotes_estoque|estoque_movimentacoes)/i);
});

test('exclusão informa contagens reais das dez famílias FK, sem IDs protegidos', () => {
  const counts = [...sql.matchAll(/select '([^']+)'[^\n]*count\(\*\)(?: as contagem)? from public\.(\w+) where insumo_id = old\.id/g)];
  const expected = ['insumo_analise', 'estoque_movimentacoes', 'lotes_estoque', 'reservas_estoque', 'pedidos_compra_itens', 'pedidos_internos_itens', 'planejamento_lote_conferencias', 'pedidos_internos_item_recebimentos', 'pedidos_compra_item_recebimentos', 'inventario_contagens'];
  assert.deepEqual(counts.map(m => m[2]).sort(), expected.sort());
  assert.doesNotMatch(sql, /public\.estoque_config\b/, 'tabela retirada pela 0003 não pode quebrar a exclusão');
  assert.match(sql, /where contagem > 0/);
  assert.match(sql, /detail = jsonb_build_object\('blockers', v_blockers\)::text/);
  assert.doesNotMatch(sql, /jsonb_build_object\([^;]*(?:'identificador'|'href')/);
});

test('exclusão inclui identificadores polimórficos, isolados ou misturados às FKs', () => {
  assert.match(sql, /union all select 'identificadores', 'Identificadores', count\(\*\) from public\.identificadores where entidade_tipo = 'insumo' and entidade_id = old\.id/);
  const proof = readFileSync(new URL('inativacao_insumos_0144.sql', import.meta.url), 'utf8');
  assert.match(proof, /BLOCKERS_IDENTIFICADOR_UNICO/);
  assert.match(proof, /BLOCKERS_IDENTIFICADOR_MISTO/);
  assert.match(proof, /jsonb_array_length\(v_b\) <> 4/);
});

test('tipos derivados e prova SQL local acompanham o contrato', () => {
  const types = readFileSync(new URL('../../src/lib/supabase/database.types.ts', import.meta.url), 'utf8');
  const insumos = types.slice(types.indexOf('      insumos: {'), types.indexOf('      inventario_ciclos: {'));
  assert.match(insumos, /ativo: boolean/);
  assert.equal((insumos.match(/ativo\?: boolean/g) ?? []).length, 2);
  const saldo = types.slice(types.indexOf('      v_estoque_saldo: {'), types.indexOf('      v_estoque_saldo_tipo: {'));
  assert.match(saldo, /ativo: boolean \| null/);
  const proof = new URL('inativacao_insumos_0144.sql', import.meta.url);
  assert.ok(existsSync(proof), 'prova SQL descartável preparada');
  const proofSql = readFileSync(proof, 'utf8');
  for (const label of ['DEFAULT', 'RLS', 'HISTORICO', 'NOVAS_OPERACOES', 'BLOCKERS', 'AUDITORIA', 'ROLLBACK']) assert.ok(proofSql.includes(label), label);
});

// Opt-in E2: banco NOVO prefixado, loopback explícito e psql já instalado.
// A senha, se necessária, é herdada somente do ambiente efêmero do processo.
// Não consulta nem aplica migrations; nunca aceitar DSN/host oficial.
test('E2: UPDATE serializa guardas sem conversão e bloqueia inativação concorrente', {
  skip: process.env.KONTROL_0144_LOCAL_E2 !== '1', timeout: 20000,
}, async () => {
  assert.ok(['127.0.0.1', '::1'].includes(process.env.PGHOST));
  assert.match(process.env.PGDATABASE ?? '', /^kontrol_0144_[a-z0-9_]+$/);
  const env = { ...process.env, PGCONNECT_TIMEOUT: '3' };
  let id;
  const label = `TS-0144-CONCORRENCIA-${process.pid}-${Date.now()}`;
  const execute = input => new Promise((resolve, reject) => {
    const child = spawn('psql', ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1'], { env, windowsHide: true });
    let output = '';
    let error = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { error += chunk; });
    child.once('error', reject);
    child.once('close', code => resolve({ code, output: output.trim(), error }));
    child.stdin.end(input);
  });
  const hold = statement => new Promise((resolve, reject) => {
    const child = spawn('psql', ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1'], { env, windowsHide: true });
    let output = '';
    let ready = false;
    const done = new Promise((doneResolve, doneReject) => {
      child.once('error', doneReject);
      child.once('close', code => doneResolve(code));
    });
    child.once('error', reject);
    child.stdout.on('data', chunk => {
      output += chunk;
      if (!ready && output.includes('LOCK_READY')) {
        ready = true;
        resolve({ child, done });
      }
    });
    child.stderr.on('data', () => {});
    child.once('close', code => { if (!ready) reject(new Error(`psql: lock não adquirido, exit ${code}`)); });
    child.stdin.write(`BEGIN; SET LOCAL statement_timeout='8s'; ${statement}; SELECT 'LOCK_READY';\n`);
  });
  let holder;
  try {
    const probe = await execute("select host(inet_server_addr()) || '|' || current_database();");
    assert.equal(probe.code, 0, 'conexão ao alvo sintético');
    assert.equal(probe.output, `${process.env.PGHOST}|${process.env.PGDATABASE}`);
    const fixture = await execute(`insert into public.insumos(especificacao) values('${label}') returning id;`);
    assert.equal(fixture.code, 0, 'fixture sintética nova');
    assert.match(fixture.output, /^\d+$/);
    id = fixture.output;
    holder = await hold(`select kontrol_private.exigir_insumo_ativo(${id})`);
    const competingGuard = await execute(`\\set VERBOSITY verbose\nBEGIN; SET LOCAL lock_timeout='250ms'; SELECT kontrol_private.exigir_insumo_ativo(${id}); ROLLBACK;`);
    assert.notEqual(competingGuard.code, 0, 'a segunda guarda já deve aguardar no lock inicial');
    assert.match(competingGuard.error, /55P03/, 'duas guardas não podem adquirir SHARE simultâneo antes de converter');
    const blocked = await execute(`\\set VERBOSITY verbose\nBEGIN; SET LOCAL lock_timeout='250ms'; UPDATE public.insumos SET ativo=false WHERE id=${id}; ROLLBACK;`);
    assert.notEqual(blocked.code, 0, 'inativação deve aguardar operação autorizada');
    assert.match(blocked.error, /55P03/, 'lock_timeout, não erro funcional');
    holder.child.stdin.end('ROLLBACK;\n');
    assert.equal(await holder.done, 0);
    holder = await hold(`update public.insumos set ativo=false where id=${id}`);
    const decision = execute(`\\set VERBOSITY verbose\nSET statement_timeout='5s'; SELECT kontrol_private.exigir_insumo_ativo(${id});`);
    // Só confirma a inativação depois de haver uma consulta concorrente.
    await new Promise(resolve => setTimeout(resolve, 250));
    holder.child.stdin.end('COMMIT;\n');
    assert.equal(await holder.done, 0);
    const denied = await decision;
    assert.notEqual(denied.code, 0);
    assert.match(denied.error, /55000[\s\S]*Insumo inativo/);
  } finally {
    if (holder?.child.stdin.writable) holder.child.stdin.end('ROLLBACK;\n');
    if (holder) await holder.done;
    if (id) {
      const cleanup = await execute(`delete from public.insumos where id=${id} and especificacao='${label}'; select count(*) from public.insumos where id=${id};`);
      assert.equal(cleanup.code, 0, 'cleanup somente da fixture exata');
      assert.equal(cleanup.output, '0');
    }
    delete env.PGPASSWORD;
  }
});
