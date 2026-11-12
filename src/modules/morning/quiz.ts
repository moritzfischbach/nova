/** Wach-Quiz: locally generated brain-wake tasks + reflection questions (pure, seedable). */

export type Rng = () => number;

/** mulberry32 */
export function rng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const int = (r: Rng, min: number, max: number) => min + Math.floor(r() * (max - min + 1));
const pick = <T,>(r: Rng, list: readonly T[]): T => list[Math.floor(r() * list.length)];
function shuffle<T>(r: Rng, list: T[]): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export type BrainKind = 'rechnen' | 'reihe' | 'wort' | 'gegenteil' | 'merken' | 'uhrzeit';

export interface ChoiceQuestion {
  type: 'choice';
  id: string;
  kind: BrainKind;
  label: string;
  prompt: string;
  options: string[];
  answer: number;
  /** memory task: words shown first */
  memorize?: string[];
}
export interface TimeQuestion {
  type: 'time';
  id: 'woke' | 'leave';
  label: string;
  prompt: string;
  hint?: string;
  value: string;
  /** leave question: what the plan says */
  expected?: string;
}
export interface TextQuestion {
  type: 'text';
  id: 'focus';
  label: string;
  prompt: string;
  placeholder: string;
}
export type QuizQuestion = ChoiceQuestion | TimeQuestion | TextQuestion;

/** Builds 4 unique options around the right answer, returns options + index. */
function numberOptions(r: Rng, right: number, spread: number[]): { options: string[]; answer: number } {
  const set = new Set<number>([right]);
  const candidates = shuffle(r, spread.map((d) => right + d).filter((n) => n !== right && n >= 0));
  for (const c of candidates) {
    if (set.size >= 4) break;
    set.add(c);
  }
  let k = 1;
  while (set.size < 4) set.add(right + 10 * k++);
  const options = shuffle(r, [...set]);
  return { options: options.map((n) => String(n).replace('.', ',')), answer: options.indexOf(right) };
}

function textOptions(r: Rng, right: string, wrong: string[]): { options: string[]; answer: number } {
  const options = shuffle(r, [right, ...shuffle(r, wrong.filter((w) => w !== right)).slice(0, 3)]);
  return { options, answer: options.indexOf(right) };
}

const WORDS = ['BROT', 'KAFFEE', 'SONNE', 'WECKER', 'GARTEN', 'FENSTER', 'APFEL', 'MORGEN', 'TASCHE', 'BLUME', 'WOLKE', 'KERZE', 'LAMPE', 'SPIEGEL', 'ZUCKER', 'REGEN', 'BRÜCKE', 'INSEL', 'KATZE', 'TISCH'];
const MEMO = ['Zitrone', 'Fahrrad', 'Anker', 'Wolke', 'Gitarre', 'Leuchtturm', 'Kaktus', 'Schlüssel', 'Pinguin', 'Kompass', 'Laterne', 'Muschel', 'Rakete', 'Teekanne', 'Feder', 'Brille', 'Trommel', 'Ballon'];
const OPPOSITES: [string, string][] = [
  ['früh', 'spät'], ['wach', 'müde'], ['schnell', 'langsam'], ['hell', 'dunkel'], ['laut', 'leise'], ['warm', 'kalt'],
  ['voll', 'leer'], ['oben', 'unten'], ['Anfang', 'Ende'], ['pünktlich', 'verspätet'], ['mutig', 'ängstlich'], ['stark', 'schwach'],
];

function scramble(r: Rng, word: string): string {
  let s = word;
  for (let i = 0; i < 6 && s === word; i += 1) s = shuffle(r, word.split('')).join('');
  return s;
}

