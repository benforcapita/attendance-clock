import { StrictMode } from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AttendanceController } from '../application/attendanceController';
import type { FileAdapter } from '../files/fileAdapter';
import type { AttendanceDb, StoredSnapshot } from '../storage/attendanceDb';
import { useAttendance } from './useAttendance';

const EMPTY_SNAPSHOT: StoredSnapshot = {
  state: { entries: [] },
  meta: { fileName: null, syncState: 'pending', revision: 0 },
};

function createController(snapshot: StoredSnapshot = EMPTY_SNAPSHOT, loadError?: Error) {
  const db = {
    load: loadError ? vi.fn().mockRejectedValue(loadError) : vi.fn().mockResolvedValue(snapshot),
    save: vi.fn().mockResolvedValue(undefined),
    replace: vi.fn().mockResolvedValue(undefined),
  } as unknown as AttendanceDb & {
    load: ReturnType<typeof vi.fn>;
  };
  const files = {
    supportsDirectAccess: vi.fn().mockReturnValue(false),
    chooseOrCreate: vi.fn(),
    importFile: vi.fn(),
    writeDirect: vi.fn(),
    requestWritePermission: vi.fn(),
    exportDownload: vi.fn().mockResolvedValue(undefined),
  } as unknown as FileAdapter;
  return { controller: new AttendanceController(db, files), db };
}

function trackSubscriptions(controller: AttendanceController) {
  const originalSubscribe = controller.subscribe.bind(controller);
  let active = 0;
  const subscribe = vi.spyOn(controller, 'subscribe').mockImplementation((listener) => {
    active += 1;
    const unsubscribe = originalSubscribe(listener);
    return () => {
      active -= 1;
      unsubscribe();
    };
  });
  return { subscribe, active: () => active };
}

function AttendanceProbe({ controller }: { controller: AttendanceController }) {
  const { snapshot } = useAttendance(controller);
  const value = snapshot.error
    ? `error:${snapshot.error}`
    : snapshot.initialized
      ? `revision:${snapshot.meta.revision}`
      : 'loading';
  return <output aria-label="Attendance snapshot">{value}</output>;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('useAttendance lifecycle', () => {
  it('keeps one subscription across snapshot updates and unsubscribes on unmount', async () => {
    const { controller } = createController();
    const tracker = trackSubscriptions(controller);
    const { unmount } = render(<AttendanceProbe controller={controller} />);

    expect(await screen.findByText('revision:0')).toBeVisible();
    expect(tracker.subscribe).toHaveBeenCalledOnce();
    expect(tracker.active()).toBe(1);

    unmount();
    expect(tracker.active()).toBe(0);
  });

  it('unsubscribes from the old controller when the controller prop changes', async () => {
    const first = createController();
    const second = createController({
      state: { entries: [{ date: '2026-08-15', clockIn: '08:43', clockOut: null }] },
      meta: { fileName: null, syncState: 'pending', revision: 7 },
    });
    const firstTracker = trackSubscriptions(first.controller);
    const secondTracker = trackSubscriptions(second.controller);
    const { rerender, unmount } = render(<AttendanceProbe controller={first.controller} />);
    expect(await screen.findByText('revision:0')).toBeVisible();

    rerender(<AttendanceProbe controller={second.controller} />);

    expect(await screen.findByText('revision:7')).toBeVisible();
    expect(firstTracker.active()).toBe(0);
    expect(secondTracker.active()).toBe(1);
    await act(() => first.controller.clockIn(new Date('2026-08-16T09:00:00')));
    expect(screen.getByText('revision:7')).toBeVisible();

    unmount();
    expect(secondTracker.active()).toBe(0);
  });

  it('shares one initialization request and leaves one live subscription in Strict Mode', async () => {
    const { controller, db } = createController();
    const tracker = trackSubscriptions(controller);
    const { unmount } = render(
      <StrictMode>
        <AttendanceProbe controller={controller} />
      </StrictMode>,
    );

    expect(await screen.findByText('revision:0')).toBeVisible();
    expect(db.load).toHaveBeenCalledOnce();
    expect(tracker.active()).toBe(1);

    unmount();
    expect(tracker.active()).toBe(0);
  });

  it('publishes initialization failure and still cleans up its subscription', async () => {
    const { controller, db } = createController(EMPTY_SNAPSHOT, new Error('storage blocked'));
    const tracker = trackSubscriptions(controller);
    const { unmount } = render(<AttendanceProbe controller={controller} />);

    expect(await screen.findByText('error:storage blocked')).toBeVisible();
    expect(db.load).toHaveBeenCalledOnce();
    expect(tracker.active()).toBe(1);

    unmount();
    await waitFor(() => expect(tracker.active()).toBe(0));
  });
});
