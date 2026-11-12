import { escapeHtml } from '../../shared/escape';
import { formatDateHuman } from '../../shared/dates';
import { navigate } from '../../router';
import type { TodoItem, TodoList } from '../../types';
import { updateTodo } from './repo';
import { syncReminders } from '../../shared/reminders';
import { icons } from '../../shared/icons';
import { confirmSheet, openSheet } from '../../shared/sheet';
import { toast } from '../../shared/toast';
import { attachMicButton, micButtonHtml } from '../../shared/voice';
import {
  createTodo,
  createTodoList,
  deleteTodo,
  deleteTodoList,
  listTodoLists,
  listTodos,
  renameTodoList,
  toggleTodo,
} from './repo';

const SELECTED_KEY = 'nova.activeTodoList';

export async function renderTodos(root: HTMLElement): Promise<() => void> {
  let selectedId = localStorage.getItem(SELECTED_KEY) ?? '';

  async function refresh(): Promise<void> {
    const draft = (root.querySelector('[data-testid="todo-input"]') as HTMLInputElement | null)?.value ?? '';
    const lists = await listTodoLists();
    if (lists.length === 0) {
      const created = await createTodoList('Persönlich');
      lists.push(created);
    }
    if (!lists.some((list) => list.id === selectedId)) {
      selectedId = lists[0].id;
      localStorage.setItem(SELECTED_KEY, selectedId);
    }
    const items = await listTodos(selectedId);
    const current = lists.find((list) => list.id === selectedId)!;
    const open = items.filter((item) => !item.done).length;

    root.innerHTML = `
      <section class="page">
        <header class="page-header">
          <div>
            <p class="eyebrow">Aufgaben</p>
            <h1>${escapeHtml(current.name)}</h1>
            <p class="subtitle">${open === 1 ? '1 offene Aufgabe' : `${open} offene Aufgaben`}</p>
          </div>
          <button type="button" class="icon-btn on-plum" data-action="new-list" aria-label="Neue Liste">${icons.plus}</button>
        </header>

        <div class="chips" role="tablist" aria-label="Listen">
          ${lists
            .map(
              (list) => `
            <button type="button" class="chip ${list.id === selectedId ? 'active' : ''}" data-action="select-list" data-id="${list.id}" role="tab" aria-selected="${list.id === selectedId}">
              ${escapeHtml(list.name)}
            </button>`,
            )
            .join('')}
        </div>

        <div class="list-toolbar">
          <button type="button" class="text-btn" data-action="rename-list">Liste umbenennen</button>
          <button type="button" class="text-btn danger" data-action="delete-list">Liste löschen</button>
        </div>

        <ul class="card-list" data-testid="todo-list">
          ${
            items.length === 0
              ? `<li class="empty-card">Noch keine Aufgaben in dieser Liste. Schreib einfach unten, was erledigt werden soll.</li>`
              : items
                  .map(
                    (item) => `
            <li class="item-row todo-row ${item.done ? 'done' : ''}" data-testid="todo-item" data-id="${item.id}">
              <button type="button" class="check ${item.done ? 'checked' : ''}" data-action="toggle" data-id="${item.id}" aria-label="${item.done ? 'Wieder öffnen' : 'Abhaken'}">
                ${item.done ? '✓' : ''}
              </button>
              <button type="button" class="item-copy todo-open" data-action="edit-todo" data-id="${item.id}">
                <span class="item-title">${escapeHtml(item.title)}</span>
                ${item.dueDate ? `<span class="item-meta" data-testid="todo-due">${item.remind ? '🔔 ' : ''}Fällig ${escapeHtml(formatDateHuman(item.dueDate))}${item.dueTime ? `, ${escapeHtml(item.dueTime)}` : ''}</span>` : ''}
              </button>
              <span class="row-btns">
                <button type="button" class="icon-btn ghost" data-action="ask-grok" data-id="${item.id}" aria-label="An Grok Bot schicken" title="An Grok Bot schicken">${icons.sparkle}</button>
                <button type="button" class="icon-btn ghost" data-action="delete-todo" data-id="${item.id}" aria-label="Löschen">${icons.trash}</button>
              </span>
            </li>`,
                  )
                  .join('')
          }
        </ul>

        <form class="composer" data-testid="todo-form">
          <input type="text" name="title" data-testid="todo-input" placeholder="Aufgabe hinzufügen…" autocomplete="off" maxlength="200" />
          ${micButtonHtml('todo-mic')}
          <button type="submit" class="btn btn-primary" aria-label="Hinzufügen">${icons.plus}</button>
        </form>
      </section>
    `;

    const input = root.querySelector('[data-testid="todo-input"]') as HTMLInputElement;
    input.value = draft;

    root.querySelectorAll('[data-action="select-list"]').forEach((button) => {
      button.addEventListener('click', () => {
        selectedId = (button as HTMLElement).dataset.id ?? selectedId;
        localStorage.setItem(SELECTED_KEY, selectedId);
        void refresh();
      });
    });

    root.querySelector('[data-action="new-list"]')?.addEventListener('click', () => openListSheet());
    root.querySelector('[data-action="rename-list"]')?.addEventListener('click', () => openListSheet(current));
    root.querySelector('[data-action="delete-list"]')?.addEventListener('click', async () => {
      if (lists.length <= 1) {
        toast('Mindestens eine Liste bleibt erhalten.', 'info');
        return;
      }
      const ok = await confirmSheet({
        title: 'Liste löschen',
        message: `„${current.name}“ und alle enthaltenen Aufgaben wirklich löschen?`,
        confirmLabel: 'Löschen',
        danger: true,
      });
      if (!ok) return;
      await deleteTodoList(current.id);
      toast('Liste gelöscht.', 'success');
      selectedId = '';
      await refresh();
    });

    root.querySelectorAll('[data-action="toggle"]').forEach((button) => {
      button.addEventListener('click', async () => {
        await toggleTodo((button as HTMLElement).dataset.id ?? '');
        await refresh();
      });
    });

    root.querySelectorAll<HTMLElement>('[data-action="ask-grok"]').forEach((button) => {
      button.addEventListener('click', () => {
        const item = items.find((i) => i.id === button.dataset.id);
        if (!item) return;
        navigate('grok', {
          task: `Hilf mir bei dieser Aufgabe: ${item.title}`,
          module: 'todos',
          context: `Liste: ${current.name}${item.dueDate ? `; fällig ${item.dueDate}${item.dueTime ? ` ${item.dueTime}` : ''}` : ''}`,
        });
      });
    });

    root.querySelectorAll<HTMLElement>('[data-action="edit-todo"]').forEach((button) => {
      button.addEventListener('click', () => {
        const item = items.find((i) => i.id === button.dataset.id);
        if (item) openTodoSheet(item);
      });
    });

    root.querySelectorAll('[data-action="delete-todo"]').forEach((button) => {
      button.addEventListener('click', async () => {
        await deleteTodo((button as HTMLElement).dataset.id ?? '');
        toast('Aufgabe entfernt.', 'success');
        await refresh();
      });
    });

    const addTodo = async (value: string) => {
      const title = value.trim();
      if (!title) return;
      await createTodo(selectedId, title.charAt(0).toUpperCase() + title.slice(1));
      input.value = '';
      await refresh();
    };

    root.querySelector('[data-testid="todo-form"]')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      await addTodo(input.value);
      (root.querySelector('[data-testid="todo-input"]') as HTMLInputElement | null)?.focus();
    });

    attachMicButton({
      button: root.querySelector('[data-testid="todo-mic"]') as HTMLButtonElement,
      input,
      onFinal: async (text) => {
        await addTodo(text);
        toast(`Aufgabe hinzugefügt: ${text}`, 'success');
      },
    });
  }

  function openTodoSheet(item: TodoItem): void {
    const form = document.createElement('form');
    form.innerHTML = `
      <label class="field"><span>Aufgabe</span>
        <input type="text" name="title" maxlength="200" required value="${escapeHtml(item.title)}" data-testid="todo-edit-title" /></label>
      <div class="field-row">
        <label class="field"><span>Fällig am</span><input type="date" name="dueDate" value="${escapeHtml(item.dueDate ?? '')}" data-testid="todo-due-date" /></label>
        <label class="field"><span>Uhrzeit</span><input type="time" name="dueTime" value="${escapeHtml(item.dueTime ?? '')}" data-testid="todo-due-time" /></label>
      </div>
      <label class="check-field"><input type="checkbox" name="remind" ${item.remind ? 'checked' : ''} data-testid="todo-remind" /><span>Erinnerung senden (Mitteilung)</span></label>
    `;
    const footer = document.createElement('div');
    footer.className = 'row-actions';
    footer.innerHTML = `<button type="button" class="btn btn-ghost" data-cancel>Abbrechen</button><button type="button" class="btn btn-primary" data-save>Speichern</button>`;
    const sheet = openSheet({ title: 'Aufgabe bearbeiten', content: form, footer });
    footer.querySelector('[data-cancel]')?.addEventListener('click', () => sheet.close());
    footer.querySelector('[data-save]')?.addEventListener('click', async () => {
      const data = new FormData(form);
      const title = String(data.get('title') ?? '').trim();
      if (!title) return toast('Bitte einen Titel eingeben.', 'error');
      const dueDate = String(data.get('dueDate') ?? '') || undefined;
      await updateTodo(item.id, {
        title,
        dueDate,
        dueTime: dueDate ? String(data.get('dueTime') ?? '') || undefined : undefined,
        remind: Boolean(dueDate && data.get('remind')),
      });
      sheet.close();
      toast('Aufgabe gespeichert.', 'success');
      void syncReminders();
      await refresh();
    });
  }

  function openListSheet(list?: TodoList): void {
    const form = document.createElement('form');
    form.innerHTML = `
      <label class="field">
        <span>Name der Liste</span>
        <input type="text" name="name" value="${escapeHtml(list?.name ?? '')}" maxlength="40" required placeholder="z. B. Einkaufen" />
      </label>
    `;
    const footer = document.createElement('div');
    footer.className = 'row-actions';
    footer.innerHTML = `
      <button type="button" class="btn btn-ghost" data-cancel>Abbrechen</button>
      <button type="submit" form="unused" class="btn btn-primary">${list ? 'Speichern' : 'Anlegen'}</button>
    `;
    const sheet = openSheet({
      title: list ? 'Liste umbenennen' : 'Neue Liste',
      content: form,
      footer,
    });
    const nameInput = form.querySelector('input') as HTMLInputElement;
    nameInput.focus();
    nameInput.select();

    const submit = async () => {
      const name = nameInput.value.trim();
      if (!name) {
        toast('Bitte einen Namen eingeben.', 'error');
        return;
      }
      if (list) {
        await renameTodoList(list.id, name);
        toast('Liste umbenannt.', 'success');
      } else {
        const created = await createTodoList(name);
        selectedId = created.id;
        localStorage.setItem(SELECTED_KEY, selectedId);
        toast('Liste angelegt.', 'success');
      }
      sheet.close();
      await refresh();
    };

    footer.querySelector('[data-cancel]')?.addEventListener('click', () => sheet.close());
    footer.querySelector('.btn-primary')?.addEventListener('click', () => void submit());
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      void submit();
    });
  }

  await refresh();
  return () => {
    root.innerHTML = '';
  };
}
