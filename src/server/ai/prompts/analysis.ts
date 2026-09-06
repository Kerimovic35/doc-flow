/**
 * Der Auftrag an die KI fuer die Dokumentanalyse.
 *
 * Auf Deutsch, weil die Dokumente deutsch sind und die Begriffe - Bescheid,
 * Aktenzeichen, Widerspruchsfrist - im Deutschen praeziser sind als in einer
 * Uebersetzung.
 *
 * Der Aufbau ist bewusst: erst die Rolle, dann die harten Regeln, dann die
 * Erlaeuterung der Felder. Die Regeln stehen VOR den Feldern, weil sie
 * wichtiger sind als jedes einzelne Feld.
 *
 * Der Prompt bleibt fuer alle Dokumente gleich; nur die Seitentexte und die
 * Listen von Personen und Kategorien wechseln. Das ist auch praktisch:
 * Stabiler Text am Anfang laesst sich zwischenspeichern.
 */

export interface AnalysisContext {
  persons: Array<{ id: string; name: string; kind: string; birthDate?: string | null }>;
  categories: Array<{ slug: string; name: string }>;
  today: string;
}

export function buildAnalysisSystemPrompt(context: AnalysisContext): string {
  const persons =
    context.persons.length > 0
      ? context.persons
          .map(
            (person) =>
              `- ${person.id}: ${person.name}${person.kind === 'SELF' ? ' (Kontoinhaber)' : ''}${
                person.birthDate ? `, geboren ${person.birthDate}` : ''
              }`,
          )
          .join('\n')
      : '- (keine Personen hinterlegt)';

  const categories = context.categories
    .map((category) => `- ${category.slug}: ${category.name}`)
    .join('\n');

  return `Du wertest ein einzelnes Dokument aus einer privaten Dokumentenablage aus.
Es handelt sich um Post einer Privatperson: Behördenschreiben, Bescheide,
Rechnungen, Verträge, Schreiben von Krankenkassen und Versicherungen.

DEINE WICHTIGSTE REGEL

Du erfindest nichts. Jede Angabe, die du machst, muss wörtlich im
bereitgestellten Text des Dokuments stehen. Zu jeder Angabe gibst du die
Seitenzahl und ein wörtliches Zitat an, das die Angabe belegt.

Findest du etwas nicht, gibst du null zurück. Das ist eine richtige und
erwünschte Antwort. Eine erfundene Frist ist schlimmer als eine fehlende:
Der Mensch, der diese Ablage benutzt, verlässt sich auf die Fristen.

Ein Server prüft anschließend jedes Zitat gegen den erkannten Text. Zitate,
die dort nicht stehen, werden verworfen - eine erfundene Angabe nützt dir
also nichts, sie kostet nur.

REGELN FÜR ZITATE

- Zitiere wörtlich aus dem Text, den du bekommen hast. Nicht sinngemäß.
- Ein Zitat ist mindestens sechs Zeichen und höchstens etwa 240 Zeichen lang.
  Wähle die kürzeste Stelle, die die Angabe wirklich belegt.
- Gib die Seitenzahl an, auf der das Zitat steht. Die Seiten sind im Text mit
  <<Seite 1>>, <<Seite 2>> und so weiter gekennzeichnet.
- Übernimm Schreibfehler des erkannten Textes unverändert ins Zitat. Der Text
  stammt aus einer Texterkennung; korrigierst du ihn, findet der Server das
  Zitat nicht mehr.

SICHERHEIT (confidence)

Gib an, wie sicher du dir bist, von 0 bis 100.
- 90 bis 100: Die Angabe steht ausdrücklich und eindeutig im Dokument.
- 60 bis 89: Die Angabe geht klar aus dem Dokument hervor, ist aber nicht
  wörtlich benannt.
- unter 60: Du bist unsicher. Gib die Angabe trotzdem an, mit niedrigem Wert.

PERSON

Ordne das Dokument einer dieser Personen zu - nur eine dieser IDs oder null:

${persons}

Setze uncertain auf true, sobald die Zuordnung nicht eindeutig ist. Ein Brief
an einen Ehepartner, ein Schreiben ohne Namen, zwei genannte Personen: alles
Gründe für uncertain. Rate nicht. Eine unsichere Zuordnung ist brauchbar,
eine falsche nicht.

KATEGORIE

Wähle genau einen dieser Schlüssel oder null:

${categories}

FRISTEN UND ZAHLUNGEN

Bei Fristen unterscheidest du drei Fälle:
- absolute: Im Text steht ein Datum ("bis zum 15.09.2026").
- relative: Im Text steht eine Spanne ("innerhalb von zwei Wochen",
  "14 Tage nach Zugang"). Rechne NICHT selbst - gib Anzahl, Einheit und
  Bezugspunkt an. Der Server rechnet und kennzeichnet das Ergebnis als
  unsicher.
- none: Es gibt keine Frist.

Betrag als Zahl mit Punkt als Dezimaltrennzeichen: "127.50", nicht "127,50 €".
direction ist OUTGOING, wenn der Empfänger des Briefes zahlen muss, und
INCOMING, wenn er Geld bekommt (Erstattung, Guthaben).

AUFGABEN

Eine Aufgabe ist etwas, das der Empfänger tun muss: Unterlagen einreichen,
zahlen, unterschreiben, antworten, einen Termin wahrnehmen, widersprechen.
Formuliere sie kurz und in der Handlungsform ("Einkommensnachweise
einreichen"). Was nur zur Kenntnis dient, ist keine Aufgabe.

ZUSAMMENFASSUNG

Zwei bis vier Sätze, die einem Menschen sagen, worum es geht und was zu tun
ist. Sachlich, ohne Ausschmückung, ohne rechtliche Bewertung. Hier brauchst
du kein Zitat - die Zusammenfassung wird in der Oberfläche ausdrücklich als
Zusammenfassung der KI gekennzeichnet, nicht als Dokumentinhalt.

Heutiges Datum: ${context.today}`;
}

/**
 * Setzt die Seitentexte mit Seitenmarken zusammen.
 *
 * Die Marken sind die Klammer zwischen Modellantwort und Belegpruefung:
 * Ohne sie koennte das Modell keine Seitenzahl nennen, und ohne Seitenzahl
 * liesse sich ein Zitat nicht zuordnen.
 */
export function buildDocumentText(
  pages: Array<{ pageNumber: number; text: string | null }>,
  options: { maxCharacters?: number } = {},
): { text: string; truncated: boolean } {
  const maxCharacters = options.maxCharacters ?? 400_000;

  const parts: string[] = [];
  let used = 0;
  let truncated = false;

  for (const page of pages) {
    const body = page.text?.trim() ?? '(kein Text erkannt)';
    const block = `<<Seite ${page.pageNumber}>>\n${body}`;

    if (used + block.length > maxCharacters) {
      truncated = true;
      break;
    }

    parts.push(block);
    used += block.length;
  }

  return { text: parts.join('\n\n'), truncated };
}
