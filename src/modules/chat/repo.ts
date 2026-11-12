import { getAll, getById, putRecord, removeRecord, STORES } from '../../data/db';
import { createId } from '../../shared/id';
import type { ChatConversation, ChatMessage } from '../../types';

export const ACTIVE_KEY = 'nova.chatActive';

export async function listConversations(): Promise<ChatConversation[]> {
  const items = await getAll<ChatConversation>(STORES.chats);
  return items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function getConversation(id: string): Promise<ChatConversation | undefined> {
  return getById<ChatConversation>(STORES.chats, id);
}

export function newConversation(): ChatConversation {
  const now = new Date().toISOString();
  return { id: createId(), title: 'Neuer Chat', messages: [], createdAt: now, updatedAt: now };
}

export function saveConversation(conv: ChatConversation): Promise<ChatConversation> {
  const firstUser = conv.messages.find((m) => m.role === 'user');
  const title = conv.title === 'Neuer Chat' && firstUser ? firstUser.content.replace(/\s+/g, ' ').slice(0, 48) : conv.title;
  return putRecord(STORES.chats, { ...conv, title, updatedAt: new Date().toISOString() });
}

export function deleteConversation(id: string): Promise<void> {
  return removeRecord(STORES.chats, id);
}

export function message(role: ChatMessage['role'], content: string, extra: Partial<ChatMessage> = {}): ChatMessage {
  return { id: createId(), role, content, createdAt: new Date().toISOString(), ...extra };
}
