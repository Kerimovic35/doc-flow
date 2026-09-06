import { Prisma } from '@/generated/prisma/client';
import type { DocumentLifecycle, ProcessingStatus, ReviewState } from '@/generated/prisma/enums';
import { normalizeIdentifier } from '@/lib/text/normalize';
import type { SessionUser } from '@/server/auth/session';
import { db } from '@/server/db';

/**
 * Suche ueber den gesamten Bestand.
 *
 * Drei Wege fuehren zu einem Treffer, und alle drei werden gebraucht:
 *
 *   Volltext   ueber den erkannten Seitentext und die Metadaten. Deutsche
 *              Wortstammbildung inbegriffen - "Bescheide" findet "Bescheid".
 *   Nummern    exakt ueber die normalisierte Form. Wer ein Aktenzeichen
 *              sucht, will genau dieses Dokument, nicht zwanzig aehnliche.
 *   Trigramme  fangen ab, woran die Wortsuche scheitert: Tippfehler und
 *              Erkennungsfehler ("Versicherun9").
 *
 * Die Suche laeuft als eine Abfrage in SQL, nicht als drei mit Nachsortieren
 * im Programm. Bei einigen tausend Dokumenten ist das der Unterschied
 * zwischen sofort und spuerbar.
 */

export interface SearchFilter {
  personId?: string | null;
  categoryId?: string | null;
  year?: number | null;
  lifecycle?: DocumentLifecycle | null;
  /** Nur Dokumente mit offener Frist oder Aufgabe. */
  withDeadline?: boolean;
  page?: number;
  pageSize?: number;
}

export interface SearchHit {
  id: string;
  title: string | null;
  sender: string | null;
  subject: string | null;
  documentDate: Date | null;
  createdAt: Date;
  personName: string | null;
  categoryName: string | null;
  processingStatus: ProcessingStatus;
  reviewState: ReviewState;
  pageCount: number;
  thumbPageId: string | null;
  /** Textausschnitt mit hervorgehobenen Fundstellen. */
  snippet: string | null;
  /** Auf welcher Seite der Treffer steht. */
  matchPage: number | null;
  rank: number;
}

export interface SearchResult {
  hits: SearchHit[];
  total: number;
  page: number;
  pageSize: number;
  /** Die Suche wurde als exakte Nummernsuche verstanden. */
  identifierMatch: boolean;
}

interface HitRow {
  id: string;
  title: string | null;
  sender: string | null;
  subject: string | null;
  document_date: Date | null;
  created_at: Date;
  person_name: string | null;
  category_name: string | null;
  processing_status: ProcessingStatus;
  review_state: ReviewState;
  page_count: number;
  thumb_page_id: string | null;
  snippet: string | null;
  match_page: number | null;
  rank: number;
  total: bigint;
}

