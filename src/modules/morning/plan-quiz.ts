/** Morgenplan-Quiz: one-time questionnaire → perfect morning plan (route #/morgenplan). */
import { todayISO } from '../../shared/dates';
import { escapeHtml } from '../../shared/escape';
import { icons } from '../../shared/icons';
import { toast } from '../../shared/toast';
import { syncReminders } from '../../shared/reminders';
import { createId } from '../../shared/id';
import { navigate, routeParams } from '../../router';
import { WEEKDAY_SHORT } from '../habits/logic';
import { ACTIVITIES, applyPlan, computePlan, defaultAnswers, refinePrompt, travelMinutes, WAKE_TYPES, type MorningPlan, type PlanAnswers, type WakeType } from './planner';
import { ensureLinkedHabits, getMorningConfig, getSavedPlan, saveMorningConfig, savePlan } from './repo';
import { fromMin, toMin } from './wake';

const DRAFT_KEY = 'nova.planDraft';
const AUTO_SEND_KEY = 'nova.chatAutoSend';
const STEPS = ['arbeit', 'weg', 'schlaf', 'aufwachen', 'aktivitaeten', 'prioritaeten'] as const;
const WEEKDAY_LONG = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];

interface Draft {
  answers: PlanAnswers;
  step: number;
  compact: boolean;
}

const chip = (label: string, active: boolean, attrs: string) => `<button type="button" class="chip${active ? ' active' : ''}" ${attrs}>${label}</button>`;

