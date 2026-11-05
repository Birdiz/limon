import { timingSafeEqual } from "node:crypto";
import { generateAuthenticationOptions, type AuthenticationResponseJSON } from "@simplewebauthn/server";
import type { Context } from "hono";
import { CODE_TRIES } from "../limites";
import { verifiePasskey } from "./connexion";
import {
  body,
  challengeOf,
  CODE_FORME,
  CODE_MAL_FORME,
  CODE_MINUTES,
  codeRecu,
  err,
  nouveauCode,
  transportsOf,
  type App,
  type Contexte,
  type Env,
} from "./contexte";

/* Preuve récente : une passkey du compte ou un code à son adresse, avant un geste qui l'engage (`preuve`). */

export function routesPreuve(app: App, ctx: Contexte): void {
  const { cfg, db, rpID, limites, codeHash, compteOf, auth, debit, refusCode } = ctx;

  const prouve = (c: Context<Env>) =>
    db.query("update sessions set preuve = now() where hash = $1", [c.get("session")]);

  /** Seulement les passkeys du compte : le navigateur ne propose pas celle d'un autre. */
  app.post("/preuve/passkey/options", auth, debit, async (c) => {
    const compte = c.get("compte");
    const cles = await db.query<{ id: string; transports: string }>(
      "select id, transports from passkeys where compte = $1",
      [compte],
    );
    if (!cles.length) return err(c, 400, "Votre compte n'a pas de passkey : demandez un code par e-mail.");
    const options = await generateAuthenticationOptions({
      rpID,
      userVerification: "required",
      allowCredentials: cles.map((p) => ({ id: p.id, transports: transportsOf(p) })),
    });
    await db.query("insert into defis (defi, compte, expire) values ($1, $2, now() + interval '5 minutes')", [
      options.challenge,
      compte,
    ]);
    return c.json(options);
  });

  app.post("/preuve/passkey", auth, async (c) => {
    const compte = c.get("compte");
    const reponse = (await body(c)).reponse as AuthenticationResponseJSON | undefined;
    const defi = challengeOf(reponse);
    const [ok] = defi
      ? await db.query("delete from defis where defi = $1 and compte = $2 and expire > now() returning defi", [
          defi,
          compte,
        ])
      : [];
    if (!ok || !reponse) return err(c, 400, "La demande a expiré : recommencez.");
    const [pk] = await db.query<{ cle: string; compteur: number; transports: string }>(
      "select cle, compteur, transports from passkeys where id = $1 and compte = $2",
      [reponse.id, compte],
    );
    if (!pk || !(await verifiePasskey(ctx, reponse, defi!, pk)))
      return err(c, 400, "La passkey n'a pas pu être vérifiée : demandez un code par e-mail.");
    await prouve(c);
    return c.body(null, 204);
  });

  /** Le code part à l'adresse du compte. À part des codes de connexion : l'un ne sert pas à l'autre et ne le remplace pas. */
  app.post("/preuve/code", auth, async (c) => {
    const compte = c.get("compte");
    const refus = refusCode(c, [limites.codesPreuveParCompte, compte]);
    if (refus) return refus;
    const code = nouveauCode();
    await db.query(
      `insert into codes_preuve (compte, hash, expire, essais)
       values ($1, $2, now() + interval '${CODE_MINUTES} minutes', 0)
       on conflict (compte) do update set hash = excluded.hash, expire = excluded.expire, essais = 0`,
      [compte, codeHash(`preuve:${compte}`, code).toString("hex")],
    );
    try {
      await cfg.sendCodePreuve((await compteOf(compte))!.email, code);
    } catch (e) {
      console.error(e);
      return err(c, 502, "L'e-mail n'a pas pu partir. Réessayez dans un instant.");
    }
    return c.body(null, 204);
  });

  app.post("/preuve/code/verifier", auth, async (c) => {
    const code = codeRecu((await body(c)).code);
    if (!CODE_FORME.test(code)) return err(c, 400, CODE_MAL_FORME);
    const compte = c.get("compte");
    const [row] = await db.query<{ hash: string; essais: number }>(
      "update codes_preuve set essais = essais + 1 where compte = $1 and expire > now() returning hash, essais",
      [compte],
    );
    if (!row) return err(c, 400, "Ce code a expiré : demandez-en un nouveau.");
    if (row.essais > CODE_TRIES) {
      await db.query("delete from codes_preuve where compte = $1", [compte]);
      return err(c, 400, "Trop d'essais : demandez un nouveau code.");
    }
    if (!timingSafeEqual(Buffer.from(row.hash, "hex"), codeHash(`preuve:${compte}`, code)))
      return err(c, 400, "Code incorrect.");
    await db.query("delete from codes_preuve where compte = $1", [compte]);
    await prouve(c);
    return c.body(null, 204);
  });
}
