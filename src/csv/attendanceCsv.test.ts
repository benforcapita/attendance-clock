import { describe, expect, it } from 'vitest';
import { parseAttendanceCsv, serializeAttendanceCsv } from './attendanceCsv';

describe('attendance CSV', () => {
  it('round-trips canonical CSV', () => {
    const csv = 'date,clock_in,clock_out\n2026-08-15,08:43,17:12\n2026-08-16,09:01,\n';
    expect(serializeAttendanceCsv(parseAttendanceCsv(csv))).toBe(csv);
  });

  it('normalizes a BOM and CRLF line endings', () => {
    const csv = '\ufeffdate,clock_in,clock_out\r\n2026-08-15,08:43,17:12\r\n';
    expect(serializeAttendanceCsv(parseAttendanceCsv(csv))).toBe('date,clock_in,clock_out\n2026-08-15,08:43,17:12\n');
  });

  it('ignores blank lines between records', () => {
    const csv = 'date,clock_in,clock_out\n\n2026-08-16,09:01,\n\n2026-08-15,08:43,17:12\n';
    expect(serializeAttendanceCsv(parseAttendanceCsv(csv))).toBe('date,clock_in,clock_out\n2026-08-15,08:43,17:12\n2026-08-16,09:01,\n');
  });

  it.each([
    'clock_in,date,clock_out\n08:43,2026-08-15,17:12\n',
    'date,clock_in,clock_out\n2026-02-30,08:43,17:12\n',
    'date,clock_in,clock_out\n2026-08-15,08:43,\n2026-08-16,09:01,\n',
    'date,clock_in,clock_out\n2026-08-15,08:43\n',
    'date,clock_in,clock_out\n2026-08-15,"08:43",17:12\n',
    'date,clock_in,clock_out\n2026-08-15,08,43,17:12\n',
    'date,clock_in,clock_out\n2026-08-15,08:43,17:12\n2026-08-15,09:00,18:00\n',
  ])('rejects invalid input without returning partial data', (csv) => {
    expect(() => parseAttendanceCsv(csv)).toThrow();
  });

  it('reports the source row for malformed records', () => {
    try {
      parseAttendanceCsv('date,clock_in,clock_out\n2026-08-15,08:43,17:12\n2026-02-30,09:00,17:00\n');
      throw new Error('expected parse to fail');
    } catch (error) {
      expect(error).toMatchObject({ name: 'CsvError', row: 3 });
    }
  });

  it.each([
    {
      label: 'invalid date',
      csv: 'date,clock_in,clock_out\n2026-02-30,08:43,17:12\n',
      row: 2,
      field: 'date',
    },
    {
      label: 'invalid clock-in',
      csv: 'date,clock_in,clock_out\n2026-08-15,8:43,17:12\n',
      row: 2,
      field: 'clock_in',
    },
    {
      label: 'invalid clock-out',
      csv: 'date,clock_in,clock_out\n2026-08-15,08:43,25:00\n',
      row: 2,
      field: 'clock_out',
    },
    {
      label: 'duplicate date',
      csv: 'date,clock_in,clock_out\n2026-08-15,08:43,17:12\n2026-08-15,09:01,18:00\n',
      row: 3,
      field: 'date',
    },
    {
      label: 'second active row',
      csv: 'date,clock_in,clock_out\n2026-08-15,08:43,\n2026-08-16,09:01,\n',
      row: 3,
      field: 'clock_out',
    },
  ])('reports the source row and invalid field for $label', ({ csv, row, field }) => {
    try {
      parseAttendanceCsv(csv);
      throw new Error('expected parse to fail');
    } catch (error) {
      expect(error).toMatchObject({ name: 'CsvError', row, field });
      expect(error).toHaveProperty('message', expect.stringContaining(`row ${row}`));
      expect(error).toHaveProperty('message', expect.stringContaining(`field ${field}`));
    }
  });
});
