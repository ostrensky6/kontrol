import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { EquivalenciaRevisionadaForm } from "./EquivalenciaRevisionadaForm";

const io = vi.hoisted(() => ({ slots: [] as unknown[], index: 0, preparar: vi.fn(), registrar: vi.fn(), revogar: vi.fn(), refresh: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClientUntyped: async () => ({ rpc: io.rpc }) }));
vi.mock("react", async (original) => ({ ...await original<typeof import("react")>(),
  useState: (initial: unknown) => { const i=io.index++; if (!(i in io.slots)) io.slots[i]=initial; return [io.slots[i], (v: unknown) => { io.slots[i]=typeof v === "function" ? v(io.slots[i]) : v; }]; },
  useRef: (initial: unknown) => { const i=io.index++; if (!(i in io.slots)) io.slots[i]={current:initial}; return io.slots[i]; },
  useEffect: (effect: () => (() => void), deps: unknown[]) => { const i=io.index++; const old=io.slots[i] as { deps: string; cleanup: () => void } | undefined; if (old?.deps !== JSON.stringify(deps)) { old?.cleanup(); io.slots[i]={deps:JSON.stringify(deps),cleanup:effect()}; } },
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: io.refresh }), unstable_rethrow: vi.fn() }));
vi.mock("@/lib/actions/equivalencia-revisionada", () => ({ prepararEquivalenciaRevisionada: io.preparar, registrarEquivalenciaRevisionada: io.registrar, revogarEquivalenciaRevisionada: io.revogar }));
const NativeFormData = globalThis.FormData;
const cas = "equivalencia-cas-v1:"+"a".repeat(32);
type Contexto = Parameters<typeof EquivalenciaRevisionadaForm>[0]["contexto"];
const contexto: Contexto = {
  versao: "equivalencia-contexto-autorizado-v1", estado: "disponivel", codigo_analise: "A1", metodo_revisao_ref: "metodo:r2", estado_validacoes: "disponivel", instante: 1794000000000,
  revisao_contexto: "contexto:"+"b".repeat(32), capacidades: { consultar:true, registrar:true,revogar:true },
  necessidades: [{ necessidade_id:10,etapa_id:null,nome_etapa:null,nome_atividade:"Necessidade",unidade_consumo:"mL",quantidade_por_base:1,modo_cobranca:"por_amostra",base_calculo:null,insumo_receita_id:20,etapa_contexto:null,
    candidatos:[{insumo_id:20,especificacao:"SKU teste",fabricante:null,codigo_fabricante:null,codigo_interno:null,quantidade_embalagem:100,unidade_estoque:"frasco",unidade_consumo:"mL",fator_conversao:100}] }],
  equipamentos:[],decisoes:[{decisao_ref:"equivalencia:30",necessidade_id:10,etapa_id:null,insumo_id:20,equipamento_id:null,apresentacao_ref:"apresentacao:r1",evidencia_ref:"evidencia:r1",unidade_estoque:"frasco",unidade_consumo:"mL",fator_conversao:100,vigente_desde:1,vigente_ate:null,estado:"validada",pode_revogar:true}],
  referencias_documentais:"atestacao_explicita_sem_catalogo_de_revisoes",candidatos_sao_equivalencias:false,cas_escrita:false,
};
function nodes(tree: ReactNode): ReactElement<Record<string,unknown>>[] { return Children.toArray(tree).flatMap(n=>isValidElement<Record<string,unknown>>(n)?[n,...nodes(n.props.children as ReactNode)]:[]); }
function render(c=contexto, habilitada=true) { io.index=0; return EquivalenciaRevisionadaForm({contexto:c,habilitada}); }
function editar(name:string,value:string) {
  const n=nodes(render()).find(n=>n.props.name===name)!;
  (n.props.onChange as (e:unknown)=>void)({target:{value,checked:value==="sim"}});
}
function preencher(acao="registrar") {
  editar("acao",acao);
  if(acao==="registrar") for(const [k,v] of Object.entries({necessidade_id:"10",insumo_id:"20",equipamento_id:"sem",apresentacao_ref:"apresentacao:r1",evidencia_ref:"evidencia:r1",vigente_ate:"2020-01-01T00:00:00Z",confirmada:"sim"})) editar(k,v);
  else { editar("decisao_ref","equivalencia:30"); editar("motivo","Revisão técnica"); }
}
function enviar(index=0,campos:Record<string,string>={}) {
  const form=nodes(render()).filter(n=>n.type==="form")[index];
  return (form.props.onSubmit as (e:unknown)=>Promise<void>)({preventDefault:vi.fn(),currentTarget:campos});
}
beforeEach(()=>{
  vi.resetAllMocks();io.slots=[];io.index=0;
  vi.stubGlobal("FormData",class extends NativeFormData{constructor(input?:Record<string,string>){super();if(input)for(const[k,v]of Object.entries(input))this.set(k,v);}});
  io.preparar.mockImplementation(async (_s,form:FormData)=>({ok:true,message:"Preparado sem gravar",preparacao:{versao:"equivalencia-escrita-v1",acao:form.get("acao"),codigo_analise:"A1",metodo_revisao_ref:"metodo:r2",necessidade_id:10,decisao_ref:form.get("decisao_ref"),revisao_esperada:cas,cas_escrita:true}}));
});
afterEach(()=>{ vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it.each([0.0000001, 1.2345678901234568e-7, 1e21, 100])("ORD157 decimal %s atravessa parser real e preserva retry", async (fator) => {
  const real = await vi.importActual<typeof import("@/lib/actions/equivalencia-revisionada")>("@/lib/actions/equivalencia-revisionada");
  vi.stubEnv("KONTROL_EQUIVALENCIA_ESCRITA_REVISIONADA", "1");
  io.preparar.mockImplementation(real.prepararEquivalenciaRevisionada);
  io.registrar.mockImplementation(real.registrarEquivalenciaRevisionada);
  io.rpc.mockImplementation(async (nome: string) => nome === "preparar_equivalencia_revisionada_v1"
    ? { data: { versao:"equivalencia-escrita-v1", acao:"registrar", codigo_analise:"A1", metodo_revisao_ref:"metodo:r2", necessidade_id:10, decisao_ref:null, revisao_esperada:cas, cas_escrita:true }, error:null }
    : { data:null, error:{code:"08006",message:"Resposta perdida"} });
  const c = { ...contexto, necessidades: contexto.necessidades.map(n => ({ ...n, candidatos: n.candidatos.map(i => ({ ...i, fator_conversao:fator })) })) };
  for (const [name,value] of Object.entries({acao:"registrar",necessidade_id:"10",insumo_id:"20",equipamento_id:"sem",apresentacao_ref:"apresentacao:r1",evidencia_ref:"evidencia:r1",confirmada:"sim"})) {
    const n=nodes(render(c)).find(n=>n.props.name===name)!;
    (n.props.onChange as (e:unknown)=>void)({target:{value,checked:value==="sim"}});
  }
  const submit = (index:number, campos:Record<string,string>={}) => (nodes(render(c)).filter(n=>n.type==="form")[index].props.onSubmit as (e:unknown)=>Promise<void>)({preventDefault:vi.fn(),currentTarget:campos});
  await submit(0);
  const texto=String(io.preparar.mock.calls[0][1].get("fator_conversao"));
  expect(texto).toMatch(/^\d+(?:[.,]\d+)?$/);
  expect(Number(texto)).toBe(fator);
  expect(io.rpc).toHaveBeenCalledWith("preparar_equivalencia_revisionada_v1",expect.objectContaining({p_dados:expect.objectContaining({fator_conversao:fator})}));
  if(fator===100) expect(texto).toBe("100");
  await submit(1,{confirmar:"sim"});await submit(1,{confirmar:"sim"});
  expect(io.registrar).toHaveBeenCalledTimes(2);
  const payload=Object.fromEntries(io.registrar.mock.calls[0][1]);
  expect(payload).toMatchObject({fator_conversao:texto,revisao_esperada:cas});
  expect(payload.operacao_id).toMatch(/^[a-f0-9-]{36}$/);
  expect(Object.fromEntries(io.registrar.mock.calls[1][1])).toEqual(payload);
  expect(io.rpc.mock.calls[2]).toEqual(io.rpc.mock.calls[1]);
  expect(io.rpc.mock.calls[1][1].p_contexto.fator_conversao).toBe(fator);
});

describe("ORD153 consumidor revisionado",()=>{
  it("preparação separada com intenção completa; edição invalida CAS",async()=>{
    preencher();await enviar();expect(io.registrar).not.toHaveBeenCalled();
    const payload=Object.fromEntries(io.preparar.mock.calls[0][1]);
    expect(payload).toMatchObject({necessidade_id:"10",etapa_id:"",insumo_id:"20",equipamento_id:"",unidade_estoque:"frasco",unidade_consumo:"mL",fator_conversao:"100",confirmada:"sim"});
    expect(payload).not.toHaveProperty("revisao_esperada");
    expect(renderToStaticMarkup(render())).toContain(cas);
    editar("evidencia_ref","outra");expect(renderToStaticMarkup(render())).not.toContain("Confirmar gravação preparada");
  });
  it("descarta preparação tardia após editar",async()=>{
    let resolve!:(value:unknown)=>void;io.preparar.mockImplementation(()=>new Promise(r=>{resolve=r;}));
    preencher();const p=enviar();editar("apresentacao_ref","nova");
    resolve({ok:true,preparacao:{versao:"equivalencia-escrita-v1",acao:"registrar",codigo_analise:"A1",metodo_revisao_ref:"metodo:r2",necessidade_id:10,decisao_ref:null,revisao_esperada:cas,cas_escrita:true}});await p;
    expect(renderToStaticMarkup(render())).not.toContain("Confirmar gravação preparada");
  });
  it("mantém UUID/CAS/intenção exatos após indeterminado, inclusive vigência passada",async()=>{
    preencher();await enviar();io.registrar.mockResolvedValue({ok:false,motivo:"resultado_indeterminado",message:"Incerto"});
    const p=enviar(1,{confirmar:"sim"});await enviar(1,{confirmar:"sim"});await p;
    expect(io.registrar).toHaveBeenCalledOnce();
    await enviar(1,{confirmar:"sim"});expect(io.registrar).toHaveBeenCalledTimes(2);
    const first=Object.fromEntries(io.registrar.mock.calls[0][1]);expect(Object.fromEntries(io.registrar.mock.calls[1][1])).toEqual(first);
    expect(first).toMatchObject({revisao_esperada:cas,vigente_ate:"2020-01-01T00:00:00Z"});expect(first.operacao_id).toMatch(/^[a-f0-9-]{36}$/);
    expect(io.refresh).toHaveBeenCalledTimes(2);
  });
  it.each(["contexto_obsoleto","identidade_reutilizada"])("%s exige outra preparação, não reenvia",async(motivo)=>{
    preencher();await enviar();io.registrar.mockResolvedValue({ok:false,motivo,message:"Confira o contexto"});await enviar(1,{confirmar:"sim"});
    const html=renderToStaticMarkup(render());expect(html).not.toContain("Repetir exatamente");expect(html).toContain("Separar nova intenção e reler");
  });
  it.each(["negada","desabilitada","concorrencia"])("mostra %s sem falso sucesso",async(motivo)=>{
    preencher();await enviar();io.registrar.mockResolvedValue({ok:false,motivo,message:"Operação não confirmada"});await enviar(1,{confirmar:"sim"});
    expect(renderToStaticMarkup(render())).toContain(`${motivo}:`);expect(renderToStaticMarkup(render())).toContain('role="alert"');
  });
  it("recibo correlacionado/replay é histórico e atualiza consulta sem novo efeito",async()=>{
    preencher("revogar");await enviar();io.revogar.mockImplementation(async(_s,f:FormData)=>({ok:true,message:"Replay confirmado",recibo:{operacao_id:f.get("operacao_id"),revisao_aplicada:f.get("revisao_esperada"),codigo_analise:"A1",metodo_revisao_ref:"metodo:r2",acao:"revogar",necessidade_id:10,estado:"revogada",decisao_ref:"equivalencia:30",replay:true}}));
    await enviar(1,{confirmar:"sim"});expect(io.revogar).toHaveBeenCalledOnce();expect(Object.fromEntries(io.revogar.mock.calls[0][1])).toMatchObject({decisao_ref:"equivalencia:30",motivo:"Revisão técnica"});
    expect(renderToStaticMarkup(render())).toContain("histórico (replay, sem novo efeito)");expect(io.refresh).toHaveBeenCalledOnce();
  });
  it("recibo com identidade trocada vira indeterminado",async()=>{
    preencher();await enviar();io.registrar.mockResolvedValue({ok:true,recibo:{operacao_id:"outro"}});await enviar(1,{confirmar:"sim"});expect(renderToStaticMarkup(render())).toContain("resultado_indeterminado");
  });
  it("flag off/capacidade negada não oferecem gravação; leitura permanece",()=>{
    expect(nodes(render(contexto,false)).some(n=>n.type==="form")).toBe(false);
    const negado={...contexto,capacidades:{consultar:true as const,registrar:false,revogar:false}};
    expect(renderToStaticMarkup(render(negado))).toContain("Registro: não concedido");
  });
  it("troca de contexto invalida preparação, sem usar revisão0160 como CAS",async()=>{
    preencher();await enviar();const novo={...contexto,revisao_contexto:"contexto:"+"c".repeat(32)};
    expect(renderToStaticMarkup(render(novo))).not.toContain("Confirmar gravação preparada");
  });
  it("outra intenção exige ciência explícita e preserva tentativa anterior incerta",async()=>{
    preencher();await enviar();io.registrar.mockResolvedValue({ok:false,motivo:"resultado_indeterminado",message:"Incerto"});await enviar(1,{confirmar:"sim"});
    const uuid=Object.fromEntries(io.registrar.mock.calls[0][1]).operacao_id;
    await enviar(2,{});expect(renderToStaticMarkup(render())).toContain("Repetir exatamente");
    await enviar(2,{separar:"sim"});
    const html=renderToStaticMarkup(render());expect(html).toContain(`Tentativa anterior preservada: ${uuid}`);expect(html).toContain("não presumir ausência de efeito");expect(html).not.toContain("Repetir exatamente");expect(io.registrar).toHaveBeenCalledOnce();
  });
});
