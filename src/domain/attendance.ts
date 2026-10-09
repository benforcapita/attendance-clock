export type AttendanceEntry = {
  date: string;
  clockIn: string;
  clockOut: string | null;
};

export type AttendanceState = { entries: AttendanceEntry[] };

export type AttendanceField = 'date' | 'clockIn' | 'clockOut';

export class DomainError extends Error {
  readonly field?: AttendanceField;

  constructor(message: string, field?: AttendanceField) {
    super(message);
    this.name = 'DomainError';
    this.field = field;
  }
}

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_PATTERN = /^(\d{2}):(\d{2})$/;

function validDate(value: string): boolean {
  const match = DATE_PATTERN.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const candidate = new Date(0);
  candidate.setUTCHours(0, 0, 0, 0);
  candidate.setUTCFullYear(year, month - 1, day);
  return candidate.getUTCFullYear() === year && candidate.getUTCMonth() === month - 1 && candidate.getUTCDate() === day;
}

function validTime(value: string): boolean {
  const match = TIME_PATTERN.exec(value);
  return Boolean(match && Number(match[1]) < 24 && Number(match[2]) < 60);
}

function assertEntry(entry: AttendanceEntry): void {
  if (!entry) {
    throw new DomainError('invalid attendance entry');
  }
  if (entry.clockOut !== null && !entry.clockIn) {
    throw new DomainError('clock-out requires clock-in', 'clockIn');
  }
  if (!validDate(entry.date)) {
    throw new DomainError('invalid attendance date', 'date');
  }
  if (!validTime(entry.clockIn)) {
    throw new DomainError('invalid clock-in time', 'clockIn');
  }
  if (entry.clockOut !== null && !validTime(entry.clockOut)) {
    throw new DomainError('invalid clock-out time', 'clockOut');
  }
}

export function validateState(state: AttendanceState): void {
  if (!state || !Array.isArray(state.entries)) throw new DomainError('invalid attendance state');
  const dates = new Set<string>();
  let activeCount = 0;
  for (const entry of state.entries) {
    assertEntry(entry);
    if (dates.has(entry.date)) throw new DomainError('duplicate attendance date', 'date');
    dates.add(entry.date);
    if (entry.clockOut === null) activeCount += 1;
  }
  if (activeCount > 1) throw new DomainError('only one active attendance row is allowed', 'clockOut');
}

function sorted(entries: AttendanceEntry[]): AttendanceEntry[] {
  return [...entries].sort((left, right) => left.date.localeCompare(right.date));
}

function formatDate(now: Date): string {
  if (Number.isNaN(now.getTime())) throw new DomainError('invalid date');
  return `${now.getFullYear().toString().padStart(4, '0')}-${(now.getMonth() + 1).toString().padStart(2, '0')}-${now.getDate().toString().padStart(2, '0')}`;
}

function formatTime(now: Date): string {
  if (Number.isNaN(now.getTime())) throw new DomainError('invalid date');
  return `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
}

export function clockIn(state: AttendanceState, now: Date): AttendanceState {
  validateState(state);
  if (state.entries.some((entry) => entry.clockOut === null)) throw new DomainError('a session is already active');
  const entry: AttendanceEntry = { date: formatDate(now), clockIn: formatTime(now), clockOut: null };
  if (state.entries.some((existing) => existing.date === entry.date)) throw new DomainError('attendance date already exists');
  return { entries: sorted([...state.entries, entry]) };
}

export function clockOut(state: AttendanceState, now: Date): AttendanceState {
  validateState(state);
  const active = state.entries.find((entry) => entry.clockOut === null);
  if (!active) throw new DomainError('no active attendance session');
  const clockOutValue = formatTime(now);
  // CSV has no end-date column. Compare wall-clock minutes so closing a stale
  // session cannot silently turn several days into a short overnight shift.
  const start = Date.parse(`${active.date}T${active.clockIn}:00Z`);
  const end = Date.parse(`${formatDate(now)}T${clockOutValue}:00Z`);
  const minutes = (end - start) / 60_000;
  if (minutes < 0) throw new DomainError('Cannot clock out before clock-in. Correct the entry in History.', 'clockOut');
  if (minutes >= 24 * 60) throw new DomainError('This session is at least 24 hours long. Correct the entry in History before clocking out.', 'clockOut');
  return { entries: sorted(state.entries.map((entry) => entry === active ? { ...entry, clockOut: clockOutValue } : { ...entry })) };
}

export function updateEntry(state: AttendanceState, originalDate: string, entry: AttendanceEntry): AttendanceState {
  validateState(state);
  if (!state.entries.some((existing) => existing.date === originalDate)) throw new DomainError('unknown attendance date');
  assertEntry(entry);
  const replacement = state.entries.map((existing) => existing.date === originalDate ? { ...entry } : { ...existing });
  const next = { entries: sorted(replacement) };
  validateState(next);
  return next;
}

export function deleteEntry(state: AttendanceState, date: string): AttendanceState {
  validateState(state);
  if (!state.entries.some((entry) => entry.date === date)) throw new DomainError('unknown attendance date');
  return { entries: sorted(state.entries.filter((entry) => entry.date !== date).map((entry) => ({ ...entry }))) };
}

export function sessionMinutes(entry: AttendanceEntry): number | null {
  assertEntry(entry);
  if (entry.clockOut === null) return null;
  const inMatch = TIME_PATTERN.exec(entry.clockIn)!;
  const outMatch = TIME_PATTERN.exec(entry.clockOut)!;
  const start = Number(inMatch[1]) * 60 + Number(inMatch[2]);
  const end = Number(outMatch[1]) * 60 + Number(outMatch[2]);
  return (end >= start ? end : end + 24 * 60) - start;
}
