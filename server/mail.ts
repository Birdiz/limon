/** Envoi du code de connexion. */
export type SendCode = (email: string, code: string) => Promise<void>;
/** Envoi de l'avertissement avant effacement d'un compte resté sans connexion. */
export type SendAvertissement = (email: string, limite: Date) => Promise<void>;
/** Avis à l'ancienne adresse d'un compte. La nouvelle n'y figure pas : l'ancienne n'est peut-être plus à la personne. */
export type SendAdresseChangee = (ancienne: string) => Promise<void>;

const SENDER = { name: "Quart de tour", email: "connexion@quart-de-tour.fr" };

function text(code: string): string {
  return [
    `Votre code de connexion à Quart de tour : ${code}`,
    "",
    "Il est valable 10 minutes.",
    "Si vous n'avez pas demandé ce code, ignorez ce message : personne ne peut entrer dans votre compte sans lui.",
    "",
    "Quart de tour, https://quart-de-tour.fr",
  ].join("\n");
}

function html(code: string): string {
  return `<!doctype html><html lang="fr"><body style="font-family:Helvetica,Arial,sans-serif;color:#1d2228">
<p>Votre code de connexion à Quart de tour :</p>
<p style="font-size:28px;font-weight:bold;letter-spacing:6px">${code}</p>
<p>Il est valable 10 minutes.</p>
<p style="color:#666">Si vous n'avez pas demandé ce code, ignorez ce message : personne ne peut entrer dans votre compte sans lui.</p>
<p style="color:#666">Quart de tour, <a href="https://quart-de-tour.fr">quart-de-tour.fr</a></p>
</body></html>`;
}

const jour = (d: Date) =>
  d.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Paris" });

function avertissementText(limite: string): string {
  return [
    "Votre compte Quart de tour n'a pas servi depuis longtemps. Les comptes restés 24 mois sans connexion sont effacés.",
    "",
    `Si vous ne vous connectez pas avant le ${limite}, il sera effacé, avec vos escaliers et votre profil de l'atelier. Il ne pourra pas être retrouvé.`,
    "",
    "Pour le garder, il suffit de vous connecter : https://quart-de-tour.fr/app/",
    "Si vous ne vous en servez plus, vous n'avez rien à faire.",
    "",
    "Quart de tour, https://quart-de-tour.fr",
  ].join("\n");
}

function avertissementHtml(limite: string): string {
  return `<!doctype html><html lang="fr"><body style="font-family:Helvetica,Arial,sans-serif;color:#1d2228">
<p>Votre compte Quart de tour n'a pas servi depuis longtemps. Les comptes restés 24 mois sans connexion sont effacés.</p>
<p>Si vous ne vous connectez pas <strong>avant le ${limite}</strong>, il sera effacé, avec vos escaliers et votre profil de l'atelier. Il ne pourra pas être retrouvé.</p>
<p>Pour le garder, il suffit de vous connecter : <a href="https://quart-de-tour.fr/app/">quart-de-tour.fr/app</a></p>
<p>Si vous ne vous en servez plus, vous n'avez rien à faire.</p>
<p style="color:#666">Quart de tour, <a href="https://quart-de-tour.fr">quart-de-tour.fr</a></p>
</body></html>`;
}

function codeAdresseText(code: string): string {
  return [
    `Votre code pour changer l'adresse de votre compte Quart de tour : ${code}`,
    "",
    "Il est valable 10 minutes.",
    "Si vous n'avez pas demandé ce changement, ignorez ce message : sans ce code, cette adresse ne sera reliée à aucun compte.",
    "",
    "Quart de tour, https://quart-de-tour.fr",
  ].join("\n");
}

function codeAdresseHtml(code: string): string {
  return `<!doctype html><html lang="fr"><body style="font-family:Helvetica,Arial,sans-serif;color:#1d2228">
<p>Votre code pour changer l'adresse de votre compte Quart de tour :</p>
<p style="font-size:28px;font-weight:bold;letter-spacing:6px">${code}</p>
<p>Il est valable 10 minutes.</p>
<p style="color:#666">Si vous n'avez pas demandé ce changement, ignorez ce message : sans ce code, cette adresse ne sera reliée à aucun compte.</p>
<p style="color:#666">Quart de tour, <a href="https://quart-de-tour.fr">quart-de-tour.fr</a></p>
</body></html>`;
}

