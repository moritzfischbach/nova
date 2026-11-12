import { escapeHtml } from './escape';
import { icons } from './icons';

export interface SheetHandle {
  close: () => void;
  body: HTMLElement;
  footer: HTMLElement;
}

export function openSheet(options: {
  title: string;
  content?: HTMLElement | string;
  footer?: HTMLElement | string;
}): SheetHandle {
  const overlay = document.createElement('div');
  overlay.className = 'sheet-overlay';
  overlay.innerHTML = `
    <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title">
      <div class="sheet-handle" aria-hidden="true"></div>
      <header class="sheet-header">
        <h2 id="sheet-title">${escapeHtml(options.title)}</h2>
        <button type="button" class="icon-btn" data-sheet-close aria-label="Schließen">${icons.close}</button>
      </header>
      <div class="sheet-body"></div>
      <div class="sheet-footer"></div>
    </div>
  `;

  const body = overlay.querySelector('.sheet-body') as HTMLElement;
  const footer = overlay.querySelector('.sheet-footer') as HTMLElement;
  const sheet = overlay.querySelector('.sheet') as HTMLElement;

  if (typeof options.content === 'string') body.innerHTML = options.content;
  else if (options.content) body.append(options.content);

  if (typeof options.footer === 'string') footer.innerHTML = options.footer;
  else if (options.footer) footer.append(options.footer);
  else footer.hidden = true;

  const close = () => {
    overlay.classList.remove('open');
    sheet.classList.remove('open');
    window.setTimeout(() => overlay.remove(), 280);
    document.removeEventListener('keydown', onKey);
  };

  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape') close();
  };

  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) close();
  });
  overlay.querySelector('[data-sheet-close]')?.addEventListener('click', close);
  document.addEventListener('keydown', onKey);

  document.body.append(overlay);
  requestAnimationFrame(() => {
    overlay.classList.add('open');
    sheet.classList.add('open');
  });

  return { close, body, footer };
}

export function confirmSheet(options: {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
}): Promise<boolean> {
  return new Promise((resolve) => {
    const footer = document.createElement('div');
    footer.className = 'row-actions';
    footer.innerHTML = `
      <button type="button" class="btn btn-ghost" data-cancel>Abbrechen</button>
      <button type="button" class="btn ${options.danger ? 'btn-danger' : 'btn-primary'}" data-ok data-testid="confirm-ok">${escapeHtml(options.confirmLabel ?? 'OK')}</button>
    `;
    const sheet = openSheet({
      title: options.title,
      content: `<p class="sheet-copy">${escapeHtml(options.message)}</p>`,
      footer,
    });
    footer.querySelector('[data-cancel]')?.addEventListener('click', () => {
      sheet.close();
      resolve(false);
    });
    footer.querySelector('[data-ok]')?.addEventListener('click', () => {
      sheet.close();
      resolve(true);
    });
  });
}
