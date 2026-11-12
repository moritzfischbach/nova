/** UI for Wach-Quiz, „Früher aufstehen“ and „Pünktlich zur Arbeit“ inside the Morgenplaner. */
import { addDays, formatDateHuman, todayISO } from '../../shared/dates';
import { escapeHtml } from '../../shared/escape';
import { openSheet } from '../../shared/sheet';
import { toast } from '../../shared/toast';
import { syncReminders } from '../../shared/reminders';
import type { MorningConfig, Punctuality, WakeGoal, WakeLog, WorkConfig, WorkDay } from '../../types';
import { WEEKDAY_SHORT } from '../habits/logic';
import { buildQuiz, type BrainKind, type ChoiceQuestion, type QuizQuestion } from './quiz';
import { ensureLinkedHabits, markLinkedHabit, saveMorningConfig, saveWakeLog } from './repo';
import {
  isEarly,
  leaveTimeFor,
  motivation,
  pendingCheckin,
  punctualityLabel,
  targetWakeFor,
  wakeCell,
  wakeDelta,
  wakePlanInfo,
  wakeStats,
  wakeStreak,
  weekGrid,
  workCell,
  workDayOf,
  type DayCell,
} from './wake';

export const nowHHMM = () => new Date().toTimeString().slice(0, 5);

function deltaText(min: number): string {
  if (min <= 0) return min === 0 ? 'genau zur Zielzeit' : `${-min} Min. vor deinem Ziel`;
  return `${min} Min. nach deinem Ziel`;
}

function weekRow(cells: DayCell[], testid: string): string {
  const today = todayISO();
  return `<div class="wake-week" data-testid="${testid}">${cells
    .map((c, i) => `<span class="wk ${c.state}${c.date === today ? ' today' : ''}" title="${c.date}${c.label ? ` · ${escapeHtml(c.label)}` : ''}"><small>${WEEKDAY_SHORT[i % 7]}</small><i></i></span>`)
    .join('')}</div>`;
}

