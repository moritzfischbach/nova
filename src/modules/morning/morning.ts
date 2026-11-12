import { formatDateHuman, greeting, todayISO } from '../../shared/dates';
import { escapeHtml } from '../../shared/escape';
import { icons } from '../../shared/icons';
import { formatEUR, parseGermanNumber } from '../../shared/money';
import { displayColor } from '../../shared/palette';
import { openSheet } from '../../shared/sheet';
import { toast } from '../../shared/toast';
import { pushEnabledLocally, syncReminders } from '../../shared/reminders';
import { createId } from '../../shared/id';
import { navigate } from '../../router';
import type { RoutineItem } from '../../types';
import { upcomingInstances } from '../calendar/repo';
import { monthKey, summarizeMonth } from '../finance/repo';
import { listGoals } from '../goals/repo';
import { goalProgress, savedAmount } from '../goals/match';
import { listHabits } from '../habits/repo';
import { habitRow, wireHabitToggles } from '../habits/habits';
import { isDone } from '../habits/logic';
import { listTodoLists, listTodos, toggleTodo } from '../todos/repo';
import { budgetStatus, buildPlanPrompt, dueTodos, habitsToday, routineProgress, sortRoutine, toggleRoutineCheck } from './logic';
import { getMorningConfig, getSavedPlan, getWakeLogs, saveMorningConfig } from './repo';
import { dayOffset, fromMin, leaveTimeFor, targetWakeFor, toMin, workDayOf } from './wake';
import { openQuiz, wakeCardsHtml, wakeSectionHtml, wireWake } from './wake-ui';
import { routeParams } from '../../router';
import type { WakeLog } from '../../types';

export const AUTO_SEND_KEY = 'nova.chatAutoSend';

