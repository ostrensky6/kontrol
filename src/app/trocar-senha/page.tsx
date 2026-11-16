import { TrocarSenhaForm } from "./TrocarSenhaForm";

export default async function TrocarSenhaPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { recuperacao } = await searchParams;
  return <TrocarSenhaForm recuperacao={recuperacao === "1"} />;
}
