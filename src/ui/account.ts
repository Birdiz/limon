import type { Compte, CompteDetail } from "../core/account";
import { ApiError, NotSignedIn, type Api } from "./api";
import { byId, esc, flash } from "./dom";
import type { SyncStore } from "./sync";

const day = (ms: number) => new Date(ms).toLocaleDateString("fr-FR");
const webauthn = () => import("@simplewebauthn/browser");
const hasWebAuthn = () => typeof window.PublicKeyCredential === "function";

/** Appareil qui crée une passkey, pour la reconnaître dans la liste. L'iPad se présente comme un Mac. */
function deviceName(): string {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return "iPad";
  if (/Android/.test(ua)) return "Android";
  if (/Macintosh/.test(ua)) return "Mac";
  if (/Windows/.test(ua)) return "Windows";
  return "Ordinateur";
}

/** Message d'erreur pour l'artisan ; une passkey annulée n'en est pas une. */
function problem(e: unknown): string | null {
  if (e instanceof ApiError) return e.message;
  if (e instanceof NotSignedIn) return "Vous n'êtes plus connecté.";
  if (e instanceof Error && (e.name === "NotAllowedError" || e.name === "AbortError")) return null;
  if (e instanceof TypeError) return "Pas de réseau : réessayez une fois connecté.";
  return e instanceof Error ? e.message : "Quelque chose n'a pas marché.";
}

type View = "login" | "offer" | "account";

/**
 * Compte : ligne d'état dans « Mes projets », et dialogue de connexion (passkey, ou code par e-mail
 * pour créer le compte et en secours) puis de gestion du compte.
 */
export class AccountDialog {
  private dlg = byId<HTMLDialogElement>("compte");
  private msg = byId("acMsg");
  private email = "";

