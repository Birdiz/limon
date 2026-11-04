import type { Changement, Compte, CompteDetail, Entree, Envoi } from "../core/account";
import type { Atelier } from "../core/atelier";
import type { Project } from "../core/project";

/** Session absente ou expirée. */
export class NotSignedIn extends Error {}

/** Refus du serveur, avec son message en français ; une coupure de réseau lève une TypeError. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Le geste demande de prouver d'abord que c'est bien la personne : une passkey ou un code par e-mail. */
export class ProofNeeded extends ApiError {}

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
      const r = (await res.json().catch(() => null)) as { erreur?: string; preuve?: boolean } | null;
      const message = r?.erreur ?? "Le serveur ne répond pas. Réessayez dans un instant.";
      throw r?.preuve ? new ProofNeeded(message, res.status) : new ApiError(message, res.status);
    }
    return (res.status === 204 ? undefined : await res.json()) as T;
  }

  sendCode = (email: string) => this.call<undefined>("POST", "code", { email });
  checkCode = (email: string, code: string, appareil: string) =>
    this.call<Compte>("POST", "code/verifier", { email, code, appareil });
  passkeyOptions = <T>() => this.call<T>("POST", "passkey/options", {});
  passkeyLogin = (reponse: unknown, appareil: string) =>
    this.call<Compte>("POST", "passkey/connexion", { reponse, appareil });
  passkeyAddOptions = <T>() => this.call<T>("POST", "passkey/ajout/options", {});
  passkeyAdd = (reponse: unknown, nom: string) => this.call<CompteDetail>("POST", "passkey/ajout", { reponse, nom });
  passkeyRemove = (id: string) => this.call<CompteDetail>("DELETE", `passkeys/${encodeURIComponent(id)}`);
  proofPasskeyOptions = <T>() => this.call<T>("POST", "preuve/passkey/options", {});
  proofPasskey = (reponse: unknown) => this.call<undefined>("POST", "preuve/passkey", { reponse });
  /** Un code part à l'adresse du compte. */
  sendProofCode = () => this.call<undefined>("POST", "preuve/code", {});
  checkProofCode = (code: string) => this.call<undefined>("POST", "preuve/code/verifier", { code });
  account = () => this.call<CompteDetail>("GET", "compte");
  /** Un code part à la nouvelle adresse ; elle n'est prise qu'avec lui. */
  sendEmailCode = (email: string) => this.call<undefined>("POST", "compte/email/code", { email });
  changeEmail = (email: string, code: string) => this.call<CompteDetail>("PUT", "compte/email", { email, code });
  closeDevice = (id: string) => this.call<CompteDetail>("DELETE", `sessions/${encodeURIComponent(id)}`);
  closeOtherDevices = () => this.call<CompteDetail>("DELETE", "sessions");
  deleteAccount = () => this.call<undefined>("DELETE", "compte");
  logout = () => this.call<undefined>("POST", "deconnexion", {});

  atelierOf = () => this.call<Atelier | null>("GET", "atelier");
  /** Envoie le profil de l'atelier ; renvoie celui qui l'emporte, c'est-à-dire le plus récent. */
  pushAtelier = (atelier: Atelier) => this.call<Atelier | null>("PUT", "atelier", { atelier });

  index = () => this.call<Entree[]>("GET", "projets");
  /** `keepalive` : l'envoi se termine même si la page se ferme. */
  push = (changements: Changement[], keepalive = false) =>
    this.call<Envoi>("PUT", "projets", { changements, detail: true }, keepalive);
  fetchProjects = (ids: string[]) => this.call<Project[]>("POST", "projets/lire", { ids });
  /** Numéro du devis de l'escalier, donné par le serveur à sa première remise, le même ensuite. */
  devisNumero = async (projet: string) =>
    (await this.call<{ numero: string }>("POST", "devis/numero", { projet })).numero;
}
