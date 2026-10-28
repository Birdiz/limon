import type { Changement, Compte, CompteDetail, Entree } from "../core/account";
import type { Project } from "../core/project";

/** Session absente ou expirée. */
export class NotSignedIn extends Error {}

/** Refus du serveur, avec son message en français ; une coupure de réseau lève une TypeError. */
export class ApiError extends Error {}

/** Le serveur de Quart de tour, sur la même adresse que la page. */
export class Api {
  constructor(private f: typeof fetch = (...a) => fetch(...a)) {}

  private async call<T>(method: string, path: string, body?: unknown, keepalive = false): Promise<T> {
    const res = await this.f(`/api/${path}`, {
      method,
      keepalive,
      ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    });
    if (res.status === 401) throw new NotSignedIn();
    if (!res.ok) {
      const r = (await res.json().catch(() => null)) as { erreur?: string } | null;
      throw new ApiError(r?.erreur ?? "Le serveur ne répond pas. Réessayez dans un instant.");
    }
    return (res.status === 204 ? undefined : await res.json()) as T;
  }

  sendCode = (email: string) => this.call<undefined>("POST", "code", { email });
  checkCode = (email: string, code: string) => this.call<Compte>("POST", "code/verifier", { email, code });
  passkeyOptions = <T>() => this.call<T>("POST", "passkey/options", {});
  passkeyLogin = (reponse: unknown) => this.call<Compte>("POST", "passkey/connexion", { reponse });
  passkeyAddOptions = <T>() => this.call<T>("POST", "passkey/ajout/options", {});
  passkeyAdd = (reponse: unknown, nom: string) => this.call<CompteDetail>("POST", "passkey/ajout", { reponse, nom });
  passkeyRemove = (id: string) => this.call<CompteDetail>("DELETE", `passkeys/${encodeURIComponent(id)}`);
  account = () => this.call<CompteDetail>("GET", "compte");
  deleteAccount = () => this.call<undefined>("DELETE", "compte");
  logout = () => this.call<undefined>("POST", "deconnexion", {});

  index = () => this.call<Entree[]>("GET", "projets");
  /** `keepalive` : l'envoi se termine même si la page se ferme. */
  push = (changements: Changement[], keepalive = false) =>
    this.call<Entree[]>("PUT", "projets", { changements }, keepalive);
  fetchProjects = (ids: string[]) => this.call<Project[]>("POST", "projets/lire", { ids });
}
