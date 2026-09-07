import { describe, expect, it } from 'vitest';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { analysisSchema, normalizeAnalysis, type AnalysisWire } from './analysis-schema';

/**
 * Die Anthropic-API nimmt hoechstens 16 Felder mit Vereinigungstyp an
 * (`nullable` oder `anyOf`); darueber lehnt sie die Anfrage mit 400 ab.
 *
 * Beim ersten echten Lauf gegen die API waren es 20, und jede Analyse
 * scheiterte. Aufgefallen ist es erst in Produktion, weil der Testanbieter
 * das Schema gar nicht erst an die API reicht - deshalb dieser Test.
 */
const GRENZE = 16;

function zaehleUnions(node: unknown): number {
  if (!node || typeof node !== 'object') return 0;
  if (Array.isArray(node)) return node.reduce<number>((summe, eintrag) => summe + zaehleUnions(eintrag), 0);

  const objekt = node as Record<string, unknown>;
  const istUnion =
    Array.isArray(objekt.type) || Array.isArray(objekt.anyOf) || Array.isArray(objekt.oneOf);

  return Object.values(objekt).reduce<number>(
    (summe, wert) => summe + zaehleUnions(wert),
    istUnion ? 1 : 0,
  );
}

describe('analysisSchema', () => {
  it('bleibt unter der Union-Grenze der Anthropic-API', () => {
    expect(zaehleUnions(zodOutputFormat(analysisSchema))).toBeLessThanOrEqual(GRENZE);
  });

  it('nimmt ein Feld nur mit Wert und Beleg an', () => {
    const mitBeleg = analysisSchema.shape.sender.safeParse({
      value: 'AOK Bayern',
      confidence: 90,
      evidence: { page: 1, quote: 'AOK Bayern, Kundenservice' },
    });
    expect(mitBeleg.success).toBe(true);

    // Eine Behauptung ohne Zitat darf es nicht mehr geben.
    const ohneBeleg = analysisSchema.shape.sender.safeParse({
      value: 'AOK Bayern',
      confidence: 90,
      evidence: null,
    });
    expect(ohneBeleg.success).toBe(false);

    // Gar nichts gefunden zu haben ist dagegen eine gueltige Antwort.
    expect(analysisSchema.shape.sender.safeParse(null).success).toBe(true);
  });
});

describe('normalizeAnalysis', () => {
  it('macht aus einem fehlenden Feld ein leeres', () => {
    const wire = {
      sender: null,
      title: { value: 'Bescheid', confidence: 80, evidence: { page: 1, quote: 'Bescheid ueber' } },
    } as unknown as AnalysisWire;

    const output = normalizeAnalysis(wire);

    expect(output.sender).toEqual({ value: null, confidence: 0, evidence: null });
    expect(output.title.value).toBe('Bescheid');
    expect(output.title.evidence?.page).toBe(1);
  });
});
