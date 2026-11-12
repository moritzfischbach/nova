import '@fontsource-variable/inter';
import './styles.css';
import { ensureSeed } from './data/seed';
import { startApp } from './app';
import { syncReminders } from './shared/reminders';

async function registerServiceWorker(): Promise<void> {
  if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return;
  try {
    await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`);
  } catch (error) {
    console.warn('Service Worker konnte nicht registriert werden.', error);
  }
}

async function boot(): Promise<void> {
  const root = document.getElementById('app');
  if (!root) throw new Error('App-Wurzel fehlt.');
  await ensureSeed();
  await startApp(root);
  void registerServiceWorker();
  void syncReminders();
}

void boot();
