import { irParaEtapaDaDemanda } from "@/lib/actions/demandas";
import { ROTULO_ETAPA, vizinhasEtapa, type EtapaId } from "@/lib/orcamento/etapas-proposta";

/**
 * Barra presa no pé da tela com "← etapa anterior" e "Próxima: … →" (dono, 28/09:
 * o botão de seguir tem de estar sempre à vista). "Próxima" passa pelo servidor para
 * criar o orçamento de custo da etapa quando ainda não existe; o aviso só informa o
 * que falta, nunca impede de seguir.
 */
export function NavegacaoEtapas({
  demandaId,
  modalidade,
  atual,
  aviso,
}: {
  demandaId: number;
  modalidade: string | null | undefined;
  atual: EtapaId;
  aviso?: string | null;
}) {
  const { anterior, proxima } = vizinhasEtapa(modalidade, atual);
  if (!anterior && !proxima) return null;

  return (
    <nav
      aria-label="Etapas do orçamento"
      className="no-print sticky bottom-0 z-10 mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card/95 px-4 py-2.5 shadow-sm backdrop-blur"
    >
      {anterior ? (
        <a
          href={`/orcamento/demandas/${demandaId}?etapa=${anterior}`}
          className="min-h-10 rounded-md border border-input bg-card px-4 py-2 text-sm font-medium hover:bg-muted"
        >
          ← {ROTULO_ETAPA[anterior]}
        </a>
      ) : (
        <span />
      )}
      <div className="flex flex-wrap items-center justify-end gap-3">
        {aviso && <span className="text-xs font-medium text-warning-strong">{aviso}</span>}
        {proxima && (
          <form action={irParaEtapaDaDemanda}>
            <input type="hidden" name="demanda_id" value={demandaId} />
            <input type="hidden" name="etapa" value={proxima} />
            <button className="min-h-10 rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-500">
              Próxima: {ROTULO_ETAPA[proxima]} →
            </button>
          </form>
        )}
      </div>
    </nav>
  );
}
