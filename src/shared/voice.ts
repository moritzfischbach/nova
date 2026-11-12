/**
 * Reusable speech-to-text layer on top of the Web Speech API.
 *
 * - `isVoiceSupported()` / `voiceSupport()` for feature detection
 * - `startListening()` for a single dictation session (one utterance)
 * - `attachMicButton()` binds a mic button to a text input with live
 *   interim transcript, recording state and German error hints
 *
 * Later a wake-word engine or a Grok Bot bridge can implement the same
 * `VoiceEngine` shape and be swapped in via `setVoiceEngine()`.
 */
import { toast } from './toast';

export type VoiceErrorCode =
  | 'unsupported'
  | 'insecure'
  | 'not-allowed'
  | 'service-not-allowed'
  | 'no-speech'
  | 'audio-capture'
  | 'network'
  | 'aborted'
  | 'language-not-supported'
  | 'timeout'
  | 'unknown';

export interface VoiceCallbacks {
  onStart?: () => void;
  onInterim?: (text: string) => void;
  onFinal?: (text: string) => void;
  onError?: (code: VoiceErrorCode, message: string) => void;
  onEnd?: () => void;
}

export interface VoiceOptions extends VoiceCallbacks {
  lang?: string;
  /** Stop if nothing was heard within this many ms (guards against iOS hangs). */
  silenceTimeoutMs?: number;
}

export interface VoiceSession {
  stop: () => void;
  abort: () => void;
}

export interface VoiceEngine {
  readonly id: string;
  isSupported: () => boolean;
  start: (options: VoiceOptions) => VoiceSession;
}

