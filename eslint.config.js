import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";
import globals from "globals";

export default tseslint.config(
  { ignores: ["dist/", "node_modules/", "out/", ".venv/"] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  prettier,
  {
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      // Avec noUncheckedIndexedAccess, « ! » marque les accès d'index dont la géométrie garantit l'existence.
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },
);
