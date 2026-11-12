import logoSvg from '../../assets/logo.svg?raw';
import { formatDateHuman, greeting, todayISO } from '../../shared/dates';
import { escapeHtml } from '../../shared/escape';
import { formatEUR } from '../../shared/money';
import { upcomingInstances } from '../calendar/repo';
import { monthKey, summarizeMonth } from '../finance/repo';
import { listTodoLists, listTodos, openTodoCount } from '../todos/repo';
import { listGoals } from '../goals/repo';
import { goalProgress } from '../goals/match';
import { icons } from '../../shared/icons';
import { listHabits } from '../habits/repo';
import { habitRow, wireHabitToggles } from '../habits/habits';
import { isDone } from '../habits/logic';
import { dueTodos, habitsToday, routineProgress } from '../morning/logic';
import { getMorningConfig } from '../morning/repo';
import { navigate } from '../../router';

const COMING_SOON = ['Sales-Trainer'];

export async function renderOverview(root: HTMLElement): Promise<() => void> {
  wireHabitToggles(root, () => draw());
  root.addEventListener('click', (e) => {
    const open = (e.target as HTMLElement).closest<HTMLElement>('[data-habit-open]');
    if (open) navigate('habits', { id: open.dataset.habitOpen! });
  });
  await draw();
  async function draw(): Promise<void> {
  const today = todayISO();
  const [goals, openCount, lists, todos, events, summary, habits, morning] = await Promise.all([
    listGoals(),
    openTodoCount(),
    listTodoLists(),
    listTodos(),
    upcomingInstances(today, 60, 4).then((list) => list.map((i) => ({ ...i.event, date: i.date }))),
    summarizeMonth(monthKey(today)),
    listHabits(),
    getMorningConfig(),
  ]);
  const hToday = habitsToday(habits, today);
  const hDone = hToday.filter((h) => isDone(h, today)).length;
  const todayEvents = events.filter((e) => e.date === today).length;
  const dueCount = dueTodos(todos, today).length;
  const rp = routineProgress(morning, today);
  const hour = new Date().getHours();
  const briefTitle = hour < 11 ? 'Guten Morgen' : hour < 18 ? 'Dein Tag' : 'Morgen vorbereiten';

  const openTodos = todos.filter((item) => !item.done).slice(0, 4);
  const listNames = new Map(lists.map((list) => [list.id, list.name]));

  root.innerHTML = `
    <section class="page overview">
      <header class="hero">
        <div class="hero-top">
          <span class="brand-mark" data-testid="brand-logo">${logoSvg}</span>
          <span class="brand-word">Nova</span>
        </div>
        <p class="eyebrow">${escapeHtml(new Date().toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' }))}</p>
        <h1>${escapeHtml(greeting())}.</h1>
        <p class="lede">Ich bin Nova, deine persönliche Assistentin. Hier siehst du den Stand der Dinge – Aufgaben, Termine und Finanzen bleiben bei dir auf dem Gerät.</p>
        <div class="hero-actions">
          <a href="#/chat" class="hero-chat" data-testid="open-chat">${icons.chat} Mit Nova chatten</a>
          <a href="#/grok" data-testid="open-grok">${icons.sparkle} Nova fragt Grok</a>
          <a href="#/einstellungen" data-testid="open-settings">${icons.gear} Einstellungen</a>
        </div>
      </header>

      <a class="morning-card" href="#/morgen" data-testid="open-morning">
        <span class="morning-sun" aria-hidden="true"></span>
        <div class="morning-copy">
          <p class="dash-label">Morgenplaner</p>
          <strong>${briefTitle}</strong>
          <span>${todayEvents} ${todayEvents === 1 ? 'Termin' : 'Termine'} · ${dueCount} fällig · Routine ${rp.done}/${rp.total}</span>
        </div>
        <span class="morning-go" aria-hidden="true">${icons.chevronRight}</span>
      </a>

      <div class="dash-grid">
        <a class="dash-card" href="#/aufgaben" data-testid="dash-todos">
          <p class="dash-label">Aufgaben</p>
          <strong>${openCount}</strong>
          <span>${openCount === 1 ? 'offen' : 'offen'}</span>
        </a>
        <a class="dash-card" href="#/kalender" data-testid="dash-calendar">
          <p class="dash-label">Als Nächstes</p>
          <strong>${events[0] ? escapeHtml(events[0].title) : 'Frei'}</strong>
          <span>${events[0] ? escapeHtml(formatEventLine(events[0].date, events[0].allDay ? 'Ganztägig' : events[0].startTime)) : 'Keine anstehenden Termine'}</span>
        </a>
        <a class="dash-card" href="#/finanzen" data-testid="dash-finance">
          <p class="dash-label">Dieser Monat</p>
          <strong>${formatEUR(summary.expenses)}</strong>
          <span>Ausgaben${summary.income ? ` · ${formatEUR(summary.income)} Einnahmen` : ''}</span>
        </a>
        <a class="dash-card" href="#/ziele" data-testid="dash-goals">
          <p class="dash-label">Ziele</p>
          <strong>${goals.filter((g) => g.status === 'offen').length} offen</strong>
          <span>${(() => {
            const next = goals.find((g) => g.status === 'offen' && g.kind === 'spar');
            return next ? `${escapeHtml(next.title)}: ${Math.round(goalProgress(next) * 100)} %` : 'Leg dein erstes Sparziel an';
          })()}</span>
        </a>
      </div>

      <section data-testid="overview-habits">
        <div class="section-head">
          <h2>Gewohnheiten${hToday.length ? ` <span class="count">${hDone}/${hToday.length}</span>` : ''}</h2>
          <a href="#/gewohnheiten" class="text-btn" data-testid="open-habits">${habits.length ? 'Alle' : 'Anlegen'}</a>
        </div>
        ${
          hToday.length
            ? `<ul class="card-list">${hToday.slice(0, 4).map((h) => habitRow(h, today, { detail: false })).join('')}</ul>`
            : `<a class="empty-card block" href="#/gewohnheiten${habits.length ? '' : '?new=1'}">${habits.length ? 'Heute steht keine Gewohnheit an.' : 'Bau dir gute Gewohnheiten auf – mit Serien und Heatmap.'}</a>`
        }
      </section>

      <section>
        <div class="section-head">
          <h2>Offene Aufgaben</h2>
          <a href="#/aufgaben" class="text-btn">Alle</a>
        </div>
        ${
          openTodos.length === 0
            ? `<p class="empty-card">Alles erledigt. Wenn etwas ansteht, trag es unter Aufgaben ein.</p>`
            : `<ul class="card-list">
                ${openTodos
                  .map(
                    (item) => `
                  <li class="item-row static">
                    <span class="check"></span>
                    <div class="item-copy">
                      <span class="item-title">${escapeHtml(item.title)}</span>
                      <span class="item-meta">${escapeHtml(listNames.get(item.listId) ?? '')}</span>
                    </div>
                  </li>`,
                  )
                  .join('')}
              </ul>`
        }
      </section>

      <section>
        <div class="section-head">
          <h2>Termine</h2>
          <a href="#/kalender" class="text-btn">Kalender</a>
        </div>
        ${
          events.length === 0
            ? `<p class="empty-card">Dein Kalender ist noch still.</p>`
            : `<ul class="card-list">
                ${events
                  .map(
                    (event) => `
                  <li class="item-row static">
                    <span class="event-time">${escapeHtml(event.allDay ? 'Ganztägig' : event.startTime ?? '')}</span>
                    <div class="item-copy">
                      <span class="item-title">${escapeHtml(event.title)}</span>
                      <span class="item-meta">${escapeHtml(formatDateHuman(event.date))}${event.location ? ` · ${escapeHtml(event.location)}` : ''}</span>
                    </div>
                  </li>`,
                  )
                  .join('')}
              </ul>`
        }
      </section>

      <section>
        <h2 class="section-title">Als Nächstes geplant</h2>
        <div class="chips wrap">
          ${COMING_SOON.map((label) => `<span class="chip disabled">${escapeHtml(label)}</span>`).join('')}
        </div>
      </section>

      <aside class="install-hint">
        <p><strong>Aufs iPhone legen</strong></p>
        <p>In Safari öffnen, dann teilen und „Zum Home-Bildschirm“ wählen. Nova öffnet sich danach wie eine eigene App.</p>
      </aside>
    </section>
  `;

  }

  return () => {
    root.innerHTML = '';
  };
}

function formatEventLine(date: string, time?: string): string {
  return `${formatDateHuman(date)}${time ? ` · ${time}` : ''}`;
}
