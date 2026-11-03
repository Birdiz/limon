import net from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PG_DELAIS, pgDb, type Db } from "../server/db";
import { brevo } from "../server/mail";

/* Pannes de la base et de Brevo. Le faux Postgres parle juste assez le protocole pour accepter une connexion
   et finir une requête simple ; `muet` le fige sans couper, comme un processus suspendu. */

const DELAIS = { connexion: 50, statement: 50, query: 100 };

function message(type: string, corps: Buffer): Buffer {
  const longueur = Buffer.alloc(4);
  longueur.writeInt32BE(corps.length + 4);
  return Buffer.concat([Buffer.from(type), longueur, corps]);
}
const PRET = message("Z", Buffer.from("I"));
const BIENVENUE = Buffer.concat([message("R", Buffer.alloc(4)), PRET]);
const FINI = Buffer.concat([message("C", Buffer.from("SELECT 0\0")), PRET]);

async function fauxPostgres(muet = false) {
  const sockets = new Set<net.Socket>();
  const f = {
    muet,
    demarrage: "",
    url: "",
    couper: () => sockets.forEach((s) => s.destroy()),
    fermer: () => new Promise((r) => (f.couper(), server.close(r))),
  };
  const server = net.createServer((s) => {
    sockets.add(s);
    s.on("error", () => {});
    s.on("close", () => sockets.delete(s));
    let bienvenu = false;
    s.on("data", (d) => {
      if (f.muet) return;
      s.write(bienvenu ? FINI : BIENVENUE);
      if (!bienvenu) f.demarrage = d.toString();
      bienvenu = true;
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  f.url = `postgres://u:p@127.0.0.1:${(server.address() as net.AddressInfo).port}/base`;
  return f;
}

describe("Postgres en panne", () => {
  let f: Awaited<ReturnType<typeof fauxPostgres>>;
  let db: Db;
  const ouvre = async (muet = false) => {
    f = await fauxPostgres(muet);
    db = await pgDb(f.url, DELAIS);
  };
  afterEach(async () => {
    await db.close();
    await f.fermer();
    vi.restoreAllMocks();
  });

  it("survit à la perte d'une connexion au repos", async () => {
    const journal = vi.spyOn(console, "error").mockImplementation(() => {});
    await ouvre();
    await db.query("select 1");
    f.couper();
    await vi.waitFor(() => expect(journal).toHaveBeenCalledOnce());
    // L'erreur seule au journal, pas tout le client de la base.
    expect(journal.mock.calls[0]).toHaveLength(1);
    await expect(db.query("select 1")).resolves.toEqual([]);
  });

  it("lâche une base qui ne répond pas à la connexion", async () => {
    await ouvre(true);
    await expect(db.query("select 1")).rejects.toThrow("connection timeout");
  });

  it("lâche une base figée sur une connexion ouverte, et repart ensuite", async () => {
    await ouvre();
    await db.query("select 1");
    f.muet = true;
    await expect(db.query("select 1")).rejects.toThrow("Query read timeout");
    f.muet = false;
    await expect(db.query("select 1")).resolves.toEqual([]);
  });

  it("rend une erreur à chaque appel pendant le gel, au-delà du nombre de connexions", async () => {
    await ouvre(true);
    const appels = await Promise.allSettled(Array.from({ length: 6 }, () => db.query("select 1")));
    expect(appels.map((a) => a.status)).toEqual(Array(6).fill("rejected"));
  });

  it("demande à la base d'annuler avant que le client ne lâche", async () => {
    await ouvre();
    await db.query("select 1");
    expect(f.demarrage).toContain("statement_timeout\x0050\x00");
    expect(PG_DELAIS.query).toBeGreaterThan(PG_DELAIS.statement);
  });
});

describe("Brevo en panne", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("rend la main dans le délai", async () => {
    vi.stubGlobal(
      "fetch",
      (_: string, init: RequestInit) =>
        new Promise((_, rejette) => init.signal!.addEventListener("abort", () => rejette(init.signal!.reason))),
    );
    await expect(brevo("cle", 20)("a@exemple.fr", "123456")).rejects.toThrow(/timeout/);
  });
});
