import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pagePolicy, staticFiles } from "../server/static";

const SCRIPT = "location.replace('app/');";
// sha256 de SCRIPT en base64, calculée à part : le test ne répète pas le calcul de pagePolicy.
const EMPREINTE = "'sha256-VyeQPNaY7Zhgwl+csPaAGHIhn+7UpUXhEO4FXHnyCo8='";
/** Assez long pour être compressé. */
const LONG = "const escalier = 1;\n".repeat(100);

describe("pagePolicy", () => {
  it("n'autorise que les scripts du site et interdit le cadrage", () => {
    const p = pagePolicy('<head><script type="module" src="/a.js"></script></head>');
    expect(p).toContain("script-src 'self';");
    expect(p).toContain("frame-ancestors 'none'");
    expect(p).toContain("object-src 'none'");
    expect(p).toContain("base-uri 'none'");
  });

  it("reconnaît un script en ligne à son empreinte", () => {
    expect(pagePolicy(`<script>${SCRIPT}</script>`)).toContain(`script-src 'self' ${EMPREINTE};`);
  });

  it("donne au renvoi de la page publique son empreinte, et aucune à l'outil", async () => {
    const empreintes = (p: string) => p.match(/'sha256-/g)?.length ?? 0;
    expect(empreintes(pagePolicy(await fs.readFile("index.html", "utf8")))).toBe(1);
    expect(empreintes(pagePolicy(await fs.readFile("app/index.html", "utf8")))).toBe(0);
    expect(empreintes(pagePolicy(await fs.readFile("mentions-legales/index.html", "utf8")))).toBe(0);
  });
});

describe("staticFiles", () => {
  let dir: string;
  let app: Hono;
  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "limon-static-"));
    await fs.mkdir(path.join(dir, "app"));
    await fs.writeFile(path.join(dir, "index.html"), `<script>${SCRIPT}</script>`);
    await fs.writeFile(path.join(dir, "app/index.html"), "<p>Outil</p>");
    await fs.writeFile(path.join(dir, "sw.js"), "self;");
    await fs.mkdir(path.join(dir, "assets"));
    await fs.writeFile(path.join(dir, "assets/app-abc.js"), LONG);
    await fs.writeFile(path.join(dir, "assets/app-abc.js.map"), LONG);
    await fs.writeFile(path.join(dir, "assets/logo.png"), LONG);
    await fs.writeFile(path.join(dir, "donnees.bin"), "x");
    app = new Hono();
    app.use(await staticFiles(dir));
  });
  afterAll(() => fs.rm(dir, { recursive: true }));

  const csp = (r: Response) => r.headers.get("content-security-policy");

  it("donne à chaque page sa politique", async () => {
    expect(csp(await app.request("/"))).toContain(EMPREINTE);
    expect(csp(await app.request("/app/"))).toContain("script-src 'self';");
  });

  it("la redonne quand la page n'a pas changé", async () => {
    const etag = (await app.request("/app/")).headers.get("etag")!;
    const r = await app.request("/app/", { headers: { "if-none-match": etag } });
    expect(r.status).toBe(304);
    expect(csp(r)).toContain("frame-ancestors 'none'");
  });

  it("ne la met pas sur les autres fichiers", async () => {
    expect(csp(await app.request("/sw.js"))).toBeNull();
  });

  describe("adresses", () => {
    /** Ce qui tombe après `staticFiles` : l'API, puis le 404. */
    const suite = (r: Response) => r.headers.get("x-suite");
    let avecSuite: Hono;
    beforeAll(async () => {
      avecSuite = new Hono();
      avecSuite.use(await staticFiles(dir));
      avecSuite.all("*", (c) => c.text("suite", 404, { "x-suite": "1" }));
    });

    it("un dossier sert son index", async () => {
      expect(await (await app.request("/")).text()).toContain(SCRIPT);
      expect(await (await app.request("/app/")).text()).toBe("<p>Outil</p>");
    });

    it("/app sans barre renvoie vers /app/ et garde la requête", async () => {
      const r = await app.request("/app");
      expect(r.status).toBe(301);
      expect(r.headers.get("location")).toBe("/app/");
      const q = await app.request("/app?projet=a&b=1");
      expect(q.status).toBe(301);
      expect(q.headers.get("location")).toBe("/app/?projet=a&b=1");
    });

    it("laisse passer ce qu'il n'a pas, sans barre, avec barre ou hors du dossier", async () => {
      for (const url of ["/api/projets", "/absent", "/assets/", "/absent/", "/../secret", "/%2e%2e/secret"]) {
        const r = await avecSuite.request(url);
        expect(suite(r), url).toBe("1");
      }
    });

    it("ne répond qu'à GET et HEAD", async () => {
      expect(suite(await avecSuite.request("/app/", { method: "POST" }))).toBe("1");
      expect(suite(await avecSuite.request("/app/", { method: "DELETE" }))).toBe("1");
      const head = await avecSuite.request("/app/", { method: "HEAD" });
      expect(head.status).toBe(200);
      expect(head.headers.get("etag")).not.toBeNull();
      expect(await head.text()).toBe("");
    });
  });

  describe("entêtes", () => {
    const type = async (url: string) => (await app.request(url)).headers.get("content-type");
    const cache = async (url: string) => (await app.request(url)).headers.get("cache-control");

    it("donne le type de chaque fichier, et un type neutre à un inconnu", async () => {
      expect(await type("/")).toBe("text/html; charset=utf-8");
      expect(await type("/sw.js")).toBe("text/javascript; charset=utf-8");
      expect(await type("/assets/logo.png")).toBe("image/png");
      expect(await type("/donnees.bin")).toBe("application/octet-stream");
    });

    it("garde un an ce qui porte son empreinte, fait revalider le reste", async () => {
      expect(await cache("/assets/app-abc.js")).toBe("public, max-age=31536000, immutable");
      expect(await cache("/")).toBe("no-cache");
      expect(await cache("/app/")).toBe("no-cache");
      expect(await cache("/sw.js")).toBe("no-cache");
    });
  });

  describe("If-None-Match", () => {
    it("répond 304 sans corps à la bonne empreinte, sur tout fichier", async () => {
      const etag = (await app.request("/sw.js")).headers.get("etag")!;
      const r = await app.request("/sw.js", { headers: { "if-none-match": etag } });
      expect(r.status).toBe(304);
      expect(await r.text()).toBe("");
      expect(r.headers.get("etag")).toBe(etag);
      expect(r.headers.get("cache-control")).toBe("no-cache");
    });

    it("redonne le fichier à une autre empreinte", async () => {
      const r = await app.request("/sw.js", { headers: { "if-none-match": '"ancienne"' } });
      expect(r.status).toBe(200);
      expect(await r.text()).toBe("self;");
    });

    it("donne une empreinte par contenu", async () => {
      const etag = async (url: string) => (await app.request(url)).headers.get("etag");
      expect(await etag("/sw.js")).not.toBe(await etag("/app/"));
    });
  });

  describe("encodage", () => {
    const URL_JS = "/assets/app-abc.js";
    const avec = (accept: string) => app.request(URL_JS, { headers: { "accept-encoding": accept } });
    const octets = async (r: Response) => Buffer.from(await r.arrayBuffer());

    it("préfère brotli, et rend le même contenu", async () => {
      const r = await avec("gzip, deflate, br");
      expect(r.headers.get("content-encoding")).toBe("br");
      expect(r.headers.get("vary")).toBe("Accept-Encoding");
      expect(zlib.brotliDecompressSync(await octets(r)).toString()).toBe(LONG);
    });

    it("se rabat sur gzip", async () => {
      const r = await avec("gzip, deflate");
      expect(r.headers.get("content-encoding")).toBe("gzip");
      expect(r.headers.get("vary")).toBe("Accept-Encoding");
      expect(zlib.gunzipSync(await octets(r)).toString()).toBe(LONG);
    });

    it("rend le fichier tel quel à qui ne sait ni l'un ni l'autre", async () => {
      for (const r of [await avec("deflate"), await app.request(URL_JS)]) {
        expect(r.headers.get("content-encoding")).toBeNull();
        expect(r.headers.get("vary")).toBe("Accept-Encoding");
        expect(await r.text()).toBe(LONG);
      }
    });

    it("ne prend pas un mot voisin pour un encodage", async () => {
      const r = await avec("brx, xgzip");
      expect(r.headers.get("content-encoding")).toBeNull();
    });

    it("ne compresse ni un petit fichier, ni une image, ni une carte de sources", async () => {
      for (const url of ["/sw.js", "/assets/logo.png", "/assets/app-abc.js.map"]) {
        const r = await app.request(url, { headers: { "accept-encoding": "br, gzip" } });
        expect(r.headers.get("content-encoding"), url).toBeNull();
        expect(r.headers.get("vary"), url).toBeNull();
      }
    });

    // Défaut signalé dans la PR : RFC 9110, un 304 porte le Vary qu'aurait porté le 200, et il manque ici.
    // `it.fails` passera au rouge le jour de la correction : retirer alors `.fails`.
    it.fails("le 304 d'un fichier compressé dit aussi Vary", async () => {
      const etag = (await app.request(URL_JS)).headers.get("etag")!;
      const r = await app.request(URL_JS, { headers: { "if-none-match": etag } });
      expect(r.status).toBe(304);
      expect(r.headers.get("vary")).toBe("Accept-Encoding");
    });
  });
});
