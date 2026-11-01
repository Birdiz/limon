---
name: pwa
description: Application installable et hors ligne, service worker (src/sw.js), mises à jour silencieuses, manifeste, bouton Installer, anciennes adresses et leurs renvois.
---

# Application installable et hors ligne

`startPWA`, `src/ui/pwa.ts`.

- **Service worker** : `src/sw.js` en JavaScript, complété au build par le greffon `pwa` de `vite.config.ts` (fichiers du build et de `public/`, sans `.map` ni `.woff`, empreinte en nom de cache). Il ne touche jamais `/api/`.
- **Mises à jour** : silencieuses, sans bandeau, les artisans ne rechargeraient pas. La nouvelle version attend, prend la main quand la page passe en arrière-plan (ou dès le lancement si elle attendait déjà), puis la page se recharge après avoir enregistré la saisie en cours.
- **Installation** : bouton « Installer » dans Mes escaliers (`beforeinstallprompt`), aide Partager → écran d'accueil sur iPhone.
- **Portée** : le service worker reste à la racine (`/sw.js`, portée `/`, celle des installations d'avant /app/) et sert `app/index.html` à toute adresse sous `/app/`, `index.html` à `/`. Le manifeste garde son `id` et démarre sur `app/`.
- **Essai** : service worker enregistré en production seulement, donc `npm run build` puis `npm run start:local`.

## Anciennes adresses

Un ancien service worker sert encore l'ancien outil à `/` jusqu'à sa mise à jour : c'est pourquoi les renvois des anciennes adresses visent `/` et non `/app/`.

- `limon-escaliers.up.railway.app` sert le même site, qui part aussitôt vers quart-de-tour.fr en emportant ses projets dans l'ancre (`src/ui/move.ts`). À garder en ligne tant que des testeurs ont des projets là-bas.
- `www.quart-de-tour.fr` part de la même façon : le compte (passkeys, session, origine acceptée par `/api`) n'existe qu'à l'adresse sans www.
