import type { Category, TodoList } from '../types';
import { getAll, getMeta, putRecord, setMeta, STORES } from './db';

export const DEFAULT_CATEGORIES: Category[] = [
  {
    id: 'cat-essen',
    name: 'Essen',
    keywords: [
      'essen', 'restaurant', 'pizza', 'döner', 'doner', 'burger', 'sushi', 'imbiss',
      'mittag', 'mittagessen', 'abendessen', 'frühstück', 'fruehstueck', 'café',
      'cafe', 'kaffee', 'lunch', 'dinner', 'mensa', 'lieferung', 'lieferando',
      'bäckerei', 'baeckerei',
    ],
    color: '#C45C5C',
    type: 'expense',
    sortOrder: 1,
    builtin: true,
  },
  {
    id: 'cat-tanken',
    name: 'Tanken',
    keywords: ['tanken', 'benzin', 'diesel', 'sprit', 'tankstelle'],
    color: '#D08A2A',
    type: 'expense',
    sortOrder: 2,
    builtin: true,
  },
  {
    id: 'cat-transport',
    name: 'Transport',
    keywords: [
      'uber', 'taxi', 'bus', 'bahn', 'ticket', 'öpnv', 'oepnv', 'parken',
      'parkplatz', 'auto', 'zug', 'strassenbahn', 'straßenbahn', 'tram',
      'u-bahn', 'sbahn', 's-bahn',
    ],
    color: '#3D7A9A',
    type: 'expense',
    sortOrder: 3,
    builtin: true,
  },
  {
    id: 'cat-einkauf',
    name: 'Einkauf',
    keywords: [
      'einkauf', 'einkaufen', 'supermarkt', 'rewe', 'aldi', 'lidl', 'edeka',
      'penny', 'kaufland', 'rossmann', 'dm', 'drogerie',
    ],
    color: '#5B8A4A',
    type: 'expense',
    sortOrder: 4,
    builtin: true,
  },
  {
    id: 'cat-wohnen',
    name: 'Wohnen',
    keywords: [
      'miete', 'strom', 'gas', 'wasser', 'internet', 'nebenkosten', 'wohnung',
      'versicherung', 'rundfunk',
    ],
    color: '#6B5B95',
    type: 'expense',
    sortOrder: 5,
    builtin: true,
  },
  {
    id: 'cat-gesundheit',
    name: 'Gesundheit',
    keywords: ['apotheke', 'arzt', 'ärztin', 'aerztin', 'medikament', 'fitness', 'yoga'],
    color: '#2E8B6A',
    type: 'expense',
    sortOrder: 6,
    builtin: true,
  },
  {
    id: 'cat-freizeit',
    name: 'Freizeit',
    keywords: ['kino', 'netflix', 'spotify', 'bar', 'club', 'konzert', 'urlaub', 'hobby', 'spiel', 'ausflug'],
    color: '#8B5E83',
    type: 'expense',
    sortOrder: 7,
    builtin: true,
  },
  {
    id: 'cat-shopping',
    name: 'Shopping',
    keywords: ['kleidung', 'amazon', 'zara', 'h&m', 'hm', 'schuhe', 'mode', 'ikea'],
    color: '#B85C8A',
    type: 'expense',
    sortOrder: 8,
    builtin: true,
  },
  {
    id: 'cat-geschenke',
    name: 'Geschenke',
    keywords: ['geschenk', 'geschenke', 'blumen', 'blume'],
    color: '#C96B8C',
    type: 'expense',
    sortOrder: 9,
    builtin: true,
  },
  {
    id: 'cat-sparen',
    name: 'Sparen',
    keywords: ['sparen', 'spare', 'gespart', 'sparziel', 'zurücklegen', 'zurückgelegt', 'rücklage', 'sparkonto'],
    color: '#C9A36A',
    type: 'expense',
    sortOrder: 9.5,
    builtin: true,
  },
  {
    id: 'cat-gehalt',
    name: 'Gehalt',
    keywords: ['gehalt', 'lohn', 'einkommen', 'bonus', 'erstattung', 'rückzahlung', 'rueckzahlung'],
    color: '#3D7A5A',
    type: 'income',
    sortOrder: 10,
    builtin: true,
  },
  {
    id: 'cat-sonstiges',
    name: 'Sonstiges',
    keywords: [],
    color: '#8A7E76',
    type: 'expense',
    sortOrder: 99,
    builtin: true,
  },
];

export const DEFAULT_LISTS: TodoList[] = [
  { id: 'list-persoenlich', name: 'Persönlich', createdAt: '2026-01-01T00:00:00.000Z', sortOrder: 1 },
  { id: 'list-arbeit', name: 'Arbeit', createdAt: '2026-01-01T00:00:00.000Z', sortOrder: 2 },
];

export async function ensureSeed(): Promise<void> {
  if (await getMeta<boolean>('seeded')) {
    // Nachträglich hinzugekommene Standardkategorien ergänzen (z. B. "Sparen")
    const existing = new Set((await getAll<Category>(STORES.categories)).map((c) => c.id));
    for (const category of DEFAULT_CATEGORIES) {
      if (!existing.has(category.id) && !(await getMeta<boolean>(`cat-added:${category.id}`))) {
        await putRecord(STORES.categories, category);
        await setMeta(`cat-added:${category.id}`, true);
      }
    }
    return;
  }

  const existingCategories = await getAll<Category>(STORES.categories);
  if (existingCategories.length === 0) {
    for (const category of DEFAULT_CATEGORIES) {
      await putRecord(STORES.categories, category);
    }
  }

  const existingLists = await getAll<TodoList>(STORES.todoLists);
  if (existingLists.length === 0) {
    for (const list of DEFAULT_LISTS) {
      await putRecord(STORES.todoLists, list);
    }
  }

  await setMeta('seeded', true);
}
