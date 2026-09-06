/**
 * Parameter, die nur Prisma kennt.
 *
 * PostgreSQL-Programme wie pg_dump brechen mit "ungueltiger
 * URI-Query-Parameter" ab, sobald sie darauf stossen. Die
 * Verbindungszeichenkette muss deshalb bereinigt werden, bevor sie an ein
 * solches Programm weitergereicht wird.
 */
const PRISMA_ONLY_PARAMS = [
  'schema',
  'connection_limit',
  'pool_timeout',
  'pgbouncer',
  'socket_timeout',
  'statement_cache_size',
];

/**
 * Wandelt die Prisma-Verbindungszeichenkette in eine, die libpq versteht.
 *
 * Bewusst als reine Funktion ohne Datenbankbezug - so laesst sie sich ohne
 * laufende Datenbank testen.
 */
export function toLibpqUrl(databaseUrl: string): string {
  const url = new URL(databaseUrl);

  for (const parameter of PRISMA_ONLY_PARAMS) {
    url.searchParams.delete(parameter);
  }

  return url.toString();
}
