import type { AttendanceEntry, AttendanceState } from '../domain/attendance';
import { DomainError, validateState } from '../domain/attendance';

const HEADER = 'date,clock_in,clock_out';
const FIELDS = ['date', 'clock_in', 'clock_out'] as const;

export type CsvField = typeof FIELDS[number] | 'header' | 'row';

export class CsvError extends Error {
  readonly row?: number;

  readonly field?: CsvField;

  constructor(message: string, row?: number, field?: CsvField) {
    const location = row === undefined
      ? ''
      : `CSV row ${row}${field === undefined ? '' : `, field ${field}`}: `;
    super(`${location}${message}`);
    this.name = 'CsvError';
    this.row = row;
    this.field = field;
  }
}

function csvFailure(message: string, row?: number, field?: CsvField): CsvError {
  return new CsvError(message, row, field);
}

function csvFieldFor(error: unknown): CsvField {
  if (!(error instanceof DomainError) || error.field === undefined) return 'row';
  if (error.field === 'clockIn') return 'clock_in';
  if (error.field === 'clockOut') return 'clock_out';
  return 'date';
}

export function parseAttendanceCsv(text: string): AttendanceState {
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  if (lines[0] !== HEADER) throw csvFailure('invalid CSV header', 1, 'header');

  const entries: AttendanceEntry[] = [];
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line === '') continue;
    const row = index + 1;
    const fields = line.split(',');
    if (fields.length !== 3) throw csvFailure('CSV row must contain exactly three fields', row, 'row');
    const quotedField = fields.findIndex((field) => field.includes('"'));
    if (quotedField >= 0) throw csvFailure('quoted CSV fields are not supported', row, FIELDS[quotedField]);
    const [date, clockIn, clockOut] = fields;
    const entry: AttendanceEntry = { date, clockIn, clockOut: clockOut === '' ? null : clockOut };
    try {
      validateState({ entries: [...entries, entry] });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'invalid attendance entry';
      throw csvFailure(message, row, csvFieldFor(error));
    }
    entries.push(entry);
  }

  return { entries };
}

export function serializeAttendanceCsv(state: AttendanceState): string {
  try {
    validateState(state);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'invalid attendance state';
    throw csvFailure(message);
  }
  const entries = [...state.entries].sort((left, right) => left.date.localeCompare(right.date));
  const rows = entries.map((entry) => `${entry.date},${entry.clockIn},${entry.clockOut ?? ''}`);
  return `${HEADER}\n${rows.length > 0 ? `${rows.join('\n')}\n` : ''}`;
}
