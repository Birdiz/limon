import type { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { routesAbonnement, routeStripe } from "./routes/abonnement";
import { routesAtelier } from "./routes/atelier";
import { routesCompte } from "./routes/compte";
import { routesConnexion } from "./routes/connexion";
import { contexte, err, isDataError, nouvelleApp, type ApiConfig, type Env } from "./routes/contexte";
import { routesPreuve } from "./routes/preuve";
import { routesProjets } from "./routes/projets";

export type { ApiConfig } from "./routes/contexte";
export {
  balayeLimites,
  CODES_PAR_EMAIL,
  CODES_PAR_HEURE,
  CODES_VALABLES,
  ESSAIS_PAR_EMAIL,
  Limiter,
  nouvellesLimites,
  VERIFICATIONS_PAR_IP,
  type Limites,
} from "./limites";

/**
 * Routes /api : connexion, compte et projets. Chaque domaine déclare les siennes dans `server/routes/`, sur un contexte
 * commun (`contexte`). L'ordre compte : le webhook de Stripe avant le contrôle de l'origine, puis la taille des envois.
 */
export function api(cfg: ApiConfig): Hono<Env> {
  const ctx = contexte(cfg);
  const app = nouvelleApp();

  routeStripe(app, ctx);

  app.use(async (c, next) => {
    // Une requête qui modifie quelque chose doit venir du site lui-même.
    if (c.req.method !== "GET" && c.req.method !== "HEAD" && c.req.header("origin") !== cfg.origin)
      return err(c, 403, "Origine refusée.");
    await next();
    c.header("Cache-Control", "no-store");
  });
  app.use(bodyLimit({ maxSize: 4 << 20, onError: (c) => err(c, 413, "Envoi trop gros.") }));
  app.onError((e, c) => {
    if (isDataError(e)) return err(c, 400, "Demande mal formée.");
    console.error(e);
    return err(c, 500, "Le serveur ne répond pas. Réessayez dans un instant.");
  });

  app.get("/sante", async (c) => {
    await cfg.db.query("select 1");
    return c.text("ok");
  });

  routesConnexion(app, ctx);
  routesPreuve(app, ctx);
  routesCompte(app, ctx);
  routesAbonnement(app, ctx);
  routesProjets(app, ctx);
  routesAtelier(app, ctx);

  return app;
}