/** Cards shown at the top of the Morgenplaner. */
export function wakeCardsHtml(config: MorningConfig, logs: Record<string, WakeLog>, today: string, forcedCheckin?: string): string {
  const log = logs[today];
  const target = targetWakeFor(config, today);
  const streak = wakeStreak(logs, today);
  const simple = !config.dailyQuiz
    ? log?.wokeAt
      ? `<div class="quiz-card done" data-testid="wake-done">
        <span class="quiz-icon">${log.early ? '✓' : '·'}</span>
        <span class="quiz-copy"><span class="dash-label">Aufgestanden · ${escapeHtml(log.wokeAt)} Uhr</span>
        <strong>${log.early ? 'Pünktlich aufgestanden' : 'Heute etwas später'}</strong>
        <span>Ziel ${escapeHtml(log.target ?? target)}${streak ? ` · 🔥 ${streak} ${streak === 1 ? 'Tag' : 'Tage'}` : ''}</span></span>
      </div>`
      : `<button type="button" class="quiz-card" data-action="wake-now" data-testid="wake-now">
        <span class="quiz-icon">☀️</span>
        <span class="quiz-copy"><span class="dash-label">Ziel heute: ${escapeHtml(target)} Uhr</span>
        <strong>Bin wach</strong>
        <span>Ein Tipp – Nova merkt sich, wann du aufgestanden bist${streak ? ` · 🔥 ${streak} ${streak === 1 ? 'Tag' : 'Tage'} früh auf` : ''}</span></span>
        <span class="quiz-go">✓</span>
      </button>`
    : undefined;
  const quiz = simple ?? (log?.quizAt
    ? `<button type="button" class="quiz-card done" data-action="quiz-result" data-testid="quiz-card">
        <span class="quiz-icon">${log.early ? '✓' : '·'}</span>
        <span class="quiz-copy"><span class="dash-label">Wach-Quiz erledigt · ${escapeHtml(log.quizAt)} Uhr</span>
        <strong>${log.early ? 'Pünktlich aufgestanden' : 'Heute etwas später'}</strong>
        <span>Aufgestanden ${escapeHtml(log.wokeAt ?? log.quizAt)} · Ziel ${escapeHtml(log.target ?? target)}${streak ? ` · 🔥 ${streak} ${streak === 1 ? 'Tag' : 'Tage'}` : ''}${log.focus ? ` · Fokus: ${escapeHtml(log.focus)}` : ''}</span></span>
      </button>`
    : `<button type="button" class="quiz-card" data-action="quiz" data-testid="quiz-start">
        <span class="quiz-icon">☀️</span>
        <span class="quiz-copy"><span class="dash-label">Wach-Quiz · 3 Fragen</span>
        <strong>Werd wach in 60 Sekunden</strong>
        <span>Ziel heute: ${escapeHtml(target)} Uhr aufstehen${streak ? ` · 🔥 ${streak} ${streak === 1 ? 'Tag' : 'Tage'} früh auf` : ''}</span></span>
        <span class="quiz-go">Start</span>
      </button>`);
  const pending = forcedCheckin && forcedCheckin <= today && !logs[forcedCheckin]?.punctual && workDayOf(config.work, forcedCheckin) ? forcedCheckin : pendingCheckin(logs, config.work, today, nowHHMM());
  const checkin = pending
    ? `<div class="checkin-card" data-testid="checkin-card" data-date="${pending}">
        <p><strong>Warst du ${pending === today ? 'heute' : pending === addDays(today, -1) ? 'gestern' : `am ${escapeHtml(formatDateHuman(pending))}`} pünktlich bei der Arbeit?</strong></p>
        <div class="checkin-actions">
          <button type="button" class="btn btn-ghost" data-checkin="ja" data-testid="checkin-ja">✓ Ja</button>
          <button type="button" class="btn btn-ghost" data-checkin="knapp" data-testid="checkin-knapp">≈ Knapp</button>
          <button type="button" class="btn btn-ghost" data-checkin="spaet" data-testid="checkin-spaet">✕ Zu spät</button>
        </div>
      </div>`
    : '';
  return quiz + checkin;
}

