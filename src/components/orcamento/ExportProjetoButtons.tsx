"use client";

import { useState } from "react";
import { FileSpreadsheet, FileText } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type {
  ProjetoCalculo,
  ProjetoExportInfo,
  ProjetoExportItem,
} from "@/lib/project-budget/exporters";

type Props = {
  info: ProjetoExportInfo;
  itens: ProjetoExportItem[];
  calculo: ProjetoCalculo;
};

export function ExportProjetoButtons({ info, itens, calculo }: Props) {
  const [carregando, setCarregando] = useState<"xlsx" | "docx" | null>(null);

  async function exportar(formato: "xlsx" | "docx") {
    if (carregando) return;
    setCarregando(formato);
    try {
      const mod = await import("@/lib/project-budget/exporters");
      if (formato === "xlsx") {
        await mod.exportProjetoXlsx(info, itens, calculo);
      } else {
        await mod.exportProjetoDocx(info, itens, calculo);
      }
      toast.success(`Orçamento exportado em ${formato.toUpperCase()}.`);
    } catch (erro) {
      console.error(erro);
      toast.error("Não foi possível gerar o arquivo. Tente novamente.");
    } finally {
      setCarregando(null);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={carregando !== null}
        onClick={() => exportar("xlsx")}
      >
        <FileSpreadsheet aria-hidden />
        {carregando === "xlsx" ? "Gerando…" : "Planilha interna (XLSX)"}
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={carregando !== null}
        onClick={() => exportar("docx")}
      >
        <FileText aria-hidden />
        {carregando === "docx" ? "Gerando…" : "Documento interno (DOCX)"}
      </Button>
    </div>
  );
}