export function brainQuestion(r: Rng, kind: BrainKind, id: string): ChoiceQuestion {
  switch (kind) {
    case 'rechnen': {
      const op = pick(r, ['+', '−', '×'] as const);
      let a: number, b: number, right: number;
      if (op === '×') {
        a = int(r, 3, 12);
        b = int(r, 3, 9);
        right = a * b;
      } else if (op === '+') {
        a = int(r, 17, 68);
        b = int(r, 12, 49);
        right = a + b;
      } else {
        a = int(r, 40, 99);
        b = int(r, 11, a - 10);
        right = a - b;
      }
      const o = numberOptions(r, right, op === '×' ? [-b, b, -a, a, 1, -1, 10] : [-10, 10, -1, 1, 2, -2, 9, -9]);
      return { type: 'choice', id, kind, label: 'Kopfrechnen', prompt: `${a} ${op} ${b} = ?`, ...o };
    }
    case 'reihe': {
      const style = int(r, 0, 2);
      const start = int(r, 2, 9);
      let seq: number[];
      if (style === 0) {
        const step = int(r, 3, 9);
        seq = Array.from({ length: 5 }, (_, i) => start + i * step);
      } else if (style === 1) {
        const f = int(r, 2, 3);
        seq = Array.from({ length: 5 }, (_, i) => start * f ** i);
      } else {
        // growing gaps: +1, +2, +3 …
        seq = [start];
        for (let i = 1; i < 5; i += 1) seq.push(seq[i - 1] + i);
      }
      const right = seq.pop()!;
      const o = numberOptions(r, right, [-2, 2, -1, 1, 3, -3, seq[seq.length - 1] - seq[seq.length - 2]]);
      return { type: 'choice', id, kind, label: 'Zahlenreihe', prompt: `Wie geht es weiter? ${seq.join(', ')}, …`, ...o };
    }
    case 'wort': {
      const word = pick(r, WORDS);
      const o = textOptions(r, word, shuffle(r, WORDS.filter((w) => w.length === word.length || Math.abs(w.length - word.length) <= 1)));
      return { type: 'choice', id, kind, label: 'Buchstabensalat', prompt: `Welches Wort steckt in „${scramble(r, word)}“?`, ...o };
    }
    case 'gegenteil': {
      const [w, right] = pick(r, OPPOSITES);
      const o = textOptions(r, right, OPPOSITES.flat().filter((x) => x !== w && x !== right));
      return { type: 'choice', id, kind, label: 'Wortschatz', prompt: `Was ist das Gegenteil von „${w}“?`, ...o };
    }
    case 'merken': {
      const pool = shuffle(r, MEMO);
      const shown = pool.slice(0, 4);
      const missing = pool[4];
      const options = shuffle(r, [missing, ...shuffle(r, shown).slice(0, 3)]);
      return { type: 'choice', id, kind, label: 'Merken', prompt: 'Welches Wort war NICHT dabei?', options, answer: options.indexOf(missing), memorize: shown };
    }
    case 'uhrzeit': {
      const h = int(r, 6, 8);
      const m = pick(r, [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50]);
      const add = pick(r, [25, 35, 40, 45, 50, 55, 65, 75]);
      const startMin = h * 60 + m;
      const fmt = (n: number) => `${String(Math.floor(n / 60) % 24).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
      const right = fmt(startMin + add);
      const wrong = [fmt(startMin + add + 10), fmt(startMin + add - 10), fmt(startMin + add + 60), fmt(startMin + add - 5), fmt(startMin + add + 15)];
      const o = textOptions(r, right, wrong);
      return { type: 'choice', id, kind, label: 'Zeit im Kopf', prompt: `Du startest um ${fmt(startMin)} Uhr und brauchst ${add} Minuten. Wann bist du fertig?`, ...o };
    }
  }
}

export const BRAIN_KINDS: BrainKind[] = ['rechnen', 'reihe', 'wort', 'gegenteil', 'merken', 'uhrzeit'];

/**
 * 3 questions: „Wann bist du aufgestanden?“, one brain task, then a second brain task or a reflection
 * (leave time on work days, otherwise the most important goal). Kinds used yesterday are avoided.
 */
export function buildQuiz(opts: { seed: number; now: string; leaveAt?: string; avoid?: BrainKind[] }): QuizQuestion[] {
  const r = rng(opts.seed);
  const fresh = BRAIN_KINDS.filter((k) => !(opts.avoid ?? []).includes(k));
  const kinds = shuffle(r, fresh.length >= 2 ? fresh : BRAIN_KINDS);
  const out: QuizQuestion[] = [
    { type: 'time', id: 'woke', label: 'Ehrlich sein', prompt: 'Wann bist du heute aufgestanden?', hint: 'Zählt für dein Ziel „Früher aufstehen“.', value: opts.now },
    brainQuestion(r, kinds[0], 'b1'),
  ];
  const reflect = r() < 0.6;
  if (!reflect) out.push(brainQuestion(r, kinds[1], 'b2'));
  else if (opts.leaveAt && r() < 0.6)
    out.push({ type: 'time', id: 'leave', label: 'Pünktlich sein', prompt: 'Wann musst du heute los, um pünktlich zu sein?', value: '', expected: opts.leaveAt });
  else out.push({ type: 'text', id: 'focus', label: 'Fokus', prompt: 'Was ist dein wichtigstes Ziel heute?', placeholder: 'z. B. Angebot fertig schreiben' });
  return out;
}
