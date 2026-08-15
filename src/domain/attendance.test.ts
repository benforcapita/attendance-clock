import { describe, expect, it } from 'vitest';
import {
  clockIn,
  clockOut,
  deleteEntry,
  sessionMinutes,
  updateEntry,
  validateState,
} from './attendance';

const empty = { entries: [] };

describe('attendance domain', () => {
  it('creates and completes a session', () => {
    const active = clockIn(empty, new Date('2026-08-15T08:43:00'));
    expect(active.entries[0]).toEqual({ date: '2026-08-15', clockIn: '08:43', clockOut: null });
    expect(clockOut(active, new Date('2026-08-15T17:12:00')).entries[0].clockOut).toBe('17:12');
  });

  it('rejects duplicate dates and overlapping active rows', () => {
    const active = clockIn(empty, new Date('2026-08-15T08:43:00'));
    expect(() => clockIn(active, new Date('2026-08-15T09:00:00'))).toThrow('already active');
    expect(() => updateEntry(active, '2026-08-15', { date: '2026-08-16', clockIn: '09:00', clockOut: null })).not.toThrow();
  });

  it('treats an earlier clock-out as the following day', () => {
    expect(sessionMinutes({ date: '2026-08-15', clockIn: '22:00', clockOut: '06:00' })).toBe(480);
  });

  it('rejects invalid calendar dates and duplicate dates', () => {
    expect(() => validateState({ entries: [{ date: '2026-02-29', clockIn: '09:00', clockOut: null }] })).toThrow();
    expect(() => validateState({ entries: [
      { date: '2026-08-15', clockIn: '09:00', clockOut: null },
      { date: '2026-08-15', clockIn: '10:00', clockOut: '11:00' },
    ] })).toThrow('duplicate');
  });

  it('rejects a state containing two active rows directly', () => {
    expect(() => validateState({ entries: [
      { date: '2026-08-15', clockIn: '09:00', clockOut: null },
      { date: '2026-08-16', clockIn: '10:00', clockOut: null },
    ] })).toThrow('only one active');
  });

  it('rejects an invalid time and clock-out without clock-in', () => {
    expect(() => validateState({ entries: [{ date: '2026-08-15', clockIn: '9:00', clockOut: null }] })).toThrow();
    expect(() => clockOut(empty, new Date('2026-08-15T17:12:00'))).toThrow('active');
    const active = clockIn(empty, new Date('2026-08-15T08:43:00'));
    expect(() => clockOut(active, new Date('invalid'))).toThrow('invalid');
    expect(() => validateState({ entries: [{ date: '2026-08-15', clockIn: '', clockOut: '17:00' }] })).toThrow();
  });

  it('updates and sorts entries immutably', () => {
    const state = {
      entries: [
        { date: '2026-08-16', clockIn: '10:00', clockOut: '11:00' },
        { date: '2026-08-15', clockIn: '09:00', clockOut: '17:00' },
      ],
    };
    const updated = updateEntry(state, '2026-08-16', { date: '2026-08-14', clockIn: '08:00', clockOut: '09:00' });
    expect(updated.entries.map((entry) => entry.date)).toEqual(['2026-08-14', '2026-08-15']);
    expect(state.entries[0].date).toBe('2026-08-16');
  });

  it('deletes known entries and rejects unknown dates', () => {
    const state = { entries: [{ date: '2026-08-15', clockIn: '09:00', clockOut: '17:00' }] };
    expect(deleteEntry(state, '2026-08-15')).toEqual(empty);
    expect(() => deleteEntry(state, '2026-08-16')).toThrow('unknown');
  });

  it('returns null for an active session and calculates normal durations', () => {
    expect(sessionMinutes({ date: '2026-08-15', clockIn: '09:15', clockOut: null })).toBeNull();
    expect(sessionMinutes({ date: '2026-08-15', clockIn: '09:15', clockOut: '17:45' })).toBe(510);
  });
});
