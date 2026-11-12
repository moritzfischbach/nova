import { displayColor, PALETTE } from '../../shared/palette';
import { monthLabel, parseLocalDate, todayISO } from '../../shared/dates';
import { escapeHtml } from '../../shared/escape';
import { icons } from '../../shared/icons';
import { formatEUR } from '../../shared/money';
import { confirmSheet, openSheet } from '../../shared/sheet';
import { toast } from '../../shared/toast';
import { attachMicButton, micButtonHtml } from '../../shared/voice';
import type { Category } from '../../types';
import { matchCategory, parseExpenseInput } from './parser';
import {
  createCategory,
  createTransactionFromInput,
  deleteCategory,
  deleteTransaction,
  listCategories,
  listTransactions,
  monthKey,
  saveCategory,
  summarizeMonth,
} from './repo';

export async function renderFinance(root: HTMLElement): Promise<() => void> {
  let month = monthKey(todayISO());

  async function refresh(): Promise<void> {
    const draft = (root.querySelector('[data-testid="finance-input"]') as HTMLInputElement | null)?.value ?? '';
    const preview = (root.querySelector('[data-testid="finance-preview"]') as HTMLElement | null)?.textContent ?? '';
    const [transactions, categories, summary] = await Promise.all([
      listTransactions(),
      listCategories(),
      summarizeMonth(month),
    ]);
    const monthTx = transactions.filter((tx) => monthKey(tx.date) === month);
    const catMap = new Map(categories.map((category) => [category.id, category]));
    const [yearStr, monthStr] = month.split('-');
    const year = Number(yearStr);
    const monthIndex = Number(monthStr) - 1;
    const max = summary.byCategory[0]?.amount ?? 0;

    root.innerHTML = `
      <section class="page">
        <header class="page-header">
          <div>
            <p class="eyebrow">Finanzen</p>
            <h1>Finanzplaner</h1>
            <p class="subtitle">Tippen oder sprechen: „15 Euro Essen“.</p>
          </div>
          <button type="button" class="icon-btn on-plum" data-action="categories" aria-label="Kategorien">${icons.check}</button>
        </header>

        <form class="composer finance-composer" data-testid="finance-form">
          <input type="text" name="entry" data-testid="finance-input" placeholder="z. B. 12,50 € Tanken" autocomplete="off" maxlength="160" />
          ${micButtonHtml('finance-mic')}
          <button type="submit" class="btn btn-primary" data-testid="finance-submit">Eintragen</button>
        </form>
        <p class="preview" data-testid="finance-preview"></p>

        <div class="month-nav">
          <button type="button" class="icon-btn" data-action="prev" aria-label="Voriger Monat">${icons.chevronLeft}</button>
          <strong>${escapeHtml(monthLabel(year, monthIndex))}</strong>
          <button type="button" class="icon-btn" data-action="next" aria-label="Nächster Monat">${icons.chevronRight}</button>
        </div>

        <div class="stat-grid">
          <article class="stat-card">
            <p>Ausgaben</p>
            <strong>${formatEUR(summary.expenses)}</strong>
          </article>
          <article class="stat-card income">
            <p>Einnahmen</p>
            <strong>${formatEUR(summary.income)}</strong>
          </article>
        </div>

        <section class="chart-card" data-testid="month-chart">
          <h2>Nach Kategorie</h2>
          ${
            summary.byCategory.length === 0
              ? `<p class="muted">Noch keine Ausgaben in diesem Monat.</p>`
              : summary.byCategory
                  .map((row) => {
                    const width = max > 0 ? Math.max(8, Math.round((row.amount / max) * 100)) : 0;
                    return `
                      <div class="bar-row">
                        <span class="bar-label">${escapeHtml(row.category.name)}</span>
                        <div class="bar-track">
                          <div class="bar-fill" style="width:${width}%; background:${displayColor(row.category.color)};color:${displayColor(row.category.color)}"></div>
                        </div>
                        <span class="bar-value">${formatEUR(row.amount)}</span>
                      </div>`;
                  })
                  .join('')
          }
        </section>

        <section>
          <h2 class="section-title">Einträge</h2>
          <ul class="card-list" data-testid="tx-list">
            ${
              monthTx.length === 0
                ? `<li class="empty-card">Trag deine erste Ausgabe oben ein.</li>`
                : monthTx
                    .map((tx) => {
                      const category = catMap.get(tx.categoryId);
                      const sign = tx.type === 'income' ? '+' : '−';
                      return `
                        <li class="item-row" data-testid="tx-item">
                          <span class="cat-dot" style="background:${displayColor(category?.color, PALETTE.stone)}"></span>
                          <div class="item-copy">
                            <span class="item-title">${escapeHtml(category?.name ?? 'Unbekannt')}</span>
                            <span class="item-meta">${escapeHtml(tx.note || tx.rawInput)} · ${escapeHtml(parseLocalDate(tx.date).toLocaleDateString('de-DE'))}</span>
                          </div>
                          <strong class="amount ${tx.type}">${sign}\u00a0${formatEUR(tx.amount)}</strong>
                          <button type="button" class="icon-btn ghost" data-action="delete-tx" data-id="${tx.id}" aria-label="Löschen">${icons.trash}</button>
                        </li>`;
                    })
                    .join('')
            }
          </ul>
        </section>
      </section>
    `;

    const input = root.querySelector('[data-testid="finance-input"]') as HTMLInputElement;
    const previewEl = root.querySelector('[data-testid="finance-preview"]') as HTMLElement;
    input.value = draft;
    previewEl.textContent = preview;

    const updatePreview = () => {
      const parsed = parseExpenseInput(input.value);
      if (!input.value.trim()) {
        previewEl.textContent = '';
        return;
      }
      if (!parsed.ok) {
        previewEl.textContent = parsed.error;
        previewEl.classList.add('error');
        return;
      }
      previewEl.classList.remove('error');
      const { category, note } = matchCategory(parsed.text, categories);
      const type = parsed.type === 'auto' ? category.type : parsed.type;
      const label = type === 'income' ? 'Einnahme' : 'Ausgabe';
      previewEl.textContent = `${label}: ${formatEUR(parsed.amount)} · ${category.name}${note ? ` · ${note}` : ''}`;
    };
    input.addEventListener('input', updatePreview);
    if (draft) updatePreview();

    attachMicButton({
      button: root.querySelector('[data-testid="finance-mic"]') as HTMLButtonElement,
      input,
      onFinal: async (text) => {
        input.value = text;
        updatePreview();
        const parsed = parseExpenseInput(text);
        if (!parsed.ok) {
          toast(parsed.error, 'error');
          return;
        }
        (root.querySelector('[data-testid="finance-form"]') as HTMLFormElement).requestSubmit();
      },
    });

    root.querySelector('[data-testid="finance-form"]')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      try {
        const { goal } = await createTransactionFromInput(input.value, todayISO());
        input.value = '';
        previewEl.textContent = '';
        toast(goal ? `Eingetragen und dem Sparziel „${goal.title}“ gutgeschrieben.` : 'Eingetragen.', 'success');
        await refresh();
        (root.querySelector('[data-testid="finance-input"]') as HTMLInputElement | null)?.focus();
      } catch (error) {
        toast(error instanceof Error ? error.message : 'Konnte nicht gespeichert werden.', 'error');
      }
    });

    root.querySelector('[data-action="prev"]')?.addEventListener('click', () => {
      const date = new Date(year, monthIndex - 1, 1);
      month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      void refresh();
    });
    root.querySelector('[data-action="next"]')?.addEventListener('click', () => {
      const date = new Date(year, monthIndex + 1, 1);
      month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      void refresh();
    });
    root.querySelector('[data-action="categories"]')?.addEventListener('click', () => void openCategories(categories));
    root.querySelectorAll('[data-action="delete-tx"]').forEach((button) => {
      button.addEventListener('click', async () => {
        await deleteTransaction((button as HTMLElement).dataset.id ?? '');
        toast('Eintrag gelöscht.', 'success');
        await refresh();
      });
    });
  }

  async function openCategories(categories: Category[]): Promise<void> {
    const list = document.createElement('div');
    list.innerHTML = `
      <ul class="card-list">
        ${categories
          .map(
            (category) => `
          <li class="item-row">
            <span class="cat-dot" style="background:${displayColor(category.color)}"></span>
            <div class="item-copy">
              <span class="item-title">${escapeHtml(category.name)}</span>
              <span class="item-meta">${category.type === 'income' ? 'Einnahme' : 'Ausgabe'}${category.keywords.length ? ` · ${escapeHtml(category.keywords.slice(0, 3).join(', '))}` : ''}</span>
            </div>
            <button type="button" class="text-btn" data-edit="${category.id}">Bearbeiten</button>
          </li>`,
          )
          .join('')}
      </ul>
    `;
    const footer = document.createElement('div');
    footer.className = 'row-actions';
    footer.innerHTML = `<button type="button" class="btn btn-primary" data-add>Neue Kategorie</button>`;
    const sheet = openSheet({ title: 'Kategorien', content: list, footer });

    const edit = (category?: Category) => {
      sheet.close();
      openCategoryEditor(category);
    };
    list.querySelectorAll('[data-edit]').forEach((button) => {
      button.addEventListener('click', () => {
        const id = (button as HTMLElement).dataset.edit;
        edit(categories.find((category) => category.id === id));
      });
    });
    footer.querySelector('[data-add]')?.addEventListener('click', () => edit());
  }

  function openCategoryEditor(category?: Category): void {
    const form = document.createElement('form');
    form.innerHTML = `
      <label class="field">
        <span>Name</span>
        <input type="text" name="name" required maxlength="40" value="${escapeHtml(category?.name ?? '')}" />
      </label>
      <label class="field">
        <span>Art</span>
        <select name="type">
          <option value="expense" ${category?.type !== 'income' ? 'selected' : ''}>Ausgabe</option>
          <option value="income" ${category?.type === 'income' ? 'selected' : ''}>Einnahme</option>
        </select>
      </label>
      <label class="field">
        <span>Farbe</span>
        <input type="color" name="color" value="${escapeHtml(category?.color ?? PALETTE.orchid)}" />
      </label>
      <label class="field">
        <span>Schlüsselwörter (kommagetrennt)</span>
        <textarea name="keywords" rows="3" placeholder="pizza, restaurant">${escapeHtml(category?.keywords.join(', ') ?? '')}</textarea>
      </label>
    `;
    const footer = document.createElement('div');
    footer.className = 'row-actions';
    footer.innerHTML = `
      ${category && category.id !== 'cat-sonstiges' ? `<button type="button" class="btn btn-danger" data-delete>Löschen</button>` : `<span></span>`}
      <button type="button" class="btn btn-primary" data-save>Speichern</button>
    `;
    const sheet = openSheet({ title: category ? 'Kategorie bearbeiten' : 'Neue Kategorie', content: form, footer });

    footer.querySelector('[data-save]')?.addEventListener('click', async () => {
      const data = new FormData(form);
      const name = String(data.get('name') ?? '').trim();
      if (!name) {
        toast('Bitte einen Namen eingeben.', 'error');
        return;
      }
      const payload = {
        name,
        type: (String(data.get('type')) === 'income' ? 'income' : 'expense') as Category['type'],
        color: String(data.get('color') ?? PALETTE.orchid),
        keywords: String(data.get('keywords') ?? '')
          .split(',')
          .map((part) => part.trim())
          .filter(Boolean),
      };
      if (category) await saveCategory({ ...category, ...payload });
      else await createCategory(payload);
      sheet.close();
      toast('Kategorie gespeichert.', 'success');
      await refresh();
    });

    footer.querySelector('[data-delete]')?.addEventListener('click', async () => {
      if (!category) return;
      const ok = await confirmSheet({
        title: 'Kategorie löschen',
        message: `„${category.name}“ löschen? Vorhandene Einträge wandern nach Sonstiges.`,
        confirmLabel: 'Löschen',
        danger: true,
      });
      if (!ok) return;
      await deleteCategory(category.id);
      sheet.close();
      toast('Kategorie gelöscht.', 'success');
      await refresh();
    });
  }

  await refresh();
  return () => {
    root.innerHTML = '';
  };
}
