"use client";

import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Bold, Heading3, List, ListOrdered, Pilcrow } from "lucide-react";

import { normalizarTexto, type DocTexto } from "@/lib/orcamento/texto-rico";

// Só o que o documento sabe desenhar (texto-rico.ts): o servidor saneia de novo.
const EXTENSOES = [
  StarterKit.configure({
    heading: { levels: [3] },
    blockquote: false,
    code: false,
    codeBlock: false,
    horizontalRule: false,
    italic: false,
    strike: false,
    underline: false,
    link: false,
  }),
];

export function EditorTextoRico({
  valor,
  onChange,
  rotulo,
  autoFocus = false,
}: {
  valor: DocTexto | null;
  onChange: (doc: DocTexto | null) => void;
  rotulo: string;
  autoFocus?: boolean;
}) {
  const editor = useEditor({
    extensions: EXTENSOES,
    content: valor ?? { type: "doc", content: [{ type: "paragraph" }] },
    immediatelyRender: false,
    autofocus: autoFocus ? "end" : false,
    editorProps: {
      attributes: {
        "aria-label": rotulo,
        class:
          "texto-rico min-h-28 max-w-none rounded-b-md border border-t-0 border-input bg-background px-3 py-2 text-sm leading-6 outline-none focus-visible:ring-2 focus-visible:ring-ring [&_h3]:pt-1 [&_h3]:font-semibold [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-1 [&_ul]:list-disc [&_ul]:pl-5",
      },
    },
    onUpdate: ({ editor: e }) => onChange(normalizarTexto(e.getJSON())),
  });
  const ativo = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      negrito: e?.isActive("bold") ?? false,
      titulo: e?.isActive("heading", { level: 3 }) ?? false,
      marcadores: e?.isActive("bulletList") ?? false,
      numerada: e?.isActive("orderedList") ?? false,
    }),
  });

  const botao = (ativoAgora: boolean | undefined, rotuloBotao: string, icone: React.ReactNode, acao: () => void) => (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={acao}
      aria-label={rotuloBotao}
      aria-pressed={Boolean(ativoAgora)}
      title={rotuloBotao}
      disabled={!editor}
      className={`inline-flex h-7 items-center gap-1 rounded px-2 text-xs ${
        ativoAgora ? "bg-brand-100 text-brand-800 dark:bg-brand-950/50 dark:text-brand-200" : "hover:bg-muted"
      }`}
    >
      {icone}
    </button>
  );

  return (
    <div>
      <div role="toolbar" aria-label="Formatação" className="flex flex-wrap gap-1 rounded-t-md border border-input bg-muted/40 px-1 py-1">
        {botao(ativo?.negrito, "Negrito", <Bold className="h-3.5 w-3.5" />, () => editor?.chain().focus().toggleBold().run())}
        {botao(ativo?.titulo, "Subtítulo", <><Heading3 className="h-3.5 w-3.5" />Subtítulo</>, () =>
          editor?.chain().focus().toggleHeading({ level: 3 }).run(),
        )}
        {botao(ativo?.marcadores, "Lista com marcadores", <List className="h-3.5 w-3.5" />, () =>
          editor?.chain().focus().toggleBulletList().run(),
        )}
        {botao(ativo?.numerada, "Lista numerada", <ListOrdered className="h-3.5 w-3.5" />, () =>
          editor?.chain().focus().toggleOrderedList().run(),
        )}
        {botao(false, "Texto normal", <><Pilcrow className="h-3.5 w-3.5" />Texto normal</>, () =>
          editor?.chain().focus().setParagraph().run(),
        )}
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}
