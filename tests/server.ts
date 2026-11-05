import { cleanEmail, type Compte } from "../src/core/account";
import { api, nouvellesLimites, type Limites } from "../server/api";
import { migrate, pgliteDb, type Db } from "../server/db";
import type { Paiements } from "../server/stripe";

export const ORIGIN = "https://quart-de-tour.fr";

/**
 * Serveur de test sur PGlite en mémoire ; les codes envoyés restent dans `codes`, `codesAdresse` et `codesPreuve`, les
 * avis dans `avis` et `ajouts`.
 */
export async function testServer(options: { paiements?: Paiements; limitesActives?: boolean } = {}) {
  const db: Db = await pgliteDb();
  await migrate(db);
  const codes = new Map<string, string>();
  const codesAdresse = new Map<string, string>();
  const avis: string[] = [];
  const codesPreuve = new Map<string, string>();
  const ajouts: string[] = [];
  const make = (limites: Limites) =>
    api({
      db,
      origin: ORIGIN,
      limites,
      sendCode: async (email, code) => void codes.set(email, code),
      sendCodeAdresse: async (email, code) => void codesAdresse.set(email, code),
      sendAdresseChangee: async (ancienne) => void avis.push(ancienne),
      sendCodePreuve: async (email, code) => void codesPreuve.set(email, code),
      sendPasskeyAjoutee: async (email) => void ajouts.push(email),
      ...options,
    });
  const limites = nouvellesLimites();
  const s = {
    db,
    codes,
    codesAdresse,
    avis,
    codesPreuve,
    ajouts,
    limites,
    app: make(limites),
    /** Base vide et serveur neuf, limites de débit comprises. */
    async reset() {
      await db.query("delete from comptes");
      await db.query("delete from codes");
      codes.clear();
      codesAdresse.clear();
      avis.length = 0;
      codesPreuve.clear();
      ajouts.length = 0;
      s.limites = nouvellesLimites();
      s.app = make(s.limites);
    },
  };
  return s;
}

export type TestServer = Awaited<ReturnType<typeof testServer>>;

let ips = 0;
/** Un navigateur : garde le cookie de session entre les requêtes, comme `fetch` sur le site. */
export function browser(s: TestServer): typeof fetch {
  let cookie = "";
  // Chaque navigateur a sa propre adresse, pour ne pas épuiser les limites par adresse IP.
  const ip = `10.0.0.${++ips}`;
  return async (input, init = {}) => {
    const url = new URL(String(input), ORIGIN);
    const headers = new Headers(init.headers);
    if (cookie) headers.set("cookie", cookie);
    headers.set("x-forwarded-for", ip);
    if (init.method && init.method !== "GET") headers.set("origin", ORIGIN);
    const res = await s.app.request(url.pathname + url.search, { ...init, headers });
    const set = res.headers.get("set-cookie");
    if (set) cookie = /Max-Age=0/.test(set) ? "" : set.split(";")[0]!;
    return res;
  };
}

/** Connexion par code ; renvoie le compte. */
export async function login(s: TestServer, f: typeof fetch, email: string) {
  const json = { "content-type": "application/json" };
  await f("/api/code", { method: "POST", headers: json, body: JSON.stringify({ email }) });
  const res = await f("/api/code/verifier", {
    method: "POST",
    headers: json,
    body: JSON.stringify({ email, code: s.codes.get(cleanEmail(email)!) }),
  });
  return (await res.json()) as Compte;
}
