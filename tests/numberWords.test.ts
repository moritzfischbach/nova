import { describe, expect, it } from 'vitest';
import { normalizeSpokenNumbers, parseGermanNumberWord } from '../src/shared/numberWords';
import { parseExpenseInput, matchCategory } from '../src/modules/finance/parser';
import { DEFAULT_CATEGORIES } from '../src/data/seed';

describe('parseGermanNumberWord', () => {
  it.each([
    ['eins', 1], ['zwölf', 12], ['zwoelf', 12], ['fünfzehn', 15], ['fuenfzehn', 15],
    ['zwanzig', 20], ['dreißig', 30], ['dreissig', 30], ['dreiundzwanzig', 23],
    ['einundvierzig', 41], ['neunundneunzig', 99], ['hundert', 100], ['einhundert', 100],
    ['hundertfünfzig', 150], ['zweihundertdreiundvierzig', 243], ['tausend', 1000],
    ['zweitausend', 2000], ['zweitausendfünfhundert', 2500], ['Sechzehn', 16],
  ])('%s → %d', (word, value) => {
    expect(parseGermanNumberWord(word)).toBe(value);
  });

  it('rejects non-numbers', () => {
    expect(parseGermanNumberWord('Essen')).toBeNull();
    expect(parseGermanNumberWord('Tanken')).toBeNull();
    expect(parseGermanNumberWord('undzwanzig')).toBeNull();
  });
});

describe('normalizeSpokenNumbers', () => {
  it.each([
    ['fünfzehn Euro Essen', '15 Euro Essen'],
    ['zwölf Komma fünf Euro Tanken', '12,5 Euro Tanken'],
    ['zwölf Komma fünfzig Euro Tanken', '12,50 Euro Tanken'],
    ['drei Komma null fünf Euro Kaffee', '3,05 Euro Kaffee'],
    ['zwölf Euro fünfzig Tanken', '12,50 Euro Tanken'],
    ['fünfzig Cent Kaugummi', '0,50 Euro Kaugummi'],
    ['zwei hundert Euro Miete', '200 Euro Miete'],
    ['plus zweitausend Euro Gehalt', '+ 2000 Euro Gehalt'],
    ['ein Euro Brötchen', '1 Euro Brötchen'],
    ['15 Euro 50 Essen', '15,50 Euro Essen'],
  ])('%s → %s', (input, expected) => {
    expect(normalizeSpokenNumbers(input)).toBe(expected);
  });

  it('leaves ordinary sentences and ambiguous words alone', () => {
    expect(normalizeSpokenNumbers('Eine Pizza bestellen')).toBe('Eine Pizza bestellen');
    expect(normalizeSpokenNumbers('Gute Nacht sagen')).toBe('Gute Nacht sagen');
    expect(normalizeSpokenNumbers('12,50 € Tanken')).toBe('12,50 € Tanken');
    expect(normalizeSpokenNumbers('1.250,00 € Miete')).toBe('1.250,00 € Miete');
  });
});

describe('finance parser with spoken input', () => {
  it('parses "fünfzehn Euro Essen"', () => {
    const r = parseExpenseInput('fünfzehn Euro Essen');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.amount).toBe(15);
      expect(matchCategory(r.text, DEFAULT_CATEGORIES).category.name).toBe('Essen');
    }
  });

  it('parses "zwölf Komma fünf Euro Tanken"', () => {
    const r = parseExpenseInput('zwölf Komma fünf Euro Tanken');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.amount).toBe(12.5);
      expect(matchCategory(r.text, DEFAULT_CATEGORIES).category.name).toBe('Tanken');
    }
  });

  it('parses typical recognizer output "15 € Essen"', () => {
    const r = parseExpenseInput('15 € Essen');
    expect(r.ok && r.amount).toBe(15);
  });

  it('parses "zwölf Euro fünfzig Tanken" as 12,50', () => {
    const r = parseExpenseInput('zwölf Euro fünfzig Tanken');
    expect(r.ok && r.amount).toBe(12.5);
  });

  it('parses spoken income', () => {
    const r = parseExpenseInput('plus zweitausend Euro Gehalt');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.amount).toBe(2000);
      expect(r.type).toBe('income');
      expect(r.text).toBe('Gehalt');
    }
  });

  it('parses "dreiundzwanzig Euro Einkauf"', () => {
    const r = parseExpenseInput('dreiundzwanzig Euro Einkauf bei Rewe');
    expect(r.ok && r.amount).toBe(23);
  });
});
