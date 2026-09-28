"use client";

import { useState } from "react";
import { FileSpreadsheet, FileText } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { ModeloDocumentoProposta } from "@/lib/orcamento/documento-proposta";
import type { PropostaFinalExport } from "@/lib/orcamento/proposta-final-export";

type Props = {
  /** planilha interna (custos e parâmetros); null = sem a permissão de pessoal (DC8), só o documento */
  dados: PropostaFinalExport | null;
  /** documento do cliente, o mesmo da folha A4 */
  documento: ModeloDocumentoProposta;
};

export function ExportOrcamentoFinalButtons({ dados, documento }: Props) {
  const [carregando, setCarregando] = useState<"xlsx" | "docx" | null>(null);

  async function exportar(formato: "xlsx" | "docx") {
    if (carregando) return;
    setCarregando(formato);
    try {
      const mod = await import("@/lib/orcamento/final-exporters");
      if (formato === "xlsx") {
        if (dados) await mod.exportOrcamentoFinalXlsx(dados);
      } else {
        await mod.exportOrcamentoFinalDocx(documento);
      }
      toast.success(formato === "xlsx" ? "Planilha interna gerada." : "Proposta gerada em DOCX.");
    } catch (erro) {
      console.error(erro);
      toast.error("Não foi possível gerar o arquivo. Tente novamente.");
    } finally {
      setCarregando(null);
    }
  }

  return (
    <div className="flex items-center gap-2">
      {dados && (
        <Button
          type="button"
          variant="outline"
          disabled={carregando !== null}
          onClick={() => exportar("xlsx")}
        >
          <FileSpreadsheet aria-hidden />
          {carregando === "xlsx" ? "Gerando…" : "Planilha interna (XLSX)"}
        </Button>
      )}
      <Button
        type="button"
        variant="outline"
        disabled={carregando !== null}
        onClick={() => exportar("docx")}
      >
        <FileText aria-hidden />
        {carregando === "docx" ? "Gerando…" : "Proposta (DOCX)"}
      </Button>
    </div>
  );
}
