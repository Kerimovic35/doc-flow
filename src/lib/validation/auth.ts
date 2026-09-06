import { z } from 'zod';

export const loginSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, 'E-Mail-Adresse fehlt')
    .max(254)
    .toLowerCase()
    .pipe(z.email('Keine gültige E-Mail-Adresse')),
  password: z.string().min(1, 'Passwort fehlt').max(512),
});

export type LoginInput = z.infer<typeof loginSchema>;

/**
 * Mindestlaenge statt Zeichenklassen-Zwang: Laenge traegt bei Passwoertern
 * deutlich mehr zur Sicherheit bei als erzwungene Sonderzeichen, die in der
 * Praxis zu vorhersehbaren Mustern fuehren.
 */
export const passwordSchema = z
  .string()
  .min(12, 'Passwort muss mindestens 12 Zeichen lang sein')
  .max(512, 'Passwort ist zu lang');

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Aktuelles Passwort fehlt'),
    newPassword: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: 'Die Passwörter stimmen nicht überein',
    path: ['confirmPassword'],
  })
  .refine((data) => data.newPassword !== data.currentPassword, {
    message: 'Das neue Passwort muss sich vom bisherigen unterscheiden',
    path: ['newPassword'],
  });

export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
