/** Nombre au format français (espace fine insécable pour les milliers, virgule décimale). */
export const fmt = (v: number, d = 0): string =>
  Number(v).toLocaleString("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d });

/** Arrondi au multiple de 10 supérieur, pour les cotes proposées. */
export const ceil10 = (v: number): number => Math.ceil(v / 10) * 10;
