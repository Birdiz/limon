/** Base de données : Postgres en ligne, PGlite (Postgres en WebAssembly) en développement et dans les tests. */
export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  /** Plusieurs instructions sans paramètres, d'un seul tenant. */
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
}

/** Postgres de Railway, par `DATABASE_URL`. */
export async function pgDb(url: string): Promise<Db> {
  const { default: pg } = await import("pg");
  // bigint arrive en texte par défaut : les dates en millisecondes tiennent dans un nombre.
  pg.types.setTypeParser(pg.types.builtins.INT8, Number);
  const pool = new pg.Pool({ connectionString: url, max: 5 });
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
];

/** Met la base à jour ; un seul serveur tourne à la fois. */
export async function migrate(db: Db): Promise<void> {
  await db.query("create table if not exists schema_version (v int not null)");
  const [row] = await db.query<{ v: number }>("select coalesce(max(v), 0) as v from schema_version");
  for (let v = row!.v; v < MIGRATIONS.length; v++)
    await db.exec(`${MIGRATIONS[v]!}\ninsert into schema_version (v) values (${v + 1});`);
}

/** Efface codes, défis et sessions expirés. */
export async function purge(db: Db): Promise<void> {
  for (const t of ["codes", "defis", "sessions"]) await db.query(`delete from ${t} where expire < now()`);
}
