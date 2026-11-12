import { getAll, getById, putRecord, removeRecord, STORES } from '../../data/db';
import { createId } from '../../shared/id';
import type { Category, Transaction } from '../../types';
import { matchCategory, parseExpenseInput, resolveType } from './parser';
import { isSavingsText, matchSavingsGoal } from '../goals/match';
import { addDeposit, listGoals, removeDepositByTransaction } from '../goals/repo';
import type { Goal } from '../../types';

export async function listCategories(): Promise<Category[]> {
  const categories = await getAll<Category>(STORES.categories);
  return categories.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'de'));
}

export async function saveCategory(category: Category): Promise<Category> {
  return putRecord(STORES.categories, {
    ...category,
    name: category.name.trim(),
    keywords: category.keywords.map((keyword) => keyword.trim()).filter(Boolean),
  });
}

export async function createCategory(input: Omit<Category, 'id' | 'builtin' | 'sortOrder'>): Promise<Category> {
  const categories = await listCategories();
  const max = Math.max(0, ...categories.filter((c) => c.id !== 'cat-sonstiges').map((c) => c.sortOrder));
  return saveCategory({
    id: createId(),
    ...input,
    sortOrder: max + 1,
    builtin: false,
  });
}

export async function deleteCategory(id: string): Promise<void> {
  if (id === 'cat-sonstiges') {
    throw new Error('Die Kategorie „Sonstiges“ kann nicht gelöscht werden.');
  }
  const transactions = await listTransactions();
  const fallback = await getById<Category>(STORES.categories, 'cat-sonstiges');
  if (!fallback) throw new Error('Kategorie „Sonstiges“ fehlt.');
  for (const tx of transactions.filter((item) => item.categoryId === id)) {
    await putRecord(STORES.transactions, { ...tx, categoryId: fallback.id });
  }
  await removeRecord(STORES.categories, id);
}

export async function listTransactions(): Promise<Transaction[]> {
  const items = await getAll<Transaction>(STORES.transactions);
  return items.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
}

export async function createTransactionFromInput(
  rawInput: string,
  date: string,
): Promise<{ tx: Transaction; goal?: Goal }> {
  const parsed = parseExpenseInput(rawInput);
  if (!parsed.ok) {
    throw new Error(parsed.error);
  }
  const categories = await listCategories();
  let { category, note } = matchCategory(parsed.text, categories);
  const savings = isSavingsText(parsed.text);
  if (savings && category.id !== 'cat-sparen') {
    const sparen = categories.find((c) => c.id === 'cat-sparen');
    if (sparen) {
      category = sparen;
      note = parsed.text;
    }
  }
  const type = resolveType(parsed, category);
  const tx: Transaction = {
    id: createId(),
    amount: parsed.amount,
    currency: 'EUR',
    type,
    categoryId: category.id,
    note,
    date,
    rawInput,
    createdAt: new Date().toISOString(),
  };
  await putRecord(STORES.transactions, tx);

  let goal: Goal | undefined;
  if (category.id === 'cat-sparen') {
    const match = matchSavingsGoal(parsed.text, await listGoals());
    if (match) goal = await addDeposit(match.id, { amount: parsed.amount, date, note: rawInput, txId: tx.id });
  }
  return { tx, goal };
}

export async function deleteTransaction(id: string): Promise<void> {
  await removeRecord(STORES.transactions, id);
  await removeDepositByTransaction(id);
}

export function monthKey(isoDate: string): string {
  return isoDate.slice(0, 7);
}

export interface CategoryTotal {
  category: Category;
  amount: number;
}

export interface MonthSummary {
  month: string;
  expenses: number;
  income: number;
  byCategory: CategoryTotal[];
}

export async function summarizeMonth(month: string): Promise<MonthSummary> {
  const [transactions, categories] = await Promise.all([listTransactions(), listCategories()]);
  const catMap = new Map(categories.map((category) => [category.id, category]));
  const inMonth = transactions.filter((tx) => monthKey(tx.date) === month);
  const expenseMap = new Map<string, number>();
  let expenses = 0;
  let income = 0;

  for (const tx of inMonth) {
    if (tx.type === 'income') {
      income += tx.amount;
    } else {
      expenses += tx.amount;
      expenseMap.set(tx.categoryId, (expenseMap.get(tx.categoryId) ?? 0) + tx.amount);
    }
  }

  const byCategory = [...expenseMap.entries()]
    .map(([categoryId, amount]) => ({
      category: catMap.get(categoryId) ?? {
        id: categoryId,
        name: 'Unbekannt',
        keywords: [],
        color: '#A8A39B',
        type: 'expense' as const,
        sortOrder: 100,
      },
      amount,
    }))
    .sort((a, b) => b.amount - a.amount);

  return { month, expenses, income, byCategory };
}
