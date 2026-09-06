'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { loginSchema } from '@/lib/validation/auth';
import { login } from '@/server/services/auth';
import { setSessionCookie } from '@/server/auth/context';

export interface LoginState {
  error?: string;
}

/**
 * Ermittelt die Herkunft des Aufrufs fuer Protokoll und Anmeldebegrenzung.
 *
 * Hinter dem Reverse Proxy traegt `x-forwarded-for` die echte Adresse. Der
 * Wert stammt aus einem Header und ist damit grundsaetzlich faelschbar - er
 * dient hier nur der Nachvollziehbarkeit, nie einer Rechteentscheidung.
 */
async function clientIp(): Promise<string | null> {
  const headerList = await headers();
  const forwarded = headerList.get('x-forwarded-for');
  return forwarded?.split(',')[0]?.trim() ?? headerList.get('x-real-ip');
}

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = loginSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  });

  if (!parsed.success) {
    return { error: 'Bitte E-Mail-Adresse und Passwort eingeben.' };
  }

  const headerList = await headers();
  const result = await login(parsed.data, {
    ip: await clientIp(),
    userAgent: headerList.get('user-agent'),
  });

  if (!result.ok) {
    return { error: result.error };
  }

  await setSessionCookie(result.token, result.expiresAt);

  // `redirect` wirft intern eine Kontrollausnahme und steht deshalb
  // ausserhalb jeder try/catch-Behandlung.
  redirect('/start');
}
