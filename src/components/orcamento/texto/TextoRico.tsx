import { Fragment, type ReactNode } from "react";

import type { DocTexto, NoBloco, NoInline } from "@/lib/orcamento/texto-rico";

/** Desenha o texto formatado (sem HTML cru): igual na tela, na impressão e no link. */
export function TextoRico({ doc, className = "" }: { doc: DocTexto | null | undefined; className?: string }) {
  if (!doc || doc.content.length === 0) return null;
  return <div className={`texto-rico space-y-2 text-sm leading-6 ${className}`}>{doc.content.map(bloco)}</div>;
}

function inline(nos: NoInline[] | undefined): ReactNode {
  return (nos ?? []).map((no, i) => {
    if (no.type === "hardBreak") return <br key={i} />;
    const negrito = no.marks?.some((m) => m.type === "bold");
    return negrito ? <strong key={i} className="font-semibold">{no.text}</strong> : <Fragment key={i}>{no.text}</Fragment>;
  });
}

function bloco(no: NoBloco, i: number): ReactNode {
  switch (no.type) {
    case "heading":
      return <h4 key={i} className="pt-1 text-sm font-semibold">{inline(no.content)}</h4>;
    case "bulletList":
    case "orderedList": {
      const Lista = no.type === "bulletList" ? "ul" : "ol";
      return (
        <Lista key={i} className={`space-y-1 pl-5 ${no.type === "bulletList" ? "list-disc" : "list-decimal"}`}>
          {no.content.map((item, j) => (
            <li key={j}>
              {item.content.map((p, k) => (
                <p key={k}>{inline(p.content)}</p>
              ))}
            </li>
          ))}
        </Lista>
      );
    }
    default:
      return <p key={i}>{inline(no.content)}</p>;
  }
}
