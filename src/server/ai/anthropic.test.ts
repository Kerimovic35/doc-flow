import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { parseAnswer } from './anthropic';
import { AiSchemaError } from './provider';

/**
 * Ohne erzwungene Dekodierung ist das Auslesen der Antwort unsere Aufgabe.
 *
 * Die API prueft das Schema nicht mehr fuer uns - sie kann es nicht, die
 * daraus uebersetzte Grammatik waere zu gross. Also muss diese Stelle
 * halten: Was nicht zum Schema passt, ist ein Fehler und wird nicht als
 * halbe Analyse durchgereicht.
 */
const schema = z.object({
  sender: z.string().nullable(),
  betrag: z.number(),
});

describe('Antwort der KI auslesen', () => {
  it('nimmt blankes JSON an', () => {
    expect(parseAnswer(schema, '{"sender":"AOK Bayern","betrag":127.5}')).toEqual({
      sender: 'AOK Bayern',
      betrag: 127.5,
    });
  });

  it('nimmt JSON in Code-Zaeunen an', () => {
    const text = '```json\n{"sender":null,"betrag":0}\n```';
    expect(parseAnswer(schema, text)).toEqual({ sender: null, betrag: 0 });
  });

  it('nimmt JSON mit vorangestelltem Satz an', () => {
    const text = 'Hier ist das Ergebnis:\n{"sender":"Finanzamt","betrag":42}';
    expect(parseAnswer(schema, text)).toEqual({ sender: 'Finanzamt', betrag: 42 });
  });

  it('meldet freien Text als Formfehler', () => {
    expect(() => parseAnswer(schema, 'Dazu kann ich nichts sagen.')).toThrow(AiSchemaError);
  });

  it('meldet kaputtes JSON als Formfehler', () => {
    expect(() => parseAnswer(schema, '{"sender":"AOK",')).toThrow(AiSchemaError);
  });

  it('laesst eine Antwort mit falschem Aufbau nicht durch', () => {
    // betrag fehlt - das darf keine halbe Analyse werden.
    expect(() => parseAnswer(schema, '{"sender":"AOK"}')).toThrow(AiSchemaError);
  });
});
