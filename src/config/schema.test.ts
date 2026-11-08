import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { MIGRATION_ESPERADA } from "./schema";

describe("MIGRATION_ESPERADA", () => {
  it("é a última migration do repositório", () => {
    const pasta = new URL("../../supabase/migrations/", import.meta.url);
    const ultima = readdirSync(pasta)
      .map((arquivo) => /^(\d{4})_[a-z0-9_]+\.sql$/.exec(arquivo)?.[1])
      .filter((v): v is string => Boolean(v))
      .sort()
      .at(-1);
    expect(MIGRATION_ESPERADA).toBe(ultima);
  });
});
