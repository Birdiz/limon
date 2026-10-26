import { defineConfig } from "vitest/config";

export default defineConfig({
  // Chemins relatifs : le dossier dist/ se sert depuis n'importe quel sous-chemin.
  base: "./",
  // Three.js (≈ 590 ko) est chargé à part, après le calcul et le plan.
  build: { target: "es2022", sourcemap: true, chunkSizeWarningLimit: 700 },
  test: { include: ["tests/**/*.test.ts"] },
});
