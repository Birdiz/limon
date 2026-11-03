/* Déménagement vers quart-de-tour.fr. L'ancienne adresse sert le même site, et l'adresse en www aussi, mais le
   compte n'existe qu'à l'adresse sans www (origine des passkeys et des sessions) : elles y partent, avec l'ancre
   d'un lien de projet.
   On arrive sur la page publique, qui passe l'ancre à l'outil (/app/) : un appareil qui garde le
   service worker d'avant /app/ y sert encore l'ancien outil, qui sait lire l'ancre. */

const OLD_HOSTS = new Set(["limon-escaliers.up.railway.app", "www.quart-de-tour.fr"]);
const NEW_ORIGIN = "https://quart-de-tour.fr";

/** À l'ancienne adresse : part vers la nouvelle ; vrai si la page s'en va. */
export function leaveOldHost(): boolean {
  if (!OLD_HOSTS.has(location.hostname)) return false;
  const lien = location.hash;
  // Le départ attend la fin du démarrage de la page, dont le premier calcul réécrit l'adresse.
  queueMicrotask(() => location.replace(`${NEW_ORIGIN}/${lien}`));
  return true;
}
