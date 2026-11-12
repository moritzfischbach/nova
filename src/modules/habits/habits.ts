import { displayColor } from '../../shared/palette';
import { addDays, monthLabel, todayISO } from '../../shared/dates';
import { escapeHtml } from '../../shared/escape';
import { icons } from '../../shared/icons';
import { confirmSheet, openSheet } from '../../shared/sheet';
import { toast } from '../../shared/toast';
import { syncReminders } from '../../shared/reminders';
import { routeParams } from '../../router';
import type { Habit, HabitFrequency } from '../../types';
import { completionRate, frequencyLabel, isDone, isDueOn, lastDays, monthCells, streak, WEEKDAY_SHORT, weekCount } from './logic';
import { deleteHabit, getHabit, HABIT_COLORS, HABIT_EMOJIS, listHabits, saveHabit, toggleHabit } from './repo';

export function streakText(s: { current: number; unit: 'Tag' | 'Woche' }): string {
  if (!s.current) return 'Noch keine Serie';
  return `${s.current} ${s.unit === 'Tag' ? (s.current === 1 ? 'Tag' : 'Tage') : s.current === 1 ? 'Woche' : 'Wochen'} in Folge`;
}

/** Small 7-day strip (also used on the overview and in the Morgenplaner). */
export function weekStrip(h: Habit, today: string): string {
  return `<span class="habit-strip" aria-hidden="true">${lastDays(h, today, 7)
    .map((c) => `<i class="${c.done ? 'on' : ''}${c.scheduled ? '' : ' off'}${c.date === today ? ' today' : ''}" style="--c:${displayColor(h.color)}" title="${c.date}"></i>`)
    .join('')}</span>`;
}

/** Check-off row used by the habits page, the overview and the Morgenplaner. */
export function habitRow(h: Habit, today: string, opts: { detail?: boolean } = {}): string {
  const done = isDone(h, today);
  const s = streak(h, today);
  const due = isDueOn(h, today);
  const extra = h.frequency.type === 'perWeek' ? ` · ${weekCount(h, today)}/${h.frequency.times} diese Woche` : '';
  return `
    <li class="item-row habit-row${done ? ' done' : ''}${due ? '' : ' rest'}" data-testid="habit-item" data-habit-id="${h.id}">
      <button type="button" class="habit-emoji" style="--c:${displayColor(h.color)}" data-habit-open="${h.id}" aria-label="${escapeHtml(h.name)} öffnen">${escapeHtml(h.emoji)}</button>
      <button type="button" class="item-copy habit-copy" data-habit-open="${h.id}">
        <span class="item-title">${escapeHtml(h.name)}</span>
        <span class="item-meta">${escapeHtml(frequencyLabel(h.frequency))}${extra}${due ? '' : ' · heute frei'}</span>
        ${opts.detail === false ? '' : `<span class="habit-sub">${weekStrip(h, today)}<span class="habit-streak${s.current ? ' hot' : ''}" data-testid="habit-streak">${s.current ? '🔥 ' : ''}${escapeHtml(streakText(s))}</span></span>`}
      </button>
      <button type="button" class="check habit-check${done ? ' checked' : ''}" data-habit-toggle="${h.id}" aria-pressed="${done}" aria-label="${escapeHtml(h.name)} ${done ? 'nicht erledigt' : 'erledigt'}" data-testid="habit-check">${done ? '✓' : ''}</button>
    </li>`;
}

/** Wires toggle buttons inside a container; calls onChange after each toggle. */
export function wireHabitToggles(container: HTMLElement, onChange: () => void | Promise<void>): void {
  container.addEventListener('click', async (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-habit-toggle]');
    if (!btn) return;
    e.preventDefault();
    btn.classList.toggle('checked');
    const h = await toggleHabit(btn.dataset.habitToggle!, todayISO());
    if (h && isDone(h, todayISO())) {
      const s = streak(h, todayISO());
      toast(s.current > 1 ? `${h.emoji} ${h.name} – ${streakText(s)}!` : `${h.emoji} ${h.name} erledigt.`, 'success');
    }
    void syncReminders();
    await onChange();
  });
}

