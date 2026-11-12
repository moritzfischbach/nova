import { icons } from './shared/icons';
import { stopAllListening } from './shared/voice';
import { installBotQueueFlush } from './shared/grokbot';
import { toast } from './shared/toast';
import { renderOverview } from './modules/overview/overview';
import { renderTodos } from './modules/todos/todos';
import { renderFinance } from './modules/finance/finance';
import { renderGoals } from './modules/goals/goals';
import { renderGrok } from './modules/grok/grok';
import { renderSettings } from './modules/settings/settings';
import { currentRoute, onRouteChange, ROUTE_HASHES } from './router';
import type { RouteName } from './types';

/**
 * Module registry. Neue Module: Renderer hier eintragen, Route in router.ts,
 * optional ein Tab. Grok Bot und Einstellungen sind über die Übersicht erreichbar.
 */
const TABS: { route: RouteName; label: string; icon: string; testid: string; also?: RouteName[] }[] = [
  { route: 'overview', label: 'Nova', icon: icons.home, testid: 'tab-overview', also: ['grok', 'settings'] },
  { route: 'todos', label: 'Aufgaben', icon: icons.check, testid: 'tab-todos' },
  { route: 'calendar', label: 'Kalender', icon: icons.calendar, testid: 'tab-calendar' },
  { route: 'finance', label: 'Finanzen', icon: icons.wallet, testid: 'tab-finance' },
  { route: 'goals', label: 'Ziele', icon: icons.target, testid: 'tab-goals' },
];

const renderers: Record<RouteName, (root: HTMLElement) => Promise<() => void>> = {
  overview: renderOverview,
  todos: renderTodos,
  // lazy: the calendar library is loaded only when the tab is opened
  calendar: (root) => import('./modules/calendar/calendar').then((m) => m.renderCalendar(root)),
  finance: renderFinance,
  goals: renderGoals,
  grok: renderGrok,
  settings: renderSettings,
};

export async function startApp(host: HTMLElement): Promise<void> {
  host.innerHTML = `
    <div class="shell">
      <main id="view" class="view"></main>
      <nav class="tabbar" aria-label="Hauptnavigation">
        ${TABS.map(
          (tab) => `
          <a class="tab" href="${ROUTE_HASHES[tab.route]}" data-route="${tab.route}" data-also="${(tab.also ?? []).join(' ')}" data-testid="${tab.testid}">
            <span class="tab-icon">${tab.icon}</span>
            <span class="tab-label">${tab.label}</span>
          </a>`,
        ).join('')}
      </nav>
      <div id="toasts" class="toasts" aria-live="polite"></div>
    </div>
  `;

  const view = host.querySelector('#view') as HTMLElement;
  let dispose: (() => void) | undefined;
  let renderToken = 0;

  const render = async () => {
    const token = ++renderToken;
    const route = currentRoute();
    host.querySelectorAll<HTMLElement>('.tab').forEach((tab) => {
      const also = (tab.dataset.also ?? '').split(' ');
      tab.classList.toggle('active', tab.dataset.route === route || also.includes(route));
    });
    stopAllListening();
    dispose?.();
    dispose = undefined;
    const next = await renderers[route](view);
    if (token !== renderToken) {
      next();
      return;
    }
    dispose = next;
    view.scrollTop = 0;
  };

  installBotQueueFlush((n) => toast(`${n} Grok-Bot-Anfrage(n) nachträglich gesendet.`, 'success'));
  onRouteChange(() => {
    void render();
  });
  await render();
}
