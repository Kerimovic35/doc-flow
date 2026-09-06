'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { changePasswordSchema } from '@/lib/validation/auth';
import { toFieldErrors, type FormState } from '@/lib/form-state';
import { requireUser, clearSessionCookie } from '@/server/auth/context';
import { SESSION_COOKIE } from '@/server/auth/session';
import { changePassword, logout } from '@/server/services/auth';

export type PasswordState = FormState;

export async function changePasswordAction(
  _prev: PasswordState,
  formData: FormData,
): Promise<PasswordState> {
  const actor = await requireUser();

  const parsed = changePasswordSchema.safeParse({
    currentPassword: String(formData.get('currentPassword') ?? ''),
    newPassword: String(formData.get('newPassword') ?? ''),
    confirmPassword: String(formData.get('confirmPassword') ?? ''),
  });

  if (!parsed.success) {
    return { fieldErrors: toFieldErrors(parsed.error.issues) };
  }

  const result = await changePassword(
    actor.id,
    parsed.data.currentPassword,
    parsed.data.newPassword,
  );

  if (!result.ok) {
    return { error: result.error };
  }

  // Die Aenderung hat alle Sitzungen beendet, auch die eigene. Das Cookie
  // muss deshalb weg, sonst zeigte die Anwendung eine Sitzung an, die es
  // nicht mehr gibt.
  await clearSessionCookie();
  redirect('/login?geaendert=1');
}

export async function logoutAction(): Promise<void> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (token) await logout(token);
  await clearSessionCookie();
  redirect('/login');
}
