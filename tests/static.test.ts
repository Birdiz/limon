import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pagePolicy, staticFiles } from "../server/static";

const SCRIPT = "location.replace('app/');";
// sha256 de SCRIPT en base64, calculée à part : le test ne répète pas le calcul de pagePolicy.
const EMPREINTE = "'sha256-VyeQPNaY7Zhgwl+csPaAGHIhn+7UpUXhEO4FXHnyCo8='";

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
});
