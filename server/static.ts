import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import zlib from "node:zlib";
import type { MiddlewareHandler } from "hono";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
};
const COMPRESS = new Set([".html", ".js", ".css", ".json", ".svg", ".map", ".txt", ".xml"]);

interface File {
  type: string;
  etag: string;
  cache: string;
  raw: Uint8Array<ArrayBuffer>;
  br?: Uint8Array<ArrayBuffer>;
  gzip?: Uint8Array<ArrayBuffer>;
}

const brotli = promisify(zlib.brotliCompress);
const gzip = promisify(zlib.gzip);
const bytes = (b: Buffer) => new Uint8Array(b);

/**
 * Le site construit (`dist/`), lu et compressé une fois au démarrage : il pèse quelques mégaoctets.
 * Les fichiers de `assets/` portent leur empreinte dans leur nom et se gardent un an ; les autres
 * (pages, sw.js, manifeste, icônes, images de la page publique) sont revalidés à chaque fois.
 * Un dossier sert son index.html : / la page publique, /app/ l'outil.
 */
export async function staticFiles(dir: string): Promise<MiddlewareHandler> {
  const files = new Map<string, File>();
  for (const rel of await fs.readdir(dir, { recursive: true })) {
    const full = path.join(dir, rel);
    if (!(await fs.stat(full)).isFile()) continue;
    const ext = path.extname(rel);
    const raw = await fs.readFile(full);
    const url = "/" + rel.split(path.sep).join("/");
    const f: File = {
      type: TYPES[ext] ?? "application/octet-stream",
      etag: `"${createHash("sha1").update(raw).digest("base64url")}"`,
      cache: url.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache",
      raw: bytes(raw),
    };
    if (COMPRESS.has(ext) && raw.length > 1024) {
      f.br = bytes(await brotli(raw, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 10 } }));
      f.gzip = bytes(await gzip(raw, { level: 9 }));
    }
    files.set(url, f);
  }

  return async (c, next) => {
    if (c.req.method !== "GET" && c.req.method !== "HEAD") return next();
    const p = c.req.path;
    const f = files.get(p.endsWith("/") ? p + "index.html" : p);
    if (!f) {
      // /app sans barre finale : les chemins relatifs de la page partiraient de la racine.
      if (files.has(p + "/index.html")) return c.redirect(p + "/" + new URL(c.req.url).search, 301);
      return next();
    }
    c.header("Content-Type", f.type);
    c.header("Cache-Control", f.cache);
    c.header("ETag", f.etag);
    if (c.req.header("if-none-match") === f.etag) return c.body(null, 304);
    let data = f.raw;
    if (f.br || f.gzip) {
      c.header("Vary", "Accept-Encoding");
      const accept = c.req.header("accept-encoding") ?? "";
      if (f.br && /\bbr\b/.test(accept)) {
        data = f.br;
        c.header("Content-Encoding", "br");
      } else if (f.gzip && /\bgzip\b/.test(accept)) {
        data = f.gzip;
        c.header("Content-Encoding", "gzip");
      }
    }
    return c.body(data);
  };
}
