import type { CalendarEvent } from '../../types';
import { exportIcs, importIcs, type ParsedIcsEvent } from './ics';

/**
 * Calendar sync providers.
 *
 * Nova's own calendar is the source of truth. This interface lets future
 * two-way connectors (Google Calendar via OAuth, Apple via CalDAV) plug in
 * without changing the UI or storage layer.
 *
 * Current implementation: IcsFileSync (export + import .ics files).
 * That already works with Apple Calendar and Google Calendar through
 * their native import/export / "subscribe to calendar" flows.
 */
export interface CalendarSyncProvider {
  readonly id: string;
  readonly name: string;
  readonly capabilities: {
    importIcs: boolean;
    exportIcs: boolean;
    twoWay: boolean;
  };
  exportIcs?(events: CalendarEvent[]): string;
  importIcs?(icsText: string): ParsedIcsEvent[];
  connect?(): Promise<void>;
  disconnect?(): Promise<void>;
  pull?(): Promise<ParsedIcsEvent[]>;
  push?(events: CalendarEvent[]): Promise<void>;
}

export const icsFileSync: CalendarSyncProvider = {
  id: 'ics-file',
  name: 'ICS-Datei (Apple & Google)',
  capabilities: {
    importIcs: true,
    exportIcs: true,
    twoWay: false,
  },
  exportIcs,
  importIcs,
};

/**
 * Placeholder for a future Google Calendar provider.
 *
 * To implement later you would need:
 * - A Google Cloud project and OAuth 2.0 client of type "Web"
 * - Scopes such as `https://www.googleapis.com/auth/calendar.events`
 * - Authorization Code flow with PKCE (safe in a public PWA) OR a small
 *   backend / Grok-Bot relay that keeps the client secret and refresh token
 * - Mapping between Nova events and Google events via `uid` ↔ `iCalUID`
 * - Incremental sync with `syncToken` from events.list
 * - Conflict policy: Nova remains source of truth unless the user chooses
 *   "remote wins" for a pull
 *
 * Do not embed an OAuth client secret in this frontend.
 */
export const googleCalendarSyncStub: CalendarSyncProvider = {
  id: 'google-calendar',
  name: 'Google Kalender',
  capabilities: { importIcs: false, exportIcs: false, twoWay: true },
  async connect() {
    throw new Error('Google-Kalender-Sync ist noch nicht verbunden.');
  },
};

/**
 * Placeholder for a future Apple Calendar / iCloud CalDAV provider.
 *
 * Options:
 * 1) One-way subscription: host an .ics URL (HTTPS) and subscribe in Apple
 *    Calendar. Apple pulls Nova's calendar; changes in Apple do not flow back.
 * 2) Two-way CalDAV against iCloud (caldav.icloud.com) with an app-specific
 *    password. Needs a backend: browsers cannot speak CalDAV reliably and
 *    must not store the Apple password in localStorage.
 * 3) Import/export .ics files — already available via `icsFileSync`.
 */
export const appleCalendarSyncStub: CalendarSyncProvider = {
  id: 'apple-caldav',
  name: 'Apple Kalender',
  capabilities: { importIcs: false, exportIcs: false, twoWay: true },
  async connect() {
    throw new Error('Apple-Kalender-Sync ist noch nicht verbunden.');
  },
};

export const syncProviders: CalendarSyncProvider[] = [
  icsFileSync,
  googleCalendarSyncStub,
  appleCalendarSyncStub,
];