const RESPONSABLE = "tom.bouzy@gmail.com";

function adresseChangeeText(): string {
  return [
    "L'adresse e-mail de votre compte Quart de tour vient d'être changée. Celle-ci ne sert plus à vous connecter.",
    "",
    "Si c'est vous, vous n'avez rien à faire : connectez-vous désormais avec la nouvelle.",
    `Si ce n'est pas vous, écrivez tout de suite à ${RESPONSABLE}.`,
    "",
    "Quart de tour, https://quart-de-tour.fr",
  ].join("\n");
}

function adresseChangeeHtml(): string {
  return `<!doctype html><html lang="fr"><body style="font-family:Helvetica,Arial,sans-serif;color:#1d2228">
<p>L'adresse e-mail de votre compte Quart de tour vient d'être changée. Celle-ci ne sert plus à vous connecter.</p>
<p>Si c'est vous, vous n'avez rien à faire : connectez-vous désormais avec la nouvelle.</p>
<p>Si ce n'est pas vous, écrivez tout de suite à <a href="mailto:${RESPONSABLE}">${RESPONSABLE}</a>.</p>
<p style="color:#666">Quart de tour, <a href="https://quart-de-tour.fr">quart-de-tour.fr</a></p>
</body></html>`;
}

/** E-mail transactionnel par l'API de Brevo ; le délai vaut aussi pour la lecture de la réponse. */
async function envoie(
  apiKey: string,
  delai: number,
  email: string,
  message: { subject: string; textContent: string; htmlContent: string },
): Promise<void> {
  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    signal: AbortSignal.timeout(delai),
    headers: { "api-key": apiKey, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ sender: SENDER, to: [{ email }], ...message }),
  });
  if (!res.ok) throw new Error(`Brevo ${res.status} : ${await res.text()}`);
}

export function brevo(apiKey: string, delai = 10_000): SendCode {
  return (email, code) =>
    envoie(apiKey, delai, email, {
      subject: `${code} : votre code Quart de tour`,
      textContent: text(code),
      htmlContent: html(code),
    });
}

export function brevoAvertissement(apiKey: string, delai = 10_000): SendAvertissement {
  return (email, limite) =>
    envoie(apiKey, delai, email, {
      subject: `Votre compte Quart de tour sera effacé : connectez-vous avant le ${jour(limite)}`,
      textContent: avertissementText(jour(limite)),
      htmlContent: avertissementHtml(jour(limite)),
    });
}

export function brevoCodeAdresse(apiKey: string, delai = 10_000): SendCode {
  return (email, code) =>
    envoie(apiKey, delai, email, {
      subject: `${code} : votre code pour changer d'adresse`,
      textContent: codeAdresseText(code),
      htmlContent: codeAdresseHtml(code),
    });
}

export function brevoAdresseChangee(apiKey: string, delai = 10_000): SendAdresseChangee {
  return (ancienne) =>
    envoie(apiKey, delai, ancienne, {
      subject: "L'adresse de votre compte Quart de tour a changé",
      textContent: adresseChangeeText(),
      htmlContent: adresseChangeeHtml(),
    });
}

/** En développement : le code s'affiche dans la console. */
export const consoleMail: SendCode = async (email, code) => {
  console.log(`[code] ${email} : ${code}`);
};

export const consoleAvertissement: SendAvertissement = async (email, limite) => {
  console.log(`[avertissement] ${email} : avant le ${jour(limite)}`);
};

export const consoleCodeAdresse: SendCode = async (email, code) => {
  console.log(`[code d'adresse] ${email} : ${code}`);
};

export const consoleAdresseChangee: SendAdresseChangee = async (ancienne) => {
  console.log(`[adresse changée] avis à ${ancienne}`);
};
