import type { IncomingMessage, ServerResponse } from "node:http";
import { getRequestListener } from "@hono/node-server";
import { api } from "./api";
import { migrate, pgliteDb, type Db } from "./db";
import {
  consoleAdresseChangee,
  consoleCodeAdresse,
  consoleCodePreuve,
  consoleMail,
  consolePasskeyAjoutee,
} from "./mail";
import { stripeDepuis } from "./stripe";

/* /api dans le serveur de développement de Vite (greffon `api` de vite.config.ts). La base PGlite est
   gardée dans .pglite/ et survit aux redémarrages ; les codes s'affichent dans la console. */

const g = globalThis as { limonDb?: Promise<Db> };
const db = (g.limonDb ??= pgliteDb(".pglite").then(async (d) => (await migrate(d), d)));
const listeners = new Map<string, ReturnType<typeof getRequestListener>>();

export async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const origin = `http://${req.headers.host ?? "localhost"}`;
  let listener = listeners.get(origin);
  if (!listener) {
    // Clés de test seulement, données au lancement de `npm run dev` ; sans elles, le paiement reste fermé.
    const paiements = stripeDepuis(process.env, origin);
    listener = getRequestListener(
      api({
        db: await db,
        origin,
        sendCode: consoleMail,
        sendCodeAdresse: consoleCodeAdresse,
        sendAdresseChangee: consoleAdresseChangee,
        sendCodePreuve: consoleCodePreuve,
        sendPasskeyAjoutee: consolePasskeyAjoutee,
        ...(paiements ? { paiements } : {}),
      }).fetch,
    );
    listeners.set(origin, listener);
  }
  await listener(req, res);
}
