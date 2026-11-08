import { readFileSync } from "node:fs";
import ts from "typescript";
import { expect, it, vi } from "vitest";
import * as jsx from "react/jsx-runtime";
const source=readFileSync("src/app/orcamento/final/[id]/page.tsx","utf8");
const snapshot={demanda:{id:1,titulo:"Congelado"},empresa_emissora:{codigo:"GIA",nome_legal:"Empresa histórica",cnpj:null,endereco:null,telefone:null,email:null,site:null},nomes_analises:{A:"Nome histórico"},textos_proposta:{descricao:"Histórico"}};
async function projetar(estado:string){
 const entrada=vi.fn(()=>({})),documento=vi.fn<(args:Record<string,unknown>)=>object>(()=>({})),exportar=vi.fn<(args:Record<string,unknown>)=>object>(()=>({})),complementos=vi.fn(async()=>({nomesAnalises:{A:"Nome vivo diferente"},empresa:{nomeLegal:"Atual"}}));
 const codigo=source.slice(source.indexOf("  const snapshotDocumento ="),source.indexOf("  const statusLabel ="));
 const args={contrato:{estado,snapshot,total:55},versao:{snapshot,total_final:55,textos_proposta:"Coluna versionada"},demandaAtual:{titulo:"Atual"},lerSnapshot:(s:unknown)=>s,resolverIdentidadeComAviso:()=>({identidade:{responsavel:"Atual"}}),carregarComplementosDocumento:complementos,supabase:{},entradaDoSnapshot:entrada,montarVisaoInterna:()=>({}),montarFundos:()=>({}),acompanhamento:null,textosDaVersao:vi.fn(()=>({})),formatDate:()=>"",montarDocumentoProposta:documento,empresaDoSnapshot:()=>null,montarPropostaFinalExport:exportar};
 const js=ts.transpileModule(`async function run(){${codigo}}`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 await new Function(...Object.keys(args),js+";return run();")(...Object.values(args));return {entrada,documento,exportar,complementos};
}
it("ORD174 novo ramo não consulta complementos e preserva fonte histórica/null",async()=>{
 const r=await projetar("equivalencia");expect(r.complementos).not.toHaveBeenCalled();expect(r.entrada).toHaveBeenCalledExactlyOnceWith(snapshot,55);expect(r.documento.mock.calls[0][0]).toMatchObject({demanda:snapshot.demanda,empresa:{nomeLegal:"Empresa histórica",cnpj:null,email:null}});expect(r.exportar.mock.calls[0][0].snapshot).toBe(snapshot);
});
it("ORD174 legado conserva complementos",async()=>{const r=await projetar("legado");expect(r.complementos).toHaveBeenCalledOnce();expect(r.entrada).toHaveBeenCalledWith(snapshot,55,{A:"Nome vivo diferente"});});
it("ORD174 invalidação encerra antes do pipeline",()=>{
 const trecho=source.slice(source.indexOf("  const contrato ="),source.indexOf("  const [{ data: planoGerado"));
 const js=ts.transpileModule(`function run(){${trecho}throw Error('continuou');}`,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS}}).outputText;
 const validar=vi.fn(()=>({estado:"invalido",message:"Snapshot inválido"}));
 const tree=new Function("require","versao","validarHistoricoFinalEquivalencia","const exports={};"+js+";return run();")(()=>jsx,{snapshot:{captura_economica_versao:"desconhecida"},total_final:null},validar);
 expect(tree.props.children[1].props.role).toBe("alert");expect(validar).toHaveBeenCalledWith({captura_economica_versao:"desconhecida"},null);
});
