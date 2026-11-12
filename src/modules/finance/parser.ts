import { parseGermanNumber } from '../../shared/money';
import { escapeRegExp } from '../../shared/escape';
import { normalizeSpokenNumbers } from '../../shared/numberWords';
import type { Category, CategoryType } from '../../types';

export interface ParseSuccess {
  ok: true;
  amount: number;
  type: CategoryType | 'auto';
  text: string;
  raw: string;
}

export interface ParseFailure {
  ok: false;
  error: string;
  raw: string;
}

export type ParseResult = ParseSuccess | ParseFailure;

const NUMBER =
  '[+-]?(?:\\d{1,3}(?:\\.\\d{3})+,\\d{1,2}|\\d{1,3}(?:\\.\\d{3})+|\\d+,\\d{1,2}|\\d+\\.\\d{1,2}|\\d+)';
const CURRENCY = '(?:€|Euro|euro|EUR)';

const PATTERNS: RegExp[] = [
  new RegExp(`(${CURRENCY})\\s*(${NUMBER})`, 'i'),
  new RegExp(`(${NUMBER})\\s*(${CURRENCY})`, 'i'),
  new RegExp(`(${NUMBER})`),
];

export function parseExpenseInput(input: string): ParseResult {
  const raw = normalizeSpokenNumbers(input.trim());
  if (!raw) {
    return { ok: false, error: 'Bitte etwas eingeben, zum Beispiel „15 Euro Essen“.', raw: input };
  }

  let match: RegExpMatchArray | null = null;
  for (const pattern of PATTERNS) {
    match = raw.match(pattern);
    if (match) break;
  }

  if (!match) {
    return { ok: false, error: 'Ich habe keinen Betrag erkannt. Versuch es mit „15 Euro Essen“.', raw };
  }

  const token = match.find((part, index) => index > 0 && part && new RegExp(`^${NUMBER}$`).test(part)) ?? '';
  const amountSigned = parseGermanNumber(token);
  if (!Number.isFinite(amountSigned) || amountSigned === 0) {
    return { ok: false, error: 'Der Betrag konnte nicht gelesen werden.', raw };
  }

  let type: CategoryType | 'auto' = 'auto';
  if (token.startsWith('+') || /^\s*\+/.test(raw)) type = 'income';
  if (token.startsWith('-') || /^\s*-/.test(raw)) type = 'expense';

  const text = raw
    .replace(match[0], ' ')
    .replace(/^[+\-]\s*/, '')
    .replace(/\s+/g, ' ')
    .trim();

  return {
    ok: true,
    amount: Math.abs(amountSigned),
    type,
    text,
    raw,
  };
}

export function normalizeText(value: string): string {
  return value.toLowerCase().normalize('NFC').replace(/\s+/g, ' ').trim();
}

export function matchCategory(
  text: string,
  categories: Category[],
): { category: Category; note: string } {
  const raw = text.trim();
  const lower = normalizeText(raw);
  const fallback =
    categories.find((category) => category.id === 'cat-sonstiges') ??
    categories.find((category) => normalizeText(category.name) === 'sonstiges');

  if (!fallback) {
    throw new Error('Kategorie „Sonstiges“ fehlt.');
  }

  if (!lower) {
    return { category: fallback, note: '' };
  }

  const exact = categories.find((category) => normalizeText(category.name) === lower);
  if (exact) return { category: exact, note: '' };

  let best: { category: Category; keyword: string } | null = null;
  for (const category of categories) {
    const candidates = [category.name, ...category.keywords];
    for (const keyword of candidates) {
      const normalized = normalizeText(keyword);
      if (!normalized) continue;
      if (containsPhrase(lower, normalized)) {
        if (!best || normalized.length > best.keyword.length) {
          best = { category, keyword: normalized };
        }
      }
    }
  }

  if (best) {
    const note = normalizeText(raw) === best.keyword || normalizeText(raw) === normalizeText(best.category.name) ? '' : raw;
    return { category: best.category, note };
  }

  return { category: fallback, note: raw };
}

function containsPhrase(haystack: string, needle: string): boolean {
  if (haystack === needle) return true;
  const pattern = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(needle)}($|[^\\p{L}\\p{N}])`, 'iu');
  return pattern.test(haystack);
}

export function resolveType(parsed: ParseSuccess, category: Category): CategoryType {
  if (parsed.type !== 'auto') return parsed.type;
  return category.type;
}
