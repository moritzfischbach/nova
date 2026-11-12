/** Einstellungen → Backup & Sync (E2E-verschlüsselt). */
import { escapeHtml } from '../../shared/escape';
import { icons } from '../../shared/icons';
import { openSheet } from '../../shared/sheet';
import { toast } from '../../shared/toast';
import { openPairingSheet } from '../../shared/pairing';
import {
  backupNow,
  dirtySince,
  disableBackup,
  exportBackupFile,
  fetchVersion,
  getBackupState,
  getServerBackupStatus,
  listVersions,
  onBackupStatus,
  readBackupFile,
  restoreEnvelope,
  setAutoBackup,
  setupBackup,
  type BackupVersion,
} from '../../shared/backup/backup';
import { generateRecoveryKey, WrongSecretError, type BackupEnvelope } from '../../shared/backup/crypto';
import { summarizeCounts } from '../../shared/backup/snapshot';

export const MIN_PASSWORD = 10;

export function formatWhen(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  const day = (x: Date) => `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`;
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  if (day(d) === day(now)) return `heute, ${time}`;
  if (day(d) === day(y)) return `gestern, ${time}`;
  return `${d.toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'numeric', ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) })}, ${time}`;
}

const kb = (chars: number) => (chars * 0.75 < 1024 * 1024 ? `${Math.max(1, Math.round((chars * 0.75) / 1024))} KB` : `${((chars * 0.75) / 1024 / 1024).toFixed(1).replace('.', ',')} MB`);

