import { describe, expect, it } from 'vitest';
import { toLibpqUrl } from './postgres-url';

describe('Verbindungszeichenkette fÃ¼r PostgreSQL-Programme', () => {
  it('entfernt Prismas schema-Parameter', () => {
    // pg_dump quittiert ihn mit "ungueltiger URI-Query-Parameter" und bricht ab.
    expect(toLibpqUrl('postgresql://u:p@localhost:5432/db?schema=public')).toBe(
      'postgresql://u:p@localhost:5432/db',
    );
  });

  it('entfernt die uebrigen nur von Prisma verstandenen Parameter', () => {
    const bereinigt = toLibpqUrl(
      'postgresql://u:p@localhost:5432/db?schema=public&connection_limit=5&pool_timeout=10&pgbouncer=true',
    );
    expect(bereinigt).toBe('postgresql://u:p@localhost:5432/db');
  });

  it('behaelt Parameter, die PostgreSQL selbst kennt', () => {
    const bereinigt = toLibpqUrl(
      'postgresql://u:p@localhost:5432/db?schema=public&sslmode=require&connect_timeout=10',
    );
    expect(bereinigt).toContain('sslmode=require');
    expect(bereinigt).toContain('connect_timeout=10');
    expect(bereinigt).not.toContain('schema');
  });

  it('laesst eine Zeichenkette ohne Parameter unveraendert', () => {
    expect(toLibpqUrl('postgresql://u:p@localhost:5432/db')).toBe(
      'postgresql://u:p@localhost:5432/db',
    );
  });

  it('behaelt Passwoerter mit Sonderzeichen', () => {
    // Das Passwort geht als Argument an pg_dump, nicht durch eine Shell -
    // Sonderzeichen duerfen dabei nicht verlorengehen.
    const url = 'postgresql://u:p%40ss%3Aword@localhost:5432/db?schema=public';
    expect(toLibpqUrl(url)).toContain('p%40ss%3Aword');
  });
});
