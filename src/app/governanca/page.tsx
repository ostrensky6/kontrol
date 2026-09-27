import { redirect } from "next/navigation";

import { temPermissao } from "@/lib/auth/permissao-efetiva";

/** A governança abre na auditoria para quem tem "Ver auditoria" (a caixinha manda). */
export default async function GovernancaRedirectPage() {
  if (await temPermissao("auditoria.visualizar")) {
    redirect("/auditoria");
  }
  redirect("/sem-acesso?area=Auditoria");
}
