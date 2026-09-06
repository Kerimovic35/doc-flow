import type { PersonKind } from '@/generated/prisma/enums';
import type { PersonInput } from '@/lib/validation/person';
import type { SessionUser } from '@/server/auth/session';
import { db } from '@/server/db';

/**
 * Personenverwaltung.
 *
 * Eine Person ist kein Zugang, sondern der Mensch, um dessen Post es geht:
 * Kerim, Mutter, Vater. Alle gehoeren zu einem Benutzerkonto.
 *
 * Jede Abfrage filtert nach `userId` - auch wenn es heute nur einen Benutzer
 * gibt. Die Alternative waere, den Filter spaeter an dreissig Stellen
 * nachzuruesten und eine davon zu vergessen.
 */

export interface PersonListItem {
  id: string;
  name: string;
  kind: PersonKind;
  birthDate: Date | null;
  notes: string | null;
  active: boolean;
  documentCount: number;
}

export async function listPersons(actor: SessionUser): Promise<PersonListItem[]> {
  const persons = await db.person.findMany({
    where: { userId: actor.id },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    select: {
      id: true,
      name: true,
      kind: true,
      birthDate: true,
      notes: true,
      active: true,
      _count: { select: { documents: true } },
    },
  });

  return persons.map(({ _count, ...person }) => ({
    ...person,
    documentCount: _count.documents,
  }));
}

export type PersonResult = { ok: true; id: string } | { ok: false; error: string };

export async function createPerson(actor: SessionUser, input: PersonInput): Promise<PersonResult> {
  const existing = await db.person.findFirst({
    where: { userId: actor.id, name: input.name },
    select: { id: true },
  });
  if (existing) {
    return { ok: false, error: 'Eine Person mit diesem Namen gibt es bereits.' };
  }

  const last = await db.person.findFirst({
    where: { userId: actor.id },
    orderBy: { sortOrder: 'desc' },
    select: { sortOrder: true },
  });

  const person = await db.person.create({
    data: {
      userId: actor.id,
      name: input.name,
      kind: input.kind,
      birthDate: parseDate(input.birthDate),
      notes: input.notes || null,
      sortOrder: (last?.sortOrder ?? -1) + 1,
    },
    select: { id: true },
  });

  return { ok: true, id: person.id };
}

export async function updatePerson(
  actor: SessionUser,
  personId: string,
  input: PersonInput,
): Promise<PersonResult> {
  const person = await db.person.findFirst({
    where: { id: personId, userId: actor.id },
    select: { id: true },
  });
  if (!person) {
    return { ok: false, error: 'Person nicht gefunden.' };
  }

  const duplicate = await db.person.findFirst({
    where: { userId: actor.id, name: input.name, id: { not: personId } },
    select: { id: true },
  });
  if (duplicate) {
    return { ok: false, error: 'Eine Person mit diesem Namen gibt es bereits.' };
  }

  await db.person.update({
    where: { id: personId },
    data: {
      name: input.name,
      kind: input.kind,
      birthDate: parseDate(input.birthDate),
      notes: input.notes || null,
    },
  });

  return { ok: true, id: personId };
}

/**
 * Blendet eine Person aus, statt sie zu loeschen.
 *
 * An einer Person haengen Dokumente. Ein echtes Loeschen wuerde die
 * Zuordnung stillschweigend entfernen - beim Wiederfinden eines Bescheids in
 * fuenf Jahren waere das ein Verlust, den niemand mehr rekonstruieren kann.
 */
export async function deactivatePerson(
  actor: SessionUser,
  personId: string,
): Promise<PersonResult> {
  const person = await db.person.findFirst({
    where: { id: personId, userId: actor.id },
    select: { id: true, kind: true },
  });
  if (!person) {
    return { ok: false, error: 'Person nicht gefunden.' };
  }
  if (person.kind === 'SELF') {
    return { ok: false, error: 'Die eigene Person lässt sich nicht ausblenden.' };
  }

  await db.person.update({ where: { id: personId }, data: { active: false } });
  return { ok: true, id: personId };
}

export async function activatePerson(actor: SessionUser, personId: string): Promise<PersonResult> {
  const updated = await db.person.updateMany({
    where: { id: personId, userId: actor.id },
    data: { active: true },
  });
  if (updated.count === 0) {
    return { ok: false, error: 'Person nicht gefunden.' };
  }
  return { ok: true, id: personId };
}

function parseDate(value: string | undefined): Date | null {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}