export async function searchDocuments(
  actor: SessionUser,
  query: string,
  filter: SearchFilter = {},
): Promise<SearchResult> {
  const trimmed = query.trim();
  const page = Math.max(1, filter.page ?? 1);
  const pageSize = Math.min(50, Math.max(1, filter.pageSize ?? 20));
  const offset = (page - 1) * pageSize;

  const conditions: Prisma.Sql[] = [
    Prisma.sql`d."user_id" = ${actor.id}`,
    Prisma.sql`d."deleted_at" IS NULL`,
  ];

  if (filter.personId) conditions.push(Prisma.sql`d."person_id" = ${filter.personId}`);
  if (filter.categoryId) conditions.push(Prisma.sql`d."category_id" = ${filter.categoryId}`);
  if (filter.lifecycle) {
    conditions.push(Prisma.sql`d."lifecycle" = ${filter.lifecycle}::"DocumentLifecycle"`);
  }

  if (filter.year) {
    // Nach dem Datum des Schreibens, ersatzweise nach dem Erfassungsdatum -
    // ein Dokument ohne erkanntes Datum soll im Jahresfilter nicht
    // verschwinden.
    conditions.push(
      Prisma.sql`EXTRACT(YEAR FROM COALESCE(d."document_date", d."created_at")) = ${filter.year}`,
    );
  }

  if (filter.withDeadline) {
    conditions.push(Prisma.sql`EXISTS (
      SELECT 1 FROM "tasks" t
      WHERE t."document_id" = d."id" AND t."status" IN ('OPEN', 'POSTPONED', 'PROPOSED')
    )`);
  }

  const normalized = normalizeIdentifier(trimmed);
  // Eine Eingabe, die wie eine Nummer aussieht, wird auch als eine gesucht.
  const looksLikeIdentifier = normalized.length >= 5 && /\d/.test(normalized);

  if (trimmed) {
    conditions.push(Prisma.sql`(
      d."search_vector" @@ websearch_to_tsquery('german', ${trimmed})
      OR EXISTS (
        SELECT 1 FROM "document_pages" p
        WHERE p."document_id" = d."id"
          AND p."search_vector" @@ websearch_to_tsquery('german', ${trimmed})
      )
      ${
        looksLikeIdentifier
          ? Prisma.sql`OR EXISTS (
              SELECT 1 FROM "document_identifiers" i
              WHERE i."document_id" = d."id" AND i."normalized" = ${normalized}
            )`
          : Prisma.empty
      }
      OR d."title" % ${trimmed}
      OR d."sender" % ${trimmed}
    )`);
  }

  const where = Prisma.join(conditions, ' AND ');

  /**
   * Der Rang bestimmt die Reihenfolge.
   *
   * Ein Treffer im Titel oder beim Absender wiegt schwerer als einer
   * irgendwo im Fliesstext - wer "AOK" sucht, will die AOK-Post oben sehen
   * und nicht den Brief, in dem sie beilaeufig erwaehnt wird.
   */
  const rank = trimmed
    ? Prisma.sql`(
        ts_rank_cd(d."search_vector", websearch_to_tsquery('german', ${trimmed})) * 4
        + COALESCE((
          SELECT MAX(ts_rank_cd(p."search_vector", websearch_to_tsquery('german', ${trimmed})))
          FROM "document_pages" p WHERE p."document_id" = d."id"
        ), 0)
      )`
    : Prisma.sql`0`;

  const snippet = trimmed
    ? Prisma.sql`(
        SELECT ts_headline('german', p."text", websearch_to_tsquery('german', ${trimmed}),
          'StartSel=<mark>, StopSel=</mark>, MaxWords=28, MinWords=10, MaxFragments=1')
        FROM "document_pages" p
        WHERE p."document_id" = d."id"
          AND p."search_vector" @@ websearch_to_tsquery('german', ${trimmed})
        ORDER BY ts_rank_cd(p."search_vector", websearch_to_tsquery('german', ${trimmed})) DESC
        LIMIT 1
      )`
    : Prisma.sql`NULL`;

  const matchPage = trimmed
    ? Prisma.sql`(
        SELECT p."page_number"
        FROM "document_pages" p
        WHERE p."document_id" = d."id"
          AND p."search_vector" @@ websearch_to_tsquery('german', ${trimmed})
        ORDER BY ts_rank_cd(p."search_vector", websearch_to_tsquery('german', ${trimmed})) DESC
        LIMIT 1
      )`
    : Prisma.sql`NULL`;

  const rows = await db.$queryRaw<HitRow[]>`
    SELECT
      d."id",
      d."title",
      d."sender",
      d."subject",
      d."document_date",
      d."created_at",
      per."name" AS person_name,
      cat."name" AS category_name,
      d."processing_status",
      d."review_state",
      d."page_count",
      (SELECT p."id" FROM "document_pages" p
        WHERE p."document_id" = d."id" AND p."thumb_key" IS NOT NULL
        ORDER BY p."page_number" LIMIT 1) AS thumb_page_id,
      ${snippet} AS snippet,
      ${matchPage} AS match_page,
      ${rank} AS rank,
      COUNT(*) OVER () AS total
    FROM "documents" d
    LEFT JOIN "persons" per ON per."id" = d."person_id"
    LEFT JOIN "categories" cat ON cat."id" = d."category_id"
    WHERE ${where}
    ORDER BY rank DESC, COALESCE(d."document_date", d."created_at") DESC
    LIMIT ${pageSize} OFFSET ${offset}
  `;

  return {
    hits: rows.map((row) => ({
      id: row.id,
      title: row.title,
      sender: row.sender,
      subject: row.subject,
      documentDate: row.document_date,
      createdAt: row.created_at,
      personName: row.person_name,
      categoryName: row.category_name,
      processingStatus: row.processing_status,
      reviewState: row.review_state,
      pageCount: row.page_count,
      thumbPageId: row.thumb_page_id,
      snippet: row.snippet,
      matchPage: row.match_page,
      rank: Number(row.rank),
    })),
    total: rows.length > 0 ? Number(rows[0]!.total) : 0,
    page,
    pageSize,
    identifierMatch: looksLikeIdentifier,
  };
}

/**
 * Jahre, in denen Dokumente liegen - fuer den Jahresfilter.
 *
 * Aus den Daten statt aus einer festen Liste: Eine Auswahl mit Jahren, in
 * denen nichts liegt, waere irrefuehrend.
 */
export async function availableYears(actor: SessionUser): Promise<number[]> {
  const rows = await db.$queryRaw<Array<{ year: number }>>`
    SELECT DISTINCT EXTRACT(YEAR FROM COALESCE("document_date", "created_at"))::int AS year
    FROM "documents"
    WHERE "user_id" = ${actor.id} AND "deleted_at" IS NULL
    ORDER BY year DESC
  `;

  return rows.map((row) => row.year);
}