export async function renderBackupSettings(host: HTMLElement, opts: { paired?: boolean } = {}): Promise<() => void> {
  let disposed = false;
  const draw = async () => {
    if (disposed) return;
    const [state, server] = await Promise.all([getBackupState(), getServerBackupStatus()]);
    let found: BackupVersion | undefined;
    if (!state.enabled && server.configured && opts.paired !== false) found = (await listVersions().catch(() => []))[0];
    const dirty = dirtySince();
    const where =
      server.storage === 'github'
        ? `Verschlüsselt im privaten GitHub-Speicher deines Nova-Servers · die letzten ${server.keep ?? 10} Versionen`
        : server.storage
          ? `Verschlüsselt auf dem Nova-Server · die letzten ${server.keep ?? 10} Versionen`
          : '';
    host.innerHTML = `
      <section class="settings-group backup-group" data-testid="backup-settings">
        <div class="backup-head"><span class="backup-icon" aria-hidden="true">${icons.shield}</span><div><h2>Backup &amp; Sync</h2><p class="muted small">Ende-zu-Ende-verschlüsselt – nur du kannst es öffnen.</p></div></div>
        ${
          state.enabled
            ? `<div class="backup-status${state.lastError ? ' warn' : state.lastBackupAt ? ' ok' : ''}" data-testid="backup-status">
                <strong>${state.lastBackupAt ? `Zuletzt gesichert: ${escapeHtml(formatWhen(state.lastBackupAt))}` : 'Noch nicht gesichert'}</strong>
                <span>${state.versions ? `${state.versions} ${state.versions === 1 ? 'Version' : 'Versionen'} · ` : ''}${state.auto ? 'automatisch nach Änderungen und täglich' : 'nur manuell'}${dirty && state.auto && !state.lastError ? ' · Änderungen werden gleich gesichert' : ''}</span>
                ${state.lastError ? `<span class="backup-error" data-testid="backup-error">${escapeHtml(state.lastError)}</span>` : ''}
              </div>`
            : `<p class="muted">Deine Daten liegen bisher nur auf diesem Gerät${'' /* Safari and home-screen app have separate storage */}. Mit einem Backup sind Aufgaben, Termine, Finanzen, Ziele, Gewohnheiten, Chats und dein Morgenplan sicher – auch wenn das iPhone verloren geht oder Nova gelöscht wird.</p>`
        }
        ${
          found
            ? `<div class="hint-card" data-testid="backup-found"><p><strong>Backup gefunden</strong></p><p>Vom ${escapeHtml(formatWhen(found.createdAt))}${found.device ? ` · ${escapeHtml(found.device)}` : ''}. Hol deine Daten auf dieses Gerät.</p>
               <button type="button" class="btn btn-primary" data-restore data-testid="backup-found-restore">Jetzt wiederherstellen</button></div>`
            : ''
        }
        ${opts.paired === false && server.configured ? `<p class="bot-status warn" data-testid="backup-pair-hint">Für das Online-Backup dieses Gerät erst mit dem Nova-Server koppeln. Export und Import gehen auch ohne.</p><button type="button" class="btn btn-secondary" data-pair>Gerät koppeln</button>` : ''}
        ${!server.reachable ? '<p class="bot-status warn">Nova-Server nicht erreichbar – Export/Import als Datei geht trotzdem.</p>' : !server.configured ? '<p class="bot-status warn">Online-Backup ist auf dem Server nicht eingerichtet – Export/Import als Datei geht trotzdem.</p>' : ''}
        <div class="backup-actions">
          ${
            state.enabled
              ? `<button type="button" class="btn btn-primary" data-now data-testid="backup-now">Jetzt sichern</button>`
              : `<button type="button" class="btn btn-primary" data-setup data-testid="backup-setup">Backup einrichten</button>`
          }
          <button type="button" class="btn btn-secondary" data-restore data-testid="backup-restore">Aus Backup wiederherstellen</button>
        </div>
        <div class="backup-file-actions">
          <button type="button" class="btn btn-ghost" data-export data-testid="backup-export">Backup-Datei exportieren</button>
          <button type="button" class="btn btn-ghost" data-import data-testid="backup-import">Datei importieren</button>
          <input type="file" accept=".nova,application/json,application/octet-stream" hidden data-file data-testid="backup-file" />
        </div>
        ${
          state.enabled
            ? `<label class="check-field"><input type="checkbox" data-auto data-testid="backup-auto" ${state.auto ? 'checked' : ''} /> Automatisch sichern</label>
               <div class="backup-links"><button type="button" class="text-btn" data-setup data-testid="backup-change">Passwort ändern</button><button type="button" class="text-btn muted-btn" data-off data-testid="backup-off">Ausschalten</button></div>`
            : ''
        }
        ${where ? `<p class="muted small" data-testid="backup-where">${escapeHtml(where)}. Der Server sieht nie deine Daten oder dein Passwort.</p>` : ''}
      </section>`;
  };

  const onClick = async (e: Event) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('button');
    if (!b || !host.contains(b)) return;
    const d = b.dataset;
    if ('setup' in d) openSetupSheet(() => void draw());
    else if ('pair' in d) openPairingSheet(() => location.reload());
    else if ('restore' in d) openRestoreSheet({ onDone: () => void draw() });
    else if ('import' in d) (host.querySelector('[data-file]') as HTMLInputElement).click();
    else if ('now' in d) {
      b.setAttribute('disabled', '');
      b.innerHTML = 'Sichere …';
      try {
        await backupNow();
        toast('Backup gesichert.', 'success');
      } catch (err) {
        toast(err instanceof Error ? err.message : 'Backup fehlgeschlagen.', 'error');
      }
      await draw();
    } else if ('export' in d) {
      const s = await getBackupState();
      if (!s.params) {
        toast('Lege zuerst ein Backup-Passwort fest – damit wird auch die Datei verschlüsselt.', 'info');
        openSetupSheet(() => void draw());
        return;
      }
      try {
        const how = await exportBackupFile();
        toast(how === 'shared' ? 'Backup-Datei geteilt.' : 'Backup-Datei gespeichert (verschlüsselt).', 'success');
      } catch (err) {
        toast(err instanceof Error ? err.message : 'Export fehlgeschlagen.', 'error');
      }
    } else if ('off' in d) {
      if (b.dataset.confirm !== '1') {
        b.dataset.confirm = '1';
        b.textContent = 'Wirklich ausschalten?';
        return;
      }
      await disableBackup();
      toast('Backup auf diesem Gerät ausgeschaltet. Vorhandene Versionen bleiben erhalten.', 'info');
      await draw();
    }
  };
  const onChange = async (e: Event) => {
    const t = e.target as HTMLInputElement;
    if (t.matches('[data-auto]')) {
      await setAutoBackup(t.checked);
      await draw();
    } else if (t.matches('[data-file]') && t.files?.[0]) {
      const file = t.files[0];
      t.value = '';
      try {
        const envelope = await readBackupFile(file);
        openRestoreSheet({ file: { name: file.name, envelope }, onDone: () => void draw() });
      } catch (err) {
        toast(err instanceof Error ? err.message : 'Datei nicht lesbar.', 'error');
      }
    }
  };
  host.addEventListener('click', onClick);
  host.addEventListener('change', onChange);
  const off = onBackupStatus(() => void draw());
  await draw();
  return () => {
    disposed = true;
    off();
  };
}

