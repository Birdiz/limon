import { randomUUID, timingSafeEqual } from "node:crypto";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { cleanEmail } from "../../src/core/account";
import { CODES_VALABLES } from "../limites";
import {
  body,
  challengeOf,
  CODE_FORME,
  CODE_MAL_FORME,
  CODE_MINUTES,
  codeRecu,
  COMPTE_COLONNES,
  compteDe,
  err,
  nomAppareil,
  nouveauCode,
  transportsOf,
  type App,
  type CompteLigne,
  type Contexte,
} from "./contexte";

/* Connexion : code par e-mail, passkeys, et leur ajout ou retrait par un compte connecté. */

const TROP_D_ESSAIS = "Trop d'essais. Réessayez dans une heure.";
const ESSAIS_EPUISES = "Trop d'essais sur cette adresse e-mail, pas forcément les vôtres. Réessayez dans une heure.";
const PASSKEY_REFUSEE = "La passkey n'a pas pu être vérifiée : connectez-vous avec un code par e-mail.";

/** Signature de la passkey, visage, empreinte ou code de l'appareil compris ; note son usage. */
export async function verifiePasskey(
  { db, origin, rpID }: Contexte,
  reponse: AuthenticationResponseJSON,
  defi: string,
  pk: { cle: string; compteur: number; transports: string },
): Promise<boolean> {
  let newCounter: number;
  try {
    const v = await verifyAuthenticationResponse({
      response: reponse,
      expectedChallenge: defi,
      expectedOrigin: origin,
      expectedRPID: rpID,
      credential: {
        id: reponse.id,
        publicKey: Buffer.from(pk.cle, "base64url"),
        counter: pk.compteur,
        transports: transportsOf(pk),
      },
      requireUserVerification: true,
    });
    if (!v.verified) throw new Error("non vérifiée");
    newCounter = v.authenticationInfo.newCounter;
  } catch (e) {
    console.error(e);
    return false;
  }
  await db.query("update passkeys set compteur = $2, utilise = now() where id = $1", [reponse.id, newCounter]);
  return true;
}