// Minimal typings – the Web Speech API is not in lib.dom for all TS versions.
interface SpeechRecognitionAlternativeLike { transcript: string }
interface SpeechRecognitionResultLike { isFinal: boolean; 0: SpeechRecognitionAlternativeLike; length: number }
interface SpeechRecognitionEventLike { resultIndex: number; results: ArrayLike<SpeechRecognitionResultLike> }
interface SpeechRecognitionErrorEventLike { error: string; message?: string }
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onstart: (() => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getCtor(): SpeechRecognitionCtor | undefined {
  if (typeof window === 'undefined') return undefined;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

export function voiceSupport(): { supported: boolean; reason?: VoiceErrorCode } {
  if (!getCtor()) return { supported: false, reason: 'unsupported' };
  if (typeof window !== 'undefined' && window.isSecureContext === false) {
    return { supported: false, reason: 'insecure' };
  }
  return { supported: true };
}

export function isVoiceSupported(): boolean {
  return voiceSupport().supported;
}

export function voiceErrorMessage(code: VoiceErrorCode): string {
  switch (code) {
    case 'unsupported':
      return 'Spracheingabe wird in diesem Browser nicht unterstützt. Tippe ins Feld und nutze das Mikrofon der iPhone-Tastatur (Diktieren).';
    case 'insecure':
      return 'Spracheingabe braucht eine sichere HTTPS-Verbindung. Bis dahin: Diktieren über die iPhone-Tastatur.';
    case 'not-allowed':
    case 'service-not-allowed':
      return 'Kein Zugriff aufs Mikrofon. Bitte in den Einstellungen Mikrofon und Spracherkennung (Siri & Diktieren) erlauben.';
    case 'no-speech':
    case 'timeout':
      return 'Ich habe nichts gehört. Tippe aufs Mikrofon und sprich direkt los.';
    case 'audio-capture':
      return 'Kein Mikrofon gefunden.';
    case 'network':
      return 'Die Spracherkennung ist gerade nicht erreichbar. Prüfe die Internetverbindung.';
    case 'language-not-supported':
      return 'Deutsch wird von der Spracherkennung hier nicht unterstützt.';
    case 'aborted':
      return 'Aufnahme abgebrochen.';
    default:
      return 'Die Spracheingabe hat nicht geklappt. Versuch es noch einmal.';
  }
}

function toCode(error: string): VoiceErrorCode {
  const known: VoiceErrorCode[] = [
    'not-allowed', 'service-not-allowed', 'no-speech', 'audio-capture',
    'network', 'aborted', 'language-not-supported',
  ];
  return (known as string[]).includes(error) ? (error as VoiceErrorCode) : 'unknown';
}

export const webSpeechEngine: VoiceEngine = {
  id: 'web-speech',
  isSupported: isVoiceSupported,
  start(options) {
    const Ctor = getCtor();
    const support = voiceSupport();
    if (!Ctor || !support.supported) {
      const code = support.reason ?? 'unsupported';
      options.onError?.(code, voiceErrorMessage(code));
      options.onEnd?.();
      return { stop() {}, abort() {} };
    }

    // A fresh instance per session (recommended for iOS Safari).
    const rec = new Ctor();
    rec.lang = options.lang ?? 'de-DE';
    rec.continuous = false;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    let finalText = '';
    let interimText = '';
    let heardSomething = false;
    let errored = false;
    let ended = false;
    let timer: number | undefined;

    const clearTimer = () => {
      if (timer !== undefined) window.clearTimeout(timer);
      timer = undefined;
    };
    const armTimer = () => {
      clearTimer();
      const ms = options.silenceTimeoutMs ?? 8000;
      timer = window.setTimeout(() => {
        if (!heardSomething) {
          errored = true;
          options.onError?.('timeout', voiceErrorMessage('timeout'));
          try { rec.abort(); } catch { /* ignore */ }
          finish();
        }
      }, ms);
    };

    const finish = () => {
      if (ended) return;
      ended = true;
      clearTimer();
      const text = (finalText || interimText).trim();
      if (!errored && text) options.onFinal?.(text);
      else if (!errored && !text) options.onError?.('no-speech', voiceErrorMessage('no-speech'));
      options.onEnd?.();
    };

    rec.onstart = () => {
      options.onStart?.();
      armTimer();
    };
    rec.onresult = (event) => {
      heardSomething = true;
      clearTimer();
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const transcript = result[0]?.transcript ?? '';
        if (result.isFinal) finalText += transcript;
        else interim += transcript;
      }
      interimText = interim;
      options.onInterim?.(`${finalText}${interim}`.trim());
    };
    rec.onerror = (event) => {
      const code = toCode(event.error);
      if (code === 'aborted' && ended) return;
      errored = true;
      options.onError?.(code, voiceErrorMessage(code));
    };
    rec.onend = () => finish();

    try {
      rec.start();
    } catch {
      errored = true;
      options.onError?.('unknown', voiceErrorMessage('unknown'));
      finish();
    }

    return {
      stop: () => { try { rec.stop(); } catch { finish(); } },
      abort: () => { errored = true; try { rec.abort(); } catch { /* ignore */ } finish(); },
    };
  },
};

let engine: VoiceEngine = webSpeechEngine;
let active: VoiceSession | null = null;

/** Swap the engine later (e.g. wake-word engine or Grok Bot relay). */
export function setVoiceEngine(next: VoiceEngine): void {
  stopAllListening();
  engine = next;
}

export function startListening(options: VoiceOptions): VoiceSession {
  stopAllListening();
  const session = engine.start({
    ...options,
    onEnd: () => {
      if (active === session) active = null;
      options.onEnd?.();
    },
  });
  active = session;
  return session;
}

export function stopAllListening(): void {
  const current = active;
  active = null;
  current?.abort();
}

export const MIC_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3.5" width="6" height="11" rx="3" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M6 11.5a6 6 0 0 0 12 0M12 17.5V20.5M9 20.5h6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>`;

export function micButtonHtml(testid: string): string {
  const support = voiceSupport();
  const label = support.supported ? 'Spracheingabe starten' : 'Spracheingabe nicht verfügbar – Hinweis anzeigen';
  return `<button type="button" class="mic-btn ${support.supported ? '' : 'unsupported'}" data-testid="${testid}" aria-label="${label}" ${support.supported ? 'aria-pressed="false"' : 'data-unsupported="true"'}>${MIC_ICON}</button>`;
}

/**
 * Wires a mic button to an input: live transcript into the input,
 * recording state on the button, German hints for errors.
 */
export function attachMicButton(opts: {
  button: HTMLButtonElement;
  input: HTMLInputElement;
  onFinal: (text: string) => void | Promise<void>;
  hint?: (message: string, kind: 'info' | 'error') => void;
}): void {
  const { button, input } = opts;
  const hint = opts.hint ?? ((message, kind) => toast(message, kind));
  let session: VoiceSession | null = null;
  let before = '';

  const setRecording = (on: boolean) => {
    button.classList.toggle('recording', on);
    button.setAttribute('aria-pressed', String(on));
    button.setAttribute('aria-label', on ? 'Aufnahme beenden' : 'Spracheingabe starten');
    input.classList.toggle('listening', on);
    if (on) input.dataset.placeholder = input.placeholder;
    input.placeholder = on ? 'Ich höre zu…' : input.dataset.placeholder ?? input.placeholder;
  };

  button.addEventListener('click', () => {
    const support = voiceSupport();
    if (!support.supported) {
      hint(voiceErrorMessage(support.reason ?? 'unsupported'), 'info');
      input.focus();
      return;
    }
    if (session) {
      session.stop();
      return;
    }
    before = input.value;
    setRecording(true);
    session = startListening({
      lang: 'de-DE',
      onInterim: (text) => {
        input.value = text;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      },
      onFinal: (text) => {
        input.value = text;
        void opts.onFinal(text);
      },
      onError: (code, message) => {
        if (code === 'aborted') return;
        input.value = before;
        hint(message, 'error');
      },
      onEnd: () => {
        session = null;
        if (button.isConnected) setRecording(false);
      },
    });
  });
}
