/** Envoi du code de connexion. */
export type SendCode = (email: string, code: string) => Promise<void>;

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

/** E-mail transactionnel par l'API de Brevo. */
export function brevo(apiKey: string): SendCode {
  return async (email, code) => {
    const res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": apiKey, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        sender: SENDER,
        to: [{ email }],
        subject: `${code} : votre code Quart de tour`,
        textContent: text(code),
        htmlContent: html(code),
      }),
    });
    if (!res.ok) throw new Error(`Brevo ${res.status} : ${await res.text()}`);
  };
}

/** En développement : le code s'affiche dans la console. */
export const consoleMail: SendCode = async (email, code) => {
  console.log(`[code] ${email} : ${code}`);
};
