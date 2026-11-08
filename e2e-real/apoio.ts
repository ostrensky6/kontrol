import { expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

export const ADMIN = "admin.e2e@kontrol.local";
export const COMPRA = "compra.e2e@kontrol.local";

export function senha(): string {
  const valor = process.env.E2E_REAL_SENHA;
  if (!valor) throw new Error("E2E_REAL_SENHA ausente.");
  return valor;
}

/** Entra pela tela de login de verdade (Supabase Auth local). */
export async function entrar(page: Page, email: string, senhaUsada = senha()) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha", { exact: true }).fill(senhaUsada);
  await page.getByRole("button", { name: "Entrar" }).click();
}

export async function entrarComo(page: Page, email: string) {
  await entrar(page, email);
  await expect(page).not.toHaveURL(/\/login/);
}

/** Cliente com a chave pública, autenticado como o usuário (RLS de verdade). */
export async function clienteDoUsuario(email: string) {
  const cliente = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { error } = await cliente.auth.signInWithPassword({ email, password: senha() });
  if (error) throw new Error(`Login de ${email} falhou: ${error.message}`);
  return cliente;
}