/** Section „Aufstehen & Pünktlichkeit“. */
export function wakeSectionHtml(config: MorningConfig, logs: Record<string, WakeLog>, today: string): string {
  const plan = wakePlanInfo(config, today);
  const stats = wakeStats(logs, config.work, today);
  const days = weekGrid(today, 1);
  const work = workDayOf(config.work, today);
  const leave = leaveTimeFor(config.work, today);
  const goalLine = plan
    ? plan.reached || !plan.next
      ? `Ziel ${escapeHtml(plan.goal)} Uhr${plan.reached ? ' – erreicht 🎉' : ''}`
      : `Heute ${escapeHtml(plan.target)} · ab ${escapeHtml(formatDateHuman(plan.next.date))} ${escapeHtml(plan.next.time)} · Ziel ${escapeHtml(plan.goal)} (noch ${plan.stepsLeft} ${plan.stepsLeft === 1 ? 'Schritt' : 'Schritte'})`
    : `Aufstehen um ${escapeHtml(config.wakeTime)} · <span class="link-like">Ziel festlegen</span>`;
  return `
    <section data-testid="wake-section">
      <div class="section-head"><h2>Aufstehen &amp; Pünktlichkeit</h2><button type="button" class="text-btn" data-action="wake-settings" data-testid="wake-setup">Einrichten</button></div>
      <div class="wake-grid">
        <button type="button" class="wake-tile" data-action="${config.wakeGoal || stats.early.of ? 'wake-stats' : 'wake-settings'}" data-testid="wake-tile">
          <span class="wake-head"><span class="wake-emoji">⏰</span><span class="dash-label">Früher aufstehen</span><span class="wake-streak${stats.wakeStreak ? ' hot' : ''}">${stats.wakeStreak ? `🔥 ${stats.wakeStreak}` : '–'}</span></span>
          <strong data-testid="wake-target">${escapeHtml(targetWakeFor(config, today))} Uhr</strong>
          <span class="muted" data-testid="wake-plan">${goalLine}</span>
          ${weekRow(days.map((d) => wakeCell(logs, d, today)), 'wake-week')}
          <span class="muted small">${stats.early.of ? `${stats.early.hit} von ${stats.early.of} Tagen pünktlich auf (14 Tage)` : (config.dailyQuiz ? 'Noch keine Daten – starte morgen mit dem Wach-Quiz.' : 'Noch keine Daten – tippe morgens auf „Bin wach“.')}</span>
        </button>
        <button type="button" class="wake-tile" data-action="${config.work ? 'wake-stats' : 'wake-settings'}" data-testid="work-tile">
          <span class="wake-head"><span class="wake-emoji">🕗</span><span class="dash-label">Pünktlich zur Arbeit</span><span class="wake-streak${stats.punctualStreak ? ' hot' : ''}">${stats.punctualStreak ? `🔥 ${stats.punctualStreak}` : '–'}</span></span>
          ${
            config.work
              ? work
                ? `<strong data-testid="leave-time">Losgehen um ${escapeHtml(leave!)}</strong><span class="muted">Arbeit ${escapeHtml(work.start)} · ${work.travel} Min. Weg${work.buffer ? ` + ${work.buffer} Puffer` : ''}${config.work.leaveRemind ? ` · Push ${config.work.leaveLead} Min. vorher` : ''}</span>`
                : `<strong data-testid="leave-time">Heute frei</strong><span class="muted">Kein Arbeitstag eingetragen</span>`
              : `<strong data-testid="leave-time">Arbeitszeiten eintragen</strong><span class="muted">Dann sagt Nova dir, wann du losmusst.</span>`
          }
          ${config.work ? weekRow(days.map((d) => workCell(logs, config.work, d, today)), 'work-week') : ''}
          ${config.work ? `<span class="muted small">${stats.punctual.of ? `${stats.punctual.hit} von ${stats.punctual.of} Arbeitstagen pünktlich (14 Tage)` : 'Nach der Arbeit kurz eintragen, ob du pünktlich warst.'}</span>` : ''}
        </button>
      </div>
    </section>`;
}

/** Wires quiz, check-in, settings and stats inside the Morgenplaner root. */
export function wireWake(root: HTMLElement, get: () => { config: MorningConfig; logs: Record<string, WakeLog> }, refresh: () => Promise<void>): void {
  root.addEventListener('click', async (e) => {
    const t = e.target as HTMLElement;
    const action = t.closest<HTMLElement>('[data-action]')?.dataset.action;
    const { config, logs } = get();
    if (action === 'quiz') openQuiz(config, logs, refresh);
    else if (action === 'quiz-result') {
      const l = logs[todayISO()];
      if (l) openResult(config, logs, l, refresh);
    } else if (action === 'wake-settings') openWakeSettings(config, refresh);
    else if (action === 'wake-stats') openWakeStats(config, logs);
    else if (action === 'wake-now') {
      const today = todayISO();
      const wokeAt = nowHHMM();
      const target = targetWakeFor(config, today);
      const early = isEarly(wokeAt, target);
      await saveWakeLog(today, { wokeAt, target, early });
      await markLinkedHabit('wake', today, early, config);
      toast(early ? `Guten Morgen! ${wokeAt} – pünktlich auf.` : `Guten Morgen! Notiert: ${wokeAt} (Ziel ${target}).`, 'success');
      void syncReminders();
      await refresh();
    }
    const ci = t.closest<HTMLElement>('[data-checkin]');
    if (ci) {
      const date = ci.closest<HTMLElement>('[data-date]')!.dataset.date!;
      await recordCheckin(config, date, ci.dataset.checkin as Punctuality);
      await refresh();
    }
  });
}

