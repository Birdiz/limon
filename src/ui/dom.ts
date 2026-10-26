/** Élément par identifiant ; une absence est une erreur de gabarit, pas un cas à gérer. */
export function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Élément #${id} introuvable`);
  return el as T;
}

const timers = new WeakMap<HTMLElement, number>();

/** Message bref qui disparaît tout seul. */
export function flash(el: HTMLElement, text: string, isErr = false, ms = 3500): void {
  el.textContent = text;
  el.classList.toggle("err", isErr);
  el.hidden = false;
  clearTimeout(timers.get(el));
  timers.set(
    el,
    window.setTimeout(() => (el.hidden = true), ms),
  );
}

/** Copie dans le presse-papiers ; à défaut, affiche le texte sélectionné dans la zone de secours. */
export async function copyText(text: string, fallback: HTMLTextAreaElement): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    fallback.hidden = false;
    fallback.value = text;
    fallback.focus();
    fallback.select();
    return false;
  }
}

/** Fait télécharger des octets sous un nom de fichier. */
export function downloadBytes(data: Uint8Array<ArrayBuffer>, filename: string, type: string): void {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const cssVar = (name: string): string =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();
