import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["src/**/*.tsx"],
    rules: {
      // Rótulo visível tem de estar ligado ao campo: clicar no rótulo leva ao
      // campo e o leitor de tela anuncia o nome (auditoria de 16/11, item 7).
      "jsx-a11y/label-has-associated-control": [
        "error",
        {
          assert: "either",
          depth: 5,
          controlComponents: ["Input", "Textarea", "Select", "SelectTrigger", "Checkbox", "Switch"],
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "output/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
