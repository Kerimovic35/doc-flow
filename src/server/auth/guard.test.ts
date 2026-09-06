import { describe, expect, it } from 'vitest';
import { ForbiddenError, assertRole, hasRole } from './guard';

const normalUser = { role: 'USER' as const };
const admin = { role: 'ADMIN' as const };

describe('Rollenpruefung', () => {
  it('weist einen Benutzer von Systemzugangfunktionen ab', () => {
    // Der Kern der Anforderung: Der Schutz haengt nicht an einem
    // ausgeblendeten Menuepunkt, sondern greift beim Aufruf selbst.
    expect(() => assertRole(normalUser, 'ADMIN')).toThrow(ForbiddenError);
  });

  it('laesst einen Benutzer an Benutzerfunktionen', () => {
    expect(() => assertRole(normalUser, 'USER')).not.toThrow();
  });

  it('gibt dem Systemzugang auch alle Benutzerrechte', () => {
    // ADMIN ist die hoehere Rolle, keine getrennte - sonst muesste ein
    // Systemzugang zusaetzlich als Benutzer gefuehrt werden.
    expect(() => assertRole(admin, 'USER')).not.toThrow();
    expect(() => assertRole(admin, 'ADMIN')).not.toThrow();
  });

  it('beantwortet die Rollenfrage ohne Ausnahme', () => {
    expect(hasRole(normalUser, 'ADMIN')).toBe(false);
    expect(hasRole(admin, 'ADMIN')).toBe(true);
    expect(hasRole(normalUser, 'USER')).toBe(true);
  });
});
