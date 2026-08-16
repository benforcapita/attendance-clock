import { useCallback, useEffect, useSyncExternalStore } from 'react';
import type { AttendanceController, ControllerSnapshot } from '../application/attendanceController';
import type { AttendanceEntry } from '../domain/attendance';

type AttendanceActions = {
  snapshot: ControllerSnapshot;
  clockIn: () => Promise<void>;
  clockOut: () => Promise<void>;
  updateEntry: (originalDate: string, entry: AttendanceEntry) => Promise<void>;
  deleteEntry: (date: string) => Promise<void>;
  chooseFolder: () => Promise<void>;
  importCsv: (options?: { discardPending?: boolean }) => Promise<void>;
  exportCsv: () => Promise<void>;
  requestFilePermission: () => Promise<void>;
};

/** Keeps React in sync with the controller's durable, externally-owned snapshot. */
export function useAttendance(controller: AttendanceController): AttendanceActions {
  const subscribe = useCallback((notify: () => void) => controller.subscribe(notify), [controller]);
  const getSnapshot = useCallback(() => controller.getSnapshot(), [controller]);
  const snapshot = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getSnapshot,
  );

  useEffect(() => {
    if (!controller.getSnapshot().initialized) {
      void controller.initialize().catch(() => undefined);
    }
  }, [controller]);

  return {
    snapshot,
    clockIn: () => controller.clockIn(),
    clockOut: () => controller.clockOut(),
    updateEntry: (originalDate, entry) => controller.updateEntry(originalDate, entry),
    deleteEntry: (date) => controller.deleteEntry(date),
    chooseFolder: () => controller.chooseFolder(),
    importCsv: (options) => controller.importCsv(options),
    exportCsv: () => controller.exportCsv(),
    requestFilePermission: () => controller.requestFilePermission(),
  };
}
