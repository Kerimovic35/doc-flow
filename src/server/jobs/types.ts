import type { JobType } from '@/generated/prisma/enums';

/**
 * Ein aus der Warteschlange geholter Auftrag.
 *
 * Bewusst ein eigener, schlanker Typ statt der Prisma-Zeile: Der Handler
 * braucht nur diese Felder, und so bleibt der Worker unabhaengig davon, wie
 * die Tabelle im Einzelnen aussieht.
 */
export interface ClaimedJob {
  id: string;
  type: JobType;
  documentId: string | null;
  userId: string | null;
  payload: Record<string, unknown>;
  attempts: number;
  maxAttempts: number;
}

/** Ein Handler bearbeitet genau eine Auftragsart. */
export type JobHandler = (job: ClaimedJob) => Promise<void>;

/**
 * Ein Fehler, bei dem ein weiterer Versuch sinnlos ist: beschaedigte Datei,
 * verschluesseltes PDF, fehlende Voraussetzung. Der Worker bricht dann sofort
 * ab, statt zwei weitere Male dasselbe zu versuchen.
 */
export class PermanentJobError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermanentJobError';
  }
}