export function openSetupSheet(onDone: () => void): void {
  let mode: 'password' | 'recovery' = 'password';
  const recovery = generateRecoveryKey();
  const content = document.createElement('div');
  content.className = 'backup-sheet';
  content.dataset.testid = 'backup-setup-sheet';
  const footer = document.createElement('div');
  footer.className = 'row-actions';
  footer.innerHTML = `<button type="button" class="btn btn-ghost" data-cancel>Abbrechen</button><button type="button" class="btn btn-primary" data-save data-testid="bk-save">Einrichten &amp; sichern</button>`;
  const sheet = openSheet({ title: 'Backup einrichten', content, footer });
  const draw = () => {
    content.innerHTML = `
      <p class="muted">Nova verschlüsselt alles auf diesem Gerät, bevor es gesichert wird. Zum Wiederherstellen brauchst du dein Passwort <em>oder</em> den Schlüssel.</p>
      <div class="segmented"><button type="button" class="${mode === 'password' ? 'active' : ''}" data-mode="password" data-testid="bk-mode-password">Eigenes Passwort</button><button type="button" class="${mode === 'recovery' ? 'active' : ''}" data-mode="recovery" data-testid="bk-mode-recovery">Schlüssel erzeugen</button></div>
      ${
        mode === 'password'
          ? `<label class="field"><span>Backup-Passwort (mind. ${MIN_PASSWORD} Zeichen)</span><input type="password" autocomplete="new-password" data-testid="bk-pass" /></label>
             <label class="field"><span>Passwort wiederholen</span><input type="password" autocomplete="new-password" data-testid="bk-pass2" /></label>`
          : `<div class="recovery-box"><span class="dash-label">Dein Wiederherstellungsschlüssel</span><code data-testid="bk-recovery-key">${recovery}</code>
               <div class="row-actions"><button type="button" class="btn btn-secondary" data-copy data-testid="bk-copy">Kopieren</button><button type="button" class="btn btn-ghost" data-savekey data-testid="bk-save-key">Als Datei sichern</button></div></div>
             <p class="muted small">Wird nur jetzt angezeigt. Bewahre ihn z. B. im Passwort-Manager oder in der Dateien-App auf.</p>
             <label class="check-field"><input type="checkbox" data-testid="bk-confirm" /> Ich habe den Schlüssel sicher aufbewahrt</label>`
      }
      <p class="bot-status warn">Ohne Passwort bzw. Schlüssel kann niemand – auch Nova nicht – deine Daten wiederherstellen.</p>
      <p class="bk-error" data-testid="bk-error" hidden></p>`;
  };
  const err = (msg: string) => {
    const el = content.querySelector('[data-testid="bk-error"]') as HTMLElement;
    el.textContent = msg;
    el.hidden = false;
  };
  content.addEventListener('click', async (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('button');
    if (!b) return;
    if (b.dataset.mode) {
      mode = b.dataset.mode as typeof mode;
      draw();
    } else if ('copy' in b.dataset) {
      try {
        await navigator.clipboard.writeText(recovery);
        toast('Schlüssel kopiert.', 'success');
      } catch {
        toast('Kopieren nicht möglich – bitte abschreiben.', 'error');
      }
    } else if ('savekey' in b.dataset) {
      const file = new File([`Nova Wiederherstellungsschlüssel\n\n${recovery}\n\nErstellt am ${new Date().toLocaleString('de-DE')}. Damit lässt sich dein verschlüsseltes Nova-Backup wiederherstellen.\n`], 'Nova-Wiederherstellungsschluessel.txt', { type: 'text/plain' });
      const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
      if (nav.canShare?.({ files: [file] })) await nav.share({ files: [file] }).catch(() => undefined);
      else {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(file);
        a.download = file.name;
        a.click();
      }
    }
  });
  footer.querySelector('[data-cancel]')?.addEventListener('click', () => sheet.close());
  footer.querySelector('[data-save]')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget as HTMLButtonElement;
    let secret = recovery;
    if (mode === 'password') {
      const p1 = (content.querySelector('[data-testid="bk-pass"]') as HTMLInputElement).value;
      const p2 = (content.querySelector('[data-testid="bk-pass2"]') as HTMLInputElement).value;
      if (p1.length < MIN_PASSWORD) return err(`Bitte mindestens ${MIN_PASSWORD} Zeichen.`);
      if (p1 !== p2) return err('Die Passwörter stimmen nicht überein.');
      secret = p1;
    } else if (!(content.querySelector('[data-testid="bk-confirm"]') as HTMLInputElement).checked) return err('Bitte bestätige, dass du den Schlüssel aufbewahrt hast.');
    btn.disabled = true;
    btn.textContent = 'Verschlüssele …';
    try {
      await setupBackup(secret, mode);
      toast('Backup eingerichtet und gesichert.', 'success');
      sheet.close();
    } catch (ex) {
      // key is saved even if the upload failed (e.g. not paired) – backups resume automatically
      toast(`Passwort gespeichert. ${ex instanceof Error ? ex.message : ''}`, 'info');
      sheet.close();
    }
    onDone();
  });
  draw();
}

