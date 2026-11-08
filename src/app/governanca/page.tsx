import { redirect } from "next/navigation";

import { temPermissao } from "@/lib/auth/permissao-efetiva";

/** A governança abre na auditoria para quem tem "Ver auditoria" (a caixinha manda); os demais vão aos incidentes, que todos veem. */
export default async function GovernancaRedirectPage() {
  if (await temPermissao("auditoria.visualizar")) {
    redirect("/auditoria");
  }
  redirect("/governanca/incidentes");
}
