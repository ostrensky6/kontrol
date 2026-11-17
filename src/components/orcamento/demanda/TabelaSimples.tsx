import type { ReactNode } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export function TabelaSimples({
  colunas,
  linhas,
  vazio,
}: {
  colunas: string[];
  linhas: ReactNode[][];
  vazio: string;
}) {
  return (
    <div className="mt-4 overflow-x-auto rounded-md border border-border">
      <Table>
        <TableHeader className="bg-muted/60">
          <TableRow className="hover:bg-transparent">
            {colunas.map((coluna) => (
              <TableHead key={coluna}>
                {coluna}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {linhas.length > 0 ? (
            linhas.map((linha, index) => (
              <TableRow key={index} className="align-top">
                {linha.map((celula, celulaIndex) => (
                  <TableCell key={celulaIndex} className="max-w-sm text-foreground">
                    {celula}
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : (
            <TableRow>
              <TableCell colSpan={colunas.length} className="py-4 text-xs text-muted-foreground/80">
                {vazio}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