export async function renderHabits(root: HTMLElement): Promise<() => void> {
  const params = routeParams();

  async function refresh(): Promise<void> {
    const today = todayISO();
    const habits = await listHabits();
    const due = habits.filter((h) => isDueOn(h, today));
    const doneToday = due.filter((h) => isDone(h, today)).length;
    const pct = due.length ? Math.round((doneToday / due.length) * 100) : 0;
    const best = habits.map((h) => ({ h, s: streak(h, today) })).sort((a, b) => b.s.current - a.s.current)[0];
    root.innerHTML = `
      <section class="page habits-page">
        <header class="page-header">
          <div>
            <p class="eyebrow"><a href="#/" class="crumb">Nova</a> · Angewohnheiten</p>
            <h1>Gewohnheiten</h1>
            <p class="subtitle" data-testid="habits-summary">${habits.length ? `Heute ${doneToday} von ${due.length} erledigt` : 'Kleine Schritte, jeden Tag'}</p>
          </div>
          <button type="button" class="icon-btn on-plum" data-action="new" aria-label="Neue Gewohnheit" data-testid="habit-new">${icons.plus}</button>
        </header>
        ${
          habits.length
            ? `<div class="habit-today">
                <div class="ring" style="--p:${pct}"><span>${pct}<small>%</small></span></div>
                <div>
                  <p class="dash-label">Heute</p>
                  <strong>${doneToday === due.length && due.length ? 'Alles geschafft' : `${due.length - doneToday} noch offen`}</strong>
                  <span class="muted">${best && best.s.current ? `Längste laufende Serie: ${escapeHtml(best.h.emoji)} ${escapeHtml(best.h.name)} · ${escapeHtml(streakText(best.s))}` : 'Hak ab, was du heute geschafft hast.'}</span>
                </div>
              </div>`
            : ''
        }
        <ul class="card-list" data-testid="habit-list">
          ${
            habits.length
              ? habits.map((h) => habitRow(h, today)).join('')
              : `<li class="empty-card">Noch keine Gewohnheiten. Leg z. B. „Wasser trinken“, „10 Min. lesen“ oder „Sport 3× pro Woche“ an – oder sag es Nova im Chat.</li>`
          }
        </ul>
      </section>`;
    root.querySelector('[data-action="new"]')?.addEventListener('click', () => openHabitEditor(undefined, refresh));
    root.querySelectorAll<HTMLElement>('[data-habit-open]').forEach((b) =>
      b.addEventListener('click', async () => {
        const h = await getHabit(b.dataset.habitOpen!);
        if (h) openHabitDetail(h, refresh);
      }),
    );
  }

  wireHabitToggles(root, refresh);
  await refresh();
  const id = params.get('id');
  if (id) {
    const h = await getHabit(id);
    if (h) openHabitDetail(h, refresh);
  } else if (params.get('new')) openHabitEditor(undefined, refresh);
  return () => {
    root.innerHTML = '';
  };
}

