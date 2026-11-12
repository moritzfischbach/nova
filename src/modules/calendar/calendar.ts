import { displayColor, PALETTE } from '../../shared/palette';
import { SERVER_NOTE } from '../../shared/api';
import { createCalendar, destroyCalendar, DayGrid, Interaction, List, TimeGrid, type Calendar } from '@event-calendar/core';
import '@event-calendar/core/index.css';
import { addDays, formatDateLong, formatISODate, pad2, todayISO } from '../../shared/dates';
import { escapeHtml } from '../../shared/escape';
import { icons } from '../../shared/icons';
import { confirmSheet, openSheet } from '../../shared/sheet';
import { toast } from '../../shared/toast';
import { syncReminders } from '../../shared/reminders';
import { navigate } from '../../router';
import type { CalendarEvent } from '../../types';
import { listGoals } from '../goals/repo';
import { exportIcs } from './ics';
import { describeRRule, expandAll, formatRRule, parseRRule, weekdayOf, type Freq } from './recurrence';
import { deleteEvent, excludeOccurrence, getEvent, importIcsText, listEvents, saveEvent } from './repo';
import { getCalendarRemoteStatus, googleConnectUrl, publishFeed, syncGoogle } from './remote';

type ViewName = 'dayGridMonth' | 'timeGridWeek' | 'timeGridDay' | 'listMonth';
const VIEW_KEY = 'nova.calView';
const VIEWS: { name: ViewName; label: string }[] = [
  { name: 'dayGridMonth', label: 'Monat' },
  { name: 'timeGridWeek', label: 'Woche' },
  { name: 'timeGridDay', label: 'Tag' },
  { name: 'listMonth', label: 'Agenda' },
];
export const EVENT_COLORS = [PALETTE.silver, PALETTE.champagne, PALETTE.sky, PALETTE.sage, PALETTE.moss, PALETTE.amber, PALETTE.rose, PALETTE.lavender];
export const REMINDER_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'Keine' },
  { value: '0', label: 'Zum Beginn' },
  { value: '10', label: '10 Minuten vorher' },
  { value: '30', label: '30 Minuten vorher' },
  { value: '60', label: '1 Stunde vorher' },
  { value: '1440', label: '1 Tag vorher' },
];

