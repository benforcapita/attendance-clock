import { useMemo, useRef, useState } from 'react';
import { sessionMinutes, type AttendanceEntry } from '../domain/attendance';
import { EntryEditor } from './EntryEditor';

type HistoryViewProps = {
  entries: AttendanceEntry[];
  onUpdate: (originalDate: string, entry: AttendanceEntry) => Promise<void>;
  onDelete: (date: string) => Promise<void>;
};

type EntryMonth = {
  key: string;
  label: string;
  entries: AttendanceEntry[];
};

type SelectedEntry = {
  entry: AttendanceEntry;
  launcher: HTMLElement;
};

function durationLabel(entry: AttendanceEntry): string {
  const minutes = sessionMinutes(entry);
  if (minutes === null) return 'In progress';
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
}

function monthLabel(key: string): string {
  return new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(`${key}-01T00:00:00Z`));
}

function groupEntries(entries: AttendanceEntry[]): EntryMonth[] {
  const byMonth = new Map<string, AttendanceEntry[]>();
  for (const entry of [...entries].sort((left, right) => right.date.localeCompare(left.date))) {
    const key = entry.date.slice(0, 7);
    const group = byMonth.get(key) ?? [];
    group.push(entry);
    byMonth.set(key, group);
  }
  return [...byMonth.entries()]
    .sort(([left], [right]) => right.localeCompare(left))
    .map(([key, monthEntries]) => ({ key, label: monthLabel(key), entries: monthEntries }));
}

export function HistoryView({ entries, onUpdate, onDelete }: HistoryViewProps) {
  const [selected, setSelected] = useState<SelectedEntry | null>(null);
  const historyHeadingRef = useRef<HTMLHeadingElement>(null);
  const months = useMemo(() => groupEntries(entries), [entries]);

  return (
    <section className="history-view" aria-labelledby="history-heading">
      <div className="history-view__intro">
        <p className="eyebrow">History</p>
        <h1 id="history-heading" ref={historyHeadingRef} tabIndex={-1}>Attendance history</h1>
        <p>Review or correct your recorded sessions.</p>
      </div>

      {months.length === 0 ? (
        <p className="history-empty">No attendance entries yet.</p>
      ) : months.map((month) => (
        <section className="history-month" key={month.key} aria-labelledby={`month-${month.key}`}>
          <h2 id={`month-${month.key}`}>{month.label}</h2>
          <ol className="history-list">
            {month.entries.map((entry) => (
              <li key={entry.date}>
                <button
                  className="history-row"
                  type="button"
                  onClick={(event) => setSelected({ entry, launcher: event.currentTarget })}
                  aria-label={`${entry.date}, ${entry.clockIn} to ${entry.clockOut ?? 'in progress'}, ${durationLabel(entry)}`}
                >
                  <span>{entry.date}</span>
                  <span>{entry.clockIn}–{entry.clockOut ?? '—'}</span>
                  {entry.clockOut !== null && <span className="history-row__status">Completed</span>}
                  <strong>{durationLabel(entry)}</strong>
                </button>
              </li>
            ))}
          </ol>
        </section>
      ))}

      {selected && (
        <EntryEditor
          entry={selected.entry}
          onSave={(entry) => onUpdate(selected.entry.date, entry)}
          onDelete={() => onDelete(selected.entry.date)}
          onCancel={() => setSelected(null)}
          returnFocusTo={selected.launcher}
          fallbackFocusTo={historyHeadingRef.current}
        />
      )}
    </section>
  );
}
