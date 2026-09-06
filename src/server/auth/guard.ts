import type { UserRole } from '@/generated/prisma/enums';
import type { SessionUser } from './session';

/** Angemeldet, aber ohne das erforderliche Recht. */
export class ForbiddenError extends Error {
  constructor(message = 'Keine Berechtigung fuer diese Aktion') {
    super(message);
    this.name = 'ForbiddenError';
  }
}

/**
 * Rangfolge der Rollen. ADMIN schliesst alle Rechte von USER ein - die
 * Rollen stehen aufsteigend zueinander, nicht nebeneinander.
 */
const RANK: Record<UserRole, number> = {
  USER: 1,
  ADMIN: 2,
};

export function hasRole(user: Pick<SessionUser, 'role'>, required: UserRole): boolean {
  return RANK[user.role] >= RANK[required];
}

/**
 * Die eigentliche Rechtepruefung - bewusst als reine Funktion ohne Zugriff
 * auf Cookies oder Request.
 *
 * Dadurch laesst sie sich ohne laufenden Server testen, und jede
 * Service-Funktion kann sie am eigenen Anfang aufrufen. Genau darin liegt
 * der Schutz: Die Pruefung haengt am Datenzugriff, nicht an der Oberflaeche.
 * Ein selbst zusammengebauter Request erreicht den Service auf demselben Weg
 * wie die Benutzeroberflaeche und wird ebenso geprueft.
 */
export function assertRole(user: Pick<SessionUser, 'role'>, required: UserRole): void {
  if (!hasRole(user, required)) {
    throw new ForbiddenError(
      required === 'ADMIN'
        ? 'Diese Funktion ist dem Systemzugang vorbehalten'
        : 'Keine Berechtigung fuer diese Aktion',
    );
  }
}
