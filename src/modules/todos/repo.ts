import { getAll, getById, getByIndex, putRecord, removeRecord, STORES } from '../../data/db';
import { createId } from '../../shared/id';
import type { TodoItem, TodoList } from '../../types';

export async function listTodoLists(): Promise<TodoList[]> {
  const lists = await getAll<TodoList>(STORES.todoLists);
  return lists.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'de'));
}

export async function createTodoList(name: string): Promise<TodoList> {
  const lists = await listTodoLists();
  const list: TodoList = {
    id: createId(),
    name: name.trim(),
    createdAt: new Date().toISOString(),
    sortOrder: (lists.at(-1)?.sortOrder ?? 0) + 1,
  };
  return putRecord(STORES.todoLists, list);
}

export async function renameTodoList(id: string, name: string): Promise<void> {
  const list = await getById<TodoList>(STORES.todoLists, id);
  if (!list) return;
  await putRecord(STORES.todoLists, { ...list, name: name.trim() });
}

export async function deleteTodoList(id: string): Promise<void> {
  const items = await getByIndex<TodoItem>(STORES.todos, 'listId', id);
  for (const item of items) {
    await removeRecord(STORES.todos, item.id);
  }
  await removeRecord(STORES.todoLists, id);
}

export async function listTodos(listId?: string): Promise<TodoItem[]> {
  const items = listId
    ? await getByIndex<TodoItem>(STORES.todos, 'listId', listId)
    : await getAll<TodoItem>(STORES.todos);
  return items.sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    return a.createdAt.localeCompare(b.createdAt);
  });
}

export async function createTodo(listId: string, title: string): Promise<TodoItem> {
  const item: TodoItem = {
    id: createId(),
    listId,
    title: title.trim(),
    done: false,
    createdAt: new Date().toISOString(),
  };
  return putRecord(STORES.todos, item);
}

export async function toggleTodo(id: string): Promise<TodoItem | undefined> {
  const item = await getById<TodoItem>(STORES.todos, id);
  if (!item) return undefined;
  const next: TodoItem = {
    ...item,
    done: !item.done,
    completedAt: !item.done ? new Date().toISOString() : undefined,
  };
  return putRecord(STORES.todos, next);
}

export async function deleteTodo(id: string): Promise<void> {
  await removeRecord(STORES.todos, id);
}

export async function openTodoCount(): Promise<number> {
  const items = await listTodos();
  return items.filter((item) => !item.done).length;
}

export async function updateTodo(id: string, patch: Partial<Omit<TodoItem, 'id' | 'listId' | 'createdAt'>>): Promise<TodoItem | undefined> {
  const item = await getById<TodoItem>(STORES.todos, id);
  if (!item) return undefined;
  return putRecord(STORES.todos, { ...item, ...patch });
}
