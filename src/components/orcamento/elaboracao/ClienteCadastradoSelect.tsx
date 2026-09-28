"use client";

export type ClienteCadastro = {
  id: number;
  nome: string;
  cnpj: string | null;
  contato: string | null;
  email: string | null;
  telefone: string | null;
  endereco: string | null;
};

// campo do formulário ← dado do cadastro
const PREENCHER: Array<[string, keyof ClienteCadastro]> = [
  ["cliente_nome", "nome"],
  ["cliente_cnpj", "cnpj"],
  ["cliente_contato", "contato"],
  ["cliente_email", "email"],
  ["cliente_telefone", "telefone"],
  ["cliente_endereco", "endereco"],
];

/**
 * Escolher um cliente cadastrado preenche os dados dele no formulário (o que
 * estiver em branco no cadastro não apaga o que foi digitado).
 */
export function ClienteCadastradoSelect({
  id,
  name,
  clientes,
  valorInicial,
  className,
}: {
  id: string;
  name: string;
  clientes: ClienteCadastro[];
  valorInicial: number | null;
  className?: string;
}) {
  return (
    <select
      id={id}
      name={name}
      defaultValue={valorInicial ?? ""}
      suppressHydrationWarning
      className={className}
      onChange={(e) => {
        const cliente = clientes.find((c) => String(c.id) === e.currentTarget.value);
        const form = e.currentTarget.form;
        if (!cliente || !form) return;
        for (const [campo, chave] of PREENCHER) {
          const valor = cliente[chave];
          const alvo = form.elements.namedItem(campo);
          if (alvo instanceof HTMLInputElement && typeof valor === "string" && valor.trim()) {
            alvo.value = valor;
            alvo.dispatchEvent(new Event("input", { bubbles: true }));
          }
        }
      }}
    >
      <option value="">Sem cadastro (cliente livre)</option>
      {clientes.map((c) => (
        <option key={c.id} value={c.id}>
          {c.nome}
        </option>
      ))}
    </select>
  );
}
