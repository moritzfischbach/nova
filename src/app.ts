import { icons } from './shared/icons';
import { stopAllListening } from './shared/voice';
import { installBotQueueFlush } from './shared/grokbot';
import { toast } from './shared/toast';
import { consumePairingLink, resumePendingPairing } from './shared/pairing';
import { renderOverview } from './modules/overview/overview';
import { renderTodos } from './modules/todos/todos';
import { renderFinance } from './modules/finance/finance';
import { renderGoals } from './modules/goals/goals';
import { renderGrok } from './modules/grok/grok';
import { renderSettings } from './modules/settings/settings';
import logoSvg from './assets/logo.svg?raw';
import { currentRoute, onRouteChange, ROUTE_HASHES } from './router';
import type { RouteName } from './types';

/**
 * Module registry. Neue Module: Renderer hier eintragen, Route in router.ts,
 * optional ein Tab. Grok Bot und Einstellungen sind über die Übersicht erreichbar.
 */
const TABS: { route: RouteName; label: string; icon: string; testid: string; also?: RouteName[]; center?: boolean }[] = [
  { route: 'overview', label: 'Nova', icon: icons.home, testid: 'tab-overview', also: ['grok', 'settings'] },
  { route: 'todos', label: 'Aufgaben', icon: icons.check, testid: 'tab-todos' },
  { route: 'chat', label: 'Chat', icon: logoSvg, testid: 'tab-chat', center: true },
  { route: 'calendar', label: 'Kalender', icon: icons.calendar, testid: 'tab-calendar' },
  { route: 'finance', label: 'Finanzen', icon: icons.wallet, testid: 'tab-finance', also: ['goals'] },
];

/** Finanzplaner and Ziele share one tab; a small switch on top of both pages. */
const SUBNAV: Partial<Record<RouteName, { route: RouteName; label: string; testid: string }[]>> = {
  finance: [
    { route: 'finance', label: 'Finanzplaner', testid: 'subnav-finance' },
    { route: 'goals', label: 'Ziele', testid: 'tab-goals' },
  ],
};
SUBNAV.goals = SUBNAV.finance;

const renderers: Record<RouteName, (root: HTMLElement) => Promise<() => void>> = {
  overview: renderOverview,
  todos: renderTodos,
  // lazy: the calendar library is loaded only when the tab is opened
  calendar: (root) => import('./modules/calendar/calendar').then((m) => m.renderCalendar(root)),
  finance: renderFinance,
  goals: renderGoals,
  grok: renderGrok,
  settings: renderSettings,
  chat: (root) => import('./modules/chat/chat').then((m) => m.renderChat(root)),
};

export async function startApp(host: HTMLElement): Promise<void> {
  host.innerHTML = `
    <div class="shell">
      <main id="view" class="view"></main>
      <nav class="tabbar" aria-label="Hauptnavigation">
        ${TABS.map(
          (tab) => `
          <a class="tab${tab.center ? ' tab-center' : ''}" href="${ROUTE_HASHES[tab.route]}" data-route="${tab.route}" data-also="${(tab.also ?? []).join(' ')}" data-testid="${tab.testid}">
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
    if (consumePairingLink()) toast('Gerät mit dem Nova-Server gekoppelt.', 'success');
    const route = currentRoute();
    host.querySelectorAll<HTMLElement>('.tab').forEach((tab) => {
      const also = (tab.dataset.also ?? '').split(' ');
      tab.classList.toggle('active', tab.dataset.route === route || also.includes(route));
    });
    stopAllListening();
    dispose?.();
    dispose = undefined;
    const sub = SUBNAV[route];
    view.innerHTML = sub
      ? `<nav class="subnav" aria-label="Finanzen">${sub
          .map((item) => `<a href="${ROUTE_HASHES[item.route]}" class="${item.route === route ? 'active' : ''}" data-testid="${item.testid}">${item.label}</a>`)
          .join('')}</nav>`
      : '';
    const routeRoot = document.createElement('div');
    routeRoot.className = 'route-root';
    view.append(routeRoot);
    const next = await renderers[route](routeRoot);
    if (token !== renderToken) {
      next();
      return;
    }
    dispose = next;
    view.classList.toggle('view-chat', route === 'chat');
    view.scrollTop = 0;
  };

  resumePendingPairing(() => void render());
  installBotQueueFlush((n) => toast(`${n} Grok-Bot-Anfrage(n) nachträglich gesendet.`, 'success'));
  onRouteChange(() => {
    void render();
  });
  await render();
}
