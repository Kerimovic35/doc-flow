import { beforeEach, describe, expect, it, vi } from 'vitest';
import { actorFor, resetTestDb, seedBasics, testDb } from '@/test/integration-db';

vi.mock('@/server/db', async () => {
  const { testDb: client } = await import('@/test/integration-db');
  return { db: client };
});

const { listPersons, createPerson, updatePerson, deactivatePerson, activatePerson } = await import(
  './persons'
);

let userId: string;

beforeEach(async () => {
  await resetTestDb();
  ({ userId } = await seedBasics());
});

describe('Personen', () => {
  it('legt eine Person an', async () => {
    const actor = actorFor(userId);
    const result = await createPerson(actor, { name: 'Mutter', kind: 'FAMILY' });

    expect(result.ok).toBe(true);
    const persons = await listPersons(actor);
    expect(persons.map((p) => p.name)).toContain('Mutter');
  });

  it('lehnt einen doppelten Namen ab', async () => {
    const actor = actorFor(userId);
    await createPerson(actor, { name: 'Mutter', kind: 'FAMILY' });

    const zweite = await createPerson(actor, { name: 'Mutter', kind: 'FAMILY' });

    // Zwei Personen mit gleichem Namen waeren in der Zuordnung nicht
    // auseinanderzuhalten - weder fuer den Benutzer noch fuer die KI.
    expect(zweite.ok).toBe(false);
  });

  it('übernimmt Geburtsdatum und Notiz', async () => {
    const actor = actorFor(userId);
    const result = await createPerson(actor, {
      name: 'Vater',
      kind: 'FAMILY',
      birthDate: '1958-04-12',
      notes: 'Rentenversicherung läuft über die DRV Bund',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const person = await testDb.person.findUniqueOrThrow({ where: { id: result.id } });
    expect(person.birthDate?.toISOString().slice(0, 10)).toBe('1958-04-12');
    expect(person.notes).toContain('DRV');
  });

  it('blendet aus statt zu löschen', async () => {
    const actor = actorFor(userId);
    const created = await createPerson(actor, { name: 'Mutter', kind: 'FAMILY' });
    if (!created.ok) throw new Error('Anlegen fehlgeschlagen');

    await deactivatePerson(actor, created.id);

    // Die Zeile muss bleiben: An ihr haengen Dokumente, deren Zuordnung
    // sonst stillschweigend verschwaende.
    const person = await testDb.person.findUniqueOrThrow({ where: { id: created.id } });
    expect(person.active).toBe(false);

    await activatePerson(actor, created.id);
    const wieder = await testDb.person.findUniqueOrThrow({ where: { id: created.id } });
    expect(wieder.active).toBe(true);
  });

  it('lässt die eigene Person nicht ausblenden', async () => {
    const actor = actorFor(userId);
    const self = await testDb.person.findFirstOrThrow({ where: { userId, kind: 'SELF' } });

    const result = await deactivatePerson(actor, self.id);
    expect(result.ok).toBe(false);
  });

  it('zeigt niemals Personen eines anderen Kontos', async () => {
    const fremd = await seedBasics({ email: 'fremd@docflow.local', name: 'Fremd' });
    await createPerson(actorFor(fremd.userId), { name: 'Fremde Mutter', kind: 'FAMILY' });

    const eigene = await listPersons(actorFor(userId));

    expect(eigene.map((p) => p.name)).not.toContain('Fremde Mutter');
  });

  it('ändert keine fremde Person', async () => {
    const fremd = await seedBasics({ email: 'fremd@docflow.local', name: 'Fremd' });
    const fremdePerson = await testDb.person.findFirstOrThrow({ where: { userId: fremd.userId } });

    const result = await updatePerson(actorFor(userId), fremdePerson.id, {
      name: 'Übernommen',
      kind: 'OTHER',
    });

    expect(result.ok).toBe(false);
    const unveraendert = await testDb.person.findUniqueOrThrow({ where: { id: fremdePerson.id } });
    expect(unveraendert.name).toBe('Fremd');
  });
});