export function openRestoreSheet(opts: { file?: { name: string; envelope: BackupEnvelope }; onDone: () => void }): void {
  let mode: 'replace' | 'merge' = 'replace';
  let versions: BackupVersion[] | undefined;
  let selected: string | undefined;
  let loadError = '';
  let confirmArmed = false;
  const content = document.createElement('div');
  content.className = 'backup-sheet';
  content.dataset.testid = 'backup-restore-sheet';
  const footer = document.createElement('div');
  footer.className = 'row-actions';
  footer.innerHTML = `<button type="button" class="btn btn-ghost" data-cancel>Abbrechen</button><button type="button" class="btn btn-primary" data-go data-testid="bk-restore-go">Wiederherstellen</button>`;
  const sheet = openSheet({ title: 'Aus Backup wiederherstellen', content, footer });
  const goBtn = footer.querySelector('[data-go]') as HTMLButtonElement;
  const passValue = () => (content.querySelector('[data-testid="bk-restore-pass"]') as HTMLInputElement | null)?.value ?? '';
  const draw = () => {
    const pass = passValue();
    content.innerHTML = `
      ${
        opts.file
          ? `<div class="bk-file" data-testid="bk-file-name"><span>📄</span><span><strong>${escapeHtml(opts.file.name)}</strong><small>Erstellt ${escapeHtml(formatWhen(opts.file.envelope.createdAt))}</small></span></div>`
          : `<p class="dash-label">Version wählen</p>
             ${
               loadError
                 ? `<p class="bot-status warn" data-testid="bk-versions-error">${escapeHtml(loadError)}</p>`
                 : !versions
                   ? '<p class="muted">Lade Versionen …</p>'
                   : !versions.length
                     ? '<p class="muted" data-testid="bk-versions-empty">Noch keine Backups auf dem Server. Du kannst auch eine Backup-Datei importieren.</p>'
                     : `<ul class="bk-versions" data-testid="bk-versions">${versions
                         .map(
                           (v, i) => `<li><button type="button" class="bk-version${v.id === selected ? ' active' : ''}" data-version="${escapeHtml(v.id)}" data-testid="bk-version">
                             <span class="check${v.id === selected ? ' checked' : ''}">${v.id === selected ? '✓' : ''}</span>
                             <span><strong>${escapeHtml(formatWhen(v.createdAt))}</strong><small>${v.device ? `${escapeHtml(v.device)} · ` : ''}${kb(v.size)}${i === 0 ? ' · neueste' : ''}</small></span></button></li>`,
                         )
                         .join('')}</ul>`
             }`
      }
      <label class="field"><span>Backup-Passwort oder Wiederherstellungsschlüssel</span><input type="password" autocomplete="current-password" data-testid="bk-restore-pass" value="${escapeHtml(pass)}" /></label>
      <div class="segmented"><button type="button" class="${mode === 'replace' ? 'active' : ''}" data-mode="replace" data-testid="bk-replace">Ersetzen</button><button type="button" class="${mode === 'merge' ? 'active' : ''}" data-mode="merge" data-testid="bk-merge">Zusammenführen</button></div>
      <p class="muted small">${mode === 'replace' ? 'Ersetzt alle Daten auf diesem Gerät durch das Backup.' : 'Behält alles auf diesem Gerät und ergänzt, was im Backup fehlt oder dort neuer ist.'}</p>
      ${confirmArmed ? '<p class="bot-status warn" data-testid="bk-confirm-replace">Die aktuellen Daten auf diesem Gerät werden überschrieben. Zum Bestätigen noch einmal tippen.</p>' : ''}
      <p class="bk-error" data-testid="bk-restore-error" hidden></p>`;
    goBtn.textContent = confirmArmed ? 'Ja, ersetzen' : 'Wiederherstellen';
  };
  const err = (msg: string) => {
    const el = content.querySelector('[data-testid="bk-restore-error"]') as HTMLElement;
    el.textContent = msg;
    el.hidden = false;
  };
  content.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('button');
    if (!b) return;
    if (b.dataset.version) selected = b.dataset.version;
    else if (b.dataset.mode) {
      mode = b.dataset.mode as typeof mode;
      confirmArmed = false;
    } else return;
    draw();
  });
  footer.querySelector('[data-cancel]')?.addEventListener('click', () => sheet.close());
  goBtn.addEventListener('click', async () => {
    const secret = passValue();
    if (!opts.file && !selected) return err('Bitte eine Version wählen.');
    if (!secret) return err('Bitte Passwort oder Schlüssel eingeben.');
    if (mode === 'replace' && !confirmArmed) {
      confirmArmed = true;
      draw();
      return;
    }
    goBtn.disabled = true;
    goBtn.textContent = 'Entschlüssele …';
    try {
      const envelope = opts.file?.envelope ?? (await fetchVersion(selected!));
      const r = await restoreEnvelope(envelope, secret, mode);
      const summary = summarizeCounts(r.counts);
      sessionStorage.setItem('nova.restoreDone', `Wiederhergestellt${summary ? `: ${summary}` : ''}.`);
      sheet.close();
      opts.onDone();
      window.setTimeout(() => location.reload(), 300);
    } catch (ex) {
      goBtn.disabled = false;
      confirmArmed = false;
      draw();
      err(ex instanceof WrongSecretError ? ex.message : ex instanceof Error ? ex.message : 'Wiederherstellen fehlgeschlagen.');
    }
  });
  draw();
  if (!opts.file) {
    listVersions()
      .then((v) => {
        versions = v;
        selected = v[0]?.id;
      })
      .catch((e) => {
        loadError = e instanceof Error ? e.message : 'Versionen konnten nicht geladen werden.';
      })
      .finally(draw);
  }
}
