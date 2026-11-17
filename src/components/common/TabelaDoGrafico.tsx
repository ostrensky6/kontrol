import type { ReactNode } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableRowHead } from "@/components/ui/table";

export type ColunaDoGrafico<T> = {
  rotulo: string;
  valor: (linha: T) => ReactNode;
};

/**
 * Versão em texto de um gráfico, só para leitor de tela: o desenho do recharts
 * não diz nada a quem não enxerga, então os mesmos números vão numa tabela
 * escondida da tela.
 */
export function TabelaDoGrafico<T>({
  titulo,
  colunas,
  linhas,
  chave,
}: {
  titulo: string;
  colunas: ColunaDoGrafico<T>[];
  linhas: T[];
  chave: (linha: T, indice: number) => string;
}) {
  if (linhas.length === 0) return null;
  return (
    // sr-only no <div>: na tabela o width de 1px não segura e a tabela
    // escondida alarga a página no celular.
    <div className="sr-only">
      <Table>
        <caption>{titulo}</caption>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {colunas.map((coluna) => (
              <TableHead key={coluna.rotulo} scope="col">
                {coluna.rotulo}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {linhas.map((linha, indice) => (
            <TableRow key={chave(linha, indice)}>
              {colunas.map((coluna, i) =>
                i === 0 ? (
                  <TableRowHead key={coluna.rotulo}>
                    {coluna.valor(linha)}
                  </TableRowHead>
                ) : (
                  <TableCell key={coluna.rotulo}>{coluna.valor(linha)}</TableCell>
                ),
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/** Pega no máximo `limite` pontos espalhados, sempre com o primeiro e o último. */
export function amostrarPontos<T>(linhas: T[], limite = 24): T[] {
  if (linhas.length <= limite) return linhas;
  const passo = (linhas.length - 1) / (limite - 1);
  return Array.from(
    { length: limite },
    (_, i) => linhas[Math.round(i * passo)],
  );
}
