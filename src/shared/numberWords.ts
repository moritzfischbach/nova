/**
 * Converts spoken German number words into digits so that dictated text like
 * "fünfzehn Euro Essen" or "zwölf Komma fünf Euro Tanken" can be parsed.
 * Reusable for any module that receives speech transcripts.
 */

const UNITS: Record<string, number> = {
  null: 0, eins: 1, ein: 1, eine: 1, einen: 1, zwei: 2, zwo: 2, drei: 3, vier: 4,
  fünf: 5, sechs: 6, sieben: 7, acht: 8, neun: 9,
};

const BELOW_20: Record<string, number> = {
  ...UNITS,
  zehn: 10, elf: 11, zwölf: 12, dreizehn: 13, vierzehn: 14, fünfzehn: 15,
  sechzehn: 16, siebzehn: 17, achtzehn: 18, neunzehn: 19,
};

const TENS: Record<string, number> = {
  zwanzig: 20, dreißig: 30, vierzig: 40, fünfzig: 50, sechzig: 60,
  siebzig: 70, achtzig: 80, neunzig: 90,
};

/** Words that are only numbers when they sit next to a currency/number context. */
const AMBIGUOUS = new Set(['ein', 'eine', 'einen', 'acht', 'null']);

const CURRENCY_WORDS = new Set(['euro', '€', 'eur', 'cent', 'komma', 'hundert', 'tausend']);

function canonical(word: string): string {
  return word
    .toLowerCase()
    .replace(/ae/g, 'ä')
    .replace(/oe/g, 'ö')
    .replace(/ue/g, 'ü')
    .replace(/ss/g, 'ß');
}

function below100(word: string): number | null {
  if (word === '') return 0;
  if (word in BELOW_20) return BELOW_20[word];
  if (word in TENS) return TENS[word];
  const und = word.indexOf('und');
  if (und > 0) {
    const unitWord = word.slice(0, und);
    const tensWord = word.slice(und + 3);
    const unit = unitWord === 'ein' ? 1 : UNITS[unitWord];
    const tens = TENS[tensWord];
    if (unit !== undefined && unit > 0 && unit < 10 && tens !== undefined) return tens + unit;
  }
  return null;
}

function below1000(word: string): number | null {
  const idx = word.indexOf('hundert');
  if (idx === -1) return below100(word);
  const prefix = word.slice(0, idx);
  const rest = word.slice(idx + 'hundert'.length);
  const mult = prefix === '' ? 1 : prefix === 'ein' ? 1 : UNITS[prefix];
  if (mult === undefined || mult === 0) return null;
  const tail = below100(rest);
  if (tail === null) return null;
  return mult * 100 + tail;
}

/** Parses a single (possibly compound) German number word, e.g. "dreiundzwanzig", "zweitausendfünfhundert". */
export function parseGermanNumberWord(input: string): number | null {
  const word = canonical(input.trim());
  if (!word) return null;
  const idx = word.indexOf('tausend');
  if (idx === -1) return below1000(word);
  const prefix = word.slice(0, idx);
  const rest = word.slice(idx + 'tausend'.length);
  const mult = prefix === '' ? 1 : below1000(prefix);
  if (mult === null || mult === 0) return null;
  const tail = below1000(rest);
  if (tail === null) return null;
  return mult * 1000 + tail;
}

interface Token {
  text: string;
  value: number | null;
}

function strip(word: string): string {
  return word.replace(/^[^\p{L}\p{N}€+-]+|[^\p{L}\p{N}€]+$/gu, '');
}

function formatNumber(n: number): string {
  return String(n);
}

/**
 * Replaces German number words with digits.
 * "fünfzehn Euro Essen"         → "15 Euro Essen"
 * "zwölf Komma fünf Euro Tanken" → "12,5 Euro Tanken"
 * "zwölf Euro fünfzig Tanken"   → "12,50 Euro Tanken"
 * "fünfzig Cent Kaugummi"       → "0,50 Euro Kaugummi"
 * "plus zweitausend Euro Gehalt" → "+2000 Euro Gehalt"
 */
export function normalizeSpokenNumbers(input: string): string {
  const words = input.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return input.trim();

  const tokens: Token[] = words.map((text) => {
    const bare = strip(text);
    const lower = canonical(bare);
    let value: number | null = null;
    if (/^\d+$/.test(bare)) value = Number(bare);
    else if (lower === 'hundert') value = 100;
    else if (lower === 'tausend') value = 1000;
    else value = parseGermanNumberWord(bare);
    return { text, value };
  });

  const isContext = (i: number) => {
    const t = tokens[i];
    if (!t) return false;
    const lower = canonical(strip(t.text));
    return CURRENCY_WORDS.has(lower) || (t.value !== null && !AMBIGUOUS.has(lower));
  };

  // Drop ambiguous words ("eine Pizza") unless next to a number/currency context.
  tokens.forEach((t, i) => {
    const lower = canonical(strip(t.text));
    if (t.value !== null && AMBIGUOUS.has(lower) && !isContext(i + 1) && !isContext(i - 1)) {
      t.value = null;
    }
  });

  const out: string[] = [];
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];
    const lower = canonical(strip(t.text));

    if (i === 0 && (lower === 'plus' || lower === 'minus') && tokens[1]?.value != null) {
      out.push(lower === 'plus' ? '+' : '-');
      i += 1;
      continue;
    }

    if (t.value === null) {
      out.push(t.text);
      i += 1;
      continue;
    }

    // Combine sequences like "zwei hundert fünfzig" / "drei tausend".
    let value = t.value;
    let j = i + 1;
    while (j < tokens.length && tokens[j].value !== null) {
      const nextLower = canonical(strip(tokens[j].text));
      const next = tokens[j].value as number;
      if (nextLower === 'hundert' && value < 10) value *= 100;
      else if (nextLower === 'tausend' && value < 1000) value *= 1000;
      else if (next < 100 && value >= 100 && value % 100 === 0) value += next;
      else break;
      j += 1;
    }

    let numberText = formatNumber(value);

    // Decimal: "<n> Komma <digits...>"
    if (canonical(strip(tokens[j]?.text ?? '')) === 'komma' && tokens[j + 1]?.value != null) {
      const decimals: number[] = [];
      let k = j + 1;
      while (k < tokens.length && tokens[k].value !== null) {
        decimals.push(tokens[k].value as number);
        k += 1;
        if (decimals[decimals.length - 1] >= 10) break;
      }
      const decimalText = decimals.every((d) => d < 10) ? decimals.join('') : String(decimals[0]);
      numberText = `${numberText},${decimalText}`;
      j = k;
    }

    const after = canonical(strip(tokens[j]?.text ?? ''));

    // "<n> Cent" → "0,nn Euro"
    if (after === 'cent' && !numberText.includes(',') && value < 100) {
      out.push(`0,${String(value).padStart(2, '0')}`, 'Euro');
      i = j + 1;
      continue;
    }

    // "<n> Euro <cents>" → "<n>,<cents> Euro"
    if ((after === 'euro' || after === '€' || after === 'eur') && !numberText.includes(',')) {
      const centTok = tokens[j + 1];
      if (centTok && centTok.value !== null && centTok.value < 100) {
        const afterCents = canonical(strip(tokens[j + 2]?.text ?? ''));
        if (afterCents !== 'euro' && afterCents !== 'komma') {
          out.push(`${numberText},${String(centTok.value).padStart(2, '0')}`, tokens[j].text);
          i = j + 2;
          continue;
        }
      }
    }

    out.push(numberText);
    i = j;
  }

  return out.join(' ').replace(/\s+/g, ' ').trim();
}
