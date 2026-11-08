import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import { VinculosProjetoPainel } from "./VinculosProjetoPainel";

const io=vi.hoisted(()=>({slots:[] as unknown[],index:0,cleanup:()=>{},ler:vi.fn(),gravar:vi.fn()}));
vi.mock("react",async(original)=>({...await original<typeof import("react")>(),
  useState:(initial:unknown)=>{const i=io.index++;if(!(i in io.slots))io.slots[i]=initial;return[io.slots[i],(v:unknown)=>{io.slots[i]=v;}];},
  useRef:(initial:unknown)=>{const i=io.index++;if(!(i in io.slots))io.slots[i]={current:initial};return io.slots[i];},
  useEffect:(effect:()=>()=>void)=>{const i=io.index++;if(!(i in io.slots)){io.slots[i]=true;io.cleanup=effect();}},
}));
vi.mock("next/navigation",()=>({unstable_rethrow:vi.fn()}));
vi.mock("@/lib/actions/vinculos-projeto",()=>({listarVinculosProjeto:io.ler,configurarVinculoProjeto:io.gravar}));
const item={usuario_id:"00000000-0000-4000-8000-000000000002",nome:"Pessoa",papel:"admin",suspenso:false,senha_provisoria:false,vinculado:true,coordenacao_direta:false};
const leitura={ok:true,escrita_habilitada:true,pagina:{projeto_id:42,itens:[item],proximo_usuario_id:item.usuario_id}};
function nodes(t:ReactNode):ReactElement<Record<string,unknown>>[]{return Children.toArray(t).flatMap(n=>isValidElement<Record<string,unknown>>(n)?[n,...nodes(n.props.children as ReactNode)]:[]);}
function render(){io.index=0;const n=VinculosProjetoPainel({projetoId:42});return (n.type as (p:typeof n.props)=>ReactNode)(n.props);}
function click(label:string){return(nodes(render()).find(n=>n.props.children===label)!.props.onClick as ()=>Promise<void>)();}
beforeEach(()=>{vi.resetAllMocks();io.slots=[];io.index=0;io.ler.mockResolvedValue(leitura);io.gravar.mockResolvedValue({ok:true,recibo:{}});});

it("usa projeto confirmado e cursor literal; ID não é campo livre",async()=>{
  await click("Reler vínculos do projeto");expect(io.ler).toHaveBeenCalledWith({projeto_id:42,apos_usuario_id:null,limite:20});
  await click("Próxima página");expect(io.ler).toHaveBeenLastCalledWith({projeto_id:42,apos_usuario_id:item.usuario_id,limite:20});
  expect(nodes(render()).some(n=>n.type==="input")).toBe(false);
});
it("flag off mantém leitura e bloqueia escrita até no handler",async()=>{
  io.ler.mockResolvedValue({...leitura,escrita_habilitada:false});await click("Reler vínculos do projeto");
  expect(nodes(render()).find(n=>n.props.children==="Remover vínculo explícito")!.props.disabled).toBe(true);
  await click("Remover vínculo explícito");expect(io.gravar).not.toHaveBeenCalled();
});
it.each([true,false])("papel mudado continua removível, double submit e releitura após ok=%s",async(ok)=>{
  await click("Reler vínculos do projeto");let resolve!:(v:unknown)=>void;io.gravar.mockImplementation(()=>new Promise(r=>{resolve=r;}));
  const p=click("Remover vínculo explícito");await click("Remover vínculo explícito");
  expect(io.gravar).toHaveBeenCalledExactlyOnceWith({projeto_id:42,usuario_id:item.usuario_id,vinculado:false});
  resolve({ok,message:"Não confirmado"});await p;
  expect(renderToStaticMarkup(render())).toContain("Releia");expect(renderToStaticMarkup(render())).not.toContain("Remover vínculo explícito");
  await click("Reler vínculos do projeto");expect(io.ler).toHaveBeenCalledTimes(2);
});
it("adiciona sem remover coordenação; mostra estado direto separado",async()=>{
  io.ler.mockResolvedValue({...leitura,pagina:{...leitura.pagina,itens:[{...item,papel:"coordenador",vinculado:false,coordenacao_direta:true}]}});
  await click("Reler vínculos do projeto");expect(renderToStaticMarkup(render())).toContain("remover o vínculo não remove a coordenação");
  await click("Adicionar vínculo explícito");expect(io.gravar).toHaveBeenCalledWith({projeto_id:42,usuario_id:item.usuario_id,vinculado:true});
});
it("negação, erro e página vazia são distintos; ausência não é desvínculo",async()=>{
  io.ler.mockResolvedValue({ok:false,message:"NAO_AUTORIZADO"});await click("Reler vínculos do projeto");expect(renderToStaticMarkup(render())).toContain("NAO_AUTORIZADO");
  io.ler.mockRejectedValue(new Error("offline"));await click("Reler vínculos do projeto");expect(renderToStaticMarkup(render())).toContain("Leitura não confirmada");
  io.ler.mockResolvedValue({...leitura,pagina:{...leitura.pagina,itens:[]}});await click("Reler vínculos do projeto");
  expect(renderToStaticMarkup(render())).toContain("Nenhum usuário nesta página confirmada");expect(renderToStaticMarkup(render())).toContain("ausência nesta página não significa desvínculo");
});
it("troca de projeto remonta; resposta tardia do anterior não ocupa o novo contexto",async()=>{
  expect(VinculosProjetoPainel({projetoId:43}).key).not.toBe(VinculosProjetoPainel({projetoId:42}).key);
  let resolve!:(v:unknown)=>void;io.ler.mockImplementation(()=>new Promise(r=>{resolve=r;}));const p=click("Reler vínculos do projeto");io.cleanup();resolve(leitura);await p;expect(io.slots[0]).toBeNull();
});
it("descarta resposta correlacionada a outro projeto",async()=>{
  io.ler.mockResolvedValue({...leitura,pagina:{...leitura.pagina,projeto_id:43}});await click("Reler vínculos do projeto");expect(renderToStaticMarkup(render())).toContain("outro projeto descartada");expect(io.slots[0]).toBeNull();
});
