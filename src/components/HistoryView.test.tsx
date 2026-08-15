import { useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AttendanceEntry } from '../domain/attendance';
import { HistoryView } from './HistoryView';

const completed: AttendanceEntry = {
  date: '2026-08-15',
  clockIn: '09:00',
  clockOut: '17:00',
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('HistoryView', () => {
  it('edits a historical row with native date and time inputs', async () => {
    const update = vi.fn().mockResolvedValue(undefined);
    render(<HistoryView entries={[completed]} onUpdate={update} onDelete={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /2026-08-15/ }));
    expect(screen.getByLabelText('Date')).toHaveAttribute('type', 'date');
    expect(screen.getByLabelText('Clock out')).toHaveAttribute('type', 'time');
    fireEvent.change(screen.getByLabelText('Clock out'), { target: { value: '18:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(update).toHaveBeenCalledWith('2026-08-15', expect.objectContaining({ clockOut: '18:00' }));
  });

  it('requires confirmation before deleting', async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    render(<HistoryView entries={[completed]} onUpdate={vi.fn()} onDelete={remove} />);

    fireEvent.click(screen.getByRole('button', { name: /2026-08-15/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }));

    expect(remove).toHaveBeenCalledWith('2026-08-15');
  });

  it('groups newest months and rows first and formats overnight durations', () => {
    render(
      <HistoryView
        entries={[
          { date: '2026-07-31', clockIn: '23:00', clockOut: '01:30' },
          completed,
          { date: '2026-08-20', clockIn: '08:00', clockOut: '12:00' },
        ]}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)).toEqual([
      'August 2026',
      'July 2026',
    ]);
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual([
      expect.stringContaining('2026-08-20'),
      expect.stringContaining('2026-08-15'),
      expect.stringContaining('2026-07-31'),
    ]);
    expect(screen.getByText('2h 30m')).toBeVisible();
  });

  it('keeps the correction dialog open and displays domain errors', async () => {
    const update = vi.fn().mockRejectedValue(new Error('invalid attendance entry'));
    render(<HistoryView entries={[completed]} onUpdate={update} onDelete={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /2026-08-15/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('invalid attendance entry');
    expect(screen.getByRole('dialog')).toBeVisible();
  });

  it('opens a modal editor, focuses its first field, and restores row focus after Escape', () => {
    const showModal = vi.spyOn(HTMLDialogElement.prototype, 'showModal');
    render(<HistoryView entries={[completed]} onUpdate={vi.fn()} onDelete={vi.fn()} />);
    const row = screen.getByRole('button', { name: /2026-08-15/ });

    fireEvent.click(row);

    const dialog = screen.getByRole('dialog');
    expect(showModal).toHaveBeenCalledOnce();
    expect(screen.getByLabelText('Date')).toHaveFocus();
    fireEvent(dialog, new Event('cancel', { cancelable: true }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(row).toHaveFocus();
  });

  it('restores focus to surviving history content after deleting the launching row', async () => {
    function DeleteHarness() {
      const [entries, setEntries] = useState<AttendanceEntry[]>([
        completed,
        { date: '2026-08-14', clockIn: '08:00', clockOut: '16:00' },
      ]);
      return (
        <HistoryView
          entries={entries}
          onUpdate={vi.fn()}
          onDelete={async (date) => setEntries((current) => current.filter((entry) => entry.date !== date))}
        />
      );
    }
    render(<DeleteHarness />);

    fireEvent.click(screen.getByRole('button', { name: /2026-08-15/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const remainingRow = screen.getByRole('button', { name: /2026-08-14/ });
    const historyHeading = screen.getByRole('heading', { name: 'Attendance history' });
    await waitFor(() => expect([remainingRow, historyHeading]).toContain(document.activeElement));
  });

  it('restores focus to surviving history content after an edit changes the row key', async () => {
    function DateChangeHarness() {
      const [entries, setEntries] = useState<AttendanceEntry[]>([completed]);
      return (
        <HistoryView
          entries={entries}
          onUpdate={async (originalDate, replacement) => setEntries((current) => current.map((entry) => (
            entry.date === originalDate ? replacement : entry
          )))}
          onDelete={vi.fn()}
        />
      );
    }
    render(<DateChangeHarness />);

    fireEvent.click(screen.getByRole('button', { name: /2026-08-15/ }));
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-08-16' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const changedRow = screen.getByRole('button', { name: /2026-08-16/ });
    const historyHeading = screen.getByRole('heading', { name: 'Attendance history' });
    await waitFor(() => expect([changedRow, historyHeading]).toContain(document.activeElement));
  });
});