export async function recordCheckin(config: MorningConfig, date: string, p: Punctuality): Promise<void> {
  await saveWakeLog(date, { punctual: p });
  await markLinkedHabit('work', date, p !== 'spaet', config);
  toast(p === 'spaet' ? 'Notiert. Morgen klappt es – Nova erinnert dich ans Losgehen.' : p === 'knapp' ? 'Knapp ist auch pünktlich. Notiert!' : 'Pünktlich – stark! Notiert.', p === 'spaet' ? 'info' : 'success');
  void syncReminders();
}

export function openQuiz(config: MorningConfig, logs: Record<string, WakeLog>, onDone: () => Promise<void>): void {
  const today = todayISO();
  const leaveAt = leaveTimeFor(config.work, today);
  const avoid = (logs[addDays(today, -1)]?.kinds ?? []) as BrainKind[];
  const questions: QuizQuestion[] = buildQuiz({ seed: (Date.now() ^ Math.floor(Math.random() * 1e9)) >>> 0, now: nowHHMM(), leaveAt, avoid });
  const answers: { woke?: string; leave?: string; focus?: string } = {};
  let index = 0;
  let correct = 0;
  let memoDone = false;
  const content = document.createElement('div');
  content.className = 'quiz';
  content.dataset.testid = 'quiz';
  const sheet = openSheet({ title: 'Wach-Quiz', content });

  const next = () => {
    index += 1;
    memoDone = false;
    if (index >= questions.length) void finish();
    else draw();
  };

  const draw = () => {
    const q = questions[index];
    const dots = questions.map((_, i) => `<i class="${i < index ? 'done' : i === index ? 'now' : ''}"></i>`).join('');
    let body = '';
    if (q.type === 'choice' && q.memorize && !memoDone) {
      body = `<p class="quiz-prompt">Merk dir diese vier Wörter:</p>
        <div class="memo-words" data-testid="quiz-memo">${q.memorize.map((w) => `<span>${escapeHtml(w)}</span>`).join('')}</div>
        <button type="button" class="btn btn-primary wide" data-memo data-testid="quiz-memo-ok">Gemerkt</button>`;
    } else if (q.type === 'choice') {
      body = `<p class="quiz-prompt" data-testid="quiz-prompt">${escapeHtml(q.prompt)}</p>
        <div class="quiz-options">${q.options.map((o, i) => `<button type="button" class="quiz-opt" data-opt="${i}" data-testid="quiz-option">${escapeHtml(o)}</button>`).join('')}</div>`;
    } else if (q.type === 'time') {
      body = `<p class="quiz-prompt" data-testid="quiz-prompt">${escapeHtml(q.prompt)}</p>
        ${q.hint ? `<p class="muted">${escapeHtml(q.hint)}</p>` : ''}
        <input type="time" class="quiz-time" value="${escapeHtml(q.value)}" data-testid="quiz-time" />
        <button type="button" class="btn btn-primary wide" data-next data-testid="quiz-next">Weiter</button>`;
    } else {
      body = `<p class="quiz-prompt" data-testid="quiz-prompt">${escapeHtml(q.prompt)}</p>
        <input class="quiz-text" maxlength="120" placeholder="${escapeHtml(q.placeholder)}" data-testid="quiz-text" />
        <button type="button" class="btn btn-primary wide" data-next data-testid="quiz-next">Weiter</button>`;
    }
    content.innerHTML = `<div class="quiz-dots">${dots}</div><p class="eyebrow quiz-label" data-testid="quiz-step">Frage ${index + 1} von ${questions.length} · ${escapeHtml(q.label)}</p>${body}`;
    content.querySelector<HTMLInputElement>('.quiz-text')?.focus();
  };

  content.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const q = questions[index];
    if (t.closest('[data-memo]')) {
      memoDone = true;
      draw();
      return;
    }
    const opt = t.closest<HTMLButtonElement>('[data-opt]');
    if (opt && q.type === 'choice' && !content.querySelector('.quiz-opt.picked')) {
      const i = Number(opt.dataset.opt);
      const ok = i === (q as ChoiceQuestion).answer;
      if (ok) correct += 1;
      opt.classList.add('picked', ok ? 'right' : 'wrong');
      content.querySelectorAll<HTMLButtonElement>('.quiz-opt')[(q as ChoiceQuestion).answer].classList.add('right');
      content.querySelectorAll<HTMLButtonElement>('.quiz-opt').forEach((b) => (b.disabled = true));
      const fb = document.createElement('p');
      fb.className = `quiz-feedback ${ok ? 'ok' : 'no'}`;
      fb.dataset.testid = 'quiz-feedback';
      fb.textContent = ok ? 'Richtig! Dein Kopf ist wach.' : `Fast – richtig ist „${(q as ChoiceQuestion).options[(q as ChoiceQuestion).answer]}“.`;
      content.append(fb);
      window.setTimeout(next, ok ? 750 : 1300);
      return;
    }
    if (t.closest('[data-next]')) {
      if (q.type === 'time') {
        const v = content.querySelector<HTMLInputElement>('.quiz-time')!.value;
        if (q.id === 'woke' && !v) return toast('Bitte eine Uhrzeit wählen.', 'error');
        answers[q.id] = v || undefined;
      } else if (q.type === 'text') answers.focus = content.querySelector<HTMLInputElement>('.quiz-text')!.value.trim() || undefined;
      next();
    }
  });
  content.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.target as HTMLElement).matches('input')) {
      e.preventDefault();
      content.querySelector<HTMLButtonElement>('[data-next]')?.click();
    }
  });

  const finish = async () => {
    const quizAt = nowHHMM();
    const target = targetWakeFor(config, today);
    let wokeAt = answers.woke ?? quizAt;
    if (wokeAt > quizAt && quizAt > '03:00') wokeAt = quizAt;
    const early = isEarly(wokeAt, target);
    const brain = questions.filter((q) => q.type === 'choice') as ChoiceQuestion[];
    const log = await saveWakeLog(today, { quizAt, wokeAt, target, early, score: correct, total: brain.length, focus: answers.focus, leaveAt: answers.leave, kinds: brain.map((q) => q.kind) });
    await markLinkedHabit('wake', today, early, config);
    void syncReminders();
    sheet.close();
    const nextLogs = { ...logs, [today]: log };
    await onDone();
    openResult(config, nextLogs, log, onDone);
  };
  draw();
}