export function openHabitDetail(habit: Habit, onChange: () => Promise<void>): void {
  let h = habit;
  const now = new Date();
  let year = now.getFullYear();
  let month = now.getMonth();
  const content = document.createElement('div');
  content.className = 'habit-detail';
  content.dataset.testid = 'habit-detail';

  const draw = () => {
    const today = todayISO();
    const s = streak(h, today);
    const rate30 = Math.round(completionRate(h, addDays(today, -29), today) * 100);
    const rate7 = Math.round(completionRate(h, addDays(today, -6), today) * 100);
    const cells = monthCells(h, year, month, today);
    const inMonth = cells.filter((c) => c.inMonth && !c.future);
    const monthDone = inMonth.filter((c) => c.done).length;
    const canNext = new Date(year, month + 1, 1) <= now;
    content.innerHTML = `
      <div class="habit-hero" style="--c:${displayColor(h.color)}">
        <span class="habit-emoji big">${escapeHtml(h.emoji)}</span>
        <div><p class="item-meta">${escapeHtml(frequencyLabel(h.frequency))}${h.reminderTime ? ` · Erinnerung ${escapeHtml(h.reminderTime)} Uhr` : ''}</p>
        <p class="habit-streak${s.current ? ' hot' : ''}">${s.current ? '🔥 ' : ''}${escapeHtml(streakText(s))}</p></div>
      </div>
      <div class="stat-grid four">
        <article class="stat-card"><p>Serie</p><strong data-testid="habit-current">${s.current}</strong><span class="muted">${s.unit === 'Tag' ? 'Tage' : 'Wochen'}</span></article>
        <article class="stat-card"><p>Rekord</p><strong data-testid="habit-longest">${s.longest}</strong><span class="muted">${s.unit === 'Tag' ? 'Tage' : 'Wochen'}</span></article>
        <article class="stat-card"><p>7 Tage</p><strong data-testid="habit-rate7">${rate7} %</strong><span class="muted">Quote</span></article>
        <article class="stat-card"><p>30 Tage</p><strong data-testid="habit-rate30">${rate30} %</strong><span class="muted">Quote</span></article>
      </div>
      <div class="heat-head">
        <button type="button" class="icon-btn ghost" data-month="-1" aria-label="Voriger Monat">${icons.chevronLeft}</button>
        <strong data-testid="habit-month">${escapeHtml(monthLabel(year, month))}</strong>
        <span class="muted">${monthDone}× erledigt</span>
        <button type="button" class="icon-btn ghost" data-month="1" aria-label="Nächster Monat" ${canNext ? '' : 'disabled'}>${icons.chevronRight}</button>
      </div>
      <div class="heatmap" data-testid="habit-heatmap" style="--c:${displayColor(h.color)}">
        ${WEEKDAY_SHORT.map((d) => `<span class="heat-wd">${d}</span>`).join('')}
        ${cells
          .map(
            (c) =>
              `<button type="button" class="heat-cell${c.done ? ' on' : ''}${c.scheduled ? '' : ' off'}${c.inMonth ? '' : ' out'}${c.date === today ? ' today' : ''}" data-day="${c.date}" ${c.future || !c.inMonth ? 'disabled' : ''} aria-label="${c.date}${c.done ? ' erledigt' : ''}">${Number(c.date.slice(8))}</button>`,
          )
          .join('')}
      </div>
      <p class="hint-inline">Tipp: Tippe auf einen Tag, um ihn nachträglich ab- oder anzuhaken.</p>`;
  };
  draw();
  content.addEventListener('click', async (e) => {
    const t = e.target as HTMLElement;
    const m = t.closest<HTMLButtonElement>('[data-month]');
    if (m && !m.disabled) {
      month += Number(m.dataset.month);
      if (month < 0) { month = 11; year -= 1; }
      if (month > 11) { month = 0; year += 1; }
      draw();
      return;
    }
    const day = t.closest<HTMLButtonElement>('[data-day]');
    if (day && !day.disabled) {
      h = (await toggleHabit(h.id, day.dataset.day!)) ?? h;
      draw();
      void syncReminders();
      await onChange();
    }
  });
  const footer = document.createElement('div');
  footer.className = 'row-actions';
  footer.innerHTML = `<button type="button" class="btn btn-ghost" data-edit data-testid="habit-edit">Bearbeiten</button><button type="button" class="btn btn-primary" data-today data-testid="habit-detail-check">${isDone(h, todayISO()) ? 'Heute nicht erledigt' : 'Heute erledigt'}</button>`;
  const sheet = openSheet({ title: `${h.emoji} ${h.name}`, content, footer });
  footer.querySelector('[data-edit]')?.addEventListener('click', () => {
    sheet.close();
    openHabitEditor(h, onChange);
  });
  footer.querySelector('[data-today]')?.addEventListener('click', async (e) => {
    h = (await toggleHabit(h.id, todayISO())) ?? h;
    (e.currentTarget as HTMLElement).textContent = isDone(h, todayISO()) ? 'Heute nicht erledigt' : 'Heute erledigt';
    draw();
    void syncReminders();
    await onChange();
  });
}

