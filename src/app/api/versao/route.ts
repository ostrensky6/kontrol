import { APP_VERSION } from "@/config/app";
import { MIGRATION_ESPERADA } from "@/config/schema";

export const dynamic = "force-dynamic";

/**
 * Rastreabilidade da publicação: qual versão, qual commit e qual migration
 * esta publicação espera no banco. Não expõe dado do laboratório; o
 * prod:check e quem publica comparam com o registro de migrations do banco.
 */
export function GET() {
  return Response.json(
    {
      versao: APP_VERSION,
      commit: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
      ambiente: process.env.VERCEL_ENV ?? null,
      migration_esperada: MIGRATION_ESPERADA,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
