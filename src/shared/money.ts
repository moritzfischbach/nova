export function formatEUR(amount: number): string {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(amount);
}

/**
 * Parses German and common international number formats.
 * 12,50 → 12.5 | 1.250,50 → 1250.5 | 12.50 → 12.5 | 1.250 → 1250
 */
export function parseGermanNumber(token: string): number {
  const trimmed = token.trim();
  const sign = trimmed.startsWith('-') ? -1 : 1;
  const raw = trimmed.replace(/^[+-]/, '');
  if (!raw) return Number.NaN;

  if (raw.includes(',') && raw.includes('.')) {
    if (raw.lastIndexOf(',') > raw.lastIndexOf('.')) {
      return sign * Number.parseFloat(raw.replace(/\./g, '').replace(',', '.'));
    }
    return sign * Number.parseFloat(raw.replace(/,/g, ''));
  }

  if (raw.includes(',')) {
    return sign * Number.parseFloat(raw.replace(',', '.'));
  }

  if (raw.includes('.')) {
    const parts = raw.split('.');
    if (parts.length === 2 && parts[1].length === 3 && /^\d+$/.test(parts[1])) {
      return sign * Number.parseFloat(parts[0] + parts[1]);
    }
    return sign * Number.parseFloat(raw);
  }

  return sign * Number.parseFloat(raw);
}
