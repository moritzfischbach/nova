export type ID = string;

export interface TodoList {
  id: ID;
  name: string;
  createdAt: string;
  sortOrder: number;
}

export interface TodoItem {
  id: ID;
  listId: ID;
  title: string;
  done: boolean;
  createdAt: string;
  completedAt?: string;
  /** Fälligkeit (YYYY-MM-DD) und optional Uhrzeit (HH:MM) */
  dueDate?: string;
  dueTime?: string;
  /** Erinnerung zur Fälligkeit senden */
  remind?: boolean;
}

export interface CalendarEvent {
  id: ID;
  uid: string;
  title: string;
  date: string;
  endDate?: string;
  startTime?: string;
  endTime?: string;
  allDay: boolean;
  location?: string;
  notes?: string;
  /** Kalender-Zuordnung (Standard "nova") */
  calendarId?: string;
  /** Optionale Farbe (#rrggbb) */
  color?: string;
  /** Wiederholung als RRULE ohne Präfix, z. B. "FREQ=WEEKLY;BYDAY=MO,WE" */
  rrule?: string;
  /** Ausgelassene Vorkommen (YYYY-MM-DD) */
  exdates?: string[];
  /** Externe Kennungen für Sync */
  googleId?: string;
  googleEtag?: string;
  /** Lokal geändert, noch nicht mit externem Kalender abgeglichen */
  syncDirty?: boolean;
  /** Erinnerung x Minuten vor Beginn (z. B. 10, 60, 1440) */
  reminderMinutes?: number;
  createdAt: string;
  updatedAt: string;
}

export interface Tombstone {
  uid: string;
  googleId?: string;
  deletedAt: string;
}

export type CategoryType = 'expense' | 'income';

export interface Category {
  id: ID;
  name: string;
  keywords: string[];
  color: string;
  type: CategoryType;
  sortOrder: number;
  builtin?: boolean;
}

export interface Transaction {
  id: ID;
  amount: number;
  currency: 'EUR';
  type: CategoryType;
  categoryId: ID;
  note: string;
  date: string;
  rawInput: string;
  createdAt: string;
}

export type RouteName = 'overview' | 'todos' | 'calendar' | 'finance' | 'goals' | 'grok' | 'settings' | 'chat';

export type BotModule = 'todos' | 'kalender' | 'finanzen' | 'ziele' | 'allgemein';
export type BotRequestStatus = 'wartend' | 'gesendet' | 'fehler';

export interface BotRequest {
  id: string;
  requestId: string;
  task: string;
  module: BotModule;
  context?: string;
  status: BotRequestStatus;
  error?: string;
  errorCode?: string;
  createdAt: string;
  sentAt?: string;
  attempts: number;
}

export interface GoalDeposit {
  id: string;
  amount: number;
  date: string;
  note?: string;
  /** verknüpfter Finanzplaner-Eintrag */
  txId?: string;
}

export type GoalKind = 'spar' | 'allgemein';
export type GoalStatus = 'offen' | 'erreicht';

/** Ein Ziel: Sparziel (mit Beträgen) oder allgemeines Ziel. */
export interface Goal {
  id: string;
  kind: GoalKind;
  title: string;
  /** Zieldatum (YYYY-MM-DD), erscheint im Kalender */
  targetDate?: string;
  note?: string;
  status: GoalStatus;
  /** nur Sparziel */
  targetAmount?: number;
  deposits: GoalDeposit[];
  /** Schlüsselwörter für Finanzplaner-Verknüpfung ("50 Euro Sparen Urlaub") */
  keywords?: string[];
  color: string;
  createdAt: string;
  updatedAt: string;
}

export interface MetaRecord {
  key: string;
  value: unknown;
}

/* Nova Chat */
export type ChatToolName = 'aufgabe_anlegen' | 'termin_anlegen' | 'finanzeintrag_erfassen' | 'sparziel_einzahlen' | 'an_grok_bot_weitergeben';
export type ToolCallStatus = 'offen' | 'ausgefuehrt' | 'abgelehnt' | 'fehler';

export interface ChatToolCall {
  id: string;
  name: ChatToolName;
  /** JSON-String wie vom Modell geliefert */
  arguments: string;
  status: ToolCallStatus;
  /** Ergebnis für das Modell (JSON-String) */
  result?: string;
  /** Kurzbeschreibung für die Anzeige */
  summary?: string;
  /** Link in Nova, z. B. #/aufgaben */
  link?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  createdAt: string;
  toolCalls?: ChatToolCall[];
  toolCallId?: string;
  error?: string;
  errorCode?: string;
  model?: string;
}

export interface ChatConversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
}

// ---------- Angewohnheiten ----------
/** Weekdays 1 = Montag … 7 = Sonntag (ISO). */
export type HabitFrequency = { type: 'daily' } | { type: 'weekdays'; days: number[] } | { type: 'perWeek'; times: number };

export interface Habit {
  id: string;
  name: string;
  emoji: string;
  frequency: HabitFrequency;
  reminderTime?: string; // HH:MM
  color: string;
  /** ISO dates (YYYY-MM-DD) on which the habit was done */
  completions: string[];
  archived?: boolean;
  createdAt: string;
  updatedAt: string;
}

// ---------- Morgenplaner ----------
export interface RoutineItem {
  id: string;
  title: string;
  time?: string; // HH:MM
}

export interface MorningConfig {
  wakeTime: string; // HH:MM
  remind: boolean;
  routine: RoutineItem[];
  /** routine items checked per day: { '2026-11-12': ['id1'] } (only recent days kept) */
  checks: Record<string, string[]>;
}
