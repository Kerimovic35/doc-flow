import Link from 'next/link';
import { PageBody, PageHeader } from '@/components/ui/page-header';
import { Button } from '@/components/ui/button';
import { requireUser } from '@/server/auth/context';
import { listPersons } from '@/server/services/persons';
import { EditPersonForm, NewPersonForm } from './person-forms';
import { togglePersonAction } from './actions';

export const metadata = { title: 'Personen | Doc-Flow' };

const KIND_LABELS: Record<string, string> = {
  SELF: 'Ich selbst',
  FAMILY: 'Angehörige',
  OTHER: 'Sonstige',
};

export default async function PersonsPage() {
  const actor = await requireUser();
  const persons = await listPersons(actor);

  return (
    <>
      <PageHeader
        title="Personen"
        subtitle="Wessen Post hier verwaltet wird"
        action={<Link href="/einstellungen">Zurück</Link>}
      />
      <PageBody>
        <div className="flex flex-col gap-4">
          <p className="text-text-muted text-sm">
            Dokumente lassen sich einer Person zuordnen. Die KI schlägt die Person vor und
            kennzeichnet die Zuordnung als unsicher, wenn sie sich nicht sicher ist.
          </p>

          <ul className="flex flex-col gap-2">
            {persons.map((person) => (
              <li
                key={person.id}
                className="border-border bg-surface rounded-2xl border px-4 py-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium">
                      {person.name}
                      {!person.active && (
                        <span className="text-text-muted ml-2 text-xs">ausgeblendet</span>
                      )}
                    </p>
                    <p className="text-text-muted text-sm">
                      {KIND_LABELS[person.kind] ?? person.kind}
                      {' · '}
                      {person.documentCount === 1
                        ? '1 Dokument'
                        : `${person.documentCount} Dokumente`}
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center gap-1">
                    <EditPersonForm
                      person={{
                        id: person.id,
                        name: person.name,
                        kind: person.kind,
                        birthDate: person.birthDate
                          ? person.birthDate.toISOString().slice(0, 10)
                          : '',
                        notes: person.notes ?? '',
                      }}
                    />

                    {person.kind !== 'SELF' && (
                      <form action={togglePersonAction}>
                        <input type="hidden" name="personId" value={person.id} />
                        <input type="hidden" name="activate" value={person.active ? '0' : '1'} />
                        <Button type="submit" variant="ghost">
                          {person.active ? 'Ausblenden' : 'Einblenden'}
                        </Button>
                      </form>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>

          <NewPersonForm />
        </div>
      </PageBody>
    </>
  );
}
