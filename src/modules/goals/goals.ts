import { formatDateHuman, todayISO } from '../../shared/dates';
import { escapeHtml } from '../../shared/escape';
import { icons } from '../../shared/icons';
import { formatEUR, parseGermanNumber } from '../../shared/money';
import { confirmSheet, openSheet } from '../../shared/sheet';
import { toast } from '../../shared/toast';
import { navigate, routeParams } from '../../router';
import type { Goal, GoalKind } from '../../types';
import { goalProgress, monthlyRate, savedAmount } from './match';
import { addDeposit, deleteGoal, getGoal, listGoals, removeDeposit, saveGoal } from './repo';
import { syncReminders } from '../../shared/reminders';

type Filter = 'alle' | GoalKind;

export async function renderGoals(root: HTMLElement): Promise<() => void> {
  let filter: Filter = 'alle';
  const params = routeParams();

  async function refresh(): Promise<void> {
    const goals = await listGoals();
    const shown = goals.filter((g) => filter === 'alle' || g.kind === filter);
    const totalSaved = goals.filter((g) => g.kind === 'spar').reduce((s, g) => s + savedAmount(g), 0);
    root.innerHTML = `
      <section class="page">
        <header class="page-header">
          <div>
            <p class="eyebrow">Ziele</p>
            <h1>Deine Ziele</h1>
            <p class="subtitle">${goals.filter((g) => g.status === 'offen').length} offen · ${formatEUR(totalSaved)} gespart</p>
          </div>
          <button type="button" class="icon-btn on-plum" data-action="new" aria-label="Neues Ziel" data-testid="goal-new">${icons.plus}</button>
        </header>
        <div class="segmented three">
          ${(['alle', 'spar', 'allgemein'] as Filter[])
            .map((f) => `<button type="button" class="${f === filter ? 'active' : ''}" data-filter="${f}">${f === 'alle' ? 'Alle' : f === 'spar' ? 'Sparziele' : 'Ziele'}</button>`)
            .join('')}
        </div>
        <p class="hint-inline">Tipp: Im Finanzplaner „50 Euro Sparen Urlaub“ eintippen oder sagen – der Betrag landet beim passenden Sparziel.</p>
        <ul class="card-list" data-testid="goal-list">
          ${
            shown.length === 0
              ? `<li class="empty-card">Noch keine Ziele. Leg ein Sparziel (z. B. Urlaub) oder ein allgemeines Ziel an.</li>`
              : shown.map(goalCard).join('')
          }
        </ul>
      </section>
    `;
    root.querySelectorAll<HTMLElement>('[data-filter]').forEach((b) =>
      b.addEventListener('click', () => {
        filter = b.dataset.filter as Filter;
        void refresh();
      }),
    );
    root.querySelector('[data-action="new"]')?.addEventListener('click', () => openEditor());
    root.querySelectorAll<HTMLElement>('[data-goal]').forEach((b) =>
      b.addEventListener('click', async () => {
        const goal = await getGoal(b.dataset.goal ?? '');
        if (goal) openDetail(goal);
      }),
    );
  }

  function goalCard(goal: Goal): string {
    const pct = Math.round(goalProgress(goal) * 100);
    const date = goal.targetDate ? `bis ${formatDateHuman(goal.targetDate)}` : 'ohne Datum';
    return `
      <li>
        <button type="button" class="item-row goal-card ${goal.status}" data-goal="${goal.id}" data-testid="goal-item">
          <span class="goal-dot" style="background:${goal.color}">${goal.kind === 'spar' ? '€' : '◎'}</span>
          <div class="item-copy">
            <span class="item-title">${escapeHtml(goal.title)}</span>
            <span class="item-meta">${goal.kind === 'spar' ? `${formatEUR(savedAmount(goal))} von ${formatEUR(goal.targetAmount ?? 0)} · ` : ''}${escapeHtml(date)}</span>
            ${goal.kind === 'spar' ? `<span class="progress"><i style="width:${pct}%;background:${goal.color}"></i></span>` : ''}
          </div>
          <span class="badge ${goal.status === 'erreicht' ? 'badge-gesendet' : 'badge-wartend'}">${goal.status === 'erreicht' ? 'Erreicht' : goal.kind === 'spar' ? `${pct} %` : 'Offen'}</span>
        </button>
      </li>`;
  }

  function openDetail(goal: Goal): void {
    const content = document.createElement('div');
    const rate = monthlyRate(goal, todayISO());
    content.innerHTML = `
      <div class="goal-detail" data-testid="goal-detail">
        <p class="item-meta">${goal.kind === 'spar' ? 'Sparziel' : 'Ziel'}${goal.targetDate ? ` · Zieldatum ${escapeHtml(formatDateHuman(goal.targetDate))}` : ''} · ${goal.status === 'erreicht' ? 'erreicht' : 'offen'}</p>
        ${goal.note ? `<p class="sheet-copy">${escapeHtml(goal.note)}</p>` : ''}
        ${
          goal.kind === 'spar'
            ? `
          <div class="stat-grid">
            <article class="stat-card"><p>Gespart</p><strong data-testid="goal-saved">${formatEUR(savedAmount(goal))}</strong></article>
            <article class="stat-card"><p>Ziel</p><strong>${formatEUR(goal.targetAmount ?? 0)}</strong></article>
          </div>
          <span class="progress big"><i style="width:${Math.round(goalProgress(goal) * 100)}%;background:${goal.color}"></i></span>
          ${rate ? `<p class="muted">Empfohlen: ${formatEUR(rate)} pro Monat bis zum Zieldatum.</p>` : ''}
          <form class="composer static" data-deposit>
            <input type="text" inputmode="decimal" placeholder="Betrag, z. B. 50" data-testid="deposit-amount" />
            <button type="submit" class="btn btn-primary">Einzahlen</button>
          </form>
          <ul class="card-list">
            ${goal.deposits
              .slice()
              .reverse()
              .map(
                (d) => `<li class="item-row deposit-row"><span>${escapeHtml(formatDateHuman(d.date))}</span><span class="item-meta">${escapeHtml(d.note ?? '')}</span><strong>${formatEUR(d.amount)}</strong><button type="button" class="icon-btn ghost" data-remove-deposit="${d.id}" aria-label="Entfernen">${icons.trash}</button></li>`,
              )
              .join('')}
          </ul>`
            : ''
        }
      </div>`;
    const footer = document.createElement('div');
    footer.className = 'row-actions';
    footer.innerHTML = `
      <button type="button" class="btn btn-ghost" data-edit>Bearbeiten</button>
      <button type="button" class="btn btn-secondary" data-grok>${icons.sparkle} Grok</button>
      <button type="button" class="btn btn-primary" data-toggle>${goal.status === 'erreicht' ? 'Wieder öffnen' : 'Erreicht'}</button>`;
    const sheet = openSheet({ title: goal.title, content, footer });

    content.querySelector('[data-deposit]')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const raw = (content.querySelector('[data-testid="deposit-amount"]') as HTMLInputElement).value.replace(/€|euro/gi, '').trim();
      const amount = parseGermanNumber(raw);
      if (!Number.isFinite(amount) || amount <= 0) return toast('Bitte einen Betrag eingeben.', 'error');
      const updated = await addDeposit(goal.id, { amount, date: todayISO(), note: 'Einzahlung' });
      sheet.close();
      toast(updated?.status === 'erreicht' ? 'Glückwunsch – Sparziel erreicht!' : `${formatEUR(amount)} eingezahlt.`, 'success');
      await refresh();
      if (updated) openDetail(updated);
    });
    content.querySelectorAll<HTMLElement>('[data-remove-deposit]').forEach((b) =>
      b.addEventListener('click', async () => {
        const updated = await removeDeposit(goal.id, b.dataset.removeDeposit ?? '');
        sheet.close();
        await refresh();
        if (updated) openDetail(updated);
      }),
    );
    footer.querySelector('[data-edit]')?.addEventListener('click', () => {
      sheet.close();
      openEditor(goal);
    });
    footer.querySelector('[data-grok]')?.addEventListener('click', () => {
      sheet.close();
      navigate('grok', {
        task: goal.kind === 'spar' ? `Hilf mir, mein Sparziel „${goal.title}“ zu erreichen.` : `Hilf mir bei meinem Ziel: ${goal.title}`,
        module: 'ziele',
        context: goal.kind === 'spar'
          ? `Gespart ${savedAmount(goal)} von ${goal.targetAmount ?? 0} Euro${goal.targetDate ? `, Zieldatum ${goal.targetDate}` : ''}`
          : `${goal.targetDate ? `Zieldatum ${goal.targetDate}. ` : ''}${goal.note ?? ''}`,
      });
    });
    footer.querySelector('[data-toggle]')?.addEventListener('click', async () => {
      await saveGoal({ ...goal, status: goal.status === 'erreicht' ? 'offen' : 'erreicht' });
      sheet.close();
      toast('Gespeichert.', 'success');
      void syncReminders();
      await refresh();
    });
  }

  function openEditor(goal?: Goal, preset?: { date?: string; kind?: GoalKind }): void {
    const kind = goal?.kind ?? preset?.kind ?? 'spar';
    const form = document.createElement('form');
    form.innerHTML = `
      <div class="segmented" role="radiogroup">
        <button type="button" data-kind="spar" class="${kind === 'spar' ? 'active' : ''}">Sparziel</button>
        <button type="button" data-kind="allgemein" class="${kind === 'allgemein' ? 'active' : ''}">Allgemeines Ziel</button>
      </div>
      <label class="field"><span>Titel</span><input name="title" required maxlength="80" value="${escapeHtml(goal?.title ?? '')}" placeholder="z. B. Urlaub Portugal" data-testid="goal-title" /></label>
      <label class="field" data-spar><span>Zielbetrag (€)</span><input name="targetAmount" inputmode="decimal" value="${goal?.targetAmount ? String(goal.targetAmount).replace('.', ',') : ''}" placeholder="z. B. 1.500" data-testid="goal-amount" /></label>
      <label class="field"><span>Zieldatum (optional)</span><input type="date" name="targetDate" value="${escapeHtml(goal?.targetDate ?? preset?.date ?? '')}" data-testid="goal-date" /></label>
      <label class="field" data-spar><span>Stichwörter für den Finanzplaner (kommagetrennt)</span><input name="keywords" value="${escapeHtml((goal?.keywords ?? []).join(', '))}" placeholder="z. B. reise, portugal" /></label>
      <label class="field"><span>Notiz</span><textarea name="note" rows="2" maxlength="500">${escapeHtml(goal?.note ?? '')}</textarea></label>
    `;
    let currentKind: GoalKind = kind;
    const syncKind = () => {
      form.querySelectorAll<HTMLElement>('[data-spar]').forEach((el) => (el.hidden = currentKind !== 'spar'));
      form.querySelectorAll<HTMLElement>('[data-kind]').forEach((b) => b.classList.toggle('active', b.dataset.kind === currentKind));
    };
    form.querySelectorAll<HTMLElement>('[data-kind]').forEach((b) =>
      b.addEventListener('click', () => {
        currentKind = b.dataset.kind as GoalKind;
        syncKind();
      }),
    );
    syncKind();
    const footer = document.createElement('div');
    footer.className = 'row-actions';
    footer.innerHTML = `${goal ? '<button type="button" class="btn btn-danger" data-delete>Löschen</button>' : '<button type="button" class="btn btn-ghost" data-cancel>Abbrechen</button>'}<button type="button" class="btn btn-primary" data-save data-testid="goal-save">Speichern</button>`;
    const sheet = openSheet({ title: goal ? 'Ziel bearbeiten' : 'Neues Ziel', content: form, footer });
    footer.querySelector('[data-cancel]')?.addEventListener('click', () => sheet.close());
    footer.querySelector('[data-save]')?.addEventListener('click', async () => {
      const data = new FormData(form);
      const title = String(data.get('title') ?? '').trim();
      if (!title) return toast('Bitte einen Titel eingeben.', 'error');
      let targetAmount: number | undefined;
      if (currentKind === 'spar') {
        targetAmount = parseGermanNumber(String(data.get('targetAmount') ?? '').replace(/€|euro/gi, '').trim());
        if (!Number.isFinite(targetAmount) || targetAmount <= 0) return toast('Bitte einen Zielbetrag eingeben.', 'error');
      }
      await saveGoal({
        ...(goal ?? {}),
        kind: currentKind,
        title,
        targetAmount,
        targetDate: String(data.get('targetDate') ?? '') || undefined,
        note: String(data.get('note') ?? ''),
        keywords: String(data.get('keywords') ?? '').split(',').map((s) => s.trim()).filter(Boolean),
      });
      sheet.close();
      toast('Ziel gespeichert.', 'success');
      void syncReminders();
      await refresh();
    });
    footer.querySelector('[data-delete]')?.addEventListener('click', async () => {
      if (!goal) return;
      if (!(await confirmSheet({ title: 'Ziel löschen', message: `„${goal.title}“ wirklich löschen?`, confirmLabel: 'Löschen', danger: true }))) return;
      await deleteGoal(goal.id);
      sheet.close();
      void syncReminders();
      await refresh();
    });
  }

  await refresh();
  const openId = params.get('id');
  if (openId) {
    const goal = await getGoal(openId);
    if (goal) openDetail(goal);
  } else if (params.get('new')) {
    openEditor(undefined, { date: params.get('date') ?? undefined, kind: (params.get('kind') as GoalKind) ?? 'allgemein' });
  }
  return () => {
    root.innerHTML = '';
  };
}
