import type { Appareil, Compte, CompteDetail } from "../core/account";
import { day } from "../core/format";
import { PRIX, isOffre, offreVue, prixEuros, statutReel, type Rythme } from "../core/niveaux";
import type { Project } from "../core/project";
import { ApiError, NotSignedIn, ProofNeeded, type Api } from "./api";
import { byId, downloadProject, esc, flash } from "./dom";
import { readJSON, write, type KeyValue } from "./store";
import type { RefusVu, RetenuVu, SyncStatus, SyncStore } from "./sync";

/**
 * Le code demandé, le temps qu'il vaut sur le serveur. L'artisan quitte la page pour lire ses e-mails, et elle peut se
 * recharger entre-temps : mise à jour silencieuse, ou téléphone qui la libère.
 */
const CODE_ATTENDU = "limon-code-attendu";
const CODE_MS = 10 * 60_000;

const webauthn = () => import("@simplewebauthn/browser");
const hasWebAuthn = () => typeof window.PublicKeyCredential === "function";
const PERSON =
  '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="7" r="3.5"/><path d="M3.5 17c1-3.2 3.5-4.8 6.5-4.8s5.5 1.6 6.5 4.8"/></svg>';

/** Appareil qui se connecte ou crée une passkey, pour le reconnaître dans les listes. L'iPad se présente comme un Mac. */
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

/** Le stockage refuse : rien ne survivrait au rechargement de la page. */
const NOT_STORED = "Escalier pas gardé sur cet appareil : gardez-en une copie en fichier";

/** En-tête : ce qui attend l'envoi, en mots ; le profil de l'atelier n'est pas un escalier. */
function waitingWords({ pending, atelierAttend }: SyncStatus): string {
  const n = pending - (atelierAttend ? 1 : 0);
  const escaliers = `${n} escalier${n > 1 ? "s" : ""}`;
  return !atelierAttend ? escaliers : n ? `${escaliers} et votre atelier` : "votre atelier";
}

/** En-tête : les escaliers que le serveur a refusés, par leur nom s'il n'y en a qu'un. */
const refusedLine = (refused: RefusVu[]) =>
  refused.length > 1
    ? `${refused.length} escaliers n'ont pas pu rejoindre votre compte`
    : `« ${refused[0]!.nom} » n'a pas pu rejoindre votre compte`;

/** En-tête : les escaliers qu'une version plus récente a écrits. Pas un échec : ils arriveront sans rien à faire. */
const newerLine = (n: number) =>
  n > 1
    ? `${n} escaliers d'un autre appareil arriveront tout seuls à la prochaine mise à jour`
    : "1 escalier d'un autre appareil arrivera tout seul à la prochaine mise à jour";

/** En-tête : les escaliers retenus cachés tant que la personne n'a pas répondu ; sans cette ligne, ils sembleraient perdus. */
const retainedLine = (n: number) =>
  n > 1 ? `${n} escaliers attendent votre réponse` : "1 escalier attend votre réponse";

/** Mon compte : le refus, sa raison et la copie à garder ; une suppression n'a plus d'escalier à copier. */
const refusedItem = (r: RefusVu) =>
  r.nom === null
    ? `<li><div><b>Un escalier supprimé (${esc(r.id.slice(0, 12))}…)</b><small>${esc(r.raison)} La suppression n'a pas rejoint votre compte.</small></div></li>`
    : `<li><div><b>${esc(r.nom)}</b><small>${esc(r.raison)} Il reste sur cet appareil.</small></div>` +
      `<button class="btn" type="button" data-copie="${esc(r.id)}">Garder une copie</button></li>`;

/** Suppression du compte : ce que contient « Effacer aussi de cet appareil ». */
function wipeWords(all: Project[]): string {
  const several = all.length > 1;
  const devis = all.some((p) => p.devis);
  return several
    ? `Vos ${all.length} escaliers${devis ? ", avec leurs devis et leurs clients" : ""}. Sinon, ils restent ici. Effacés, ils ne seront plus nulle part.`
    : `Votre escalier${devis ? ", avec son devis et son client" : ""}. Sinon, il reste ici. Effacé, il ne sera plus nulle part.`;
}

