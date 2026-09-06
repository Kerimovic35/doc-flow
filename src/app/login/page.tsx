import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/server/auth/context';
import { LoginForm } from './login-form';

export const metadata = { title: 'Anmelden | Doc-Flow' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ geaendert?: string }>;
}) {
  // Wer bereits angemeldet ist, soll nicht erneut das Anmeldeformular sehen.
  if (await getCurrentUser()) {
    redirect('/start');
  }

  const params = await searchParams;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-8 px-6 py-12">
      <div className="flex flex-col gap-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">Doc-Flow</h1>
        <p className="text-text-muted text-sm">Deine Unterlagen an einem Ort.</p>
      </div>

      {/* Ohne diesen Hinweis waere das Abmelden nach einer Passwortaenderung
          nicht als gewollt erkennbar - es saehe nach einem Fehler aus. */}
      {params.geaendert === '1' && (
        <p className="bg-positive/10 text-positive rounded-xl px-3.5 py-3 text-sm">
          Das Passwort wurde geändert. Bitte melde dich mit dem neuen Passwort an.
        </p>
      )}

      <LoginForm />
    </main>
  );
}