export async function renderPlanQuiz(root: HTMLElement): Promise<() => void> {
  const saved = await getSavedPlan();
  const stored = sessionStorage.getItem(DRAFT_KEY);
  let draft: Draft = stored ? (JSON.parse(stored) as Draft) : { answers: saved?.answers ?? defaultAnswers(), step: 0, compact: saved?.compact ?? false };
  if (routeParams().get('neu')) draft = { answers: saved?.answers ?? defaultAnswers(), step: 0, compact: false };
  const a = () => draft.answers;
  const persist = () => sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));

  const view = () => {
    persist();
    if (draft.step >= STEPS.length) return renderResult();
    const step = STEPS[draft.step];
    const pct = Math.round(((draft.step + 1) / (STEPS.length + 1)) * 100);
    const q = question(step);
    root.innerHTML = `
      <section class="page plan-quiz" data-testid="plan-quiz" data-step="${step}">
        <header class="pq-top">
          <button type="button" class="icon-btn ghost" data-back aria-label="Zurück" data-testid="pq-back">${icons.chevronLeft}</button>
          <div class="pq-progress" aria-hidden="true"><i style="width:${pct}%"></i></div>
          <span class="pq-count" data-testid="pq-count">${draft.step + 1}/${STEPS.length}</span>
        </header>
        <p class="eyebrow">Morgenplan-Quiz</p>
        <h1 class="pq-q" data-testid="pq-question">${q.title}</h1>
        ${q.hint ? `<p class="lede pq-hint">${q.hint}</p>` : ''}
        <div class="pq-body">${q.body}</div>
      </section>`;
    // fixed bar lives outside the animated .view (a transformed ancestor would break position: fixed)
    bar.innerHTML = `<button type="button" class="btn btn-primary wide pq-next" data-next data-testid="pq-next">${draft.step === STEPS.length - 1 ? `${icons.sparkle} Plan erstellen` : 'Weiter'}</button>`;
    bar.hidden = false;
  };
  const bar = document.createElement('div');
  bar.className = 'pq-footer';
  bar.hidden = true;
  document.body.append(bar);

  function question(step: (typeof STEPS)[number]): { title: string; hint?: string; body: string } {
    const x = a();
    switch (step) {
      case 'arbeit':
        return {
          title: 'Wann musst du bei der Arbeit sein?',
          hint: 'An welchen Tagen arbeitest du – und ab wann?',
          body: `
            <div class="chips pq-days">${WEEKDAY_SHORT.map((d, i) => chip(d, x.days.includes(i + 1), `data-day="${i + 1}" data-testid="pq-day-${i + 1}"`)).join('')}</div>
            <div class="segmented"><button type="button" class="${x.sameStart ? 'active' : ''}" data-same="1" data-testid="pq-same">Jeden Tag gleich</button><button type="button" class="${x.sameStart ? '' : 'active'}" data-same="0" data-testid="pq-diff">Unterschiedlich</button></div>
            ${
              x.sameStart
                ? `<label class="pq-time-wrap"><input type="time" class="pq-time" value="${escapeHtml(x.arrive)}" data-field="arrive" data-testid="pq-arrive" /><span>Arbeitsbeginn</span></label>`
                : `<div class="pq-perday">${[...x.days]
                    .sort()
                    .map((d) => `<label class="pq-perday-row"><span>${WEEKDAY_LONG[d - 1]}</span><input type="time" value="${escapeHtml(x.arriveByDay[String(d)] ?? x.arrive)}" data-arrive-day="${d}" data-testid="pq-arrive-${d}" /></label>`)
                    .join('')}</div>`
            }`,
        };
      case 'weg': {
        const travel = travelMinutes(x);
        const arrive = x.sameStart ? x.arrive : x.arriveByDay[String([...x.days].sort()[0])] ?? x.arrive;
        const derived =
          x.travelMode === 'dauer'
            ? `→ Losfahren um <strong>${fromMin(toMin(arrive) - travel - x.buffer)}</strong> (Arbeitsbeginn ${arrive}${x.buffer ? `, ${x.buffer} Min. Puffer` : ''})`
            : `→ <strong>${travel} Min.</strong> Fahrzeit${x.buffer ? ` + ${x.buffer} Min. Puffer` : ''} bis ${arrive}`;
        return {
          title: 'Wie lange brauchst du zur Arbeit?',
          hint: 'Kennst du eher die Fahrzeit oder die Uhrzeit, zu der du losmusst?',
          body: `
            <div class="segmented"><button type="button" class="${x.travelMode === 'dauer' ? 'active' : ''}" data-mode="dauer" data-testid="pq-mode-dauer">Fahrzeit kenne ich</button><button type="button" class="${x.travelMode === 'abfahrt' ? 'active' : ''}" data-mode="abfahrt" data-testid="pq-mode-abfahrt">Abfahrtszeit kenne ich</button></div>
            ${
              x.travelMode === 'dauer'
                ? `<div class="chips wrap">${[10, 15, 20, 25, 30, 40, 45, 60].map((n) => chip(`${n} Min.`, x.travel === n, `data-travel="${n}" data-testid="pq-travel-${n}"`)).join('')}</div>
                   <label class="field"><span>Oder genau (Minuten)</span><input type="number" min="0" max="240" inputmode="numeric" value="${x.travel}" data-field="travel" data-testid="pq-travel" /></label>`
                : `<label class="pq-time-wrap"><input type="time" class="pq-time" value="${escapeHtml(x.departure)}" data-field="departure" data-testid="pq-departure" /><span>Ich fahre los um</span></label>`
            }
            <p class="pq-sub">Puffer für Verkehr, Parken oder Bahn</p>
            <div class="chips wrap">${[0, 5, 10, 15, 20].map((n) => chip(n ? `${n} Min.` : 'Kein Puffer', x.buffer === n, `data-buffer="${n}" data-testid="pq-buffer-${n}"`)).join('')}</div>
            <p class="pq-derived" data-testid="pq-derived">${derived}</p>`,
        };
      }
      case 'schlaf':
        return {
          title: 'Wie viel Schlaf brauchst du?',
          hint: 'Damit deine Schlafenszeit zum Aufstehen passt.',
          body: `
            <div class="chips wrap">${[6, 6.5, 7, 7.5, 8, 8.5, 9].map((h) => chip(`${String(h).replace('.', ',')} Std.`, x.sleepHours === h, `data-sleep="${h}" data-testid="pq-sleep-${String(h).replace('.', '')}"`)).join('')}</div>
            <label class="pq-time-wrap"><input type="time" class="pq-time" value="${escapeHtml(x.bedtime)}" data-field="bedtime" data-testid="pq-bedtime" /><span>Meistens im Bett um</span></label>`,
        };
      case 'aufwachen':
        return {
          title: 'Wie schnell kommst du morgens in Gang?',
          body: `<div class="pq-options">${(Object.keys(WAKE_TYPES) as WakeType[])
            .map(
              (k) => `<button type="button" class="pq-option${x.wakeType === k ? ' active' : ''}" data-wake="${k}" data-testid="pq-wake-${k}">
                <span class="pq-option-emoji">${k === 'schnell' ? '⚡' : k === 'normal' ? '🌤️' : '😴'}</span>
                <span><strong>${WAKE_TYPES[k].label}</strong><small>${WAKE_TYPES[k].hint} · ${WAKE_TYPES[k].minutes} Min.</small></span></button>`,
            )
            .join('')}</div>`,
        };
      case 'aktivitaeten': {
        const customs = x.activities.filter((p) => !ACTIVITIES.some((d) => d.id === p.id));
        const all = [...ACTIVITIES.map((d) => ({ id: d.id, title: d.title, emoji: d.emoji, minutes: d.minutes })), ...customs];
        const total = x.activities.reduce((s, p) => s + p.minutes, 0);
        return {
          title: 'Was willst du vor dem Losfahren machen?',
          hint: 'Tippe an, was dazugehört. Die Minuten kannst du anpassen.',
          body: `
            <ul class="pq-acts" data-testid="pq-acts">${all
              .map((d) => {
                const sel = x.activities.find((p) => p.id === d.id);
                return `<li class="pq-act${sel ? ' on' : ''}">
                  <button type="button" class="pq-act-main" data-act="${d.id}" data-testid="pq-act-${d.id}" aria-pressed="${Boolean(sel)}"><span class="pq-act-emoji">${d.emoji}</span><span>${escapeHtml(d.title)}</span><span class="check${sel ? ' checked' : ''}">${sel ? '✓' : ''}</span></button>
                  <span class="pq-stepper"><button type="button" data-dec="${d.id}" aria-label="Kürzer" data-testid="pq-dec-${d.id}">−</button><b data-testid="pq-min-${d.id}">${sel?.minutes ?? d.minutes}</b><small>Min.</small><button type="button" data-inc="${d.id}" aria-label="Länger" data-testid="pq-inc-${d.id}">+</button></span>
                </li>`;
              })
              .join('')}</ul>
            <form class="pq-custom" data-custom>
              <input name="title" placeholder="Eigener Punkt, z. B. Pflanzen gießen" maxlength="40" data-testid="pq-custom-title" />
              <input name="minutes" type="number" min="1" max="120" value="10" inputmode="numeric" aria-label="Minuten" data-testid="pq-custom-min" />
              <button type="submit" class="btn btn-secondary" data-testid="pq-custom-add">${icons.plus}</button>
            </form>
            <p class="pq-derived" data-testid="pq-total">Zusammen ${total} Min. vor dem Losfahren</p>`,
        };
      }
      case 'prioritaeten':
        return {
          title: 'Was ist ein Muss – was wäre schön?',
          hint: 'Wenn der Morgen zu voll wird, kürzt Nova zuerst die Kann-Sachen.',
          body: `
            <ul class="pq-prio" data-testid="pq-prio">${x.activities
              .map(
                (p) => `<li><span>${p.emoji} ${escapeHtml(p.title)} <small>${p.minutes} Min.</small></span>
                <span class="segmented mini"><button type="button" class="${p.must ? 'active' : ''}" data-must="${p.id}|1" data-testid="pq-must-${p.id}">Muss</button><button type="button" class="${p.must ? '' : 'active'}" data-must="${p.id}|0" data-testid="pq-nice-${p.id}">Kann</button></span></li>`,
              )
              .join('')}</ul>
            <p class="pq-sub">Puffer oder Zeit nur für dich, bevor du losfährst?</p>
            <div class="chips wrap">${[0, 10, 15, 20].map((n) => chip(n ? `${n} Min.` : 'Brauche ich nicht', x.meTime === n, `data-me="${n}" data-testid="pq-me-${n}"`)).join('')}</div>`,
        };
    }
  }

  function renderResult(): void {
    bar.hidden = true;
    bar.innerHTML = '';
    const plan = computePlan(a(), { compact: draft.compact });
    const base = draft.compact ? computePlan(a()) : plan;
    root.innerHTML = `
      <section class="page plan-result" data-testid="plan-result">
        <header class="pq-top">
          <button type="button" class="icon-btn ghost" data-back aria-label="Zurück" data-testid="pq-back">${icons.chevronLeft}</button>
          <div class="pq-progress done" aria-hidden="true"><i style="width:100%"></i></div>
          <span class="pq-count">✓</span>
        </header>
        <div class="pr-hero">
          <span class="morning-sun big" aria-hidden="true"></span>
          <p class="eyebrow">Dein perfekter Morgen</p>
          <h1>Aufstehen um <span data-testid="plan-wake">${plan.wake}</span></h1>
          <p class="lede">${plan.totalMinutes} Min. für dich bis zum Losfahren · ins Bett um <strong data-testid="plan-bedtime">${plan.bedtime}</strong> für ${String(a().sleepHours).replace('.', ',')} Std. Schlaf</p>
        </div>
        <ol class="timeline" data-testid="plan-timeline">
          <li class="tl wake"><span class="tl-time">${plan.wake}</span><span class="tl-dot"></span><span class="tl-copy"><strong>⏰ Wecker</strong></span></li>
          ${plan.steps
            .map(
              (s) => `<li class="tl${s.must ? '' : ' nice'}" data-testid="plan-step"><span class="tl-time">${s.start}</span><span class="tl-dot"></span><span class="tl-copy"><strong>${s.emoji} ${escapeHtml(s.title)}</strong><small>${s.minutes} Min.${s.must ? '' : ' · kann'}</small></span></li>`,
            )
            .join('')}
          <li class="tl leave"><span class="tl-time" data-testid="plan-leave">${plan.leave}</span><span class="tl-dot"></span><span class="tl-copy"><strong>🚗 Losfahren</strong><small>${plan.travel} Min. Weg${plan.buffer ? ` + ${plan.buffer} Min. Puffer` : ''}</small></span></li>
          <li class="tl arrive"><span class="tl-time" data-testid="plan-arrival">${plan.arrival}</span><span class="tl-dot"></span><span class="tl-copy"><strong>🏢 Ankunft</strong><small>Arbeitsbeginn ${plan.workStart}</small></span></li>
        </ol>
        ${
          plan.perDay.some((d) => d.wake !== plan.wake)
            ? `<div class="pr-perday" data-testid="plan-perday"><p class="dash-label">Andere Tage</p>${plan.perDay
                .map((d) => `<span><b>${WEEKDAY_SHORT[d.day - 1]}</b> auf ${d.wake} · los ${d.leave}</span>`)
                .join('')}</div>`
            : ''
        }
        ${
          base.hints.length || draft.compact
            ? `<div class="hint-card pr-hints" data-testid="plan-hints">${base.hints.map((h) => `<p>${escapeHtml(h)}</p>`).join('')}
                ${base.packed || draft.compact ? `<button type="button" class="btn btn-secondary" data-compact data-testid="plan-compact">${draft.compact ? 'Doch alle Punkte einplanen' : `Ohne Kann-Sachen: auf um ${base.compactWake}`}</button>` : ''}</div>`
            : ''
        }
        <div class="pr-actions">
          <button type="button" class="btn btn-primary wide" data-apply data-testid="plan-apply">Plan übernehmen</button>
          <button type="button" class="btn btn-secondary wide" data-refine data-testid="plan-refine">${icons.sparkle} Mit Nova verfeinern</button>
          <button type="button" class="text-btn" data-edit data-testid="plan-edit">Antworten ändern</button>
        </div>
        <p class="hint-inline">„Plan übernehmen“ setzt deine Morgenroutine, Weckzeit + Mitteilung, Arbeitsbeginn, Fahrzeit + „Zeit loszugehen“ und dein Ziel „Früher aufstehen“.</p>
      </section>`;
  }

  const apply = async (plan: MorningPlan) => {
    const config = await saveMorningConfig(applyPlan(await getMorningConfig(), plan, todayISO()));
    await savePlan({ answers: a(), compact: draft.compact, appliedAt: new Date().toISOString() });
    if (config.linkHabits) await ensureLinkedHabits(config);
    sessionStorage.removeItem(DRAFT_KEY);
    void syncReminders();
    toast(`Plan übernommen – Wecker ${config.wakeTime} Uhr, losfahren ${plan.leave} Uhr.`, 'success');
    navigate('morning');
  };

  const onClick = (e: Event) => {
    const t = e.target as HTMLElement;
    const btn = t.closest<HTMLElement>('button');
    if (!btn) return;
    const x = a();
    const d = btn.dataset;
    if ('back' in d) {
      if (draft.step === 0) {
        sessionStorage.removeItem(DRAFT_KEY);
        navigate('morning');
        return;
      }
      draft.step -= 1;
    } else if ('next' in d) {
      if (STEPS[draft.step] === 'arbeit' && !x.days.length) return toast('Bitte mindestens einen Arbeitstag wählen.', 'error');
      if (STEPS[draft.step] === 'weg' && x.travelMode === 'abfahrt' && travelMinutes(x) <= 0) return toast('Die Abfahrt liegt nach dem Arbeitsbeginn – bitte prüfen.', 'error');
      if (STEPS[draft.step] === 'aktivitaeten' && !x.activities.length) toast('Nichts ausgewählt – Nova plant nur das Aufwachen ein.', 'info');
      draft.step += 1;
    } else if (d.day) {
      const n = Number(d.day);
      x.days = x.days.includes(n) ? x.days.filter((v) => v !== n) : [...x.days, n].sort();
    } else if (d.same) x.sameStart = d.same === '1';
    else if (d.mode) {
      // derive the other value so switching keeps the same plan
      const arrive = x.sameStart ? x.arrive : x.arriveByDay[String(x.days[0])] ?? x.arrive;
      if (d.mode === 'abfahrt' && x.travelMode === 'dauer') x.departure = fromMin(toMin(arrive) - x.travel - x.buffer);
      if (d.mode === 'dauer' && x.travelMode === 'abfahrt') x.travel = travelMinutes(x);
      x.travelMode = d.mode as PlanAnswers['travelMode'];
    } else if (d.travel) x.travel = Number(d.travel);
    else if (d.buffer) x.buffer = Number(d.buffer);
    else if (d.sleep) x.sleepHours = Number(d.sleep);
    else if (d.wake) x.wakeType = d.wake as WakeType;
    else if (d.act) {
      const def = ACTIVITIES.find((v) => v.id === d.act);
      const has = x.activities.find((p) => p.id === d.act);
      if (has) x.activities = x.activities.filter((p) => p.id !== d.act);
      else if (def) x.activities.push({ id: def.id, title: def.title, emoji: def.emoji, minutes: def.minutes, must: Boolean(def.must) });
    } else if (d.inc || d.dec) {
      const id = (d.inc ?? d.dec)!;
      let p = x.activities.find((v) => v.id === id);
      if (!p) {
        const def = ACTIVITIES.find((v) => v.id === id);
        if (!def) return;
        p = { id: def.id, title: def.title, emoji: def.emoji, minutes: def.minutes, must: Boolean(def.must) };
        x.activities.push(p);
      }
      p.minutes = Math.max(5, Math.min(120, p.minutes + (d.inc ? 5 : -5)));
    } else if (d.must) {
      const [id, v] = d.must.split('|');
      const p = x.activities.find((q) => q.id === id);
      if (p) p.must = v === '1';
    } else if (d.me) x.meTime = Number(d.me);
    else if ('compact' in d) draft.compact = !draft.compact;
    else if ('edit' in d) draft.step = 0;
    else if ('apply' in d) return void apply(computePlan(x, { compact: draft.compact }));
    else if ('refine' in d) {
      sessionStorage.setItem(AUTO_SEND_KEY, refinePrompt(x, computePlan(x, { compact: draft.compact })));
      persist();
      navigate('chat');
      return;
    } else return;
    view();
    if ('next' in d || 'back' in d || 'edit' in d) window.scrollTo({ top: 0 });
  };
  root.addEventListener('click', onClick);
  bar.addEventListener('click', onClick);

  root.addEventListener('change', (e) => {
    const t = e.target as HTMLInputElement;
    const x = a();
    if (t.dataset.field === 'arrive' && t.value) x.arrive = t.value;
    else if (t.dataset.field === 'departure' && t.value) x.departure = t.value;
    else if (t.dataset.field === 'bedtime' && t.value) x.bedtime = t.value;
    else if (t.dataset.field === 'travel') x.travel = Math.max(0, Math.min(240, Math.round(Number(t.value) || 0)));
    else if (t.dataset.arriveDay && t.value) x.arriveByDay[t.dataset.arriveDay] = t.value;
    else return;
    view();
  });

  root.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target as HTMLFormElement;
    const data = new FormData(f);
    const title = String(data.get('title') ?? '').trim();
    const minutes = Math.max(1, Math.min(120, Math.round(Number(data.get('minutes')) || 10)));
    if (!title) return;
    a().activities.push({ id: `eigen-${createId().slice(0, 8)}`, title, emoji: '⭐', minutes, must: false, custom: true });
    view();
  });

  view();
  return () => {
    bar.remove();
    root.innerHTML = '';
  };
}
