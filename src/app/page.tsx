import { redirect } from 'next/navigation';

/**
 * Die Wurzel hat keinen eigenen Inhalt. Angemeldet fuehrt sie zum Dashboard,
 * andernfalls leitet die Huelle der geschuetzten Seiten zur Anmeldung weiter.
 */
export default function RootPage() {
  redirect('/start');
}
