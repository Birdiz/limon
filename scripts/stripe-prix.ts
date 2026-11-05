/* Crée dans Stripe ce qu'il faut à l'abonnement : `STRIPE_SECRET_KEY=sk_test_… npm run stripe:prix`.

   Deux produits, leurs quatre prix TTC (`PRIX`, src/core/niveaux.ts) et la page de gestion (factures, carte, changement
   d'offre, arrêt à la fin de la période). À lancer une fois en mode test, une fois en ligne : un prix déjà créé, reconnu à
   sa clé, n'est pas refait. Stripe ne change jamais un prix : un nouveau montant demande une clé nouvelle. Écrit à la fin
   les valeurs de STRIPE_PRIX et STRIPE_PORTAIL à régler ; aucune clé n'est gardée. */

import { NOM_OFFRE, PRIX, type Offre, type Rythme } from "../src/core/niveaux";

const cle = process.env.STRIPE_SECRET_KEY;
if (!cle) throw new Error("STRIPE_SECRET_KEY est nécessaire.");
const origin = process.env.ORIGIN ?? "https://quart-de-tour.fr";

async function appel<T>(methode: string, chemin: string, champs: Record<string, string> = {}): Promise<T> {
  const res = await fetch(`https://api.stripe.com/v1/${chemin}`, {
    method: methode,
    headers: { authorization: `Bearer ${cle}`, "content-type": "application/x-www-form-urlencoded" },
    ...(methode === "POST" ? { body: new URLSearchParams(champs).toString() } : {}),
  });
  const r = (await res.json()) as T & { error?: { message?: string } };
  if (!res.ok) throw new Error(`${chemin} : ${res.status} ${r.error?.message ?? ""}`);
  return r;
}

const INTERVALLE: Record<Rythme, string> = { mois: "month", an: "year" };
const lignes: string[] = [];
const offresPortail: Record<string, string> = {};
let n = 0;

for (const offre of Object.keys(PRIX) as Offre[]) {
  const trouves = await appel<{ data: { id: string; product: string; lookup_key: string }[] }>(
    "GET",
    `prices?active=true&${(Object.keys(PRIX[offre]) as Rythme[])
      .map((r) => `lookup_keys[]=${offre}-${r}-${PRIX[offre][r]}`)
      .join("&")}`,
  );
  let produit = trouves.data[0]?.product;
  produit ??= (await appel<{ id: string }>("POST", "products", { name: `Quart de tour : ${NOM_OFFRE[offre]}` })).id;
  const ids: string[] = [];
  for (const rythme of Object.keys(PRIX[offre]) as Rythme[]) {
    const lookup = `${offre}-${rythme}-${PRIX[offre][rythme]}`;
    const id =
      trouves.data.find((p) => p.lookup_key === lookup)?.id ??
      (
        await appel<{ id: string }>("POST", "prices", {
          product: produit,
          currency: "eur",
          unit_amount: String(PRIX[offre][rythme]),
          tax_behavior: "inclusive",
          lookup_key: lookup,
          "recurring[interval]": INTERVALLE[rythme],
        })
      ).id;
    ids.push(id);
    lignes.push(`${offre}-${rythme}:${id}`);
  }
  offresPortail[`features[subscription_update][products][${n}][product]`] = produit;
  ids.forEach((id, i) => (offresPortail[`features[subscription_update][products][${n}][prices][${i}]`] = id));
  n++;
}

const portail = await appel<{ id: string }>("POST", "billing_portal/configurations", {
  "business_profile[headline]": "Quart de tour : votre abonnement",
  default_return_url: `${origin}/app/?compte`,
  "features[invoice_history][enabled]": "true",
  "features[payment_method_update][enabled]": "true",
  "features[customer_update][enabled]": "true",
  "features[customer_update][allowed_updates][0]": "address",
  "features[customer_update][allowed_updates][1]": "name",
  "features[customer_update][allowed_updates][2]": "tax_id",
  "features[subscription_cancel][enabled]": "true",
  "features[subscription_cancel][mode]": "at_period_end",
  "features[subscription_update][enabled]": "true",
  "features[subscription_update][default_allowed_updates][0]": "price",
  ...offresPortail,
});

console.log(`STRIPE_PRIX=${lignes.join(",")}`);
console.log(`STRIPE_PORTAIL=${portail.id}`);
