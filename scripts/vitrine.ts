/* Captures de l'outil pour la page publique, dans public/vitrine/ : `npm run vitrine`.

   Lance le serveur de développement et Google Chrome sans fenêtre, ouvre l'escalier d'exemple et
   photographie l'outil (clair et sombre), le téléphone et la fiche PDF. Chrome est piloté par son
   protocole de débogage, avec le WebSocket de Node : rien à installer. Sur Mac seulement pour la
   fiche, rendue en image par Quick Look (qlmanage) puis convertie par sips. Autre Chrome : CHROME=… */

import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createServer } from "vite";

const ROOT = path.resolve(import.meta.dirname, "..");
const OUT = path.join(ROOT, "public/vitrine");
const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

type Json = Record<string, unknown>;

/** Une page de Chrome, pilotée par messages : chaque commande attend sa réponse. */
class Page {
  private n = 0;
  private wait = new Map<number, { ok: (r: Json) => void; ko: (e: Error) => void }>();
  private constructor(private ws: WebSocket) {
    ws.addEventListener("message", (e) => {
      const m = JSON.parse(String(e.data)) as { id?: number; result?: Json; error?: { message: string } };
      const w = m.id === undefined ? undefined : this.wait.get(m.id);
      if (!w) return;
      this.wait.delete(m.id!);
      if (m.error) w.ko(new Error(m.error.message));
      else w.ok(m.result ?? {});
    });
  }

  static async open(port: number): Promise<Page> {
    const res = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" });
    const { webSocketDebuggerUrl } = (await res.json()) as { webSocketDebuggerUrl: string };
    const ws = new WebSocket(webSocketDebuggerUrl);
    await new Promise((ok) => ws.addEventListener("open", ok, { once: true }));
    const p = new Page(ws);
    await p.send("Page.enable");
    return p;
  }

  send(method: string, params: Json = {}): Promise<Json> {
    const id = ++this.n;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((ok, ko) => this.wait.set(id, { ok, ko }));
  }

  async eval<T>(expression: string): Promise<T> {
    const r = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(`${expression} : ${JSON.stringify(r.exceptionDetails)}`);
    return (r.result as { value: T }).value;
  }

  /** Attend qu'une expression devienne vraie. */
  async until(expression: string, ms = 15_000): Promise<void> {
    const end = Date.now() + ms;
    while (!(await this.eval<boolean>(expression))) {
      if (Date.now() > end) throw new Error(`Toujours faux : ${expression}`);
      await sleep(100);
    }
  }

  async go(url: string): Promise<void> {
    await this.send("Page.navigate", { url });
    await this.until(`document.readyState === "complete"`);
    await this.eval(`document.fonts.ready.then(() => true)`);
  }

  async size(width: number, height: number, scale: number, mobile = false): Promise<void> {
    await this.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: scale, mobile });
    await this.send("Emulation.setTouchEmulationEnabled", { enabled: mobile });
  }

  async theme(dark: boolean): Promise<void> {
    await this.send("Emulation.setEmulatedMedia", {
      // Sans animations : rien ne se photographie à moitié apparu.
      features: [
        { name: "prefers-color-scheme", value: dark ? "dark" : "light" },
        { name: "prefers-reduced-motion", value: "reduce" },
      ],
    });
  }

  /** Photographie la vue, ou seulement le rectangle qui englobe les éléments désignés. */
  async shot(file: string, selector?: string): Promise<void> {
    const params: Json = { format: "webp", quality: 82 };
    if (selector) {
      const r = await this.eval<{ x: number; y: number; width: number; height: number }>(
        `(() => {
          const rs = [...document.querySelectorAll(${JSON.stringify(selector)})].map((e) => e.getBoundingClientRect());
          const x = Math.min(...rs.map((r) => r.left)), y = Math.min(...rs.map((r) => r.top));
          const w = Math.max(...rs.map((r) => r.right)) - x, h = Math.max(...rs.map((r) => r.bottom)) - y;
          return { x: x + scrollX, y: y + scrollY, width: w, height: h };
        })()`,
      );
      params.clip = { ...r, scale: 1 };
      params.captureBeyondViewport = true;
    }
    const { data } = (await this.send("Page.captureScreenshot", params)) as { data: string };
    fs.writeFileSync(path.join(OUT, file), Buffer.from(data, "base64"));
    console.log(`  ${file}`);
  }

  click(selector: string): Promise<unknown> {
    return this.eval(`document.querySelector(${JSON.stringify(selector)}).click()`);
  }
}

const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

