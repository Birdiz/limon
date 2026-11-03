import type { SendAvertissement } from "./mail";

/** Base de données : Postgres en ligne, PGlite (Postgres en WebAssembly) en développement et dans les tests. */
export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  /** Plusieurs instructions sans paramètres, d'un seul tenant. */
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
}

/** Délais en millisecondes. Une requête trop longue est annulée par la base (`statement`) ; une base figée
    n'annule plus rien, le client la lâche un peu après (`query`). Une écriture lâchée ainsi a pu être appliquée,
    et une migration passe par ces délais : plus longue, elle fait échouer le démarrage. */
export const PG_DELAIS = { connexion: 5_000, statement: 5_000, query: 7_000 };

/** Postgres de Railway, par `DATABASE_URL`. */
export async function pgDb(url: string, delais = PG_DELAIS): Promise<Db> {
  const { default: pg } = await import("pg");
  // bigint arrive en texte par défaut : les dates en millisecondes tiennent dans un nombre.
  pg.types.setTypeParser(pg.types.builtins.INT8, Number);
  const pool = new pg.Pool({
    connectionString: url,
    max: 5,
    connectionTimeoutMillis: delais.connexion,
    statement_timeout: delais.statement,
    query_timeout: delais.query,
  });
  // Sans écouteur, une connexion au repos perdue (redémarrage de la base) ferait tomber le processus.
  pool.on("error", (e) => console.error(e));
  return {
    query: async <T>(sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows as T[],
    // Sans paramètres, plusieurs instructions partent ensemble et forment une seule transaction.
    exec: async (sql) => void (await pool.query(sql)),
    close: () => pool.end(),
  };
}

/** PGlite, en mémoire ou dans un dossier. */
export async function pgliteDb(dir?: string): Promise<Db> {
  const { PGlite } = await import("@electric-sql/pglite");
  const db = new PGlite(dir);
  return {
    query: async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows,
    exec: async (sql) => void (await db.exec(sql)),
    close: () => db.close(),
  };
}

/** Migrations, dans l'ordre ; ne jamais en modifier une qui est en ligne, en ajouter une. */
const MIGRATIONS = [
  `create table comptes (
    id uuid primary key,
    email text not null unique,
    cree timestamptz not null default now(),
    statut text not null default 'testeur',
    droits_jusqu_a timestamptz
  );
  create table passkeys (
    id text primary key,
    compte uuid not null references comptes on delete cascade,
    cle text not null,
    compteur bigint not null,
    transports text not null default '',
    nom text not null,
    cree timestamptz not null default now(),
    utilise timestamptz
  );
  create index on passkeys (compte);
  create table sessions (
    hash text primary key,
    compte uuid not null references comptes on delete cascade,
    cree timestamptz not null default now(),
    expire timestamptz not null
  );
  create index on sessions (compte);
  create table codes (
    email text primary key,
    hash text not null,
    expire timestamptz not null,
    essais int not null default 0
  );
  create table defis (
    defi text primary key,
    compte uuid references comptes on delete cascade,
    expire timestamptz not null
  );
  create table projets (
    compte uuid not null references comptes on delete cascade,
    id text not null,
    modifie bigint not null,
    supprime boolean not null default false,
    donnees jsonb,
    primary key (compte, id)
  );`,
  `create table ateliers (
    compte uuid primary key references comptes on delete cascade,
    modifie bigint not null,
    donnees jsonb not null
  );`,
  // Devis : tarifs et fiche de l'entreprise, à côté des réglages de l'atelier.
  `alter table ateliers add column tarifs jsonb, add column entreprise jsonb;`,
  // Numéros des devis remis : un par escalier, suite continue par compte et par année.
  `create table devis_numeros (
    compte uuid not null references comptes on delete cascade,
    projet text not null,
    annee int not null,
    rang int not null,
    cree timestamptz not null default now(),
    primary key (compte, projet),
    unique (compte, annee, rang)
  );`,
  // Profil de l'atelier : une date par partie. Vide sur une ligne d'avant, relue par `sanitizeAtelier`.
  `alter table ateliers add column dates jsonb;`,
  // Dernière activité du compte et avertissement avant effacement. Un compte existant part de sa dernière activité
  // connue. `modifie` vient de l'horloge de l'appareil : bornée, une date à venir compte pour aujourd'hui.
  `alter table comptes add column vu timestamptz not null default now(), add column averti timestamptz;
  update comptes c set vu = least(now(), greatest(
    c.cree,
    (select max(coalesce(utilise, cree)) from passkeys where compte = c.id),
    (select max(greatest(cree, expire - interval '365 days')) from sessions where compte = c.id),
    (select max(cree) from devis_numeros where compte = c.id),
    (select max(to_timestamp(greatest(0, least(modifie, extract(epoch from now()) * 1000)) / 1000.0))
     from projets where compte = c.id),
    (select to_timestamp(greatest(0, least(modifie, extract(epoch from now()) * 1000)) / 1000.0)
     from ateliers where compte = c.id)
  ));`,
];

/** Met la base à jour ; un seul serveur tourne à la fois. */
export async function migrate(db: Db): Promise<void> {
  await db.query("create table if not exists schema_version (v int not null)");
  const [row] = await db.query<{ v: number }>("select coalesce(max(v), 0) as v from schema_version");
  for (let v = row!.v; v < MIGRATIONS.length; v++)
    await db.exec(`${MIGRATIONS[v]!}\ninsert into schema_version (v) values (${v + 1});`);
}

/** Durée de conservation sans connexion, décidée : celle d'un compte et celle d'une trace de suppression. */
const CONSERVATION = "24 months";
/** Temps laissé après l'avertissement, même s'il part en retard (panne de Brevo, du serveur). */
const PREAVIS = "30 days";
/** Avertissements par passage, pour ne pas prendre aux codes de connexion ce que Brevo accepte par jour. */
const AVERTIS_PAR_PASSE = 10;
/** Un compte dont les droits courent encore n'est ni averti ni effacé. */
const SANS_DROITS = "(droits_jusqu_a is null or droits_jusqu_a < now())";
const A_AVERTIR = `vu + interval '${CONSERVATION}' - interval '${PREAVIS}' < now() and ${SANS_DROITS}`;

/** Efface codes, défis et sessions expirés, et les traces de suppression anciennes. */
export async function purge(db: Db): Promise<void> {
  for (const t of ["codes", "defis", "sessions"]) await db.query(`delete from ${t} where expire < now()`);
  await db.query(
    `delete from projets where supprime and modifie < extract(epoch from now() - interval '${CONSERVATION}') * 1000`,
  );
}

/**
 * Avertit les comptes qui approchent de la durée, puis efface ceux qui l'ont passée, avertis depuis le préavis.
 * Sans avertissement parti, rien n'est effacé : un envoi en échec recommence au passage suivant, quitte à partir deux
 * fois si l'enregistrement échoue après l'envoi. L'effacement n'arrive jamais avant la date annoncée : `averti` est
 * posé après son calcul.
 */
export async function purgeComptes(db: Db, avertir: SendAvertissement): Promise<void> {
  const comptes = await db.query<{ id: string; email: string; limite: Date }>(
    `select id, email, now() + interval '${PREAVIS}' as limite
     from comptes where averti is null and ${A_AVERTIR} order by vu limit ${AVERTIS_PAR_PASSE}`,
  );
  for (const c of comptes) {
    try {
      await avertir(c.email, new Date(c.limite));
    } catch (e) {
      console.error(e);
      continue;
    }
    // Revenu pendant l'envoi : l'avertissement n'est pas retenu, il en faudra un autre le moment venu.
    await db.query(`update comptes set averti = now() where id = $1 and averti is null and ${A_AVERTIR}`, [c.id]);
  }
  // Tout est relu par la base dans cette seule instruction : une connexion qui passe avant met `vu` à jour et l'épargne.
  const effaces = await db.query(
    `delete from comptes
     where vu + interval '${CONSERVATION}' < now() and averti + interval '${PREAVIS}' < now() and averti > vu
       and ${SANS_DROITS}
     returning id`,
  );
  if (effaces.length) console.log(`[purge] comptes inactifs effacés : ${effaces.length}`);
}
