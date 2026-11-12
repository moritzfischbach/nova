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

export type RouteName = 'overview' | 'todos' | 'calendar' | 'finance' | 'goals' | 'grok' | 'settings';

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