function openResult(config: MorningConfig, logs: Record<string, WakeLog>, log: WakeLog, onDone: () => Promise<void>): void {
  const today = todayISO();
  const streak = wakeStreak(logs, today);
  const target = log.target ?? targetWakeFor(config, today);
  const delta = wakeDelta(log.wokeAt ?? log.quizAt!, target);
  const leave = leaveTimeFor(config.work, today);
  const work = workDayOf(config.work, today);
  const content = document.createElement('div');
  content.className = `quiz-result ${log.early ? 'early' : 'late'}`;
  content.dataset.testid = 'quiz-result';
  content.innerHTML = `
    <div class="result-badge"><span>${log.early ? '✓' : '…'}</span></div>
    <h3 data-testid="result-title">${log.early ? 'Pünktlich aufgestanden' : 'Heute etwas später'}</h3>
    <p class="muted" data-testid="result-delta">Aufgestanden ${escapeHtml(log.wokeAt ?? '')} · Ziel ${escapeHtml(target)} · ${escapeHtml(deltaText(delta))}</p>
    <div class="stat-grid three">
      <article class="stat-card"><p>Serie</p><strong data-testid="result-streak">${streak}</strong><span class="muted">${streak === 1 ? 'Tag' : 'Tage'} früh auf</span></article>
      <article class="stat-card"><p>Kopf</p><strong data-testid="result-score">${log.score ?? 0}/${log.total ?? 0}</strong><span class="muted">richtig</span></article>
      <article class="stat-card"><p>Quiz</p><strong>${escapeHtml(log.quizAt ?? '')}</strong><span class="muted">fertig um</span></article>
    </div>
    <p class="result-line" data-testid="result-motivation">${escapeHtml(motivation(Boolean(log.early), streak, today))}</p>
    ${
      work && leave
        ? `<p class="result-leave" data-testid="result-leave">🚶 Losgehen um <strong>${escapeHtml(leave)}</strong> – Arbeitsbeginn ${escapeHtml(work.start)}.${log.leaveAt && log.leaveAt !== leave ? ` Du hattest ${escapeHtml(log.leaveAt)} im Kopf.` : log.leaveAt ? ' Genau richtig im Kopf gehabt.' : ''}</p>`
        : ''
    }
    ${log.focus ? `<p class="result-focus">🎯 Fokus heute: <strong>${escapeHtml(log.focus)}</strong></p>` : ''}`;
  const footer = document.createElement('div');
  footer.className = 'row-actions';
  footer.innerHTML = `<button type="button" class="btn btn-primary" data-close data-testid="result-close">Los geht's</button>`;
  const sheet = openSheet({ title: 'Guten Morgen', content, footer });
  footer.querySelector('[data-close]')?.addEventListener('click', () => {
    sheet.close();
    void onDone();
  });
}