/** La 3D est dessinée et le calcul affiché. */
const READY = `!!document.querySelector("#scene canvas") && !!document.querySelector("#plan svg")`;

async function main(): Promise<void> {
  fs.mkdirSync(OUT, { recursive: true });
  const server = await createServer({ root: ROOT, server: { port: 0 }, logLevel: "warn" });
  await server.listen();
  const site = server.resolvedUrls!.local[0]!;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vitrine-"));
  const chrome = spawn(CHROME, [
    "--headless=new",
    "--remote-debugging-port=0",
    `--user-data-dir=${tmp}`,
    "--hide-scrollbars",
    "--no-first-run",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ]);
  try {
    const port = await new Promise<number>((ok, ko) => {
      let err = "";
      chrome.stderr.on("data", (d: Buffer) => {
        err += String(d);
        const m = /DevTools listening on ws:\/\/[^:]+:(\d+)/.exec(err);
        if (m) ok(Number(m[1]));
      });
      chrome.on("exit", () => ko(new Error(`Chrome s'est arrêté :\n${err}`)));
    });
    const page = await Page.open(port);
    await page
      .send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: tmp })
      .catch(() => page.send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: tmp }));

    // Ordinateur : l'escalier d'exemple, clair puis sombre, puis les fichiers pour la machine.
    await page.size(1440, 900, 2);
    for (const dark of [false, true]) {
      const t = dark ? "sombre" : "clair";
      await page.theme(dark);
      await page.go(`${site}app/?exemple`);
      await page.until(READY);
      await sleep(800);
      await page.shot(`outil-${t}.webp`);
      await page.click("#cncOpen");
      await page.until(`!!document.querySelector("#pvB svg")`);
      await page.shot(`machine-${t}.webp`, "#cnc .cncgrid > .view:nth-child(-n + 2)");
    }

    // Fiche PDF, page 1 : enregistrée par le bouton de l'outil, rendue en image par Quick Look.
    await page.theme(false);
    await page.go(`${site}app/?exemple`);
    await page.until(READY);
    await sleep(800);
    // Escalier dit terminé : la fiche montrée ne porte pas la mention « brouillon ».
    await page.click("#etatBtn");
    await page.click("#ficheDl");
    const pdf = await waitFile(tmp, ".pdf");
    execFileSync("qlmanage", ["-t", "-s", "1400", "-o", tmp, pdf], { stdio: "ignore" });
    execFileSync(
      "sips",
      ["-s", "format", "jpeg", "-s", "formatOptions", "82", `${pdf}.png`, "--out", path.join(OUT, "fiche.jpg")],
      {
        stdio: "ignore",
      },
    );
    console.log("  fiche.jpg");

    // Téléphone : une question du pas à pas, avec son croquis, puis la 3D.
    await page.size(390, 844, 3, true);
    for (const dark of [false, true]) {
      const t = dark ? "sombre" : "clair";
      await page.theme(dark);
      await page.go(`${site}app/?nouveau`);
      await page.until(`!!document.querySelector("#stNext")`);
      await page.click("#stNext");
      await sleep(400);
      await page.shot(`telephone-${t}.webp`);
    }
    for (const dark of [false, true]) {
      await page.theme(dark);
      await page.go(`${site}app/?exemple`);
      await page.until(READY);
      await page.click(`[data-tab="vue3d"]`);
      await sleep(800);
      await page.shot(`telephone-3d-${dark ? "sombre" : "clair"}.webp`);
    }
    await page.theme(false);

    // Image des aperçus de lien (messageries, réseaux) : 1200 × 630.
    await page.size(1200, 630, 1);
    await page.go(`${site}app/?exemple`);
    await page.until(READY);
    await sleep(800);
    const { data } = (await page.send("Page.captureScreenshot", { format: "png" })) as { data: string };
    fs.writeFileSync(path.join(OUT, "partage.png"), Buffer.from(data, "base64"));
    console.log("  partage.png");
  } finally {
    // Chrome écrit encore dans son profil en s'arrêtant : attendre la fin avant d'effacer.
    const exited = new Promise((ok) => chrome.once("exit", ok));
    chrome.kill();
    await exited;
    await server.close();
    fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5 });
  }
}

async function waitFile(dir: string, ext: string): Promise<string> {
  for (let i = 0; i < 100; i++) {
    const f = fs.readdirSync(dir).find((n) => n.endsWith(ext));
    if (f) return path.join(dir, f);
    await sleep(100);
  }
  throw new Error(`Aucun fichier ${ext} enregistré`);
}

await main();
