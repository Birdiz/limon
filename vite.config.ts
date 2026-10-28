import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";

/** Écrit dist/sw.js : src/sw.js avec la liste des fichiers du build et leur empreinte. */
function pwa(): Plugin {
  let publicDir = "";
  return {
    name: "limon-pwa",
    apply: (_, env) => env.command === "build" && !env.isSsrBuild,
    enforce: "post",
    configResolved(c) {
      publicDir = c.publicDir;
    },
    generateBundle(_, bundle) {
      const hash = createHash("sha256");
      const files: string[] = [];
      for (const [name, out] of Object.entries(bundle).sort(([a], [b]) => a.localeCompare(b))) {
        // Les navigateurs qui ont un service worker lisent tous le woff2 : le woff ne servirait jamais.
        if (name.endsWith(".map") || name.endsWith(".woff")) continue;
        files.push(name);
        hash.update(name).update(out.type === "chunk" ? out.code : out.source);
      }
      const walk = (dir: string): string[] =>
        fs
          .readdirSync(dir, { withFileTypes: true })
          .flatMap((d) => (d.isDirectory() ? walk(path.join(dir, d.name)) : [path.join(dir, d.name)]));
      for (const f of walk(publicDir).sort()) {
        const name = path.relative(publicDir, f).split(path.sep).join("/");
        files.push(name);
        hash.update(name).update(fs.readFileSync(f));
      }
      const src = fs.readFileSync(path.resolve(import.meta.dirname, "src/sw.js"), "utf8");
      hash.update(src);
      const source = src
        .replace('"__VERSION__"', JSON.stringify(hash.digest("hex").slice(0, 12)))
        .replace('["__FICHIERS__"]', JSON.stringify(files));
      this.emitFile({ type: "asset", fileName: "sw.js", source });
    },
  };
}

/** En développement, /api est servi par le serveur de server/dev.ts, rechargé à chaque modification. */
function api(): Plugin {
  return {
    name: "limon-api",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith("/api/")) return next();
        server
          .ssrLoadModule("/server/dev.ts")
          .then((m) => (m as typeof import("./server/dev")).handle(req, res))
          .catch(next);
      });
    },
  };
}

export default defineConfig(({ isSsrBuild }) => ({
  // Chemins relatifs : le dossier dist/ se sert depuis n'importe quel sous-chemin.
  base: "./",
  // Three.js (≈ 590 ko) est chargé à part, après le calcul et le plan. Le serveur (--ssr) n'emporte pas public/.
  build: { target: "es2022", sourcemap: true, chunkSizeWarningLimit: 700, copyPublicDir: !isSsrBuild },
  plugins: [pwa(), api()],
  test: { include: ["tests/**/*.test.ts"] },
}));