  constructor(
    private store: SyncStore,
    private api: Api,
  ) {
    byId("acOpen").addEventListener("click", () => void this.show());
    byId("acClose").addEventListener("click", () => this.dlg.close());
    byId("acPk").addEventListener("click", () => void this.run(() => this.passkeyLogin(false)));
    byId("acEmailForm").addEventListener("submit", (e) => {
      e.preventDefault();
      void this.run(() => this.sendCode());
    });
    byId("acCodeForm").addEventListener("submit", (e) => {
      e.preventDefault();
      void this.run(() => this.checkCode());
    });
    byId("acBack").addEventListener("click", () => this.codeStep(false));
    byId("acOfferYes").addEventListener("click", () => void this.run(() => this.addPasskey()));
    byId("acOfferNo").addEventListener("click", () => this.dlg.close());
    byId("acAddKey").addEventListener("click", () => void this.run(() => this.addPasskey()));
    byId("acKeys").addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-key]");
      if (b) void this.run(() => this.removePasskey(b.dataset.key!));
    });
    byId("acLogout").addEventListener("click", () => void this.run(() => this.logout()));
    byId("acDelete").addEventListener("click", () => void this.run(() => this.deleteAccount()));
    store.onStatus(() => void this.refreshLine());
    void this.refreshLine();
  }

  /** Ligne du dialogue Mes projets. */
  private async refreshLine(): Promise<void> {
    const st = await this.store.status();
    const line = byId("acLine");
    const open = byId("acOpen");
    if (!st.compte) {
      line.textContent =
        "Les projets sont gardés dans ce navigateur. Avec un compte, retrouvez-les sur votre téléphone et votre ordinateur.";
      open.textContent = "Créer un compte ou se connecter";
      return;
    }
    const s = st.pending > 1 ? "s" : "";
    const state = !st.pending
      ? "projets enregistrés en ligne"
      : st.offline
        ? `${st.pending} projet${s} à envoyer dès que le réseau revient`
        : `${st.pending} projet${s} en cours d'envoi`;
    line.innerHTML = `Connecté avec <b>${esc(st.compte.email)}</b> · ${state}.`;
    open.textContent = "Mon compte";
    if (this.dlg.open && !byId("acAccount").hidden)
      byId("acState").textContent = `${state[0]!.toUpperCase()}${state.slice(1)}.`;
  }

  async show(): Promise<void> {
    this.msg.hidden = true;
    if (!this.dlg.open) this.dlg.showModal();
    if (this.store.account()) await this.run(() => this.showAccount());
    else this.showLogin();
  }

  private view(v: View): void {
    byId("acLogin").hidden = v !== "login";
    byId("acOffer").hidden = v !== "offer";
    byId("acAccount").hidden = v !== "account";
    byId("acTitle").textContent = v === "account" ? "Mon compte" : "Compte";
  }

  /** Lance une action du dialogue et affiche son erreur éventuelle. */
  private async run(action: () => Promise<void>): Promise<void> {
    try {
      await action();
    } catch (e) {
      if (e instanceof NotSignedIn) this.store.sessionLost();
      const m = problem(e);
      if (m) flash(this.msg, m, true, 6000);
    }
  }

  private showLogin(): void {
    this.view("login");
    this.codeStep(false);
    byId("acPkBox").hidden = !hasWebAuthn();
    // La passkey proposée dans le remplissage automatique du champ e-mail.
    void webauthn().then(async (w) => {
      if (await w.browserSupportsWebAuthnAutofill()) await this.run(() => this.passkeyLogin(true));
    });
  }

  private codeStep(on: boolean): void {
    byId("acEmailForm").hidden = on;
    byId("acCodeForm").hidden = !on;
    byId("acCodeTo").textContent = this.email;
    byId<HTMLInputElement>("acCode").value = "";
    byId<HTMLInputElement>(on ? "acCode" : "acEmail").focus();
  }

  private async sendCode(): Promise<void> {
    this.email = byId<HTMLInputElement>("acEmail").value.trim();
    await this.api.sendCode(this.email);
    this.codeStep(true);
    flash(this.msg, "Code envoyé : regardez vos e-mails (et les indésirables).", false, 8000);
  }

  private async checkCode(): Promise<void> {
    const compte = await this.api.checkCode(this.email, byId<HTMLInputElement>("acCode").value);
    await this.signedIn(compte);
    // Proposer la passkey seulement là où Face ID, l'empreinte ou Windows Hello existent.
    const w = await webauthn();
    if (await w.platformAuthenticatorIsAvailable()) this.view("offer");
    else await this.showAccount();
  }

  private async passkeyLogin(autofill: boolean): Promise<void> {
    const w = await webauthn();
    const optionsJSON = await this.api.passkeyOptions<Parameters<typeof w.startAuthentication>[0]["optionsJSON"]>();
    const reponse = await w.startAuthentication({ optionsJSON, useBrowserAutofill: autofill });
    await this.signedIn(await this.api.passkeyLogin(reponse));
    this.dlg.close();
  }

  private async signedIn(compte: Compte): Promise<void> {
    await this.store.signIn(compte);
    flash(this.msg, "Connecté");
  }

  private async addPasskey(): Promise<void> {
    const w = await webauthn();
    const optionsJSON = await this.api.passkeyAddOptions<Parameters<typeof w.startRegistration>[0]["optionsJSON"]>();
    const reponse = await w.startRegistration({ optionsJSON });
    this.render(await this.api.passkeyAdd(reponse, deviceName()));
    flash(this.msg, "Face ID ou l'empreinte activé sur cet appareil");
  }

  private async removePasskey(id: string): Promise<void> {
    if (!confirm("Retirer cette passkey ? Vous pourrez toujours vous connecter avec un code par e-mail.")) return;
    this.render(await this.api.passkeyRemove(id));
  }

  private async showAccount(): Promise<void> {
    const compte = this.store.account();
    if (!compte) return this.showLogin();
    this.view("account");
    byId("acMe").textContent = compte.email;
    void this.refreshLine();
    byId("acKeys").innerHTML = '<li class="empty">…</li>';
    try {
      this.render(await this.api.account());
    } catch (e) {
      if (!(e instanceof TypeError)) throw e;
      byId("acKeys").innerHTML = '<li class="empty">Liste indisponible sans réseau.</li>';
    }
  }

  private render(d: CompteDetail): void {
    this.view("account");
    byId("acMe").textContent = d.email;
    byId("acKeys").innerHTML = d.passkeys.length
      ? d.passkeys
          .map(
            (k) =>
              `<li><div><b>${esc(k.nom)}</b><small>ajoutée le ${day(k.cree)}${k.utilise ? ` · utilisée le ${day(k.utilise)}` : ""}</small></div>` +
              `<button class="btn" type="button" data-key="${esc(k.id)}">Retirer</button></li>`,
          )
          .join("")
      : '<li class="empty">Aucune pour l\'instant : vous vous connectez avec un code par e-mail.</li>';
    byId("acAddKey").hidden = !hasWebAuthn();
  }

  private async logout(): Promise<void> {
    if (
      !confirm(
        "Se déconnecter ? Vos projets restent dans votre compte et quittent cet appareil : vous les retrouverez en vous reconnectant.",
      )
    )
      return;
    await this.store.signOut();
    this.dlg.close();
  }

  private async deleteAccount(): Promise<void> {
    if (
      !confirm(
        "Supprimer votre compte ? Votre adresse et vos projets en ligne seront effacés. Les projets restent sur cet appareil, mais plus sur les autres.",
      )
    )
      return;
    await this.store.deleteAccount();
    this.dlg.close();
  }
}
