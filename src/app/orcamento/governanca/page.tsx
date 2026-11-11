import { redirect } from "next/navigation";

/** As regras do orçamento passaram para a Governança (revisão de 11/11, L6). O endereço antigo continua valendo. */
export default function RegrasOrcamentoRedirectPage() {
  redirect("/governanca/regras");
}
