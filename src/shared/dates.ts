export function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function formatISODate(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function todayISO(): string {
  return formatISODate(new Date());
}

export function parseLocalDate(isoDate: string): Date {
  const [year, month, day] = isoDate.split('-').map(Number);
  return new Date(year, (month ?? 1) - 1, day ?? 1);
}

export function addDays(isoDate: string, days: number): string {
  const date = parseLocalDate(isoDate);
  date.setDate(date.getDate() + days);
  return formatISODate(date);
}

export function monthLabel(year: number, monthIndex: number): string {
  const label = new Date(year, monthIndex, 1).toLocaleDateString('de-DE', {
    month: 'long',
    year: 'numeric',
  });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function weekdayLabels(): string[] {
  return ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
}

export function startOfMonthGrid(year: number, monthIndex: number): Date {
  const first = new Date(year, monthIndex, 1);
  const mondayBased = (first.getDay() + 6) % 7;
  first.setDate(first.getDate() - mondayBased);
  return first;
}

export function greeting(now = new Date()): string {
  const hour = now.getHours();
  if (hour < 11) return 'Guten Morgen';
  if (hour < 18) return 'Guten Tag';
  return 'Guten Abend';
}

export function formatDateHuman(iso: string): string {
  return parseLocalDate(iso).toLocaleDateString('de-DE', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

export function formatDateLong(iso: string): string {
  return parseLocalDate(iso).toLocaleDateString('de-DE', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}

export function sameMonth(iso: string, year: number, monthIndex: number): boolean {
  const date = parseLocalDate(iso);
  return date.getFullYear() === year && date.getMonth() === monthIndex;
}

export function nextHourRange(now = new Date()): { start: string; end: string } {
  const start = new Date(now);
  start.setMinutes(0, 0, 0);
  start.setHours(start.getHours() + 1);
  const end = new Date(start);
  end.setHours(end.getHours() + 1);
  return {
    start: `${pad2(start.getHours())}:${pad2(start.getMinutes())}`,
    end: `${pad2(end.getHours())}:${pad2(end.getMinutes())}`,
  };
}
