import { mensagemErroLink } from "@/lib/auth/link-email";
import { LoginForm } from "./LoginForm";

type Params = Record<string, string | string[] | undefined>;

function primeiro(valor: string | string[] | undefined) {
  return Array.isArray(valor) ? valor[0] : valor;
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const aviso = mensagemErroLink({
    erro: primeiro(params.erro),
    error_code: primeiro(params.error_code),
    error: primeiro(params.error),
  });
  return <LoginForm aviso={aviso} />;
}