export async function renderMorning(root: HTMLElement): Promise<() => void> {
  let config = await getMorningConfig();
  let logs: Record<string, WakeLog> = await getWakeLogs();
  const params = routeParams();
  const forcedCheckin = params.get('checkin') ?? undefined;

  async function refresh(): Promise<void> {
    const today = todayISO();
    config = await getMorningConfig();
    logs = await getWakeLogs();
    const [instances, todos, lists, habits, goals, month] = await Promise.all([
      upcomingInstances(today, 1, 30),
      listTodos(),
      listTodoLists(),
      listHabits(),
      listGoals(),
      summarizeMonth(monthKey(today)),
    ]);
    const events = instances.filter((i) => i.date === today);
    const due = dueTodos(todos, today);
    const hToday = habitsToday(habits, today);
    const hDone = hToday.filter((h) => isDone(h, today)).length;
    const listName = new Map(lists.map((l) => [l.id, l.name]));
    const savedPlan = await getSavedPlan();
    const shift = dayOffset(config, today);
    const routine = sortRoutine(config.routine.map((r) => (shift && r.time ? { ...r, time: fromMin(toMin(r.time) + shift) } : r)));
    const workToday = workDayOf(config.work, today);
    const leaveToday = leaveTimeFor(config.work, today);
    const planCard = savedPlan
      ? `<div class="plan-card" data-testid="plan-card">
          <div class="plan-card-times">
            <span><small>Aufstehen</small><strong data-testid="plan-card-wake">${escapeHtml(targetWakeFor(config, today))}</strong></span>
            ${workToday && leaveToday ? `<span><small>Losfahren</small><strong data-testid="plan-card-leave">${escapeHtml(leaveToday)}</strong></span><span><small>Ankunft</small><strong>${escapeHtml(fromMin(toMin(leaveToday) + workToday.travel))}</strong></span>` : '<span><small>Heute</small><strong>frei</strong></span>'}
          </div>
          <a href="#/morgenplan?neu=1" class="text-btn" data-testid="plan-redo">Quiz wiederholen</a>
        </div>`
      : `<a href="#/morgenplan?neu=1" class="plan-cta" data-testid="plan-start">
          <span class="plan-cta-icon" aria-hidden="true">🌅</span>
          <span class="plan-cta-copy"><span class="dash-label">Morgenplan-Quiz · 2 Minuten</span><strong>Erstell deinen perfekten Morgen</strong><span>6 kurze Fragen – Nova rechnet aus, wann du aufstehen solltest und was vor dem Losfahren alles reinpasst.</span></span>
          <span class="quiz-go">Los</span>
        </a>`;
    const rp = routineProgress(config, today);
    const checked = new Set(config.checks[today] ?? []);
    const saving = goals.filter((g) => g.status === 'offen' && g.kind === 'spar').slice(0, 3);
    const budget = config.budget ? budgetStatus(config.budget, month.expenses, today) : undefined;
    const weekday = new Date().toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
    const parts = [
      `${events.length} ${events.length === 1 ? 'Termin' : 'Termine'}`,
      `${due.length} ${due.length === 1 ? 'fällige Aufgabe' : 'fällige Aufgaben'}`,
      `${hToday.length} ${hToday.length === 1 ? 'Gewohnheit' : 'Gewohnheiten'}`,
    ];

    root.innerHTML = `
      <section class="page morning-page" data-testid="morning">
        <header class="hero morning-hero">
          <p class="eyebrow"><a href="#/" class="crumb">Nova</a> · ${escapeHtml(weekday)}</p>
          <h1>${escapeHtml(greeting())}.</h1>
          <p class="lede" data-testid="morning-summary">Heute: ${parts.join(' · ')}.</p>
          <div class="morning-actions">
            <button type="button" class="btn btn-primary" data-action="plan" data-testid="morning-plan">${icons.sparkle} Tag planen mit Nova</button>
            <button type="button" class="btn btn-ghost" data-action="settings" data-testid="morning-settings">${icons.bell} ${escapeHtml(config.wakeTime)}${config.remind ? ' Uhr' : ' · aus'}</button>
          </div>
        </header>

        ${planCard}

        <div class="wake-cards">${wakeCardsHtml(config, logs, today, forcedCheckin)}</div>

        <section>
          <div class="section-head">
            <h2>Morgenroutine <span class="count" data-testid="routine-progress">${rp.done}/${rp.total}</span></h2>
            <button type="button" class="text-btn" data-action="edit-routine" data-testid="routine-edit">Anpassen</button>
          </div>
          <span class="progress"><i style="width:${rp.total ? Math.round((rp.done / rp.total) * 100) : 0}%"></i></span>
          <ul class="card-list routine-list" data-testid="routine-list">
            ${
              routine.length
                ? routine
                    .map(
                      (r) => `<li><button type="button" class="item-row routine-row${checked.has(r.id) ? ' done' : ''}" data-routine="${r.id}" data-testid="routine-item" aria-pressed="${checked.has(r.id)}">
                  <span class="event-time">${escapeHtml(r.time ?? '–')}</span>
                  <span class="item-copy"><span class="item-title">${escapeHtml(r.title)}</span></span>
                  <span class="check${checked.has(r.id) ? ' checked' : ''}">${checked.has(r.id) ? '✓' : ''}</span>
                </button></li>`,
                    )
                    .join('')
                : '<li class="empty-card">Noch keine Routine. Tippe auf „Anpassen“.</li>'
            }
          </ul>
        </section>

        ${wakeSectionHtml(config, logs, today)}

        <section>
          <div class="section-head"><h2>Termine heute</h2><a href="#/kalender" class="text-btn">Kalender</a></div>
          <ul class="card-list" data-testid="morning-events">
            ${
              events.length
                ? events
                    .map(
                      (i) => `<li class="item-row static"><span class="event-time">${escapeHtml(i.event.allDay ? 'Ganztägig' : `${i.event.startTime ?? ''}${i.event.endTime ? `–${i.event.endTime}` : ''}`)}</span>
                  <div class="item-copy"><span class="item-title">${escapeHtml(i.event.title)}</span>${i.event.location ? `<span class="item-meta">${escapeHtml(i.event.location)}</span>` : ''}</div></li>`,
                    )
                    .join('')
                : '<li class="empty-card">Keine festen Termine – ein freier Tag zum Gestalten.</li>'
            }
          </ul>
        </section>

        <section>
          <div class="section-head"><h2>Fällige Aufgaben</h2><a href="#/aufgaben" class="text-btn">Alle</a></div>
          <ul class="card-list" data-testid="morning-todos">
            ${
              due.length
                ? due
                    .slice(0, 8)
                    .map(
                      (t) => `<li><button type="button" class="item-row" data-todo="${t.id}" data-testid="morning-todo">
                  <span class="check"></span>
                  <span class="item-copy"><span class="item-title">${escapeHtml(t.title)}</span><span class="item-meta">${t.dueDate! < today ? `<b class="overdue">überfällig seit ${escapeHtml(formatDateHuman(t.dueDate!))}</b>` : t.dueTime ? `heute ${escapeHtml(t.dueTime)} Uhr` : 'heute'}${listName.get(t.listId) ? ` · ${escapeHtml(listName.get(t.listId)!)}` : ''}</span></span>
                </button></li>`,
                    )
                    .join('')
                : '<li class="empty-card">Nichts fällig. Stark.</li>'
            }
          </ul>
        </section>

        <section>
          <div class="section-head"><h2>Gewohnheiten <span class="count">${hDone}/${hToday.length}</span></h2><a href="#/gewohnheiten" class="text-btn" data-testid="morning-habits-link">Alle</a></div>
          <ul class="card-list" data-testid="morning-habits">
            ${hToday.length ? hToday.map((h) => habitRow(h, today)).join('') : `<li class="empty-card">${habits.length ? 'Heute steht keine Gewohnheit an.' : '<a href="#/gewohnheiten?new=1">Erste Gewohnheit anlegen →</a>'}</li>`}
          </ul>
        </section>

        <section>
          <div class="section-head"><h2>Ziele &amp; Budget</h2><a href="#/ziele" class="text-btn">Ziele</a></div>
          <div class="morning-money" data-testid="morning-money">
            ${
              budget
                ? `<article class="stat-card budget-card${budget.over ? ' over' : budget.ahead ? ' ahead' : ''}" data-testid="morning-budget">
                <p>Budget ${escapeHtml(new Date().toLocaleDateString('de-DE', { month: 'long' }))}</p>
                <strong>${budget.over ? `${formatEUR(-budget.left)} drüber` : `${formatEUR(budget.left)} übrig`}</strong>
                <span class="progress"><i style="width:${Math.min(100, Math.round(budget.ratio * 100))}%"></i></span>
                <span class="muted">${formatEUR(budget.spent)} von ${formatEUR(budget.budget)}${budget.over ? '' : ` · ca. ${formatEUR(budget.perDay)} pro Tag für ${budget.daysLeft} Tage`}</span>
              </article>`
                : `<article class="stat-card" data-testid="morning-budget"><p>Ausgaben ${escapeHtml(new Date().toLocaleDateString('de-DE', { month: 'long' }))}</p><strong>${formatEUR(month.expenses)}</strong><button type="button" class="text-btn left" data-action="settings">Monatsbudget festlegen</button></article>`
            }
            ${saving
              .map(
                (g) => `<a class="stat-card goal-mini" href="#/ziele?id=${g.id}" data-testid="morning-goal"><p>${escapeHtml(g.title)}</p><strong>${Math.round(goalProgress(g) * 100)} %</strong>
              <span class="progress"><i style="width:${Math.round(goalProgress(g) * 100)}%;background:${displayColor(g.color)}"></i></span><span class="muted">${formatEUR(savedAmount(g))} von ${formatEUR(g.targetAmount ?? 0)}</span></a>`,
              )
              .join('')}
          </div>
        </section>
      </section>`;

    root.querySelector('[data-action="plan"]')?.addEventListener('click', () => {
      const prompt = buildPlanPrompt({
        date: today,
        weekday: new Date().toLocaleDateString('de-DE', { weekday: 'long' }),
        wakeTime: config.wakeTime,
        events: events.map((i) => ({ title: i.event.title, start: i.event.startTime, end: i.event.endTime, allDay: i.event.allDay, location: i.event.location })),
        todos: due,
        habits: hToday,
        routine,
        now: new Date().toTimeString().slice(0, 5),
      });
      sessionStorage.setItem(AUTO_SEND_KEY, prompt);
      navigate('chat');
    });
    root.querySelectorAll('[data-action="settings"]').forEach((b) => b.addEventListener('click', () => openSettings()));
    root.querySelector('[data-action="edit-routine"]')?.addEventListener('click', () => openRoutineEditor());
    root.querySelectorAll<HTMLElement>('[data-routine]').forEach((b) =>
      b.addEventListener('click', async () => {
        config = await saveMorningConfig(toggleRoutineCheck(config, todayISO(), b.dataset.routine!));
        const p = routineProgress(config, todayISO());
        if (p.done === p.total && p.total) toast('Morgenroutine geschafft. Guten Start!', 'success');
        await refresh();
      }),
    );
    root.querySelectorAll<HTMLElement>('[data-habit-open]').forEach((b) => b.addEventListener('click', () => navigate('habits', { id: b.dataset.habitOpen! })));
    root.querySelectorAll<HTMLElement>('[data-todo]').forEach((b) =>
      b.addEventListener('click', async () => {
        b.querySelector('.check')?.classList.add('checked');
        await toggleTodo(b.dataset.todo!);
        toast('Aufgabe erledigt.', 'success');
        void syncReminders();
        await refresh();
      }),
    );
  }

  function openSettings(): void {
    const form = document.createElement('form');
    form.innerHTML = `
      <label class="field"><span>Ich stehe auf um</span><input type="time" name="wake" value="${escapeHtml(config.wakeTime)}" required data-testid="morning-wake" /></label>
      <label class="check-field"><input type="checkbox" name="remind" ${config.remind ? 'checked' : ''} data-testid="morning-remind" /> Jeden Morgen eine Mitteilung „Guten Morgen“</label>
      ${pushEnabledLocally() ? '' : '<p class="hint-inline">Damit die Mitteilung kommt, aktiviere Mitteilungen unter <a href="#/einstellungen">Einstellungen</a> (auf dem iPhone in der Home-Bildschirm-App).</p>'}
      <label class="field"><span>Monatsbudget für Ausgaben (optional)</span><input name="budget" inputmode="decimal" placeholder="z. B. 1.200" value="${config.budget ? String(config.budget).replace('.', ',') : ''}" data-testid="morning-budget-input" /></label>`;
    const footer = document.createElement('div');
    footer.className = 'row-actions';
    footer.innerHTML = `<button type="button" class="btn btn-ghost" data-cancel>Abbrechen</button><button type="button" class="btn btn-primary" data-save data-testid="morning-save">Speichern</button>`;
    const sheet = openSheet({ title: 'Morgen-Einstellungen', content: form, footer });
    footer.querySelector('[data-cancel]')?.addEventListener('click', () => sheet.close());
    footer.querySelector('[data-save]')?.addEventListener('click', async () => {
      const data = new FormData(form);
      const rawBudget = String(data.get('budget') ?? '').replace(/€|euro/gi, '').trim();
      const budget = rawBudget ? parseGermanNumber(rawBudget) : undefined;
      if (rawBudget && (!Number.isFinite(budget) || (budget ?? 0) <= 0)) return toast('Bitte ein gültiges Budget eingeben.', 'error');
      config = await saveMorningConfig({ ...config, wakeTime: String(data.get('wake') || config.wakeTime), remind: data.get('remind') === 'on', budget });
      sheet.close();
      toast(config.remind ? `Guten-Morgen-Mitteilung täglich um ${config.wakeTime} Uhr.` : 'Gespeichert.', 'success');
      void syncReminders();
      await refresh();
    });
  }

  function openRoutineEditor(): void {
    let items: RoutineItem[] = sortRoutine(config.routine).map((r) => ({ ...r }));
    const content = document.createElement('div');
    content.className = 'routine-editor';
    const draw = () => {
      content.innerHTML = `
        <ul class="routine-edit-list">${items
          .map(
            (r, i) => `<li class="routine-edit-row" data-testid="routine-edit-row"><input type="time" value="${escapeHtml(r.time ?? '')}" data-i="${i}" data-k="time" aria-label="Uhrzeit" />
            <input value="${escapeHtml(r.title)}" maxlength="80" data-i="${i}" data-k="title" aria-label="Schritt" />
            <button type="button" class="icon-btn ghost" data-remove="${i}" aria-label="Entfernen">${icons.trash}</button></li>`,
          )
          .join('')}</ul>
        <form class="composer static routine-add" data-add>
          <input type="time" name="time" aria-label="Uhrzeit" data-testid="routine-new-time" />
          <input name="title" placeholder="Neuer Schritt, z. B. Meditieren" maxlength="80" data-testid="routine-new-title" />
          <button type="submit" class="btn btn-secondary" data-testid="routine-add">${icons.plus}</button>
        </form>`;
    };
    draw();
    content.addEventListener('input', (e) => {
      const t = e.target as HTMLInputElement;
      if (t.dataset.i === undefined) return;
      const item = items[Number(t.dataset.i)];
      if (t.dataset.k === 'time') item.time = t.value || undefined;
      else item.title = t.value;
    });
    content.addEventListener('click', (e) => {
      const rm = (e.target as HTMLElement).closest<HTMLElement>('[data-remove]');
      if (rm) {
        items.splice(Number(rm.dataset.remove), 1);
        draw();
      }
    });
    content.addEventListener('submit', (e) => {
      e.preventDefault();
      const f = e.target as HTMLFormElement;
      const data = new FormData(f);
      const title = String(data.get('title') ?? '').trim();
      if (!title) return;
      items.push({ id: createId(), title, time: String(data.get('time') ?? '') || undefined });
      items = sortRoutine(items);
      draw();
      (content.querySelector('[data-testid="routine-new-title"]') as HTMLInputElement)?.focus();
    });
    const footer = document.createElement('div');
    footer.className = 'row-actions';
    footer.innerHTML = `<button type="button" class="btn btn-ghost" data-cancel>Abbrechen</button><button type="button" class="btn btn-primary" data-save data-testid="routine-save">Speichern</button>`;
    const sheet = openSheet({ title: 'Morgenroutine', content, footer });
    footer.querySelector('[data-cancel]')?.addEventListener('click', () => sheet.close());
    footer.querySelector('[data-save]')?.addEventListener('click', async () => {
      const pending = content.querySelector<HTMLInputElement>('[data-testid="routine-new-title"]');
      if (pending?.value.trim()) {
        const time = content.querySelector<HTMLInputElement>('[data-testid="routine-new-time"]')?.value;
        items.push({ id: createId(), title: pending.value.trim(), time: time || undefined });
      }
      config = await saveMorningConfig({ ...config, routine: items.filter((r) => r.title.trim()) });
      sheet.close();
      toast('Morgenroutine gespeichert.', 'success');
      await refresh();
    });
  }

  wireHabitToggles(root, refresh);
  wireWake(root, () => ({ config, logs }), refresh);
  await refresh();
  if (params.get('quiz') && config.dailyQuiz && !logs[todayISO()]?.quizAt) openQuiz(config, logs, refresh);
  return () => {
    root.innerHTML = '';
  };
}