function timeOf(d: Date): string {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function addMinutesToTime(time: string, minutes: number): { time: string; dayShift: number } {
  const [h, m] = time.split(':').map(Number);
  const total = h * 60 + m + minutes;
  const dayShift = Math.floor(total / 1440);
  const t = ((total % 1440) + 1440) % 1440;
  return { time: `${pad2(Math.floor(t / 60))}:${pad2(t % 60)}`, dayShift };
}

export async function renderCalendar(root: HTMLElement): Promise<() => void> {
  let view: ViewName = (localStorage.getItem(VIEW_KEY) as ViewName) || 'timeGridWeek';
  if (!VIEWS.some((v) => v.name === view)) view = 'timeGridWeek';

  root.innerHTML = `
    <section class="page cal-page">
      <header class="page-header compact">
        <div>
          <p class="eyebrow">Kalender</p>
          <h1 data-testid="cal-title">Kalender</h1>
        </div>
        <div class="header-actions">
          <button type="button" class="icon-btn on-plum" data-action="sync" aria-label="Synchronisieren">${icons.sync}</button>
          <button type="button" class="icon-btn on-plum" data-action="add" aria-label="Termin hinzufügen" data-testid="cal-add">${icons.plus}</button>
        </div>
      </header>
      <div class="cal-toolbar">
        <div class="segmented four" role="tablist" aria-label="Ansicht">
          ${VIEWS.map((v) => `<button type="button" role="tab" data-view="${v.name}" data-testid="view-${v.name}" class="${v.name === view ? 'active' : ''}">${v.label}</button>`).join('')}
        </div>
        <div class="month-nav">
          <button type="button" class="icon-btn" data-action="prev" aria-label="Zurück" data-testid="cal-prev">${icons.chevronLeft}</button>
          <button type="button" class="text-btn" data-action="today" data-testid="cal-today">Heute</button>
          <button type="button" class="icon-btn" data-action="next" aria-label="Weiter" data-testid="cal-next">${icons.chevronRight}</button>
        </div>
      </div>
      <div class="ec-host" data-testid="calendar"></div>
    </section>
  `;

  const host = root.querySelector('.ec-host') as HTMLElement;
  const titleEl = root.querySelector('[data-testid="cal-title"]') as HTMLElement;
  const calHeight = () => `${Math.max(440, window.innerHeight - 290)}px`;

  const ec: Calendar = createCalendar(host, [TimeGrid, DayGrid, List, Interaction], {
    view,
    locale: 'de-DE',
    firstDay: 1,
    height: calHeight(),
    headerToolbar: { start: '', center: '', end: '' },
    nowIndicator: true,
    slotEventOverlap: false, // like Google: overlapping events in columns side by side
    allDaySlot: true,
    allDayContent: 'ganzt.',
    noEventsContent: 'Keine Termine',
    scrollTime: '07:30:00',
    slotDuration: '00:30:00',
    slotHeight: 26,
    dayMaxEvents: true,
    selectable: true,
    editable: true,
    eventLongPressDelay: 400,
    selectLongPressDelay: 400,
    eventTimeFormat: { hour: '2-digit', minute: '2-digit' },
    slotLabelFormat: { hour: '2-digit', minute: '2-digit' },
    dayHeaderFormat: { weekday: 'short', day: 'numeric' },
    buttonText: { today: 'Heute', dayGridMonth: 'Monat', timeGridWeek: 'Woche', timeGridDay: 'Tag', listMonth: 'Agenda' } as never,
    eventSources: [
      {
        events: async (info: { start: Date; end: Date }) => {
          const from = formatISODate(info.start);
          const to = addDays(formatISODate(info.end), -1);
          const [events, goals] = await Promise.all([listEvents(), listGoals()]);
          const instances = expandAll(events, from, to).map((i) => {
            const e = i.event;
            const color = displayColor(e.color);
            if (e.allDay) {
              return {
                id: i.instanceId,
                title: e.title,
                start: i.date,
                end: addDays(i.endDate, 1),
                allDay: true,
                backgroundColor: color,
                editable: !i.recurring,
                extendedProps: { kind: 'event', eventId: e.id, date: i.date, recurring: i.recurring },
              };
            }
            const startTime = e.startTime ?? '09:00';
            let endTime = e.endTime ?? addMinutesToTime(startTime, 60).time;
            let endDate = i.endDate;
            if (endDate === i.date && endTime <= startTime) {
              const shifted = addMinutesToTime(startTime, 60);
              endTime = shifted.time;
              endDate = addDays(i.date, shifted.dayShift);
            }
            return {
              id: i.instanceId,
              title: e.title,
              start: `${i.date} ${startTime}`,
              end: `${endDate} ${endTime}`,
              allDay: false,
              backgroundColor: color,
              editable: !i.recurring,
              extendedProps: { kind: 'event', eventId: e.id, date: i.date, recurring: i.recurring },
            };
          });
          const markers = goals
            .filter((g) => g.targetDate && g.targetDate >= from && g.targetDate <= to)
            .map((g) => ({
              id: `goal::${g.id}`,
              title: `${g.status === 'erreicht' ? '✓' : '◎'} Ziel: ${g.title}`,
              start: g.targetDate!,
              end: addDays(g.targetDate!, 1),
              allDay: true,
              editable: false,
              backgroundColor: 'transparent',
              textColor: g.color,
              classNames: ['ec-goal-marker'],
              extendedProps: { kind: 'goal', goalId: g.id },
            }));
          return [...markers, ...instances];
        },
      },
    ],
    datesSet: (info: { view: { title: string } }) => {
      titleEl.textContent = info.view.title;
    },
    dateClick: (info: { date: Date; allDay: boolean; view: { type: string } }) => {
      const date = formatISODate(info.date);
      if (info.view.type === 'dayGridMonth' || info.allDay) {
        openEventSheet({ date, allDay: info.view.type !== 'dayGridMonth' && info.allDay, startTime: '09:00', endTime: '10:00' }, { offerGoal: true });
      } else {
        const start = timeOf(info.date);
        const end = addMinutesToTime(start, 60);
        openEventSheet({ date, startTime: start, endTime: end.time, endDate: end.dayShift ? addDays(date, end.dayShift) : undefined, allDay: false }, { offerGoal: true });
      }
    },
    select: (info: { start: Date; end: Date; allDay: boolean }) => {
      ec.unselect();
      const date = formatISODate(info.start);
      if (info.allDay) {
        openEventSheet({ date, endDate: addDays(formatISODate(info.end), -1), allDay: true });
      } else {
        openEventSheet({ date, startTime: timeOf(info.start), endDate: formatISODate(info.end) !== date ? formatISODate(info.end) : undefined, endTime: timeOf(info.end), allDay: false });
      }
    },
    eventClick: async (info: { event: { extendedProps: Record<string, unknown> } }) => {
      const props = info.event.extendedProps;
      if (props.kind === 'goal') {
        navigate('goals', { id: String(props.goalId) });
        return;
      }
      const event = await getEvent(String(props.eventId));
      if (event) openEventSheet(event, { occurrence: props.recurring ? String(props.date) : undefined });
    },
    eventDrop: (info: { event: { start: Date; end: Date | null; allDay: boolean; extendedProps: Record<string, unknown> } }) => void moveEvent(info.event),
    eventResize: (info: { event: { start: Date; end: Date | null; allDay: boolean; extendedProps: Record<string, unknown> } }) => void moveEvent(info.event),
  } as never);

  async function moveEvent(e: { start: Date; end: Date | null; allDay: boolean; extendedProps: Record<string, unknown> }): Promise<void> {
    const event = await getEvent(String(e.extendedProps.eventId));
    if (!event) return;
    const start = e.start;
    const end = e.end ?? new Date(start.getTime() + 3600_000);
    if (e.allDay) {
      const endIncl = addDays(formatISODate(end), -1);
      await saveEvent({ ...event, allDay: true, date: formatISODate(start), endDate: endIncl > formatISODate(start) ? endIncl : undefined });
    } else {
      await saveEvent({
        ...event,
        allDay: false,
        date: formatISODate(start),
        startTime: timeOf(start),
        endDate: formatISODate(end) !== formatISODate(start) ? formatISODate(end) : undefined,
        endTime: timeOf(end),
      });
    }
    toast('Termin verschoben.', 'success');
    void syncReminders();
    ec.refetchEvents();
  }

  const setView = (name: ViewName) => {
    view = name;
    localStorage.setItem(VIEW_KEY, name);
    ec.setOption('view', name);
    root.querySelectorAll<HTMLElement>('[data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
  };
  root.querySelectorAll<HTMLElement>('[data-view]').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view as ViewName)));
  root.querySelector('[data-action="prev"]')?.addEventListener('click', () => ec.prev());
  root.querySelector('[data-action="next"]')?.addEventListener('click', () => ec.next());
  root.querySelector('[data-action="today"]')?.addEventListener('click', () => ec.gotoDate(new Date()));
  root.querySelector('[data-action="add"]')?.addEventListener('click', () => {
    const current = ec.getOption('date') as unknown as Date;
    const date = view === 'timeGridDay' && current ? formatISODate(current) : todayISO();
    openEventSheet({ date, startTime: '09:00', endTime: '10:00', allDay: false }, { offerGoal: true });
  });
  root.querySelector('[data-action="sync"]')?.addEventListener('click', () => void openSyncSheet());

  // Swipe left/right to navigate
  let touch: { x: number; y: number; t: number } | null = null;
  host.addEventListener('touchstart', (e) => {
    const t = e.touches[0];
    touch = { x: t.clientX, y: t.clientY, t: Date.now() };
  }, { passive: true });
  host.addEventListener('touchend', (e) => {
    if (!touch) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touch.x;
    const dy = t.clientY - touch.y;
    const fast = Date.now() - touch.t < 600;
    touch = null;
    if (fast && Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.8) {
      host.classList.add(dx < 0 ? 'slide-left' : 'slide-right');
      window.setTimeout(() => host.classList.remove('slide-left', 'slide-right'), 220);
      if (dx < 0) ec.next();
      else ec.prev();
    }
  }, { passive: true });

  const onResize = () => ec.setOption('height', calHeight());
  window.addEventListener('resize', onResize);

  function openEventSheet(initial: Partial<CalendarEvent> & { date: string }, opts: { occurrence?: string; offerGoal?: boolean } = {}): void {
    const rule = parseRRule(initial.rrule);
    const endMode = rule?.count ? 'count' : rule?.until ? 'until' : 'never';
    const color = displayColor(initial.color, EVENT_COLORS[0]);
    const form = document.createElement('form');
    form.className = 'event-form';
    form.innerHTML = `
      <label class="field"><span>Titel</span>
        <input type="text" name="title" required maxlength="160" placeholder="z. B. Zahnarzt" value="${escapeHtml(initial.title ?? '')}" data-testid="event-title" /></label>
      ${opts.occurrence ? `<p class="hint-inline">Wiederholender Termin (${escapeHtml(describeRRule(initial.rrule))}). Änderungen gelten für die ganze Serie.</p>` : ''}
      <label class="check-field"><input type="checkbox" name="allDay" ${initial.allDay ? 'checked' : ''} data-testid="event-allday" /><span>Ganztägig</span></label>
      <div class="field-row">
        <label class="field"><span>Beginn</span><input type="date" name="date" required value="${escapeHtml(initial.date)}" data-testid="event-date" /></label>
        <label class="field" data-timed><span>Uhrzeit</span><input type="time" name="startTime" value="${escapeHtml(initial.startTime ?? '09:00')}" data-testid="event-start" /></label>
      </div>
      <div class="field-row">
        <label class="field"><span>Ende</span><input type="date" name="endDate" value="${escapeHtml(initial.endDate ?? initial.date)}" data-testid="event-end-date" /></label>
        <label class="field" data-timed><span>Uhrzeit</span><input type="time" name="endTime" value="${escapeHtml(initial.endTime ?? '10:00')}" data-testid="event-end" /></label>
      </div>
      <div class="field"><span>Farbe</span>
        <div class="swatches" role="radiogroup">
          ${EVENT_COLORS.map((c) => `<button type="button" class="swatch ${c === color ? 'active' : ''}" data-color="${c}" style="background:${c}" aria-label="Farbe ${c}"></button>`).join('')}
        </div>
      </div>
      <div class="field-row">
        <label class="field"><span>Wiederholen</span>
          <select name="freq" data-testid="event-repeat">
            <option value="">Nie</option>
            ${(['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'] as Freq[]).map((f) => `<option value="${f}" ${rule?.freq === f ? 'selected' : ''}>${{ DAILY: 'Täglich', WEEKLY: 'Wöchentlich', MONTHLY: 'Monatlich', YEARLY: 'Jährlich' }[f]}</option>`).join('')}
          </select></label>
        <label class="field" data-repeat><span>Alle … (Intervall)</span><input type="number" name="interval" min="1" max="99" value="${rule?.interval ?? 1}" /></label>
      </div>
      <div class="field-row" data-repeat>
        <label class="field"><span>Endet</span>
          <select name="endMode" data-testid="event-repeat-end">
            <option value="never" ${endMode === 'never' ? 'selected' : ''}>Nie</option>
            <option value="count" ${endMode === 'count' ? 'selected' : ''}>Nach Anzahl</option>
            <option value="until" ${endMode === 'until' ? 'selected' : ''}>Am Datum</option>
          </select></label>
        <label class="field" data-endval="count"><span>Anzahl</span><input type="number" name="count" min="1" max="999" value="${rule?.count ?? 10}" /></label>
        <label class="field" data-endval="until"><span>Bis</span><input type="date" name="until" value="${escapeHtml(rule?.until ?? '')}" /></label>
      </div>
      <label class="field"><span>Erinnerung</span>
        <select name="reminder" data-testid="event-reminder">
          ${REMINDER_OPTIONS.map((o) => `<option value="${o.value}" ${String(initial.reminderMinutes ?? '') === o.value ? 'selected' : ''}>${o.label}</option>`).join('')}
        </select></label>
      <label class="field"><span>Ort</span><input type="text" name="location" maxlength="160" placeholder="optional" value="${escapeHtml(initial.location ?? '')}" /></label>
      <label class="field"><span>Notizen</span><textarea name="notes" rows="2" maxlength="500" placeholder="optional">${escapeHtml(initial.notes ?? '')}</textarea></label>
      ${opts.offerGoal && !initial.id ? `<button type="button" class="text-btn" data-goal-here data-testid="goal-for-day">◎ Stattdessen Ziel für diesen Tag anlegen</button>` : ''}
    `;
    let chosenColor = color;
    const allDay = form.querySelector('[name="allDay"]') as HTMLInputElement;
    const freq = form.querySelector('[name="freq"]') as HTMLSelectElement;
    const endModeSel = form.querySelector('[name="endMode"]') as HTMLSelectElement;
    const sync = () => {
      form.querySelectorAll<HTMLElement>('[data-timed]').forEach((el) => (el.hidden = allDay.checked));
      form.querySelectorAll<HTMLElement>('[data-repeat]').forEach((el) => (el.hidden = !freq.value));
      form.querySelectorAll<HTMLElement>('[data-endval]').forEach((el) => (el.hidden = el.dataset.endval !== endModeSel.value));
    };
    [allDay, freq, endModeSel].forEach((el) => el.addEventListener('change', sync));
    // like Google: moving the start date moves the end date along (keeps the duration)
    const startDateInput = form.querySelector('[name="date"]') as HTMLInputElement;
    const endDateInput = form.querySelector('[name="endDate"]') as HTMLInputElement;
    let lastStart = startDateInput.value;
    startDateInput.addEventListener('change', () => {
      const prev = Date.parse(`${lastStart}T00:00:00Z`);
      const next = Date.parse(`${startDateInput.value}T00:00:00Z`);
      const end = Date.parse(`${endDateInput.value}T00:00:00Z`);
      if (!Number.isNaN(prev) && !Number.isNaN(next)) {
        const shifted = Number.isNaN(end) ? next : Math.max(next, end + (next - prev));
        endDateInput.value = new Date(shifted).toISOString().slice(0, 10);
      }
      lastStart = startDateInput.value;
    });
    sync();
    form.querySelectorAll<HTMLElement>('[data-color]').forEach((b) =>
      b.addEventListener('click', () => {
        chosenColor = b.dataset.color!;
        form.querySelectorAll('.swatch').forEach((s) => s.classList.toggle('active', s === b));
      }),
    );

    const footer = document.createElement('div');
    footer.className = 'row-actions';
    footer.innerHTML = `
      ${initial.id ? `<button type="button" class="btn btn-danger" data-delete data-testid="event-delete">Löschen</button>` : `<button type="button" class="btn btn-ghost" data-cancel>Abbrechen</button>`}
      ${initial.id ? `<button type="button" class="btn btn-secondary" data-grok aria-label="An Grok Bot">${icons.sparkle}</button>` : ''}
      <button type="button" class="btn btn-primary" data-save data-testid="event-save">Speichern</button>
    `;
    const sheet = openSheet({ title: initial.id ? 'Termin bearbeiten' : 'Neuer Termin', content: form, footer });

    form.querySelector('[data-goal-here]')?.addEventListener('click', () => {
      sheet.close();
      navigate('goals', { new: '1', date: (form.querySelector('[name="date"]') as HTMLInputElement).value, kind: 'allgemein' });
    });
    footer.querySelector('[data-cancel]')?.addEventListener('click', () => sheet.close());
    footer.querySelector('[data-grok]')?.addEventListener('click', () => {
      sheet.close();
      navigate('grok', {
        task: `Hilf mir mit diesem Termin: ${initial.title ?? ''}`,
        module: 'kalender',
        context: `${initial.date}${initial.allDay ? ' ganztägig' : ` ${initial.startTime ?? ''}–${initial.endTime ?? ''}`}${initial.location ? `, Ort: ${initial.location}` : ''}${initial.notes ? `, Notiz: ${initial.notes}` : ''}`,
      });
    });

    footer.querySelector('[data-save]')?.addEventListener('click', async () => {
      const d = new FormData(form);
      const title = String(d.get('title') ?? '').trim();
      if (!title) return toast('Bitte einen Titel eingeben.', 'error');
      const date = String(d.get('date') ?? '');
      let endDate = String(d.get('endDate') ?? '') || date;
      if (endDate < date) endDate = date;
      const startTime = String(d.get('startTime') ?? '09:00');
      let endTime = String(d.get('endTime') ?? '10:00');
      if (!allDay.checked && endDate === date && endTime <= startTime) endTime = addMinutesToTime(startTime, 60).time;
      let rrule: string | undefined;
      if (freq.value) {
        const r = { freq: freq.value as Freq, interval: Math.max(1, Number(d.get('interval') ?? 1) || 1) } as NonNullable<ReturnType<typeof parseRRule>>;
        if (endModeSel.value === 'count') r.count = Math.max(1, Number(d.get('count') ?? 1) || 1);
        if (endModeSel.value === 'until' && d.get('until')) r.until = String(d.get('until'));
        if (r.freq === 'WEEKLY') r.byDay = rule?.freq === 'WEEKLY' && rule.byDay?.length ? rule.byDay : [weekdayOf(date)];
        rrule = formatRRule(r);
      }
      const reminder = String(d.get('reminder') ?? '');
      await saveEvent({
        ...(initial.id ? (initial as CalendarEvent) : {}),
        title,
        date,
        endDate: endDate !== date ? endDate : undefined,
        allDay: allDay.checked,
        startTime,
        endTime,
        color: chosenColor,
        rrule,
        exdates: rrule ? initial.exdates ?? [] : [],
        reminderMinutes: reminder === '' ? undefined : Number(reminder),
        location: String(d.get('location') ?? ''),
        notes: String(d.get('notes') ?? ''),
      });
      sheet.close();
      toast(initial.id ? 'Termin aktualisiert.' : 'Termin gespeichert.', 'success');
      void syncReminders();
      ec.refetchEvents();
    });

    footer.querySelector('[data-delete]')?.addEventListener('click', async () => {
      if (!initial.id) return;
      if (opts.occurrence) {
        const choice = await chooseDeleteScope(opts.occurrence);
        if (!choice) return;
        if (choice === 'one') await excludeOccurrence(initial.id, opts.occurrence);
        else await deleteEvent(initial.id);
      } else {
        const ok = await confirmSheet({ title: 'Termin löschen', message: `„${initial.title ?? 'Diesen Termin'}“ wirklich löschen?`, confirmLabel: 'Löschen', danger: true });
        if (!ok) return;
        await deleteEvent(initial.id);
      }
      sheet.close();
      toast('Termin gelöscht.', 'success');
      void syncReminders();
      ec.refetchEvents();
    });
  }

  function chooseDeleteScope(date: string): Promise<'one' | 'all' | null> {
    return new Promise((resolve) => {
      const footer = document.createElement('div');
      footer.className = 'stack-actions';
      footer.innerHTML = `
        <button type="button" class="btn btn-danger" data-one data-testid="delete-one">Nur diesen Termin (${escapeHtml(formatDateLong(date))})</button>
        <button type="button" class="btn btn-danger" data-all data-testid="delete-all">Ganze Serie</button>
        <button type="button" class="btn btn-ghost" data-cancel>Abbrechen</button>`;
      const s = openSheet({ title: 'Wiederholenden Termin löschen', footer });
      let done = false;
      const finish = (v: 'one' | 'all' | null) => {
        if (done) return;
        done = true;
        s.close();
        resolve(v);
      };
      footer.querySelector('[data-one]')?.addEventListener('click', () => finish('one'));
      footer.querySelector('[data-all]')?.addEventListener('click', () => finish('all'));
      footer.querySelector('[data-cancel]')?.addEventListener('click', () => finish(null));
    });
  }

  async function openSyncSheet(): Promise<void> {
    const content = document.createElement('div');
    content.innerHTML = `<p class="sheet-copy">Status wird geladen…</p>`;
    const sheet = openSheet({ title: 'Kalender synchronisieren', content });
    const status = await getCalendarRemoteStatus();
    content.innerHTML = `
      <p class="sheet-copy">Nova ist die Quelle deiner Termine. Abgleich per Datei funktioniert immer, Google und Apple über den Nova-Server.</p>
      <section class="settings-group">
        <h2>Datei (.ics)</h2>
        <div class="stack-actions">
          <button type="button" class="btn btn-primary" data-export data-testid="ics-export">Exportieren (.ics)</button>
          <button type="button" class="btn btn-secondary" data-import>Importieren (.ics)</button>
          <input type="file" accept=".ics,text/calendar" hidden data-file data-testid="ics-file" />
        </div>
      </section>
      <section class="settings-group">
        <h2>Google Kalender</h2>
        <p class="muted" data-testid="google-status">${
          status.staticOnly ? SERVER_NOTE : !status.reachable ? 'Nova-Server nicht erreichbar.' : !status.google.configured ? 'Noch nicht eingerichtet: Google-OAuth-Client-ID und -Secret fehlen auf dem Server.' : status.google.connected ? `Verbunden${status.google.lastSync ? ` · zuletzt ${new Date(status.google.lastSync).toLocaleString('de-DE')}` : ''}` : 'Bereit zum Verbinden.'
        }</p>
        ${status.google.configured && !status.google.connected ? `<a class="btn btn-primary" href="${escapeHtml(googleConnectUrl())}">Mit Google verbinden</a>` : ''}
        ${status.google.connected ? `<button type="button" class="btn btn-primary" data-google-sync data-testid="google-sync">Jetzt synchronisieren</button>` : ''}
      </section>
      <section class="settings-group">
        <h2>Apple Kalender</h2>
        <p class="muted">${
          status.staticOnly ? SERVER_NOTE : !status.reachable ? 'Nova-Server nicht erreichbar.' : status.feed.enabled ? 'Abo-Feed: In Apple Kalender „Ablage → Neues Kalenderabonnement“ (iPhone: Einstellungen → Kalender → Accounts → Abonnierter Kalender) und diese Adresse einfügen. Nur lesend.' : 'Abo-Feed noch nicht eingerichtet (CALENDAR_FEED_TOKEN fehlt auf dem Server).'
        }</p>
        ${status.feed.enabled ? `<button type="button" class="btn btn-secondary" data-feed data-testid="feed-publish">Feed aktualisieren</button><p class="feed-url" data-feed-url>${escapeHtml(status.feed.url ?? '')}</p>` : ''}
      </section>
    `;
    const fileInput = content.querySelector('[data-file]') as HTMLInputElement;
    content.querySelector('[data-export]')?.addEventListener('click', async () => {
      const ics = exportIcs(await listEvents());
      const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = 'nova-kalender.ics';
      link.click();
      URL.revokeObjectURL(url);
      toast('ICS-Datei wurde gespeichert.', 'success');
    });
    content.querySelector('[data-import]')?.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      try {
        const result = await importIcsText(await file.text());
        sheet.close();
        toast(result.total === 0 ? 'Keine Termine in der Datei gefunden.' : `${result.added} neu, ${result.updated} aktualisiert.`, result.total ? 'success' : 'info');
        void syncReminders();
        ec.refetchEvents();
      } catch (error) {
        toast(error instanceof Error ? error.message : 'Import fehlgeschlagen.', 'error');
      }
    });
    content.querySelector('[data-google-sync]')?.addEventListener('click', async () => {
      try {
        const r = await syncGoogle();
        toast(`Google: ${r.pushed} gesendet, ${r.pulled} empfangen, ${r.deleted} gelöscht.`, 'success');
        sheet.close();
        void syncReminders();
        ec.refetchEvents();
      } catch (error) {
        toast(error instanceof Error ? error.message : 'Sync fehlgeschlagen.', 'error');
      }
    });
    content.querySelector('[data-feed]')?.addEventListener('click', async () => {
      try {
        const { url } = await publishFeed();
        const el = content.querySelector('[data-feed-url]');
        if (el) el.textContent = url;
        toast('Feed aktualisiert.', 'success');
      } catch (error) {
        toast(error instanceof Error ? error.message : 'Fehler', 'error');
      }
    });
  }

  return () => {
    window.removeEventListener('resize', onResize);
    void destroyCalendar(ec);
    root.innerHTML = '';
  };
}

