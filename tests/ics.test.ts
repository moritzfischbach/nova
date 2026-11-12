import { describe, expect, it } from 'vitest';
import { escapeIcsText, exportIcs, foldLine, importIcs, unescapeIcsText } from '../src/modules/calendar/ics';
import type { CalendarEvent } from '../src/types';

function sample(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 'evt-1',
    uid: 'evt-1@nova.local',
    title: 'Zahnarzt',
    date: '2026-11-15',
    startTime: '10:00',
    endTime: '11:00',
    allDay: false,
    location: 'Praxis am Markt',
    notes: 'Bitte Versichertenkarte mitnehmen',
    createdAt: '2026-11-11T10:00:00.000Z',
    updatedAt: '2026-11-11T10:00:00.000Z',
    ...overrides,
  };
}

describe('ICS export/import', () => {
  it('roundtrips a timed event', () => {
    const ics = exportIcs([sample()]);
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('SUMMARY:Zahnarzt');
    expect(ics).toContain('DTSTART:20261115T100000');
    expect(ics).toContain('DTEND:20261115T110000');
    expect(ics).toContain('LOCATION:Praxis am Markt');

    const parsed = importIcs(ics);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].title).toBe('Zahnarzt');
    expect(parsed[0].date).toBe('2026-11-15');
    expect(parsed[0].startTime).toBe('10:00');
    expect(parsed[0].endTime).toBe('11:00');
    expect(parsed[0].allDay).toBe(false);
    expect(parsed[0].location).toBe('Praxis am Markt');
    expect(parsed[0].notes).toBe('Bitte Versichertenkarte mitnehmen');
    expect(parsed[0].uid).toBe('evt-1@nova.local');
  });

  it('exports all-day events with exclusive DTEND', () => {
    const ics = exportIcs([
      sample({
        title: 'Urlaub',
        allDay: true,
        startTime: undefined,
        endTime: undefined,
        date: '2026-12-24',
        endDate: '2026-12-26',
      }),
    ]);
    expect(ics).toContain('DTSTART;VALUE=DATE:20261224');
    expect(ics).toContain('DTEND;VALUE=DATE:20261227');

    const parsed = importIcs(ics);
    expect(parsed[0].allDay).toBe(true);
    expect(parsed[0].date).toBe('2026-12-24');
    expect(parsed[0].endDate).toBe('2026-12-26');
  });

  it('escapes commas, semicolons and newlines', () => {
    const title = 'Dinner, extra; fancy';
    const notes = 'Erste Zeile\nZweite Zeile';
    const escaped = escapeIcsText(title);
    expect(escaped).toContain('\\,');
    expect(escaped).toContain('\\;');
    expect(unescapeIcsText(escaped)).toBe(title);

    const ics = exportIcs([sample({ title, notes })]);
    const parsed = importIcs(ics);
    expect(parsed[0].title).toBe(title);
    expect(parsed[0].notes).toBe(notes);
  });

  it('unfolds folded lines', () => {
    const longTitle = 'Ein sehr langer Titel für einen besonders wichtigen Termin bei Nova am Nachmittag';
    const folded = foldLine(`SUMMARY:${escapeIcsText(longTitle)}`);
    expect(folded).toContain('\r\n ');
    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'UID:fold@nova.local',
      folded,
      'DTSTART;VALUE=DATE:20261120',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    const parsed = importIcs(ics);
    expect(parsed[0].title).toBe(longTitle);
    expect(parsed[0].allDay).toBe(true);
  });

  it('imports multiple events and UTC timestamps', () => {
    const ics = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:utc@example.com
SUMMARY:Call
DTSTART:20261115T150000Z
DTEND:20261115T160000Z
END:VEVENT
BEGIN:VEVENT
UID:second@example.com
SUMMARY:Zweites
DTSTART;VALUE=DATE:20261116
END:VEVENT
END:VCALENDAR`;
    const parsed = importIcs(ics);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].title).toBe('Call');
    expect(parsed[0].allDay).toBe(false);
    expect(parsed[0].startTime).toMatch(/^\d{2}:\d{2}$/);
    expect(parsed[1].title).toBe('Zweites');
    expect(parsed[1].date).toBe('2026-11-16');
  });
});

describe('ICS recurrence, color, alarm', () => {
  it('exports and imports RRULE, EXDATE, COLOR and VALARM', () => {
    const ics = exportIcs([sample({ rrule: 'FREQ=WEEKLY;BYDAY=MO,WE;COUNT=10', exdates: ['2026-11-18'], color: '#3D7A9A', reminderMinutes: 30 })]);
    expect(ics).toContain('RRULE:FREQ=WEEKLY;BYDAY=MO,WE;COUNT=10');
    expect(ics).toContain('EXDATE:20261118T100000');
    expect(ics).toContain('COLOR:#3D7A9A');
    expect(ics).toContain('TRIGGER:-PT30M');
    const [p] = importIcs(ics);
    expect(p).toMatchObject({ rrule: 'FREQ=WEEKLY;BYDAY=MO,WE;COUNT=10', exdates: ['2026-11-18'], color: '#3D7A9A', reminderMinutes: 30, startTime: '10:00' });
  });
  it('imports Google-style yearly all-day event with alarm in days', () => {
    const ics = 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:bday@google.com\r\nSUMMARY:Geburtstag Anna\r\nDTSTART;VALUE=DATE:20260315\r\nDTEND;VALUE=DATE:20260316\r\nRRULE:FREQ=YEARLY\r\nEXDATE;VALUE=DATE:20270315,20280315\r\nBEGIN:VALARM\r\nTRIGGER:-P1D\r\nACTION:DISPLAY\r\nEND:VALARM\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n';
    const [p] = importIcs(ics);
    expect(p).toMatchObject({ allDay: true, date: '2026-03-15', rrule: 'FREQ=YEARLY', exdates: ['2027-03-15', '2028-03-15'], reminderMinutes: 1440 });
    expect(p.endDate).toBeUndefined();
  });
});
