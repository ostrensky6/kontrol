import { redirect } from "next/navigation";

/** "Configurações" na barra de Orçamentos abre a primeira das três telas; as abas levam às outras. */
export default function ConfiguracoesOrcamentoRedirectPage() {
  redirect("/orcamento/parametros");
}
