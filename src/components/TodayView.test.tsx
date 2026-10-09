import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ControllerSnapshot } from '../application/attendanceController';
import { PersistenceBadge } from './PersistenceBadge';
import { TodayView } from './TodayView';

const idleSnapshot: ControllerSnapshot = {
  state: { entries: [] },
  meta: { fileName: null, syncState: 'pending', revision: 0 },
  initialized: true,
  error: null,
};

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('TodayView', () => {
  it('offers one primary clock action and changes it after activation', async () => {
    const onClockIn = vi.fn().mockResolvedValue(undefined);
    const onClockOut = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(
      <TodayView snapshot={idleSnapshot} onClockIn={onClockIn} onClockOut={onClockOut} />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Clock in' }));

    expect(onClockIn).toHaveBeenCalledOnce();
    expect(screen.getAllByRole('button')).toHaveLength(1);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Clock in' })).toBeEnabled());

    rerender(
      <TodayView
        snapshot={{
          ...idleSnapshot,
          state: { entries: [{ date: '2026-08-15', clockIn: '08:43', clockOut: null }] },
        }}
        onClockIn={onClockIn}
        onClockOut={onClockOut}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Clock out' }));
    expect(onClockOut).toHaveBeenCalledOnce();
  });

  it('only disables the primary action while its clock operation is running', async () => {
    let resolveClockIn!: () => void;
    const onClockIn = vi.fn(() => new Promise<void>((resolve) => { resolveClockIn = resolve; }));
    render(<TodayView snapshot={idleSnapshot} onClockIn={onClockIn} onClockOut={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Clock in' }));

    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Saving attendance…');
    resolveClockIn();
    expect(await screen.findByRole('button', { name: 'Clock in' })).toBeEnabled();
  });

  it('announces controller errors without removing the primary action', () => {
    render(
      <TodayView
        snapshot={{ ...idleSnapshot, error: 'Attendance database is unavailable' }}
        onClockIn={vi.fn()}
        onClockOut={vi.fn()}
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Attendance database is unavailable');
    expect(screen.getByRole('button', { name: 'Clock in' })).toBeEnabled();
  });

  it('refreshes the Today date and completed-row details at local midnight while idle', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 15, 23, 59, 59, 500));
    render(
      <TodayView
        snapshot={{
          ...idleSnapshot,
          state: { entries: [{ date: '2026-08-15', clockIn: '08:43', clockOut: '17:12' }] },
        }}
        onClockIn={vi.fn()}
        onClockOut={vi.fn()}
      />,
    );

    expect(screen.getByText(/August 15, 2026/)).toBeVisible();
    expect(screen.getByText('08:43')).toBeVisible();

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(screen.getByText(/August 16, 2026/)).toBeVisible();
    expect(screen.queryByText('08:43')).not.toBeInTheDocument();
  });

  it('explains the one-record-per-day limit instead of offering an invalid second clock-in', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 15, 18));
    render(<TodayView snapshot={{ ...idleSnapshot, state: { entries: [{ date: '2026-08-15', clockIn: '09:00', clockOut: '17:00' }] } }} onClockIn={vi.fn()} onClockOut={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Day completed' })).toBeDisabled();
    expect(screen.getByText(/correct today’s entry in History/)).toBeVisible();
  });

  it('derives elapsed time from the clock-in timestamp on each tick and cleans up its interval', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 15, 9, 43, 0));
    const { unmount } = render(
      <TodayView
        snapshot={{
          ...idleSnapshot,
          state: { entries: [{ date: '2026-08-15', clockIn: '08:43', clockOut: null }] },
        }}
        onClockIn={vi.fn()}
        onClockOut={vi.fn()}
      />,
    );

    const elapsed = screen.getByText('Elapsed time').closest('p');
    expect(elapsed).not.toBeNull();
    expect(within(elapsed!).getByText('1h 00m')).toBeVisible();
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(within(elapsed!).getByText('1h 01m')).toBeVisible();

    vi.setSystemTime(new Date(2026, 7, 15, 12, 0, 0));
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(within(elapsed!).getByText('3h 17m')).toBeVisible();

    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('PersistenceBadge', () => {
  it.each([
    ['synced', 'Saved to attendance.csv'],
    ['pending', 'Saved locally — export pending'],
    ['permission-required', 'File permission required'],
  ] as const)('announces %s persistence', (syncState, label) => {
    render(<PersistenceBadge meta={{ fileName: 'attendance.csv', syncState, revision: 1 }} />);

    expect(screen.getByText(label)).toBeVisible();
  });
});