export function openWakeSettings(config: MorningConfig, onSave: () => Promise<void>): void {
  const g = config.wakeGoal;
  const w = config.work;
  const form = document.createElement('form');
  form.className = 'wake-form';
  form.innerHTML = `
    <h3 class="form-section">⏰ Früher aufstehen</h3>
    <div class="field-row">
      <label class="field"><span>Ziel-Aufstehzeit</span><input type="time" name="goal" value="${escapeHtml(g?.goal ?? '')}" data-testid="wake-goal" /></label>
      <label class="field"><span>Heute stehe ich auf um</span><input type="time" name="start" value="${escapeHtml(g?.gradual ? g.start : config.wakeTime)}" data-testid="wake-start" /></label>
    </div>
    <label class="check-field"><input type="checkbox" name="gradual" ${g?.gradual ? 'checked' : ''} data-testid="wake-gradual" /> Schrittweise: jede Woche früher</label>
    <div class="field-row" data-gradual>
      <label class="field"><span>Schritt</span><select name="step" data-testid="wake-step">${[5, 10, 15].map((n) => `<option value="${n}" ${(g?.stepMinutes ?? 10) === n ? 'selected' : ''}>${n} Minuten</option>`).join('')}</select></label>
      <label class="field"><span>Alle</span><select name="every" data-testid="wake-every">${[[7, 'Woche'], [3, '3 Tage'], [14, '2 Wochen']].map(([n, l]) => `<option value="${n}" ${(g?.everyDays ?? 7) === n ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    </div>
    <p class="hint-inline">Die Guten-Morgen-Mitteilung kommt zur Zielzeit des Tages und öffnet direkt das Wach-Quiz. Innerhalb von 10 Minuten zählt als pünktlich.</p>

    <h3 class="form-section">🕗 Pünktlich zur Arbeit</h3>
    <div class="work-table" data-testid="work-table">
      <span class="wt-head"></span><span class="wt-head">Beginn</span><span class="wt-head">Weg (Min.)</span>
      ${WEEKDAY_SHORT.map((d, i) => {
        const day = w?.days[String(i + 1)];
        return `<label class="wt-day"><input type="checkbox" name="day${i + 1}" ${day ? 'checked' : ''} data-testid="work-day-${i + 1}" /> ${d}</label>
          <input type="time" name="start${i + 1}" value="${escapeHtml(day?.start ?? '08:00')}" data-testid="work-start-${i + 1}" />
          <input type="number" min="0" max="300" inputmode="numeric" name="travel${i + 1}" value="${day?.travel ?? 25}" data-testid="work-travel-${i + 1}" />`;
      }).join('')}
    </div>
    <button type="button" class="text-btn left" data-copy data-testid="work-copy">Montag für Mo–Fr übernehmen</button>
    <label class="check-field"><input type="checkbox" name="leaveRemind" ${w?.leaveRemind ?? true ? 'checked' : ''} data-testid="work-remind" /> Mitteilung „Zeit loszugehen“</label>
    <div class="field-row">
      <label class="field"><span>Minuten vorher</span><input type="number" min="0" max="120" name="lead" value="${w?.leaveLead ?? 10}" data-testid="work-lead" /></label>
      <label class="field"><span>Abends fragen „Warst du pünktlich?“</span><input type="time" name="checkin" value="${escapeHtml(w ? (w.checkinTime ?? '') : '18:30')}" data-testid="work-checkin" /></label>
    </div>
    <label class="check-field"><input type="checkbox" name="link" ${config.linkHabits ?? true ? 'checked' : ''} data-testid="wake-link" /> Als Gewohnheiten „Früh aufstehen“ und „Pünktlich bei der Arbeit“ führen</label>
    <label class="check-field"><input type="checkbox" name="dailyQuiz" ${config.dailyQuiz ? 'checked' : ''} data-testid="wake-daily-quiz" /> Tägliches Wach-Quiz (3 kurze Fragen zum Wachwerden)</label>`;
  const syncGradual = () => {
    const on = (form.querySelector('[name="gradual"]') as HTMLInputElement).checked;
    form.querySelectorAll<HTMLElement>('[data-gradual]').forEach((el) => (el.hidden = !on));
  };
  form.querySelector('[name="gradual"]')?.addEventListener('change', syncGradual);
  syncGradual();
  form.querySelector('[data-copy]')?.addEventListener('click', () => {
    const v = (n: string) => form.querySelector<HTMLInputElement>(`[name="${n}"]`)!;
    for (let i = 1; i <= 5; i += 1) {
      v(`day${i}`).checked = true;
      v(`start${i}`).value = v('start1').value;
      v(`travel${i}`).value = v('travel1').value;
    }
  });
  const footer = document.createElement('div');
  footer.className = 'row-actions';
  footer.innerHTML = `<button type="button" class="btn btn-ghost" data-cancel>Abbrechen</button><button type="button" class="btn btn-primary" data-save data-testid="wake-save">Speichern</button>`;
  const sheet = openSheet({ title: 'Aufstehen & Arbeit', content: form, footer });
  footer.querySelector('[data-cancel]')?.addEventListener('click', () => sheet.close());
  footer.querySelector('[data-save]')?.addEventListener('click', async () => {
    const data = new FormData(form);
    const s = (k: string) => String(data.get(k) ?? '');
    const today = todayISO();
    let wakeGoal: WakeGoal | undefined;
    if (s('goal')) {
      const gradual = data.get('gradual') === 'on';
      const start = s('start') || config.wakeTime;
      if (gradual && start <= s('goal')) return toast('Für den Stufenplan muss die heutige Zeit später als das Ziel sein.', 'error');
      const step = Number(s('step')) || 10;
      const every = Number(s('every')) || 7;
      const same = g && g.goal === s('goal') && g.start === start && g.gradual === gradual && g.stepMinutes === step && g.everyDays === every;
      wakeGoal = { goal: s('goal'), gradual, start, startDate: same ? g!.startDate : today, stepMinutes: step, everyDays: every };
    }
    const days: Record<string, WorkDay> = {};
    for (let i = 1; i <= 7; i += 1) {
      if (data.get(`day${i}`) !== 'on') continue;
      const start = s(`start${i}`);
      const travel = Math.round(Number(s(`travel${i}`)));
      if (!start || !(travel >= 0)) return toast(`Bitte Beginn und Weg für ${WEEKDAY_SHORT[i - 1]} angeben.`, 'error');
      const buffer = w?.days[String(i)]?.buffer;
      days[String(i)] = buffer ? { start, travel, buffer } : { start, travel };
    }
    const work: WorkConfig | undefined = Object.keys(days).length
      ? { days, leaveRemind: data.get('leaveRemind') === 'on', leaveLead: Math.max(0, Math.round(Number(s('lead')) || 0)), checkinTime: s('checkin') || undefined }
      : undefined;
    const linkHabits = data.get('link') === 'on';
    const next = await saveMorningConfig({ ...config, wakeGoal, work, linkHabits, dailyQuiz: data.get('dailyQuiz') === 'on', wakeTime: wakeGoal && !wakeGoal.gradual ? wakeGoal.goal : config.wakeTime });
    if (linkHabits) await ensureLinkedHabits(next);
    sheet.close();
    toast('Gespeichert. Nova plant Aufstehen und Losgehen ein.', 'success');
    void syncReminders();
    await onSave();
  });
}

function grid(cells: DayCell[], testid: string): string {
  return `<div class="heatmap wake-heat" data-testid="${testid}">${WEEKDAY_SHORT.map((d) => `<span class="heat-wd">${d}</span>`).join('')}${cells
    .map((c) => `<span class="heat-cell ${c.state === 'on' ? 'on' : c.state === 'miss' ? 'miss' : c.state === 'off' ? 'off' : c.state === 'future' ? 'out-future' : ''}${c.date === todayISO() ? ' today' : ''}" title="${c.date}${c.label ? ` · ${escapeHtml(c.label)}` : ''}">${Number(c.date.slice(8))}</span>`)
    .join('')}</div>`;
}

export function openWakeStats(config: MorningConfig, logs: Record<string, WakeLog>): void {
  const today = todayISO();
  const s = wakeStats(logs, config.work, today);
  const days = weekGrid(today, 4);
  const pct = (x: { hit: number; of: number }) => (x.of ? `${Math.round((x.hit / x.of) * 100)} %` : '–');
  const recent = Object.values(logs).filter((l) => l.date <= today).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);
  const content = document.createElement('div');
  content.className = 'habit-detail wake-stats';
  content.dataset.testid = 'wake-stats';
  content.innerHTML = `
    <div class="stat-grid four">
      <article class="stat-card"><p>Früh auf</p><strong data-testid="stats-wake-streak">${s.wakeStreak}</strong><span class="muted">Tage Serie</span></article>
      <article class="stat-card"><p>Quote</p><strong>${pct(s.early)}</strong><span class="muted">14 Tage</span></article>
      <article class="stat-card"><p>Pünktlich</p><strong data-testid="stats-work-streak">${s.punctualStreak}</strong><span class="muted">Arbeitstage</span></article>
      <article class="stat-card"><p>Quote</p><strong>${pct(s.punctual)}</strong><span class="muted">14 Tage</span></article>
    </div>
    <h3 class="form-section">⏰ Früh aufgestanden – 4 Wochen</h3>
    ${grid(days.map((d) => wakeCell(logs, d, today)), 'stats-wake-grid')}
    ${config.work ? `<h3 class="form-section">🕗 Pünktlich bei der Arbeit – 4 Wochen</h3>${grid(days.map((d) => workCell(logs, config.work, d, today)), 'stats-work-grid')}` : ''}
    <p class="legend"><i class="on"></i> geschafft <i class="miss"></i> verpasst <i></i> kein Eintrag</p>
    ${
      recent.length
        ? `<ul class="card-list compact">${recent
            .map(
              (l) => `<li class="item-row static"><span class="event-time">${escapeHtml(formatDateHuman(l.date))}</span><span class="item-copy"><span class="item-meta">${l.wokeAt ? `Auf ${escapeHtml(l.wokeAt)} (Ziel ${escapeHtml(l.target ?? '')})` : 'kein Quiz'}${l.punctual ? ` · Arbeit: ${punctualityLabel(l.punctual)}` : ''}${l.focus ? ` · ${escapeHtml(l.focus)}` : ''}</span></span><span>${l.early === undefined ? '' : l.early ? '✓' : '–'}</span></li>`,
            )
            .join('')}</ul>`
        : ''
    }`;
  openSheet({ title: 'Aufstehen & Pünktlichkeit', content });
}
