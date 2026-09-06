'use server';

import { revalidatePath } from 'next/cache';
import { requireUser } from '@/server/auth/context';
import { markRemindersSeen, relatedReminderIds } from '@/server/services/reminders';

/**
 * Erinnerungen wegklicken.
 *
 * Die Zeilen bleiben in der Datenbank und tragen nur ein Datum - so ist
 * spaeter nachvollziehbar, dass erinnert wurde. Ein Loeschen wuerde die
 * Erinnerung beim naechsten Aufruf des Dashboards neu erzeugen.
 */
export async function dismissRemindersAction(formData: FormData): Promise<void> {
  const actor = await requireUser();
  const shown = formData.getAll('reminderId').filter((id): id is string => typeof id === 'string');

  // Auch die Erinnerungen zu denselben Posten, die nur nicht angezeigt
  // wurden - sonst erschiene die naechste sofort wieder.
  await markRemindersSeen(actor, await relatedReminderIds(actor, shown));
  revalidatePath('/start');
}
