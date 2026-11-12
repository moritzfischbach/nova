import { describe, expect, it } from 'vitest';
import { DEFAULT_CATEGORIES } from '../src/data/seed';
import { matchCategory, parseExpenseInput, resolveType } from '../src/modules/finance/parser';

describe('parseExpenseInput', () => {
  it('parses "15 Euro Essen"', () => {
    const result = parseExpenseInput('15 Euro Essen');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.amount).toBe(15);
      expect(result.text).toBe('Essen');
    }
  });

  it('parses German decimals with euro sign', () => {
    const result = parseExpenseInput('12,50 € Tanken');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.amount).toBe(12.5);
      expect(result.text).toBe('Tanken');
    }
  });

  it('parses currency before the amount', () => {
    const result = parseExpenseInput('€9,99 Kaffee');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.amount).toBe(9.99);
      expect(result.text).toBe('Kaffee');
    }
  });

  it('parses amount after the category', () => {
    const result = parseExpenseInput('Essen 15€');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.amount).toBe(15);
      expect(result.text).toBe('Essen');
    }
  });

  it('parses German thousands', () => {
    const result = parseExpenseInput('1.250,00 € Miete');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.amount).toBe(1250);
      expect(result.text).toBe('Miete');
    }
  });

  it('treats 1.250 without decimals as thousands', () => {
    const result = parseExpenseInput('1.250 Miete');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.amount).toBe(1250);
  });

  it('accepts international decimals', () => {
    const result = parseExpenseInput('12.50 Taxi');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.amount).toBe(12.5);
      expect(result.text).toBe('Taxi');
    }
  });

  it('detects income via plus prefix', () => {
    const result = parseExpenseInput('+1200 Gehalt');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.amount).toBe(1200);
      expect(result.type).toBe('income');
      expect(result.text).toBe('Gehalt');
    }
  });

  it('detects expense via minus prefix', () => {
    const result = parseExpenseInput('-20 Kino');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.amount).toBe(20);
      expect(result.type).toBe('expense');
    }
  });

  it('rejects empty input', () => {
    const result = parseExpenseInput('   ');
    expect(result.ok).toBe(false);
  });

  it('rejects text without an amount', () => {
    const result = parseExpenseInput('kein betrag');
    expect(result.ok).toBe(false);
  });
});

describe('matchCategory', () => {
  it('matches category names exactly', () => {
    const { category, note } = matchCategory('Essen', DEFAULT_CATEGORIES);
    expect(category.name).toBe('Essen');
    expect(note).toBe('');
  });

  it('maps keywords such as pizza and tanken', () => {
    expect(matchCategory('pizza bei luigi', DEFAULT_CATEGORIES).category.name).toBe('Essen');
    expect(matchCategory('Tanken', DEFAULT_CATEGORIES).category.name).toBe('Tanken');
    expect(matchCategory('uber', DEFAULT_CATEGORIES).category.name).toBe('Transport');
  });

  it('falls back to Sonstiges and keeps the note', () => {
    const { category, note } = matchCategory('irgendwas unbekanntes', DEFAULT_CATEGORIES);
    expect(category.name).toBe('Sonstiges');
    expect(note).toBe('irgendwas unbekanntes');
  });

  it('resolves income type from the Gehalt category', () => {
    const parsed = parseExpenseInput('2500 Gehalt');
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      const { category } = matchCategory(parsed.text, DEFAULT_CATEGORIES);
      expect(resolveType(parsed, category)).toBe('income');
    }
  });
});
