/* Page publique (/) : des styles et quelques mouvements, la page est écrite dans index.html. Le renvoi
   vers l'outil de ceux qui ont déjà des escaliers est dans le <head>, pour partir avant l'affichage. */
import "@fontsource/barlow/latin-400.css";
import "@fontsource/barlow/latin-600.css";
import "@fontsource/barlow-condensed/latin-700.css";
import "./styles/vitrine.css";

/* Chaque bloc monte quand il entre à l'écran ; ceux qui entrent ensemble se suivent de près. Rien
   ne bouge pour qui a coupé les animations sur son appareil. */
if (!matchMedia("(prefers-reduced-motion: reduce)").matches && "IntersectionObserver" in window) {
  const blocs = document.querySelectorAll<HTMLElement>(".vitrine main > section:not(.hero) > :not(ol), .steps li");
  const vue = new IntersectionObserver(
    (entries) => {
      let n = 0;
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const el = e.target as HTMLElement;
        el.style.transitionDelay = `${n++ * 90}ms`;
        el.classList.add("vu");
        vue.unobserve(el);
        // Arrivé, le bloc rend la main à ses propres transitions (survol des boutons).
        const fini = (ev: TransitionEvent) => {
          if (ev.target !== el) return;
          el.removeEventListener("transitionend", fini);
          el.classList.remove("monte", "vu");
          el.style.transitionDelay = "";
        };
        el.addEventListener("transitionend", fini);
      }
    },
    { rootMargin: "0px 0px -8% 0px" },
  );
  for (const el of blocs) {
    el.classList.add("monte");
    vue.observe(el);
  }
}

const haut = document.querySelector(".vtop");
const leve = () => haut?.classList.toggle("leve", scrollY > 4);
addEventListener("scroll", leve, { passive: true });
leve();