export function openHabitEditor(habit: Habit | undefined, onChange: () => Promise<void>, preset?: { name?: string }): void {
  let freq: HabitFrequency = habit?.frequency ?? { type: 'daily' };
  let days = freq.type === 'weekdays' ? [...freq.days] : [1, 2, 3, 4, 5];
  let times = freq.type === 'perWeek' ? freq.times : 3;
  let emoji = habit?.emoji ?? HABIT_EMOJIS[0];
  let color = habit?.color ?? HABIT_COLORS[0];
  const form = document.createElement('form');
  form.className = 'habit-form';
  form.innerHTML = `
    <label class="field"><span>Name</span><input name="name" required maxlength="60" value="${escapeHtml(habit?.name ?? preset?.name ?? '')}" placeholder="z. B. 2 Liter Wasser" data-testid="habit-name" /></label>
    <div class="field"><span>Symbol</span><div class="emoji-grid" data-testid="habit-emojis">${HABIT_EMOJIS.map((e) => `<button type="button" data-emoji="${e}">${e}</button>`).join('')}</div></div>
    <div class="field"><span>Wie oft?</span>
      <div class="segmented three" role="radiogroup">
        <button type="button" data-freq="daily" data-testid="habit-freq-daily">Täglich</button>
        <button type="button" data-freq="weekdays" data-testid="habit-freq-weekdays">Wochentage</button>
        <button type="button" data-freq="perWeek" data-testid="habit-freq-perweek">× pro Woche</button>
      </div>
    </div>
    <div class="chips weekday-chips" data-show="weekdays">${WEEKDAY_SHORT.map((d, i) => `<button type="button" class="chip" data-day="${i + 1}" data-testid="habit-day-${i + 1}">${d}</button>`).join('')}</div>
    <div class="chips" data-show="perWeek">${[1, 2, 3, 4, 5, 6].map((n) => `<button type="button" class="chip" data-times="${n}" data-testid="habit-times-${n}">${n}×</button>`).join('')}</div>
    <label class="field"><span>Erinnerung (optional)</span><input type="time" name="reminder" value="${escapeHtml(habit?.reminderTime ?? '')}" data-testid="habit-reminder" /></label>
    <div class="field"><span>Farbe</span><div class="color-row">${HABIT_COLORS.map((c) => `<button type="button" class="color-dot" data-color="${c}" style="--c:${displayColor(c)}" aria-label="Farbe"></button>`).join('')}</div></div>`;
  const sync = () => {
    form.querySelectorAll<HTMLElement>('[data-freq]').forEach((b) => b.classList.toggle('active', b.dataset.freq === freq.type));
    form.querySelectorAll<HTMLElement>('[data-show]').forEach((el) => (el.hidden = el.dataset.show !== freq.type));
    form.querySelectorAll<HTMLElement>('[data-day]').forEach((b) => b.classList.toggle('active', days.includes(Number(b.dataset.day))));
    form.querySelectorAll<HTMLElement>('[data-times]').forEach((b) => b.classList.toggle('active', Number(b.dataset.times) === times));
    form.querySelectorAll<HTMLElement>('[data-emoji]').forEach((b) => b.classList.toggle('active', b.dataset.emoji === emoji));
    form.querySelectorAll<HTMLElement>('[data-color]').forEach((b) => b.classList.toggle('active', b.dataset.color === color));
  };
  form.addEventListener('click', (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('button');
    if (!t) return;
    if (t.dataset.freq) freq = t.dataset.freq === 'daily' ? { type: 'daily' } : t.dataset.freq === 'weekdays' ? { type: 'weekdays', days } : { type: 'perWeek', times };
    if (t.dataset.day) {
      const d = Number(t.dataset.day);
      days = days.includes(d) ? days.filter((x) => x !== d) : [...days, d].sort();
    }
    if (t.dataset.times) times = Number(t.dataset.times);
    if (t.dataset.emoji) emoji = t.dataset.emoji;
    if (t.dataset.color) color = t.dataset.color;
    sync();
  });
  sync();
  const footer = document.createElement('div');
  footer.className = 'row-actions';
  footer.innerHTML = `${habit ? '<button type="button" class="btn btn-danger" data-delete data-testid="habit-delete">Löschen</button>' : '<button type="button" class="btn btn-ghost" data-cancel>Abbrechen</button>'}<button type="button" class="btn btn-primary" data-save data-testid="habit-save">Speichern</button>`;
  const sheet = openSheet({ title: habit ? 'Gewohnheit bearbeiten' : 'Neue Gewohnheit', content: form, footer });
  footer.querySelector('[data-cancel]')?.addEventListener('click', () => sheet.close());
  const save = async () => {
    const data = new FormData(form);
    const name = String(data.get('name') ?? '').trim();
    if (!name) return toast('Bitte einen Namen eingeben.', 'error');
    let frequency: HabitFrequency = { type: 'daily' };
    if (freq.type === 'weekdays') {
      if (!days.length) return toast('Bitte mindestens einen Wochentag wählen.', 'error');
      frequency = { type: 'weekdays', days };
    } else if (freq.type === 'perWeek') frequency = { type: 'perWeek', times };
    await saveHabit({ ...(habit ?? {}), name, emoji, color, frequency, reminderTime: String(data.get('reminder') ?? '') || undefined });
    sheet.close();
    toast(habit ? 'Gewohnheit gespeichert.' : `${emoji} „${name}“ angelegt.`, 'success');
    void syncReminders();
    await onChange();
  };
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    void save();
  });
  footer.querySelector('[data-save]')?.addEventListener('click', () => void save());
  footer.querySelector('[data-delete]')?.addEventListener('click', async () => {
    if (!habit) return;
    if (!(await confirmSheet({ title: 'Gewohnheit löschen', message: `„${habit.name}“ samt Verlauf löschen?`, confirmLabel: 'Löschen', danger: true }))) return;
    await deleteHabit(habit.id);
    sheet.close();
    void syncReminders();
    await onChange();
  });
}
