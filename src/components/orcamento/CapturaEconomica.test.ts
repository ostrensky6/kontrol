import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import ts from "typescript";
import * as jsxRuntime from "react/jsx-runtime";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CapturaEconomica, HistoricoEconomico } from "./CapturaEconomica";
import type { ContextoCaptura, LeituraContextoCaptura } from "@/lib/orcamento/captura-equivalencia-leitura";
const io=vi.hoisted(()=>({slots:[] as unknown[],index:0,preparar:vi.fn(),capturar:vi.fn(),historico:vi.fn(),refresh:vi.fn()}));
vi.mock("react",async(original)=>({...await original<typeof import("react")>(),
  useState:(initial:unknown)=>{const i=io.index++;const slots=io.slots;if(!(i in slots))slots[i]=initial;return [slots[i],(v:unknown)=>{slots[i]=v;}];},
  useRef:(v:unknown)=>{const i=io.index++;if(!(i in io.slots))io.slots[i]={current:v};return io.slots[i];},
  useEffect:(fn:()=>()=>void,deps:unknown[])=>{const i=io.index++;const old=io.slots[i] as {deps:string;cleanup:()=>void}|undefined;if(old?.deps!==JSON.stringify(deps)){old?.cleanup();io.slots[i]={deps:JSON.stringify(deps),cleanup:fn()};}},
}));
vi.mock("next/navigation",()=>({useRouter:()=>({refresh:io.refresh}),unstable_rethrow:vi.fn()}));
vi.mock("@/lib/actions/captura-orcamento-equivalencia",()=>({capturarNovoOrcamentoEquivalencia:io.capturar}));
const c:ContextoCaptura={versao:"captura-economica-leitura-v1",estado:"contexto",orcamento_id:7,demanda:{id:9,titulo:null,modalidade:"laboratorio"},modulo:"laboratorio",revisao:2,status:"rascunho",status_operacional:"preenchido",modo:"sem_captura",edicao_legada_bloqueada:false,capacidades:{consultar:true,preparar_intencao:true},captura_habilitada:true,referencias_documentais:"atestacao_explicita_sem_catalogo_de_revisoes",fontes_economicas:"nao_verificadas",cas_escrita:"custo_revisao",contexto_ref:"captura-contexto:"+"a".repeat(32),historico:[],historico_total:0,historico_truncado:false,
itens:[{id:1,codigo_analise:"A1",n_amostras:5,custo_unitario:null,preco_unitario:null,valor_snapshot:null,metodos_documentados:[{metodo_revisao_ref:"metodo:r1",estado_validacoes:"disponivel",contexto_ref:"b".repeat(32),tem_validacao_vigente:true,referencias:[]}]}]};
function nodes(t:ReactNode):ReactElement<Record<string,unknown>>[]{return Children.toArray(t).flatMap(n=>isValidElement<Record<string,unknown>>(n)?[n,...nodes(n.props.children as ReactNode)]:[]);}
function render(contexto=c){io.index=0;return CapturaEconomica({orcamentoId:7,contexto,prepararAction:io.preparar});}
const campos={confirmar:"sim","metodo-1":"metodo:r1"};
function submit(data:Record<string,string>=campos){return(nodes(render()).find(n=>n.type==="form")!.props.onSubmit as (e:unknown)=>Promise<void>)({preventDefault:vi.fn(),currentTarget:data});}
function retry(){return(nodes(render()).find(n=>n.props.children==="Repetir intenção original, sem preparar novamente")!.props.onClick as ()=>Promise<void>)();}
const Native=globalThis.FormData;
beforeEach(()=>{vi.resetAllMocks();io.slots=[];io.index=0;vi.stubGlobal("FormData",class extends Native{constructor(data?:Record<string,string>){super();if(data)for(const[k,v]of Object.entries(data))this.set(k,v);}});io.preparar.mockImplementation(async p=>({estado:"preparada",...p}));io.capturar.mockResolvedValue({ok:false,motivo:"resultado_indeterminado",message:"Incerto"});});
afterEach(()=>vi.unstubAllGlobals());
function parPreservado() {
  const capturaSlots:unknown[]=[], historicoSlots:unknown[]=[];
  return (contexto:LeituraContextoCaptura, geracaoLeitura="leitura-1") => {
    io.slots=capturaSlots;io.index=0;const captura=CapturaEconomica({orcamentoId:7,contexto,prepararAction:io.preparar});
    io.slots=historicoSlots;io.index=0;const historico=HistoricoEconomico({orcamentoId:7,contexto,consultarAction:io.historico,...{geracaoLeitura}});
    return {captura,historico};
  };
}
function enviarArvore(tree:ReactNode, data:Record<string,string>) {
  return (nodes(tree).find(n=>n.type==="form")!.props.onSubmit as(e:unknown)=>Promise<void>)({preventDefault:vi.fn(),currentTarget:data});
}
const negado:LeituraContextoCaptura={versao:"captura-economica-leitura-v1",estado:"negado",motivo:"sem_permissao"};
const ledger={estado:"historico",recibo:{custo_total:9876.54},snapshot:{fonte:"FONTE_CONGELADA_TESTE"}};
it.each([false,true])("ORD168 duas instâncias: negação invalida histórico pendente=%s sem perder intenção",async(pendente)=>{
  const par=parPreservado();await enviarArvore(par(c).captura,campos);
  const original=io.capturar.mock.calls[0][0];
  let resolver!:(r:unknown)=>void;
  io.historico.mockImplementation(()=>pendente?new Promise(r=>{resolver=r;}):Promise.resolve(ledger));
  const leitura=enviarArvore(par(c).historico,{uuid:original.operacao_id});if(!pendente)await leitura;
  if(!pendente)expect(renderToStaticMarkup(par(c).historico)).toContain("FONTE_CONGELADA_TESTE");
  const revogado=par(negado,"leitura-2");
  expect(renderToStaticMarkup(revogado.historico)).not.toContain("FONTE_CONGELADA_TESTE");
  if(pendente){resolver(ledger);await leitura;}
  const depois=par(negado,"leitura-2");expect(renderToStaticMarkup(depois.historico)).not.toContain("FONTE_CONGELADA_TESTE");
  expect(renderToStaticMarkup(depois.historico)).toContain("negado");expect(renderToStaticMarkup(depois.captura)).toContain(original.operacao_id);
  const indisponivel={...negado,estado:"indisponivel" as const,motivo:"falha_de_leitura" as const};io.historico.mockResolvedValue(ledger);
  await enviarArvore(par(indisponivel,"leitura-3").historico,{uuid:original.operacao_id});
  expect(renderToStaticMarkup(par(indisponivel,"leitura-3").historico)).toContain("FONTE_CONGELADA_TESTE");
  expect(renderToStaticMarkup(par(indisponivel,"leitura-4").historico)).not.toContain("FONTE_CONGELADA_TESTE");
  const retryNode=nodes(par(indisponivel,"leitura-3").captura).find(n=>n.props.children==="Repetir intenção original, sem preparar novamente")!;
  await(retryNode.props.onClick as()=>Promise<void>)();expect(io.capturar.mock.calls[1][0]).toEqual(original);expect(io.preparar).toHaveBeenCalledOnce();
});
it("ORD168 resposta tardia reconcilia as duas instâncias sem aplicar recibo",async()=>{
  const par=parPreservado();let resolver!:(r:unknown)=>void;io.capturar.mockImplementation(()=>new Promise(r=>{resolver=r;}));
  const p=enviarArvore(par(c).captura,campos);await Promise.resolve();const original=io.capturar.mock.calls[0][0];
  par(negado,"leitura-2");resolver({ok:true,message:"SUCESSO_TARDIO",recibo:{operacao_id:original.operacao_id,orcamento_id:7,revisao_anterior:2,revisao_aplicada:3,quantidade_itens:1}});await p;
  expect(io.refresh).toHaveBeenCalledOnce();const result=par(negado,"leitura-3");expect(renderToStaticMarkup(result.captura)).not.toContain("SUCESSO_TARDIO");expect(renderToStaticMarkup(result.captura)).toContain(original.operacao_id);
});
it("ORD168 render real da condição da página oculta exclusão protegida e mantém rascunho legado",()=>{
  const source=readFileSync("src/app/orcamento/[id]/page.tsx","utf8");const ast=ts.createSourceFile("page.tsx",source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  let expr:ts.JsxExpression|undefined;
  const visit=(n:ts.Node)=>{if(ts.isJsxExpression(n)&&n.expression&&n.getText(ast).includes('trigger="Excluir orçamento"'))expr=n;ts.forEachChild(n,visit);};visit(ast);
  const compiled=ts.transpileModule(`const result = (${expr!.expression!.getText(ast)});`,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS}}).outputText;
  const avaliar=new Function("require","podeCancelar","capturaBloqueiaLegado","orc","cancelamentoIncompleto","CancelarComMotivo","ConfirmActionButton","cancelarOrcamento","excluirOrcamento","orcId","const exports = {};"+compiled+";return result;");
  for(const protegido of [true,false]){const tree=avaliar(()=>jsxRuntime,true,protegido,{status:"rascunho",cliente_nome:"Teste"},false,"cancelar","excluir",()=>{},()=>{},7);expect(nodes(tree).some(n=>n.props.trigger==="Excluir orçamento")).toBe(!protegido);}
});
it("flag off/capacidade negada não oferecem captura; ausência não é zero",()=>{
  expect(nodes(render({...c,captura_habilitada:false})).some(n=>n.type==="form")).toBe(false);
  expect(nodes(render({...c,capacidades:{consultar:true,preparar_intencao:false}})).some(n=>n.type==="form")).toBe(false);
  expect(renderToStaticMarkup(render({...c,itens:[]}))).toContain("não representa custo zero");
});
it("exige opt-in e método do contexto, antes de preparar ou capturar",async()=>{
  await submit({"metodo-1":"metodo:r1"});await submit({confirmar:"sim","metodo-1":"injetado"});expect(io.preparar).not.toHaveBeenCalled();expect(io.capturar).not.toHaveBeenCalled();
});
it("primeira captura prepara uma vez; double submit e retry preservam intenção completa",async()=>{
  const p=submit();await submit();await p;expect(io.preparar).toHaveBeenCalledOnce();expect(io.capturar).toHaveBeenCalledOnce();
  const t=io.capturar.mock.calls[0][0];expect(t).toEqual({versao:"equivalencia-economica-v1",orcamento_id:7,revisao_esperada:2,operacao_id:expect.any(String),metodos:{A1:"metodo:r1"}});
  await retry();expect(io.preparar).toHaveBeenCalledOnce();expect(io.capturar.mock.calls[1][0]).toEqual(t);
  expect(renderToStaticMarkup(render())).toContain("somente em memória");
});
it.each(["revisao_obsoleta","identidade_reutilizada","negada","fonte_pendente"])("%s visível sem replay cego",async(motivo)=>{
  io.capturar.mockResolvedValue({ok:false,motivo,message:"Confira"});await submit();expect(renderToStaticMarkup(render())).toContain(motivo);expect(renderToStaticMarkup(render())).not.toContain("Repetir intenção original");
});
it("recusa preparação e descarta resposta de contexto anterior",async()=>{
  let resolve!:(v:unknown)=>void;io.preparar.mockImplementation(()=>new Promise(r=>{resolve=r;}));const p=submit();render({...c,contexto_ref:"captura-contexto:"+"c".repeat(32)});resolve({estado:"preparada",...io.preparar.mock.calls[0][0]});await p;expect(io.capturar).not.toHaveBeenCalled();
});
it("recibo confirmado relê contexto; não é estado atual",async()=>{
  io.capturar.mockImplementation(async t=>({ok:true,message:"Confirmada",recibo:{operacao_id:t.operacao_id,orcamento_id:7,revisao_anterior:2,revisao_aplicada:3,quantidade_itens:1,replay:false}}));await submit();expect(io.refresh).toHaveBeenCalledOnce();expect(renderToStaticMarkup(render())).toContain("Não substitui o estado atual");
});
it("histórico é independente de contexto indisponível e não recalcula preços",async()=>{
  const props={orcamentoId:7,geracaoLeitura:"teste-1",contexto:{versao:"captura-economica-leitura-v1" as const,estado:"indisponivel" as const,motivo:"falha_de_leitura" as const},consultarAction:io.historico};
  io.index=0;const tree=HistoricoEconomico(props);io.historico.mockResolvedValue({estado:"indisponivel",motivo:"falha_de_leitura"});
  await(nodes(tree).find(n=>n.type==="form")!.props.onSubmit as(e:unknown)=>Promise<void>)({preventDefault:vi.fn(),currentTarget:{uuid:"11111111-1111-4111-8111-111111111111"}});
  expect(io.historico).toHaveBeenCalledWith("11111111-1111-4111-8111-111111111111");io.index=0;expect(renderToStaticMarkup(HistoricoEconomico(props))).toContain("Falha não significa operação inexistente");expect(io.capturar).not.toHaveBeenCalled();
});
it("página mantém fronteira server e bloqueia writers legados pelo contexto",()=>{
  const s=readFileSync("src/app/orcamento/[id]/page.tsx","utf8");expect(s).not.toMatch(/^['"]use client/);expect(s).toContain('"use server"');expect(s).toContain("contextoCaptura.edicao_legada_bloqueada");expect(s).toContain("podeRecalcular && !capturaBloqueiaLegado");expect(s).toContain("podeRevisar && !capturaBloqueiaLegado");expect(s).toContain("bloqueado={bloqueado}");expect(s).toContain("<HistoricoEconomico");
});
it("histórico apresenta valores congelados e lista truncada sem usar catálogo vivo",async()=>{
  const props={orcamentoId:7,geracaoLeitura:"teste-1",contexto:{...c,historico_total:21,historico_truncado:true},consultarAction:io.historico};
  io.index=0;const tree=HistoricoEconomico(props);
  expect(renderToStaticMarkup(tree)).toContain("últimos 20");
  io.historico.mockResolvedValue({estado:"historico",hash_confere:true,recibo:{custo_total:12.34},snapshot:{itens:[{codigo_analise:"A1",valor_snapshot:{proveniencia_dimensional:[{fonte_custo:"custo_medio_ponderado",referencia_custo:"referencia-congelada",unidade_estoque:"frasco",unidade_consumo:"mL",fator_conversao:100,custo_unitario_estoque:12.34}]}}]}});
  await(nodes(tree).find(n=>n.type==="form")!.props.onSubmit as(e:unknown)=>Promise<void>)({preventDefault:vi.fn(),currentTarget:{uuid:"11111111-1111-4111-8111-111111111111"}});
  io.index=0;const html=renderToStaticMarkup(HistoricoEconomico(props));
  for(const s of ["12.34","referencia-congelada","frasco","mL","100","não nova auditoria matemática","sem preço vivo"])expect(html).toContain(s);
  expect(io.preparar).not.toHaveBeenCalled();expect(io.capturar).not.toHaveBeenCalled();
});
it("resposta tardia de captura não substitui estado e preserva intenção para consulta",async()=>{
  let resolve!:(v:unknown)=>void;io.capturar.mockImplementation(()=>new Promise(r=>{resolve=r;}));
  const p=submit();await Promise.resolve();const t=io.capturar.mock.calls[0][0];
  render({...c,contexto_ref:"captura-contexto:"+"d".repeat(32)});
  resolve({ok:true,message:"Tardia",recibo:{operacao_id:t.operacao_id,orcamento_id:7,revisao_anterior:2,revisao_aplicada:3,quantidade_itens:1}});await p;
  const html=renderToStaticMarkup(render({...c,contexto_ref:"captura-contexto:"+"d".repeat(32)}));expect(html).not.toContain("Tardia");expect(html).toContain(t.operacao_id);expect(html).toContain("resultado_indeterminado");
});
it("preparação recusada e contexto negado não chamam captura",async()=>{
  io.preparar.mockResolvedValue({estado:"recusada",motivo:"contexto_alterado"});await submit();expect(io.capturar).not.toHaveBeenCalled();expect(renderToStaticMarkup(render())).toContain("contexto_alterado");
  io.index=0;const tree=CapturaEconomica({orcamentoId:7,contexto:{estado:"negado",versao:"captura-economica-leitura-v1",motivo:"sem_permissao"},prepararAction:io.preparar});expect(nodes(tree).some(n=>n.type==="form")).toBe(false);expect(renderToStaticMarkup(tree)).toContain("Não significa ausência de captura");
});
