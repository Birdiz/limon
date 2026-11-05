import { createHmac } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { CompteDetail } from "../src/core/account";
import { migrate, pgliteDb, purgeComptes } from "../server/db";
import { AtelierStore } from "../src/ui/atelier";
import { Api } from "../src/ui/api";
import { LocalStore, type KeyValue } from "../src/ui/store";
import { SyncStore } from "../src/ui/sync";
import { atelierDefauts } from "../src/core/atelier";
import { DEFAULTS } from "../src/core/params";
import {
  etatDe,
  lirePrix,
  signatureValable,
  stripe,
  StripeRefus,
  stripeDepuis,
  type Paiements,
} from "../server/stripe";
import { ORIGIN, browser, login, testServer, type TestServer } from "./server";

const SECRET = "whsec_essai";
const PRIX = {
  "payant-mois": "price_pm",
  "payant-an": "price_pa",
  "premium-mois": "price_vm",
  "premium-an": "price_va",
};
const FIN = Math.floor(Date.now() / 1000) + 30 * 86400;

/** Faux Stripe : garde les appels, répond ce qu'il faut. */
function fauxStripe() {
  const appels: { url: string; method: string; champs: URLSearchParams; idem: string | null }[] = [];
  const faux = {
    appels,
    panne: false,
    fetch: (async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input).replace("https://api.stripe.com/v1/", "");
      const headers = new Headers(init.headers);
      expect(headers.get("authorization")).toBe("Bearer sk_test_essai");
      appels.push({
        url,
        method: init.method ?? "GET",
        champs: new URLSearchParams(init.body as string),
        idem: headers.get("idempotency-key"),
      });
      if (faux.panne) return Response.json({ error: { code: "api_error" } }, { status: 500 });
      if (url === "customers") return Response.json({ id: "cus_1" });
      if (url === "checkout/sessions") return Response.json({ url: "https://checkout.stripe.com/s" });
      if (url === "billing_portal/sessions") return Response.json({ url: "https://billing.stripe.com/p" });
      return Response.json({ id: url });
    }) as typeof fetch,
  };
  return faux;
}