export function routesConnexion(app: App, ctx: Contexte): void {
  const { cfg, db, origin, rpID, limites, codeHash, ip, startSession, compteOf, detail, auth, preuve, refusCode } = ctx;

  /* ---------- Code par e-mail ---------- */

  app.post("/code", async (c) => {
    const email = cleanEmail((await body(c)).email);
    if (!email) return err(c, 400, "Cette adresse e-mail n'est pas valable.");
    const refus = refusCode(
      c,
      [limites.codesParIpEmail, `${ip(c)}:${email}`],
      [limites.codesParIp, ip(c)],
      [limites.codesParEmail, email],
    );
    if (refus) return refus;
    const code = nouveauCode();
    await db.query(
      `insert into codes (email, hash, expire) values ($1, $2, now() + interval '${CODE_MINUTES} minutes')`,
      [email, codeHash(email, code).toString("hex")],
    );
    try {
      await cfg.sendCode(email, code);
    } catch (e) {
      console.error(e);
      return err(c, 502, "L'e-mail n'a pas pu partir. Réessayez dans un instant.");
    }
    // Même réponse, que l'adresse ait déjà un compte ou non.
    return c.body(null, 204);
  });

  app.post("/code/verifier", async (c) => {
    const b = await body(c);
    const email = cleanEmail(b.email);
    const code = codeRecu(b.code);
    if (!email || !CODE_FORME.test(code)) return err(c, 400, CODE_MAL_FORME);
    if (!limites.verificationsParIp.hit(ip(c))) return err(c, 429, TROP_D_ESSAIS);
    const valables = await db.query<{ hash: string }>(
      `select hash from codes where email = $1 and expire > now() order by id desc limit ${CODES_VALABLES}`,
      [email],
    );
    if (!valables.length) return err(c, 400, "Ce code a expiré : demandez-en un nouveau.");
    // Comptés seulement là où un code attend, donc pour peu d'e-mails : ces tables ne se remplissent pas. Le plafond de
    // l'e-mail est regardé d'abord : pendant qu'il est atteint, la personne n'use pas ses propres essais.
    if (limites.essaisParEmail.atteinte(email)) return err(c, 429, ESSAIS_EPUISES);
    if (!limites.essaisParIpEmail.hit(`${ip(c)}:${email}`)) return err(c, 429, TROP_D_ESSAIS);
    if (!limites.essaisParEmail.hit(email)) return err(c, 429, ESSAIS_EPUISES);
    const attendu = codeHash(email, code);
    const bon = valables.find((v) => timingSafeEqual(Buffer.from(v.hash, "hex"), attendu));
    if (!bon) return err(c, 400, "Code incorrect.");
    // Un code ne sert qu'une fois, même demandé deux fois au même instant ; les autres tombent avec la connexion.
    const [pris] = await db.query("delete from codes where email = $1 and hash = $2 returning id", [email, bon.hash]);
    if (!pris) return err(c, 400, "Ce code a expiré : demandez-en un nouveau.");
    await db.query("delete from codes where email = $1", [email]);
    // 30 jours d'essai dès que le paiement est ouvert ; avant, un compte naît testeur : le compteur ne tourne pas pour rien.
    await db.query(
      `insert into comptes (id, email, statut, droits_jusqu_a)
       values ($1, $2, ${cfg.paiements ? "'essai', now() + interval '30 days'" : "'testeur', null"})
       on conflict (email) do nothing`,
      [randomUUID(), email],
    );
    const [compte] = await db.query<CompteLigne>(`select ${COMPTE_COLONNES} from comptes where email = $1`, [email]);
    await startSession(c, compte!.id, b.appareil);
    return c.json(compteDe(compte!));
  });

  /* ---------- Passkeys ---------- */

  app.post("/passkey/options", async (c) => {
    if (!limites.passkeysParIp.hit(ip(c))) return err(c, 429, "Trop d'essais. Réessayez dans une heure.");
    const options = await generateAuthenticationOptions({ rpID, userVerification: "required" });
    await db.query("insert into defis (defi, expire) values ($1, now() + interval '5 minutes')", [options.challenge]);
    return c.json(options);
  });

  app.post("/passkey/connexion", async (c) => {
    const b = await body(c);
    const reponse = b.reponse as AuthenticationResponseJSON | undefined;
    const defi = challengeOf(reponse);
    const [ok] = defi
      ? await db.query("delete from defis where defi = $1 and compte is null and expire > now() returning defi", [defi])
      : [];
    if (!ok || !reponse) return err(c, 400, "La demande a expiré : recommencez.");
    const [pk] = await db.query<{ compte: string; cle: string; compteur: number; transports: string }>(
      "select compte, cle, compteur, transports from passkeys where id = $1",
      [reponse.id],
    );
    if (!pk) return err(c, 404, "Cette passkey ne correspond à aucun compte : connectez-vous avec un code par e-mail.");
    if (!(await verifiePasskey(ctx, reponse, defi!, pk))) return err(c, 400, PASSKEY_REFUSEE);
    await startSession(c, pk.compte, b.appareil);
    return c.json(await compteOf(pk.compte));
  });

  app.post("/passkey/ajout/options", auth, preuve, async (c) => {
    const compte = (await compteOf(c.get("compte")))!;
    const existing = await db.query<{ id: string; transports: string }>(
      "select id, transports from passkeys where compte = $1",
      [compte.id],
    );
    const options = await generateRegistrationOptions({
      rpName: "Quart de tour",
      rpID,
      userName: compte.email,
      userDisplayName: compte.email,
      userID: new TextEncoder().encode(compte.id),
      excludeCredentials: existing.map((p) => ({ id: p.id, transports: transportsOf(p) })),
      authenticatorSelection: { residentKey: "required", userVerification: "required" },
    });
    await db.query("insert into defis (defi, compte, expire) values ($1, $2, now() + interval '5 minutes')", [
      options.challenge,
      compte.id,
    ]);
    return c.json(options);
  });

  app.post("/passkey/ajout", auth, preuve, async (c) => {
    const b = await body(c);
    const reponse = b.reponse as RegistrationResponseJSON | undefined;
    const nom = nomAppareil(b.nom);
    const defi = challengeOf(reponse);
    const [ok] = defi
      ? await db.query("delete from defis where defi = $1 and compte = $2 and expire > now() returning defi", [
          defi,
          c.get("compte"),
        ])
      : [];
    if (!ok || !reponse) return err(c, 400, "La demande a expiré : recommencez.");
    let ajoutee: unknown[];
    try {
      const v = await verifyRegistrationResponse({
        response: reponse,
        expectedChallenge: defi!,
        expectedOrigin: origin,
        expectedRPID: rpID,
        requireUserVerification: true,
      });
      if (!v.verified) throw new Error("non vérifiée");
      const cred = v.registrationInfo.credential;
      ajoutee = await db.query(
        `insert into passkeys (id, compte, cle, compteur, transports, nom) values ($1, $2, $3, $4, $5, $6)
         on conflict (id) do nothing returning id`,
        [
          cred.id,
          c.get("compte"),
          Buffer.from(cred.publicKey).toString("base64url"),
          cred.counter,
          (cred.transports ?? []).join(","),
          nom,
        ],
      );
    } catch (e) {
      console.error(e);
      return err(c, 400, "La passkey n'a pas pu être enregistrée.");
    }
    // Sans le nom donné par la page, qui n'a rien à faire dans un message reçu par la personne. L'ajout est fait : un avis
    // qui ne part pas n'y revient pas.
    if (ajoutee.length) await cfg.sendPasskeyAjoutee((await compteOf(c.get("compte")))!.email).catch(console.error);
    return c.json(await detail(c));
  });

  app.delete("/passkeys/:id", auth, async (c) => {
    await db.query("delete from passkeys where id = $1 and compte = $2", [c.req.param("id"), c.get("compte")]);
    return c.json(await detail(c));
  });
}
