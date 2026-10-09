import { useEffect, useMemo, useState } from 'react';
import type { ControllerSnapshot } from '../application/attendanceController';
import { sessionMinutes, type AttendanceEntry } from '../domain/attendance';
import { PersistenceBadge } from './PersistenceBadge';

type TodayViewProps = {
  snapshot: ControllerSnapshot;
  onClockIn: () => Promise<void>;
  onClockOut: () => Promise<void>;
};

function localDateTime(entry: AttendanceEntry): Date {
  const [year, month, day] = entry.date.split('-').map(Number);
  const [hours, minutes] = entry.clockIn.split(':').map(Number);
  return new Date(year, month - 1, day, hours, minutes);
}

function elapsedMinutes(entry: AttendanceEntry, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - localDateTime(entry).getTime()) / 60_000));
}

function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${String(minutes % 60).padStart(2, '0')}m`;
}

function formatToday(now: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(now);
}

function localCalendarDate(now: Date): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function TodayView({ snapshot, onClockIn, onClockOut }: TodayViewProps) {
  const activeEntry = snapshot.state.entries.find((entry) => entry.clockOut === null) ?? null;
  const [now, setNow] = useState(() => new Date());
  const [isClocking, setIsClocking] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    setNow(new Date());
    if (activeEntry) {
      const interval = window.setInterval(() => setNow(new Date()), 30_000);
      return () => window.clearInterval(interval);
    }

    let midnightRefresh = 0;
    const scheduleMidnightRefresh = () => {
      const current = new Date();
      const nextMidnight = new Date(current);
      nextMidnight.setHours(24, 0, 0, 0);
      midnightRefresh = window.setTimeout(() => {
        setNow(new Date());
        scheduleMidnightRefresh();
      }, Math.max(1, nextMidnight.getTime() - current.getTime()));
    };
    scheduleMidnightRefresh();
    return () => window.clearTimeout(midnightRefresh);
  }, [activeEntry?.date, activeEntry?.clockIn]);

  const completedToday = useMemo(
    () => snapshot.state.entries.find((entry) => entry.date === localCalendarDate(now) && entry.clockOut !== null) ?? null,
    [now, snapshot.state.entries],
  );
  const displayedEntry = activeEntry ?? completedToday;
  const duration = displayedEntry?.clockOut === null
    ? elapsedMinutes(displayedEntry, now)
    : displayedEntry ? sessionMinutes(displayedEntry) : null;
  const status = activeEntry ? `Working since ${activeEntry.clockIn}` : 'Not working';
  const dayCompleted = !activeEntry && completedToday !== null;
  const primaryLabel = activeEntry ? 'Clock out' : dayCompleted ? 'Day completed' : 'Clock in';
  const busyLabel = 'Saving…';

  const runClockAction = async () => {
    setIsClocking(true);
    setActionError(null);
    try {
      await (activeEntry ? onClockOut() : onClockIn());
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsClocking(false);
    }
  };

  const error = actionError ?? snapshot.error;

  return (
    <section className="today-view" aria-labelledby="today-heading">
      <div className="today-view__intro">
        <p className="eyebrow">Today</p>
        <h1 id="today-heading">Attendance Clock</h1>
        <p className="today-date">{formatToday(now)}</p>
        <p className="work-status" aria-live="polite">{status}</p>
      </div>

      <div className="today-layout">
        <div className="today-card today-card--action">
          {activeEntry && (
            <p className="elapsed-time" aria-live="polite">
              <span className="elapsed-time__label">Elapsed time</span>
              <strong>{formatDuration(duration ?? 0)}</strong>
            </p>
          )}
          <button
            className={`clock-button ${activeEntry ? 'clock-button--out' : 'clock-button--in'}`}
            type="button"
            aria-label={isClocking ? busyLabel : primaryLabel}
            onClick={() => void runClockAction()}
            disabled={isClocking || dayCompleted}
          >
            <span className="clock-button__inner">
              <span className="clock-button__icon" aria-hidden="true">
                {activeEntry ? '⏹' : '▶'}
              </span>
              <span className="clock-button__label">{isClocking ? busyLabel : primaryLabel}</span>
            </span>
          </button>
          {dayCompleted && <p className="settings-section__hint">One entry is recorded per day. You can correct today’s entry in History.</p>}
        </div>

        <aside className="today-card today-card--details" aria-label="Today's attendance details">
          <dl className="attendance-details">
            <div>
              <dt>Clock in</dt>
              <dd>{displayedEntry?.clockIn ?? '—'}</dd>
            </div>
            <div>
              <dt>Clock out</dt>
              <dd>{displayedEntry?.clockOut ?? '—'}</dd>
            </div>
            <div>
              <dt>Duration</dt>
              <dd>{duration === null || duration === undefined ? '—' : formatDuration(duration)}</dd>
            </div>
          </dl>
          <PersistenceBadge meta={snapshot.meta} saving={isClocking} />
        </aside>
      </div>

      {error && <p className="attendance-error" role="alert" aria-live="polite">{error}</p>}
    </section>
  );
}