function signe(corps: string, secret = SECRET, t = Math.floor(Date.now() / 1000)) {
  return `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${corps}`).digest("hex")}`;
}

let nEvenement = 0;
const evenement = (
  statut: string,
  {
    type = "customer.subscription.updated",
    prix = "price_pm",
    client = "cus_1",
    id = "sub_1",
    created = FIN - 100,
    fin = FIN,
    extra = {},
  } = {},
) => ({
  id: `evt_${++nEvenement}`,
  type,
  created,
  data: {
    object: {
      id,
      status: statut,
      customer: client,
      items: { data: [{ current_period_end: fin, price: { id: prix } }] },
      ...extra,
    },
  },
});

describe("comptes d'avant l'abonnement", () => {
  it("restent testeurs, sans date de fin, et un compte neuf part en essai", async () => {
    const db = await pgliteDb();
    await migrate(db);
    await db.exec(
      `drop table paiements_evenements;
       alter table comptes alter column statut set default 'testeur', alter column droits_jusqu_a drop default,
         drop column client_stripe, drop column abonnement, drop column abonnement_evenement, drop column resilie;
       delete from schema_version where v >= 12;`,
    );
    await db.query("insert into comptes (id, email) values ('00000000-0000-0000-0000-000000000001', 'a@exemple.fr')");
    await migrate(db);
    expect(await db.query("select statut, droits_jusqu_a from comptes")).toEqual([
      { statut: "testeur", droits_jusqu_a: null },
    ]);
    await db.query("insert into comptes (id, email) values ('00000000-0000-0000-0000-000000000002', 'b@exemple.fr')");
    const [neuf] = await db.query<{ statut: string; ok: boolean }>(
      `select statut, droits_jusqu_a > now() + interval '29 days' as ok from comptes where email = 'b@exemple.fr'`,
    );
    expect(neuf).toEqual({ statut: "essai", ok: true });
    await db.close();
  });
});

describe("signature de Stripe", () => {
  const corps = '{"id":"evt"}';
  it("accepte une signature juste, parmi plusieurs", () => {
    expect(signatureValable(corps, signe(corps), SECRET)).toBe(true);
    expect(signatureValable(corps, `${signe(corps)},v1=00`, SECRET)).toBe(true);
    expect(signatureValable(corps, `v0=aa,${signe(corps)}`, SECRET)).toBe(true);
  });
  it("refuse un autre secret, un autre corps, une signature vieille ou mal formée", () => {
    expect(signatureValable(corps, signe(corps, "autre"), SECRET)).toBe(false);
    expect(signatureValable(`${corps} `, signe(corps), SECRET)).toBe(false);
    expect(signatureValable(corps, signe(corps, SECRET, Math.floor(Date.now() / 1000) - 301), SECRET)).toBe(false);
    expect(signatureValable(corps, undefined, SECRET)).toBe(false);
    expect(signatureValable(corps, "t=abc,v1=zz", SECRET)).toBe(false);
    expect(signatureValable(corps, "n'importe quoi", SECRET)).toBe(false);
  });
});

describe("état d'un abonnement", () => {
  const offres = { price_pm: "payant", price_vm: "premium" } as const;
  it("donne le niveau du prix et la fin de période", () => {
    expect(etatDe(evenement("active"), offres)).toMatchObject({
      statut: "abonne",
      droitsJusquA: FIN * 1000,
      resilie: false,
    });
    expect(etatDe(evenement("trialing", { prix: "price_vm" }), offres)).toMatchObject({ statut: "premium" });
    expect(etatDe(evenement("past_due"), offres)).toMatchObject({ statut: "abonne" });
  });
  it("lit la fin de période au niveau de l'abonnement, dans les anciennes versions de l'API", () => {
    const ev = evenement("active");
    Object.assign(ev.data.object, { current_period_end: FIN + 5, items: { data: [{ price: { id: "price_pm" } }] } });
    expect(etatDe(ev, offres)?.droitsJusquA).toBe((FIN + 5) * 1000);
  });
  it("voit l'arrêt demandé, de l'une ou l'autre façon", () => {
    expect(etatDe(evenement("active", { extra: { cancel_at_period_end: true } }), offres)?.resilie).toBe(true);
    expect(etatDe(evenement("active", { extra: { cancel_at: FIN } }), offres)?.resilie).toBe(true);
  });
  it("ramène au gratuit un abonnement fini", () => {
    for (const s of ["canceled", "unpaid", "incomplete_expired"])
      expect(etatDe(evenement(s), offres)).toMatchObject({ statut: "expire", droitsJusquA: null });
  });
  it("ignore un paiement en cours, un prix inconnu et les autres événements", () => {
    const journal = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(etatDe(evenement("incomplete"), offres)).toBeNull();
    expect(etatDe(evenement("active", { prix: "price_autre" }), offres)).toBeNull();
    expect(journal).toHaveBeenCalledOnce();
    journal.mockRestore();
    expect(etatDe({ type: "invoice.paid", data: { object: {} } }, offres)).toBeNull();
  });
});

describe("réglages de Stripe", () => {
  it("lit les quatre prix, ou rien", () => {
    expect(lirePrix("payant-mois:a,payant-an:b,premium-mois:c,premium-an:d")).toEqual({
      "payant-mois": "a",
      "payant-an": "b",
      "premium-mois": "c",
      "premium-an": "d",
    });
    expect(lirePrix("payant-mois:a")).toBeNull();
    expect(lirePrix("autre-mois:a,payant-an:b,premium-mois:c,premium-an:d")).toBeNull();
    expect(lirePrix(undefined)).toBeNull();
  });
  it("laisse le paiement fermé sans réglage, ou s'il en manque un", () => {
    expect(stripeDepuis({}, ORIGIN)).toBeUndefined();
    const journal = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(stripeDepuis({ STRIPE_SECRET_KEY: "sk" }, ORIGIN)).toBeUndefined();
    expect(journal).toHaveBeenCalledOnce();
    journal.mockRestore();
  });
});

describe("abonnement", () => {
  let s: TestServer;
  let faux: ReturnType<typeof fauxStripe>;
  const json = { "content-type": "application/json" };
  const post = (f: typeof fetch, path: string, data: unknown = {}, method = "POST") =>
    f(path, { method, headers: json, body: JSON.stringify(data) });
  /** Stripe prévient : sans origine, signé. */
  const prevenir = (ev: unknown, signature?: string) => {
    const corps = JSON.stringify(ev);
    return s.app.request("/api/stripe", {
      method: "POST",
      headers: { "stripe-signature": signature ?? signe(corps) },
      body: corps,
    });
  };
  const compte = async (email: string) =>
    (await s.db.query<Record<string, unknown>>("select * from comptes where email = $1", [email]))[0]!;
  const detail = async (f: typeof fetch) => (await (await f("/api/compte")).json()) as CompteDetail;
  const abonne = async (f: typeof fetch) => {
    const r = await post(f, "/api/abonnement/paiement", { offre: "payant", rythme: "mois" });
    expect(r.status).toBe(200);
  };

  beforeAll(async () => {
    faux = fauxStripe();
    s = await testServer({
      paiements: stripe({ cle: "sk_test_essai", secret: SECRET, prix: PRIX, origin: ORIGIN }, faux.fetch),
      limitesActives: true,
    });
  });
  afterAll(() => s.db.close());
  beforeEach(async () => {
    await s.reset();
    faux.appels.length = 0;
    faux.panne = false;
  });

  describe("essai", () => {
    it("un compte neuf naît en essai de 30 jours, tout ouvert", async () => {
      const a = await login(s, browser(s), "a@exemple.fr");
      expect(a.statut).toBe("essai");
      expect(a.droitsJusquA! - Date.now()).toBeGreaterThan(29.9 * 86_400_000);
      expect(a.droitsJusquA! - Date.now()).toBeLessThan(30.1 * 86_400_000);
    });

    it("dit le statut à chaque échange, sans requête de plus", async () => {
      const f = browser(s);
      await login(s, f, "a@exemple.fr");
      await s.db.query("update comptes set statut = 'expire', droits_jusqu_a = null");
      expect((await f("/api/projets")).headers.get("x-statut")).toBe("expire;");
    });

    it("l'essai fini ne bloque rien du compte : lecture, envoi d'escaliers, données, déconnexion", async () => {
      const f = browser(s);
      await login(s, f, "a@exemple.fr");
      await s.db.query("update comptes set droits_jusqu_a = now() - interval '1 hour'");
      expect((await f("/api/projets")).status).toBe(200);
      expect((await post(f, "/api/projets", { changements: [] }, "PUT")).status).toBe(200);
      expect((await f("/api/atelier")).status).toBe(200);
      expect((await f("/api/compte/donnees")).status).toBe(200);
      expect((await post(f, "/api/deconnexion")).status).toBe(204);
    });
  });

  describe("services du serveur", () => {
    const atelier = { modifie: 5, defauts: {} };
    it("refuse l'atelier et le devis au gratuit par 402, ni panne ni réseau", async () => {
      const f = browser(s);
      await login(s, f, "a@exemple.fr");
      await s.db.query("update comptes set statut = 'expire', droits_jusqu_a = null");
      const r = await post(f, "/api/atelier", { atelier }, "PUT");
      expect(r.status).toBe(402);
      expect(((await r.json()) as { erreur: string }).erreur).toMatch(/abonnement/);
      expect((await post(f, "/api/devis/numero", { projet: "a" })).status).toBe(402);
    });
    it("garde le devis au premium, l'atelier dès le payant", async () => {
      const f = browser(s);
      await login(s, f, "a@exemple.fr");
      await s.db.query("update comptes set statut = 'abonne', droits_jusqu_a = now() + interval '1 month'");
      expect((await post(f, "/api/atelier", { atelier }, "PUT")).status).toBe(200);
      expect((await post(f, "/api/devis/numero", { projet: "a" })).status).toBe(402);
      await s.db.query("update comptes set statut = 'premium'");
      expect((await post(f, "/api/devis/numero", { projet: "a" })).status).toBe(409); // pas encore dans le compte, mais permis
    });
    it("un testeur a tout, à vie", async () => {
      const f = browser(s);
      await login(s, f, "a@exemple.fr");
      await s.db.query("update comptes set statut = 'testeur', droits_jusqu_a = null");
      expect((await post(f, "/api/atelier", { atelier }, "PUT")).status).toBe(200);
      expect((await post(f, "/api/devis/numero", { projet: "a" })).status).toBe(409);
    });
    it("ne refuse rien tant que les limites dorment", async () => {
      const dort = await testServer({});
      const f = browser(dort);
      await login(dort, f, "a@exemple.fr");
      await dort.db.query("update comptes set statut = 'expire', droits_jusqu_a = null");
      expect((await post(f, "/api/atelier", { atelier }, "PUT")).status).toBe(200);
      await dort.db.close();
    });
  });

  describe("paiement", () => {
    it("crée le client une fois, et ouvre la page de paiement de l'offre choisie", async () => {
      const f = browser(s);
      await login(s, f, "a@exemple.fr");
      const r = await post(f, "/api/abonnement/paiement", { offre: "premium", rythme: "an" });
      expect(await r.json()).toEqual({ url: "https://checkout.stripe.com/s" });
      const session = faux.appels.find((a) => a.url === "checkout/sessions")!;
      expect(session.champs.get("line_items[0][price]")).toBe("price_va");
      expect(session.champs.get("customer")).toBe("cus_1");
      expect(session.champs.get("success_url")).toBe(`${ORIGIN}/app/?compte=paye`);
      expect(session.champs.get("cancel_url")).toBe(`${ORIGIN}/app/?compte`);
      expect((await compte("a@exemple.fr")).client_stripe).toBe("cus_1");
      await post(f, "/api/abonnement/paiement", { offre: "payant", rythme: "mois" });
      expect(faux.appels.filter((a) => a.url === "customers")).toHaveLength(1);
      expect(faux.appels.find((a) => a.url === "customers")!.idem).toMatch(/^client-/);
    });

    it("garde l'essai offert : le premier prélèvement attend sa fin", async () => {
      const f = browser(s);
      const a = await login(s, f, "a@exemple.fr");
      await abonne(f);
      const session = faux.appels.find((x) => x.url === "checkout/sessions")!;
      expect(session.champs.get("subscription_data[trial_end]")).toBe(String(Math.floor(a.droitsJusquA! / 1000)));
    });

    it("prélève tout de suite quand l'essai finit dans moins de 3 jours, ou est fini", async () => {
      const f = browser(s);
      await login(s, f, "a@exemple.fr");
      await s.db.query("update comptes set droits_jusqu_a = now() + interval '2 days'");
      await abonne(f);
      expect(faux.appels.find((x) => x.url === "checkout/sessions")!.champs.has("subscription_data[trial_end]")).toBe(
        false,
      );
    });

    it("refuse une offre inconnue, un testeur et un abonné", async () => {
      const f = browser(s);
      await login(s, f, "a@exemple.fr");
      expect((await post(f, "/api/abonnement/paiement", { offre: "or", rythme: "mois" })).status).toBe(400);
      await s.db.query("update comptes set statut = 'testeur', droits_jusqu_a = null");
      expect((await post(f, "/api/abonnement/paiement", { offre: "payant", rythme: "mois" })).status).toBe(409);
      await s.db.query("update comptes set statut = 'abonne', droits_jusqu_a = now() + interval '1 month'");
      expect((await post(f, "/api/abonnement/paiement", { offre: "premium", rythme: "mois" })).status).toBe(409);
      expect(faux.appels.filter((a) => a.url === "checkout/sessions")).toHaveLength(0);
    });

    it("demande une preuve récente, pour payer comme pour gérer", async () => {
      const f = browser(s);
      await login(s, f, "a@exemple.fr");
      await s.db.query("update sessions set preuve = now() - interval '1 hour'");
      for (const route of ["paiement", "gestion"]) {
        const r = await post(f, `/api/abonnement/${route}`, { offre: "payant", rythme: "mois" });
        expect(r.status).toBe(403);
        expect(await r.json()).toMatchObject({ preuve: true });
      }
    });

    it("dit la panne de Stripe sans parler de réseau, et la note au journal", async () => {
      const journal = vi.spyOn(console, "error").mockImplementation(() => {});
      const f = browser(s);
      await login(s, f, "a@exemple.fr");
      faux.panne = true;
      const r = await post(f, "/api/abonnement/paiement", { offre: "payant", rythme: "mois" });
      expect(r.status).toBe(502);
      expect(((await r.json()) as { erreur: string }).erreur).toMatch(/rien n'a été prélevé/);
      expect(journal).toHaveBeenCalled();
      journal.mockRestore();
    });

    it("ouvre la gestion à qui a un client, pas aux autres", async () => {
      const f = browser(s);
      await login(s, f, "a@exemple.fr");
      expect((await post(f, "/api/abonnement/gestion")).status).toBe(409);
      await abonne(f);
      expect(await (await post(f, "/api/abonnement/gestion")).json()).toEqual({ url: "https://billing.stripe.com/p" });
    });

    it("sans Stripe, le paiement reste fermé et le dit", async () => {
      const ferme = await testServer({});
      const f = browser(ferme);
      await login(ferme, f, "a@exemple.fr");
      expect((await detail(f)).paiement).toBe(false);
      expect((await post(f, "/api/abonnement/paiement", { offre: "payant", rythme: "mois" })).status).toBe(503);
      expect((await ferme.app.request("/api/stripe", { method: "POST", body: "{}" })).status).toBe(503);
      await ferme.db.close();
    });
  });

  describe("nouvelles de Stripe", () => {
    let f: typeof fetch;
    beforeEach(async () => {
      f = browser(s);
      await login(s, f, "a@exemple.fr");
      await abonne(f);
    });

    it("un paiement passe le compte au bon niveau, vu au prochain échange", async () => {
      expect((await prevenir(evenement("active"))).status).toBe(200);
      const d = await detail(f);
      expect(d).toMatchObject({
        statut: "abonne",
        droitsJusquA: FIN * 1000,
        resilie: false,
        gestion: true,
        paiement: true,
      });
      expect((await f("/api/projets")).headers.get("x-statut")).toBe(`abonne;${FIN * 1000}`);
      await prevenir(evenement("active", { prix: "price_va", created: FIN - 90 }));
      expect((await detail(f)).statut).toBe("premium");
    });

    it("passe sans origine, et seulement sur cette route", async () => {
      expect((await prevenir(evenement("active"))).status).toBe(200);
      const r = await s.app.request("/api/projets", { method: "PUT", body: "{}" });
      expect(r.status).toBe(403);
    });

    it("refuse une signature fausse, sans rien écrire", async () => {
      const ev = evenement("active");
      const r = await prevenir(ev, signe(JSON.stringify(ev), "autre"));
      expect(r.status).toBe(400);
      expect((await compte("a@exemple.fr")).statut).toBe("essai");
      expect(await s.db.query("select 1 from paiements_evenements where id = $1", [ev.id])).toEqual([]);
    });

    it("refuse un corps de plus de 4 Mo sans le vérifier", async () => {
      const r = await s.app.request("/api/stripe", {
        method: "POST",
        headers: { "content-length": String(5 << 20) },
        body: "x".repeat(5 << 20),
      });
      expect(r.status).toBe(413);
    });

    it("un événement rejoué ne change rien", async () => {
      const ev = evenement("active");
      await prevenir(ev);
      await s.db.query("update comptes set statut = 'expire', abonnement_evenement = 0");
      expect((await prevenir(ev)).status).toBe(200);
      expect((await compte("a@exemple.fr")).statut).toBe("expire");
    });

    it("un événement plus ancien que le dernier n'y touche pas", async () => {
      await prevenir(evenement("active", { prix: "price_vm", created: FIN - 50 }));
      await prevenir(evenement("active", { created: FIN - 60 }));
      expect((await compte("a@exemple.fr")).statut).toBe("premium");
    });

    it("la fin d'un autre abonnement du même client n'y touche pas", async () => {
      await prevenir(evenement("active", { id: "sub_2", created: FIN - 90 }));
      await prevenir(evenement("canceled", { id: "sub_1", type: "customer.subscription.deleted", created: FIN - 80 }));
      expect((await compte("a@exemple.fr")).statut).toBe("abonne");
    });

    it("un client inconnu est accepté sans effet : son compte a pu partir", async () => {
      expect((await prevenir(evenement("active", { client: "cus_parti" }))).status).toBe(200);
      expect((await compte("a@exemple.fr")).statut).toBe("essai");
    });

    it("ne touche pas au compte d'un testeur", async () => {
      await s.db.query("update comptes set statut = 'testeur', droits_jusqu_a = null");
      await prevenir(evenement("active"));
      expect((await compte("a@exemple.fr")).statut).toBe("testeur");
    });

    it("une résiliation laisse courir la période, puis ramène au gratuit sans rien effacer", async () => {
      await post(f, "/api/projets", { changements: [] }, "PUT");
      await s.db.query(
        `insert into projets (compte, id, modifie, donnees) select id, 'gardé', 1, '{}'::jsonb from comptes`,
      );
      await prevenir(evenement("active"));
      await prevenir(evenement("active", { created: FIN - 90, extra: { cancel_at_period_end: true } }));
      expect(await detail(f)).toMatchObject({ statut: "abonne", resilie: true, droitsJusquA: FIN * 1000 });
      await prevenir(evenement("canceled", { type: "customer.subscription.deleted", created: FIN - 80 }));
      expect(await detail(f)).toMatchObject({ statut: "expire", resilie: false, droitsJusquA: null, gestion: true });
      expect(await s.db.query("select id from projets where id = 'gardé'")).toHaveLength(1);
      expect((await f("/api/compte/donnees")).status).toBe(200);
      // Et on peut revenir.
      await abonne(f);
      await prevenir(evenement("active", { id: "sub_3", created: FIN - 70 }));
      expect((await compte("a@exemple.fr")).statut).toBe("abonne");
    });

    it("rejoue plus tard si la base est en panne : rien n'est retenu", async () => {
      const journal = vi.spyOn(console, "error").mockImplementation(() => {});
      const query = vi.spyOn(s.db, "query").mockRejectedValueOnce(new Error("base perdue"));
      const ev = evenement("active");
      expect((await prevenir(ev)).status).toBe(500);
      query.mockRestore();
      journal.mockRestore();
      expect((await prevenir(ev)).status).toBe(200);
      expect((await compte("a@exemple.fr")).statut).toBe("abonne");
    });
  });

  describe("la page", () => {
    function memoire(): KeyValue {
      const m = new Map<string, string>();
      return {
        getItem: (k) => m.get(k) ?? null,
        setItem: (k, v) => void m.set(k, v),
        removeItem: (k) => void m.delete(k),
      };
    }
    async function appareil() {
      const f = browser(s);
      const storage = memoire();
      const atelier = new AtelierStore(storage);
      const store = new SyncStore(new LocalStore(storage), new Api(f), storage, atelier);
      await store.signIn(await login(s, f, "a@exemple.fr"));
      return { store, atelier, storage };
    }

    it("voit le statut changé au prochain échange, et s'en souvient", async () => {
      const { store, storage } = await appareil();
      expect(store.account()?.statut).toBe("essai");
      const vu = vi.fn();
      store.onStatus(vu);
      await s.db.query("update comptes set statut = 'premium', droits_jusqu_a = to_timestamp($1::bigint / 1000.0)", [
        FIN * 1000,
      ]);
      await store.sync();
      expect(store.account()).toMatchObject({ statut: "premium", droitsJusquA: FIN * 1000 });
      expect(vu).toHaveBeenCalled();
      expect((JSON.parse(storage.getItem("limon-synchro")!) as { compte: { statut: string } }).compte.statut).toBe(
        "premium",
      );
    });

    it("un profil de l'atelier hors de l'offre reste sur l'appareil, sans erreur ni attente, et laisse se déconnecter", async () => {
      const { store, atelier } = await appareil();
      await s.db.query("update comptes set statut = 'expire', droits_jusqu_a = null");
      atelier.set({ defauts: atelierDefauts(DEFAULTS) }, 1000);
      await store.sync();
      const st = await store.status();
      expect(st).toMatchObject({ erreur: null, offline: false, pending: 0, atelierAttend: false });
      await store.signOut();
      expect(store.account()).toBeNull();
      expect(atelier.get()).not.toBeNull();
    });

    it("le profil repart dès que l'offre le permet", async () => {
      const { store, atelier } = await appareil();
      await s.db.query("update comptes set statut = 'expire', droits_jusqu_a = null");
      atelier.set({ defauts: atelierDefauts(DEFAULTS) }, 1000);
      await store.sync();
      await s.db.query("update comptes set statut = 'abonne', droits_jusqu_a = to_timestamp($1::bigint / 1000.0)", [
        FIN * 1000,
      ]);
      await store.sync();
      expect(await s.db.query("select 1 from ateliers")).toHaveLength(1);
      expect((await store.status()).atelierAttend).toBe(false);
    });
  });

  describe("fin du compte", () => {
    it("supprimer le compte arrête d'abord l'abonnement", async () => {
      const f = browser(s);
      await login(s, f, "a@exemple.fr");
      await abonne(f);
      expect((await f("/api/compte", { method: "DELETE" })).status).toBe(204);
      expect(faux.appels.at(-1)).toMatchObject({ url: "customers/cus_1", method: "DELETE" });
      expect(await s.db.query("select 1 from comptes")).toEqual([]);
    });

    it("garde le compte si l'arrêt échoue, et le note au journal", async () => {
      const journal = vi.spyOn(console, "error").mockImplementation(() => {});
      const f = browser(s);
      await login(s, f, "a@exemple.fr");
      await abonne(f);
      faux.panne = true;
      const r = await f("/api/compte", { method: "DELETE" });
      expect(r.status).toBe(502);
      expect(journal.mock.calls.flat().some((e) => e instanceof StripeRefus)).toBe(true);
      expect(await s.db.query("select 1 from comptes")).toHaveLength(1);
      journal.mockRestore();
    });

    it("un client déjà effacé chez Stripe ne retient pas le compte", async () => {
      const f404 = (async () =>
        Response.json({ error: { code: "resource_missing" } }, { status: 404 })) as typeof fetch;
      const p = stripe({ cle: "k", secret: SECRET, prix: PRIX, origin: ORIGIN }, f404);
      await expect(p.effacerClient("cus_x")).resolves.toBeUndefined();
    });

    it("un changement d'adresse suit chez Stripe, sans dépendre de lui", async () => {
      const f = browser(s);
      await login(s, f, "a@exemple.fr");
      await abonne(f);
      await post(f, "/api/compte/email/code", { email: "b@exemple.fr" });
      const r = await post(
        f,
        "/api/compte/email",
        { email: "b@exemple.fr", code: s.codesAdresse.get("b@exemple.fr") },
        "PUT",
      );
      expect(r.status).toBe(200);
      const appel = faux.appels.at(-1)!;
      expect(appel.url).toBe("customers/cus_1");
      expect(appel.champs.get("email")).toBe("b@exemple.fr");
    });

    it("la purge efface le client avant le compte, et attend s'il ne part pas", async () => {
      const journal = vi.spyOn(console, "error").mockImplementation(() => {});
      const avertir = async () => {};
      await purgeComptes(s.db, avertir); // Note le passage : sans date connue, les avertissements tombent.
      const f = browser(s);
      await login(s, f, "a@exemple.fr");
      await abonne(f);
      await s.db.query(
        `update comptes set droits_jusqu_a = null, statut = 'expire',
           vu = now() - interval '25 months', averti = now() - interval '32 days'`,
      );
      const effacer = vi.fn<Paiements["effacerClient"]>().mockRejectedValueOnce(new Error("panne"));
      await purgeComptes(s.db, avertir, effacer);
      expect(await s.db.query("select 1 from comptes")).toHaveLength(1);
      effacer.mockResolvedValue();
      await purgeComptes(s.db, avertir, effacer);
      expect(effacer).toHaveBeenLastCalledWith("cus_1");
      expect(await s.db.query("select 1 from comptes")).toEqual([]);
      journal.mockRestore();
    });
  });
});
