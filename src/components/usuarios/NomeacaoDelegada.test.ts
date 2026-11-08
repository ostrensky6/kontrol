import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NomeacaoDelegada } from "./NomeacaoDelegada";

const io = vi.hoisted(() => ({ slots: [] as unknown[], index: 0, cleanup: () => {}, ler: vi.fn(), nomear: vi.fn() }));
vi.mock("react", async (original) => ({ ...await original<typeof import("react")>(),
  useState: (initial: unknown) => { const i=io.index++; if (!(i in io.slots)) io.slots[i]=initial; return [io.slots[i], (v: unknown) => { io.slots[i]=v; }]; },
  useRef: (initial: unknown) => { const i=io.index++; if (!(i in io.slots)) io.slots[i]={current:initial}; return io.slots[i]; },
  useEffect: (effect: () => (() => void)) => { const i=io.index++; if (!(i in io.slots)) { io.slots[i]=true; io.cleanup=effect(); } },
}));
vi.mock("next/navigation", () => ({ unstable_rethrow: vi.fn() }));
vi.mock("@/lib/actions/nomeacao-contexto", () => ({ listarContextoNomeacao: io.ler }));
vi.mock("@/lib/actions/usuarios", () => ({ nomearPapelUsuario: io.nomear }));
const item = { usuario_id:"00000000-0000-4000-8000-000000000002", nome:"Pessoa", papel_atual_esperado:"gestor", suspenso:false, senha_provisoria:false, papeis_destino:["gestor","coordenador"] };
const pagina = { itens:[item], proximo_usuario_id:item.usuario_id };
function nodes(t:ReactNode):ReactElement<Record<string,unknown>>[] { return Children.toArray(t).flatMap(n=>isValidElement<Record<string,unknown>>(n)?[n,...nodes(n.props.children as ReactNode)]:[]); }
function render() { io.index=0; return NomeacaoDelegada(); }
function click(label:string) { return (nodes(render()).find(n=>n.props.children===label)!.props.onClick as ()=>Promise<void>)(); }
function submit(destino="coordenador") { return (nodes(render()).find(n=>n.type==="form")!.props.onSubmit as (e:unknown)=>void)({preventDefault:vi.fn(),currentTarget:{destino}}); }
const Native=globalThis.FormData;
beforeEach(()=>{ vi.resetAllMocks(); io.slots=[]; io.index=0; io.ler.mockResolvedValue({ok:true,pagina}); io.nomear.mockResolvedValue({ok:true,message:"Confirmado"}); vi.stubGlobal("FormData",class extends Native { constructor(input?:Record<string,string>){super();if(input)for(const[k,v]of Object.entries(input))this.set(k,v);} }); });
afterEach(()=>vi.unstubAllGlobals());

it("consulta backend sem gate admin/usuarios.gerenciar, pagina pelo cursor e não preseleciona destino",async()=>{
  await click("Reler contexto de nomeação"); expect(io.ler).toHaveBeenCalledWith({apos_usuario_id:null,limite:20});
  expect(renderToStaticMarkup(render())).toContain("Selecione um destino");
  await click("Próxima página");expect(io.ler).toHaveBeenLastCalledWith({apos_usuario_id:item.usuario_id,limite:20});
});
it("destino fora da projeção e no-op não invocam action; coordenador sem mudança",async()=>{
  await click("Reler contexto de nomeação"); submit("admin");submit("gestor"); expect(io.nomear).not.toHaveBeenCalled();
  io.ler.mockResolvedValue({ok:true,pagina:{...pagina,itens:[{...item,papeis_destino:["gestor"]}]}});
  await click("Reler contexto de nomeação");
  expect(nodes(render()).find(n=>n.props.children==="Nomear")!.props.disabled).toBe(true);
  expect(renderToStaticMarkup(render())).toContain("Gestor → Gestor");
});
it.each([true,false])("CAS literal, duplo envio bloqueado e releitura após ok=%s",async(ok)=>{
  await click("Reler contexto de nomeação");
  let resolve!:(v:unknown)=>void;io.nomear.mockImplementation(()=>new Promise(r=>{resolve=r;}));
  submit();submit();expect(io.nomear).toHaveBeenCalledOnce();
  expect(Object.fromEntries(io.nomear.mock.calls[0][1])).toEqual({id:item.usuario_id,papel_atual_esperado:"gestor",papel_destino:"coordenador"});
  expect(nodes(render()).find(n=>n.type==="section")!.props["aria-busy"]).toBe(true);
  resolve({ok,message:ok?"Confirmado":"PAPEL_ALTERADO"});await Promise.resolve();
  expect(nodes(render()).some(n=>n.type==="form")).toBe(false);
  expect(renderToStaticMarkup(render())).toContain(ok?"Confirmado":"PAPEL_ALTERADO");
  await click("Reler contexto de nomeação");expect(io.ler).toHaveBeenCalledTimes(2);
});
it("negação não é vazio; erro técnico permite retry de leitura",async()=>{
  io.ler.mockResolvedValue({ok:false,message:"ACESSO_NEGADO"});await click("Reler contexto de nomeação");
  expect(renderToStaticMarkup(render())).toContain("ACESSO_NEGADO");expect(renderToStaticMarkup(render())).not.toContain("página confirmada");
  io.ler.mockRejectedValue(new Error("offline"));await click("Reler contexto de nomeação");expect(renderToStaticMarkup(render())).toContain("Consulta não confirmada");
  io.ler.mockResolvedValue({ok:true,pagina:{itens:[],proximo_usuario_id:null}});await click("Reler contexto de nomeação");expect(renderToStaticMarkup(render())).toContain("Nenhum usuário nesta página confirmada");
});
it("resposta após desmontagem é descartada",async()=>{
  let resolve!:(v:unknown)=>void;io.ler.mockImplementation(()=>new Promise(r=>{resolve=r;}));
  const p=click("Reler contexto de nomeação");io.cleanup();resolve({ok:true,pagina});await p;expect(io.slots[0]).toBeNull();
});