/** Mon compte : un appareil connecté. Celui-ci n'a pas de bouton : « Se déconnecter » envoie d'abord ce qui attend. */
const deviceItem = (a: Appareil) =>
  a.actuel
    ? `<li class="cur"><div><b>${esc(a.nom)}</b><small>cet appareil · connecté le ${day(a.cree)}</small></div></li>`
    : `<li><div><b>${esc(a.nom)}</b><small>connecté le ${day(a.cree)} · utilisé le ${day(a.utilise)}</small></div>` +
      `<button class="btn" type="button" data-device="${esc(a.id)}">Déconnecter</button></li>`;

type View = "login" | "offer" | "retenus" | "account" | "proof";

/**
 * Compte : bouton et état de l'enregistrement dans l'en-tête, et onglet Mon compte de l'accueil : connexion (passkey,
 * ou code par e-mail pour créer le compte et en secours) puis gestion du compte.
 */
export class AccountPanel {
  private msg = byId("acMsg");
  private email = "";
  private current: View = "login";
  /** Le geste qui demande une preuve, et la vue où il attend. */
  private pending: { action: () => Promise<void>; from: View } | null = null;
  private newEmail = "";
  private rythme: Rythme = "mois";

  constructor(
    private store: SyncStore,
    private api: Api,
    private storage: KeyValue | null,
  ) {
    byId("acPk").addEventListener("click", () => void this.run(() => this.passkeyLogin(false)));
    byId("acEmailForm").addEventListener("submit", (e) => {
      e.preventDefault();
      void this.run(() => this.sendCode());
    });
    byId("acCodeForm").addEventListener("submit", (e) => {
      e.preventDefault();
      void this.run(() => this.checkCode());
    });
    byId("acBack").addEventListener("click", () => {
      write(this.storage, CODE_ATTENDU, null);
      this.codeStep(false);
    });
    byId("acEmailChange").addEventListener("click", () => this.emailStep("adresse"));
    byId("acNewEmailNo").addEventListener("click", () => this.emailStep(null));
    byId("acNewEmailForm").addEventListener("submit", (e) => {
      e.preventDefault();
      void this.run(() => this.sendEmailCode());
    });
    byId("acNewCodeBack").addEventListener("click", () => this.emailStep("adresse"));
    byId("acNewCodeForm").addEventListener("submit", (e) => {
      e.preventDefault();
      void this.run(() => this.changeEmail());
    });
    byId("acOfferYes").addEventListener("click", () => void this.run(() => this.addPasskey()));
    byId("acOfferNo").addEventListener("click", () => void this.run(() => this.showAccount()));
    byId("acRetenusPrendre").addEventListener("click", () => void this.run(() => this.takeRetained()));
    byId("acRetenusLaisser").addEventListener("click", () => void this.run(() => this.leaveRetained()));
    byId("acRetenusEffacer").addEventListener("click", () => void this.run(() => this.eraseRetained()));
    byId("acAddKey").addEventListener("click", () => void this.run(() => this.addPasskey()));
    byId("acKeys").addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-key]");
      if (b) void this.run(() => this.removePasskey(b.dataset.key!));
    });
    byId("acDevices").addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-device]");
      if (b) void this.run(() => this.closeDevice(b.dataset.device!));
    });
    byId("acCloseOthers").addEventListener("click", () => void this.run(() => this.closeOthers()));
    byId("acRefus").addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-copie]");
      if (b) void this.run(() => this.keepCopy(b.dataset.copie!));
    });
    byId("acProofPk").addEventListener("click", () => void this.run(() => this.proveByPasskey()));
    byId("acProofMail").addEventListener("click", () => void this.run(() => this.sendProofCode()));
    byId("acProofCodeForm").addEventListener("submit", (e) => {
      e.preventDefault();
      void this.run(() => this.checkProofCode());
    });
    byId("acProofGo").addEventListener("click", () => void this.resume());
    byId("acProofNo").addEventListener("click", () => this.leaveProof());
    byId("acMois").addEventListener("click", () => this.showPrices("mois"));
    byId("acAn").addEventListener("click", () => this.showPrices("an"));
    byId("acOffres").addEventListener("click", (e) => {
      const offre = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-choix]")?.dataset.choix;
      if (isOffre(offre)) void this.run(async () => location.assign(await this.api.checkout(offre, this.rythme)));
    });
    byId("acGerer").addEventListener(
      "click",
      () => void this.run(async () => location.assign(await this.api.billing())),
    );
    byId("acLogout").addEventListener("click", () => void this.run(() => this.logout()));
    byId("acDelete").addEventListener("click", () => void this.run(() => this.askDelete()));
    byId("acDeleteYes").addEventListener("click", () => void this.run(() => this.deleteAccount()));
    byId("acDeleteNo").addEventListener("click", () => (byId("acDeleteBox").hidden = true));
    store.onStatus(() => void this.refreshLine());
    void this.refreshLine();
  }

  /** En-tête : bouton du compte et état de l'enregistrement. */
  private async refreshLine(): Promise<void> {
    const st = await this.store.status();
    const btn = byId("acOpen");
    const saved = byId("saved");
    const refused = st.refuses.filter((r) => r.nom !== null);
    const retenus = st.stored ? st.aDecider.length : 0;
    saved.classList.toggle("ask", retenus > 0);
    saved.classList.toggle("wait", !!st.compte && (st.pending > 0 || retenus > 0));
    saved.classList.toggle("fail", !st.stored || (!!st.compte && !retenus && (refused.length > 0 || !!st.erreur)));
    if (!st.compte) {
      saved.textContent = st.stored ? "Enregistré sur cet appareil" : NOT_STORED;
      btn.className = "btn hbtn acbtn guest";
      btn.innerHTML = `${PERSON}<span class="lbl-long">Ouvrir l'outil</span><span class="lbl-short">Compte</span>`;
      btn.removeAttribute("aria-label");
      // Déconnecté pendant que le compte était à l'écran : plus rien à y montrer.
      if (["account", "offer", "retenus", "proof"].includes(this.current)) this.showLogin();
      return;
    }
    const s = st.pending > 1 ? "s" : "";
    const attente = waitingWords(st);
    const state = !st.stored
      ? NOT_STORED
      : retenus
        ? retainedLine(retenus)
        : st.pending && st.offline
          ? `${attente} à envoyer dès que le réseau revient`
          : st.erreur
            ? st.pending
              ? `${attente} pas encore envoyé${s}. ${st.erreur}`
              : st.erreur
            : refused.length
              ? refusedLine(refused)
              : st.pending
                ? `${attente} en cours d'envoi`
                : st.plusRecents
                  ? newerLine(st.plusRecents)
                  : "escaliers enregistrés sur tous vos appareils";
    const allSaved = st.stored && !retenus && !st.pending && !st.erreur && !refused.length && !st.plusRecents;
    const toSee = retenus || (refused.length && state === refusedLine(refused)) ? " : voir Mon compte" : "";
    saved.textContent = allSaved
      ? "Enregistré sur tous vos appareils"
      : `${state[0]!.toUpperCase()}${state.slice(1)}${toSee}`;
    btn.className = "btn hbtn acbtn member";
    btn.innerHTML = `<span class="lbl">Mon compte</span><span class="avatar" aria-hidden="true">${esc(st.compte.email[0]!.toUpperCase())}</span>`;
    btn.setAttribute("aria-label", "Mon compte");
    // Question posée ou répondue dans un autre onglet : l'écran suit.
    const askedHere = this.current === "retenus";
    if ((askedHere || this.current === "account") && askedHere !== st.aDecider.length > 0)
      void this.run(() => this.showAccount());
    if (byId("acAccount").hidden) return;
    byId("acState").textContent = `${state[0]!.toUpperCase()}${state.slice(1)}`.replace(/\.?$/, ".");
    const list = byId("acRefus");
    list.hidden = !st.refuses.length;
    list.innerHTML = st.refuses.map(refusedItem).join("");
  }

  /** Adresse du code qui attend ; passé son temps, le code ne vaut plus et l'adresse ne reste pas sur l'appareil. */
  private codeAttendu(): string | null {
    const v = readJSON(this.storage, CODE_ATTENDU) as { email?: unknown; jusqu?: unknown } | null;
    if (typeof v?.email === "string" && typeof v.jusqu === "number" && Date.now() < v.jusqu) return v.email;
    write(this.storage, CODE_ATTENDU, null);
    return null;
  }

  /** Un code attend : la page rouvre Mon compte à son arrivée. */
  awaitsCode(): boolean {
    return !this.store.account() && this.codeAttendu() !== null;
  }

  /** L'onglet s'affiche : connexion, ou le compte. */
  async show(): Promise<void> {
    this.msg.hidden = true;
    byId("acDeleteBox").hidden = true;
    this.emailStep(null, false);
    if (this.store.account()) await this.run(() => this.showAccount());
    else this.showLogin();
  }

  private view(v: View): void {
    this.current = v;
    byId("acLogin").hidden = v !== "login";
    byId("acOffer").hidden = v !== "offer";
    byId("acRetenus").hidden = v !== "retenus";
    byId("acAccount").hidden = v !== "account";
    byId("acProof").hidden = v !== "proof";
  }

  /** Lance une action du dialogue et affiche son erreur éventuelle. */
  private async run(action: () => Promise<void>): Promise<void> {
    try {
      await action();
    } catch (e) {
      if (e instanceof ProofNeeded) return this.askProof(action);
      if (e instanceof NotSignedIn) await this.store.sessionLost();
      const m = problem(e);
      if (m) flash(this.msg, m, true, 6000);
    }
  }

  /** Le serveur demande une preuve : passkey si le compte en a une et le navigateur la connaît, sinon code par e-mail. */
  private async askProof(action: () => Promise<void>): Promise<void> {
    this.pending = { action, from: this.current };
    this.view("proof");
    byId("acProof").scrollIntoView({ block: "nearest" });
    this.proofStep("choix");
    byId("acProofTo").textContent = this.store.account()?.email ?? "";
    byId("acProofPk").hidden = true;
    byId("acProofMail").classList.add("go");
    const d = hasWebAuthn() ? await this.api.account().catch(() => null) : null;
    const withKey = !!d?.passkeys.length;
    byId("acProofPk").hidden = !withKey;
    byId("acProofMail").classList.toggle("go", !withKey);
  }

  private proofStep(step: "choix" | "code" | "fait"): void {
    byId("acProofAsk").hidden = step !== "choix";
    byId("acProofCodeForm").hidden = step !== "code";
    byId("acProofDone").hidden = step !== "fait";
    byId("acProofNo").hidden = step === "fait";
    byId<HTMLInputElement>("acProofCode").value = "";
    if (step === "code") byId("acProofCode").focus();
  }

  private async proveByPasskey(): Promise<void> {
    const w = await webauthn();
    const optionsJSON =
      await this.api.proofPasskeyOptions<Parameters<typeof w.startAuthentication>[0]["optionsJSON"]>();
    await this.api.proofPasskey(await w.startAuthentication({ optionsJSON }));
    this.proofStep("fait");
  }

  private async sendProofCode(): Promise<void> {
    await this.api.sendProofCode();
    this.proofStep("code");
    flash(this.msg, "Code envoyé : regardez vos e-mails (et les indésirables).", false, 8000);
  }

  private async checkProofCode(): Promise<void> {
    await this.api.checkProofCode(byId<HTMLInputElement>("acProofCode").value);
    this.proofStep("fait");
  }

  /** Le geste repart sur ce clic, pas tout seul : Safari n'ouvre Face ID qu'après un geste de la personne. */
  private async resume(): Promise<void> {
    const pending = this.pending;
    this.leaveProof();
    if (pending) await this.run(pending.action);
  }

  private leaveProof(): void {
    this.view(this.pending?.from ?? "account");
    this.pending = null;
  }

  private showLogin(): void {
    this.view("login");
    byId("acDeleteBox").hidden = true;
    // Déjà venu avec un compte : se connecter passe avant créer.
    const known = this.store.known();
    byId("acIntro").textContent = known
      ? "Connectez-vous pour retrouver vos escaliers sur cet appareil."
      : "Avec un compte, vos escaliers vous suivent sur votre téléphone et votre ordinateur, et restent utilisables sans réseau.";
    byId("acEmailLbl").textContent = known
      ? "Se connecter avec un code, ou créer un autre compte"
      : "Créer un compte, ou se connecter avec un code";
    const attendu = this.codeAttendu();
    if (attendu) byId<HTMLInputElement>("acEmail").value = this.email = attendu;
    // Pas de clavier qui surgit à l'ouverture de l'onglet sur le téléphone.
    this.codeStep(attendu !== null, false);
    byId("acPkBox").hidden = !hasWebAuthn();
    // La passkey proposée dans le remplissage automatique du champ e-mail.
    void webauthn().then(async (w) => {
      if (await w.browserSupportsWebAuthnAutofill()) await this.run(() => this.passkeyLogin(true));
    });
  }

  private codeStep(on: boolean, focus = true): void {
    byId("acEmailForm").hidden = on;
    byId("acCodeForm").hidden = !on;
    byId("acCodeTo").textContent = this.email;
    byId<HTMLInputElement>("acCode").value = "";
    if (focus) byId<HTMLInputElement>(on ? "acCode" : "acEmail").focus();
  }

  private async sendCode(): Promise<void> {
    this.email = byId<HTMLInputElement>("acEmail").value.trim();
    await this.api.sendCode(this.email);
    write(this.storage, CODE_ATTENDU, JSON.stringify({ email: this.email, jusqu: Date.now() + CODE_MS }));
    this.codeStep(true);
    flash(this.msg, "Code envoyé : regardez vos e-mails (et les indésirables).", false, 8000);
  }

  private async checkCode(): Promise<void> {
    const compte = await this.api.checkCode(this.email, byId<HTMLInputElement>("acCode").value, deviceName());
    await this.signedIn(compte);
    // Proposer la passkey seulement là où Face ID, l'empreinte ou Windows Hello existent.
    const w = await webauthn();
    const asks = (await this.store.status()).aDecider.length > 0;
    if (!asks && (await w.platformAuthenticatorIsAvailable())) this.view("offer");
    else await this.showAccount();
  }

  private async passkeyLogin(autofill: boolean): Promise<void> {
    const w = await webauthn();
    const optionsJSON = await this.api.passkeyOptions<Parameters<typeof w.startAuthentication>[0]["optionsJSON"]>();
    const reponse = await w.startAuthentication({ optionsJSON, useBrowserAutofill: autofill });
    await this.signedIn(await this.api.passkeyLogin(reponse, deviceName()));
    await this.showAccount();
  }

  private async signedIn(compte: Compte): Promise<void> {
    await this.store.signIn(compte);
    write(this.storage, CODE_ATTENDU, null);
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
    const d = await this.api.passkeyRemove(id);
    this.render(d);
    // Une passkey retirée, c'est souvent un appareil perdu : il reste connecté tant qu'on ne le déconnecte pas.
    const n = d.appareils.filter((a) => !a.actuel).length;
    const qui = n > 1 ? `vos ${n} autres appareils` : "votre autre appareil";
    if (n && confirm(`Passkey retirée. Déconnecter aussi ${qui} ? Celui-ci reste connecté.`)) await this.closeOthers();
  }

  /** Changer d'adresse : le bouton, puis la nouvelle adresse, puis le code qu'elle a reçu. */
  private emailStep(step: "adresse" | "code" | null, focus = true): void {
    byId("acEmailChange").hidden = step !== null;
    byId("acNewEmailForm").hidden = step !== "adresse";
    byId("acNewCodeForm").hidden = step !== "code";
    byId("acNewCodeTo").textContent = this.newEmail;
    byId<HTMLInputElement>("acNewCode").value = "";
    if (step === null) byId<HTMLInputElement>("acNewEmail").value = "";
    else if (focus) byId<HTMLInputElement>(step === "code" ? "acNewCode" : "acNewEmail").focus();
  }

  private async sendEmailCode(): Promise<void> {
    this.newEmail = byId<HTMLInputElement>("acNewEmail").value.trim();
    await this.api.sendEmailCode(this.newEmail);
    this.emailStep("code");
    flash(this.msg, "Code envoyé : regardez vos e-mails (et les indésirables).", false, 8000);
  }

  private async changeEmail(): Promise<void> {
    try {
      this.render(await this.api.changeEmail(this.newEmail, byId<HTMLInputElement>("acNewCode").value));
    } catch (e) {
      // Adresse déjà prise : le code est usé, il en faut une autre.
      if (e instanceof ApiError && e.status === 409) this.emailStep("adresse");
      throw e;
    }
    this.emailStep(null);
    flash(this.msg, "Adresse changée : connectez-vous désormais avec celle-ci.", false, 8000);
  }

  private async closeDevice(id: string): Promise<void> {
    this.render(await this.api.closeDevice(id));
    flash(this.msg, "Appareil déconnecté");
  }

  private async closeOthers(): Promise<void> {
    this.render(await this.api.closeOtherDevices());
    flash(this.msg, "Autres appareils déconnectés");
  }

  private async showAccount(): Promise<void> {
    const compte = this.store.account();
    if (!compte) return this.showLogin();
    const { aDecider } = await this.store.status();
    if (aDecider.length) return this.showRetained(aDecider);
    this.view("account");
    byId("acMe").textContent = compte.email;
    void this.refreshLine();
    byId("acKeys").innerHTML = '<li class="empty">…</li>';
    byId("acDevices").innerHTML = '<li class="empty">…</li>';
    byId("acCloseOthers").hidden = true;
    try {
      this.render(await this.api.account());
    } catch (e) {
      if (!(e instanceof TypeError)) throw e;
      byId("acKeys").innerHTML = '<li class="empty">Liste indisponible sans réseau.</li>';
      byId("acDevices").innerHTML = '<li class="empty">Liste indisponible sans réseau.</li>';
    }
  }

  /** La question : ces escaliers de l'appareil sont peut-être à quelqu'un d'autre. Rien ne se décide sans réponse. */
  private showRetained(retenus: RetenuVu[]): void {
    this.view("retenus");
    const several = retenus.length > 1;
    byId("acRetenusTxt").textContent = several
      ? `${retenus.length} escaliers de cet appareil ne sont dans aucun compte. Ils sont peut-être à quelqu'un d'autre.`
      : "Un escalier de cet appareil n'est dans aucun compte. Il est peut-être à quelqu'un d'autre.";
    byId("acRetenusNoms").innerHTML = retenus.map((r) => `<li><div><b>${esc(r.nom)}</b></div></li>`).join("");
    byId("acRetenusNote").textContent = several
      ? "Laissés ici, ils restent à l'écart de votre compte, et la question reviendra à votre prochaine connexion."
      : "Laissé ici, il reste à l'écart de votre compte, et la question reviendra à votre prochaine connexion.";
    byId("acRetenusPrendre").textContent = several ? "Les mettre dans mon compte" : "Le mettre dans mon compte";
    byId("acRetenusLaisser").textContent = several ? "Les laisser sur cet appareil" : "Le laisser sur cet appareil";
    byId("acRetenusEffacer").textContent = several ? "Les effacer" : "L'effacer";
  }

  private async takeRetained(): Promise<void> {
    await this.store.takeRetained();
    await this.showAccount();
  }

  private async leaveRetained(): Promise<void> {
    this.store.leaveRetained();
    await this.showAccount();
  }

  private async eraseRetained(): Promise<void> {
    const n = (await this.store.status()).aDecider.length;
    const question =
      n > 1
        ? `Effacer ces ${n} escaliers ? Ils ne seront plus nulle part.`
        : "Effacer cet escalier ? Il ne sera plus nulle part.";
    if (!confirm(question)) return;
    await this.store.eraseRetained();
    await this.showAccount();
  }

  private render(d: CompteDetail): void {
    this.view("account");
    this.store.accountSeen(d);
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
    byId("acDevices").innerHTML = d.appareils.map(deviceItem).join("");
    byId("acCloseOthers").hidden = !d.appareils.some((a) => !a.actuel);
    this.showOffer(d);
  }

  /** Mon offre : rien tant que le paiement en ligne n'est pas ouvert. */
  private showOffer(d: CompteDetail): void {
    byId("acOffre").hidden = !d.paiement;
    const vue = offreVue(d, Date.now());
    byId("acOffreTxt").innerHTML = vue.texte;
    byId("acOffres").hidden = !vue.choix;
    byId("acOffreNote").textContent = vue.note;
    byId("acOffreNote").hidden = !vue.note;
    byId("acGererBox").hidden = !vue.gerer;
    this.showPrices(this.rythme);
  }

  private showPrices(rythme: Rythme): void {
    this.rythme = rythme;
    byId("acMois").setAttribute("aria-pressed", String(rythme === "mois"));
    byId("acAn").setAttribute("aria-pressed", String(rythme === "an"));
    const mots = rythme === "mois" ? "par mois" : "par an";
    byId("acPrixPayant").textContent = `${prixEuros(PRIX.payant[rythme])} ${mots}`;
    byId("acPrixPremium").textContent = `${prixEuros(PRIX.premium[rythme])} ${mots}`;
  }

  /** Retour de la page de paiement : l'abonnement s'ouvre quand Stripe a prévenu le serveur, en quelques secondes. */
  async paymentDone(): Promise<void> {
    flash(this.msg, "Merci ! Votre abonnement s'ouvre, cela prend quelques secondes.", false, 12_000);
    for (let essai = 0; essai < 6; essai++) {
      await new Promise((r) => setTimeout(r, 2000));
      const d = await this.api.account().catch(() => null);
      const statut = d && statutReel(d, Date.now());
      if (statut !== "abonne" && statut !== "premium") continue;
      if (this.current === "account") this.render(d!);
      flash(this.msg, "Votre abonnement est ouvert. Merci !");
      return;
    }
  }

  private async keepCopy(id: string): Promise<void> {
    const p = await this.store.get(id);
    if (!p) return;
    downloadProject(p);
    flash(this.msg, "Copie enregistrée");
  }

  private async logout(): Promise<void> {
    const refused = (await this.store.status()).refuses.some((r) => r.nom !== null);
    if (
      !confirm(
        "Se déconnecter ? Vos escaliers restent dans votre compte et quittent cet appareil : vous les retrouverez en vous reconnectant." +
          (refused ? " Ceux qui n'ont pas pu rejoindre votre compte restent sur cet appareil." : ""),
      )
    )
      return;
    await this.store.signOut();
  }

  /** « Supprimer mon compte » : dit ce qui part, et propose d'effacer aussi les escaliers de cet appareil. */
  private async askDelete(): Promise<void> {
    const all = await this.store.list();
    byId("acWipeBox").hidden = !all.length;
    byId<HTMLInputElement>("acWipe").checked = false;
    byId("acWipeWhat").textContent = wipeWords(all);
    byId("acDeleteBox").hidden = false;
    byId("acDeleteNo").focus();
  }

  private async deleteAccount(): Promise<void> {
    await this.store.deleteAccount(byId<HTMLInputElement>("acWipe").checked);
  }
}
