import path from "node:path";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { api } from "./api";
import { migrate, pgDb, pgliteDb, purge } from "./db";
import { brevo, consoleMail } from "./mail";
import { staticFiles } from "./static";

/* Serveur de Quart de tour : le site construit et /api, sur la même adresse.
   En ligne : DATABASE_URL et BREVO_API_KEY. `--local` : base PGlite en mémoire et codes dans la console,
   pour essayer le build (service worker compris) sans rien installer. */

const local = process.argv.includes("--local");
const port = Number(process.env.PORT ?? 3000);
const url = process.env.DATABASE_URL;
const key = process.env.BREVO_API_KEY;
if (!local && (!url || !key))
  throw new Error("DATABASE_URL et BREVO_API_KEY sont nécessaires (ou --local pour essayer).");
const origin = process.env.ORIGIN ?? (local ? `http://localhost:${port}` : "https://quart-de-tour.fr");

const db = url ? await pgDb(url) : await pgliteDb();
await migrate(db);
await purge(db);
setInterval(() => void purge(db).catch(console.error), 3_600_000).unref();

const app = new Hono();
app.use(async (c, next) => {
  await next();
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
  if (origin.startsWith("https:")) c.header("Strict-Transport-Security", "max-age=31536000");
});
app.route("/", api({ db, origin, sendCode: key && !local ? brevo(key) : consoleMail }));
app.use(await staticFiles(path.resolve(import.meta.dirname, "../dist")));

const server = serve({ fetch: app.fetch, port }, () => console.log(`Quart de tour sur ${origin} (port ${port})`));
process.on("SIGTERM", () => server.close(() => void db.close().then(() => process.exit(0))));
