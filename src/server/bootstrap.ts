import { db } from '@/server/db';
import { hashPassword } from '@/server/auth/password';
import { log } from '@/server/log';
import { ensureUserDefaults } from '@/server/services/defaults';

/**
 * Erstinitialisierung beim Serverstart.
 *
 * Legt genau dann einen Zugang an, wenn die Benutzertabelle vollstaendig leer
 * ist. Sobald ein Konto existiert, ruehrt diese Funktion Benutzer nicht mehr
 * an - andernfalls koennte ein versehentlich stehen gebliebenes
 * BOOTSTRAP_PASSWORD in der Umgebung dauerhaft eine Hintertuer offenhalten.
 *
 * Die Startdaten (Kategorien, eigene Person, Voreinstellungen) haengen am
 * Benutzer und werden fuer jeden Benutzer nachgezogen, dem sie fehlen - auch
 * spaeter noch.
 */
export interface BootstrapResult {
  userCreated: boolean;
  categoriesCreated: number;
  personsCreated: number;
  note?: string;
}

export async function bootstrap(): Promise<BootstrapResult> {
  const result: BootstrapResult = { userCreated: false, categoriesCreated: 0, personsCreated: 0 };

  const userCount = await db.user.count();

  if (userCount === 0) {
    const email = process.env.BOOTSTRAP_EMAIL?.trim().toLowerCase();
    const password = process.env.BOOTSTRAP_PASSWORD;
    const name = process.env.BOOTSTRAP_NAME?.trim() || 'Ich';

    if (!email || !password) {
      result.note =
        'Kein Benutzer vorhanden. BOOTSTRAP_EMAIL und BOOTSTRAP_PASSWORD setzen und neu starten.';
      return result;
    }

    if (password.length < 12) {
      result.note = 'BOOTSTRAP_PASSWORD ist zu kurz (mindestens 12 Zeichen). Kein Zugang angelegt.';
      return result;
    }

    const passwordHash = await hashPassword(password);
    const user = await db.user.create({
      data: { email, name, passwordHash, role: 'ADMIN' },
      select: { id: true },
    });

    result.userCreated = true;
    log.info('bootstrap.user_created', { userId: user.id });
  }

  // Startdaten fuer alle Benutzer nachziehen, die noch keine haben.
  const users = await db.user.findMany({ select: { id: true, name: true } });
  for (const user of users) {
    const created = await ensureUserDefaults(db, user.id, user.name);
    result.categoriesCreated += created.categories;
    result.personsCreated += created.persons;
  }

  return result;
}
