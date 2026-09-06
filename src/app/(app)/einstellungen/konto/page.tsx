import Link from 'next/link';
import { PageBody, PageHeader } from '@/components/ui/page-header';
import { Button } from '@/components/ui/button';
import { requireUser } from '@/server/auth/context';
import { PasswordForm } from './password-form';
import { logoutAction } from './actions';

export const metadata = { title: 'Konto | Doc-Flow' };

export default async function AccountPage() {
  const user = await requireUser();

  return (
    <>
      <PageHeader
        title="Konto"
        subtitle={user.email}
        action={<Link href="/einstellungen">Zurück</Link>}
      />
      <PageBody>
        <div className="flex flex-col gap-8">
          <section className="flex flex-col gap-3">
            <h2 className="text-base font-semibold">Passwort ändern</h2>
            <PasswordForm />
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-base font-semibold">Abmelden</h2>
            <form action={logoutAction}>
              <Button type="submit" variant="secondary" fullWidth size="lg">
                Auf diesem Gerät abmelden
              </Button>
            </form>
          </section>
        </div>
      </PageBody>
    </>
  );
}
