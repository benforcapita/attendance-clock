import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AttendanceEntry, AttendanceState } from '../domain/attendance';
import { FilePermissionError, type FileAdapter, type ImportedFile } from '../files/fileAdapter';
import { AttendanceDb, type StoredSnapshot } from '../storage/attendanceDb';
import { AttendanceController, PendingImportError } from './attendanceController';

const EMPTY_STATE: AttendanceState = { entries: [] };
const DEFAULT_SNAPSHOT: StoredSnapshot = {
  state: EMPTY_STATE,
  meta: { fileName: null, syncState: 'pending', revision: 0 },
};
const CSV = 'date,clock_in,clock_out\n2026-08-15,08:43,17:12\n';
const ENTRY: AttendanceEntry = { date: '2026-08-15', clockIn: '08:43', clockOut: '17:12' };
let durableDbSequence = 0;

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createDb(snapshot: StoredSnapshot = DEFAULT_SNAPSHOT) {
  return {
    load: vi.fn().mockResolvedValue(snapshot),
    save: vi.fn().mockResolvedValue(undefined),
    replace: vi.fn().mockResolvedValue(undefined),
  } as unknown as AttendanceDb & {
    load: ReturnType<typeof vi.fn>;
    save: ReturnType<typeof vi.fn>;
    replace: ReturnType<typeof vi.fn>;
  };
}

function createFiles() {
  return {
    supportsDirectAccess: vi.fn().mockReturnValue(true),
    chooseOrCreate: vi.fn(),
    importFile: vi.fn(),
    writeDirect: vi.fn().mockResolvedValue(undefined),
    requestWritePermission: vi.fn().mockResolvedValue(true),
    exportDownload: vi.fn().mockResolvedValue(undefined),
  } as unknown as FileAdapter & {
    chooseOrCreate: ReturnType<typeof vi.fn>;
    importFile: ReturnType<typeof vi.fn>;
    writeDirect: ReturnType<typeof vi.fn>;
    requestWritePermission: ReturnType<typeof vi.fn>;
    exportDownload: ReturnType<typeof vi.fn>;
  };
}

describe('AttendanceController', () => {
  let db: ReturnType<typeof createDb>;
  let files: ReturnType<typeof createFiles>;
  let controller: AttendanceController;

  beforeEach(async () => {
    db = createDb();
    files = createFiles();
    controller = new AttendanceController(db, files);
    await controller.initialize();
  });

  it('loads the stored snapshot and notifies subscribers after initialization', async () => {
    const snapshot: StoredSnapshot = {
      state: { entries: [ENTRY] },
      meta: { fileName: 'attendance.csv', syncState: 'synced', revision: 4 },
    };
    const localDb = createDb(snapshot);
    const localController = new AttendanceController(localDb, files);
    const listener = vi.fn();
    localController.subscribe(listener);

    await localController.initialize();

    expect(localController.getSnapshot()).toEqual({ ...snapshot, initialized: true, error: null });
    expect(listener).toHaveBeenCalledOnce();
  });

  it('commits locally before writing the CSV', async () => {
    const events: string[] = [];
    const handle = { name: 'attendance.csv' } as FileSystemFileHandle;
    db = createDb({
      state: EMPTY_STATE,
      meta: { fileName: 'attendance.csv', syncState: 'synced', revision: 0 },
      fileHandle: handle,
    });
    db.save.mockImplementation(async () => { events.push('db'); });
    files = createFiles();
    files.writeDirect.mockImplementation(async () => { events.push('file'); });
    controller = new AttendanceController(db, files);
    await controller.initialize();

    await controller.clockIn(new Date('2026-08-15T08:43:00'));

    expect(events).toEqual(['db', 'file']);
    expect(db.replace).toHaveBeenCalledWith({
      state: controller.getSnapshot().state,
      meta: { fileName: 'attendance.csv', syncState: 'synced', revision: 1 },
      fileHandle: handle,
    });
    expect(controller.getSnapshot().meta).toEqual({ fileName: 'attendance.csv', syncState: 'synced', revision: 1 });
  });

  it('keeps local changes and marks pending after a file failure', async () => {
    const handle = { name: 'attendance.csv' } as FileSystemFileHandle;
    db = createDb({
      state: EMPTY_STATE,
      meta: { fileName: 'attendance.csv', syncState: 'synced', revision: 0 },
      fileHandle: handle,
    });
    files = createFiles();
    files.writeDirect.mockRejectedValue(new Error('disk full'));
    controller = new AttendanceController(db, files);
    await controller.initialize();

    await controller.clockIn(new Date('2026-08-15T08:43:00'));

    expect(controller.getSnapshot().meta.syncState).toBe('pending');
    expect(controller.getSnapshot().state.entries).toHaveLength(1);
    expect(controller.getSnapshot().error).toBe('disk full');
    expect(db.save).toHaveBeenCalledOnce();
  });

  it('marks local data permission-required when direct writing is denied', async () => {
    const handle = { name: 'attendance.csv' } as FileSystemFileHandle;
    db = createDb({
      state: EMPTY_STATE,
      meta: { fileName: 'attendance.csv', syncState: 'synced', revision: 0 },
      fileHandle: handle,
    });
    files = createFiles();
    files.writeDirect.mockRejectedValue(new FilePermissionError('denied'));
    controller = new AttendanceController(db, files);
    await controller.initialize();

    await controller.clockIn(new Date('2026-08-15T08:43:00'));

    expect(controller.getSnapshot().meta.syncState).toBe('permission-required');
    expect(db.replace).toHaveBeenCalledWith(expect.objectContaining({
      state: controller.getSnapshot().state,
      meta: expect.objectContaining({ syncState: 'permission-required' }),
      fileHandle: handle,
    }));
  });

  it('creates a chosen file and writes the current CSV to it', async () => {
    const handle = { name: 'attendance.csv' } as FileSystemFileHandle;
    files.chooseOrCreate.mockResolvedValue({ name: 'attendance.csv', text: '', handle } satisfies ImportedFile);

    await controller.chooseOrCreateFile();

    expect(files.writeDirect).toHaveBeenCalledWith(handle, 'date,clock_in,clock_out\n');
    expect(controller.getSnapshot().meta).toEqual({ fileName: 'attendance.csv', syncState: 'synced', revision: 1 });
  });

  it('renews permission and syncs the existing local state', async () => {
    const handle = { name: 'attendance.csv' } as FileSystemFileHandle;
    db = createDb({
      state: { entries: [ENTRY] },
      meta: { fileName: 'attendance.csv', syncState: 'permission-required', revision: 4 },
      fileHandle: handle,
    });
    files = createFiles();
    controller = new AttendanceController(db, files);
    await controller.initialize();

    await controller.requestFilePermission();

    expect(files.requestWritePermission).toHaveBeenCalledWith(handle);
    expect(files.writeDirect).toHaveBeenCalledWith(handle, CSV);
    expect(controller.getSnapshot().meta).toEqual({ fileName: 'attendance.csv', syncState: 'synced', revision: 5 });
  });

  it('keeps permission-required state if permission renewal is denied', async () => {
    const handle = { name: 'attendance.csv' } as FileSystemFileHandle;
    db = createDb({
      state: { entries: [ENTRY] },
      meta: { fileName: 'attendance.csv', syncState: 'permission-required', revision: 4 },
      fileHandle: handle,
    });
    files = createFiles();
    files.requestWritePermission.mockResolvedValue(false);
    controller = new AttendanceController(db, files);
    await controller.initialize();

    await controller.requestFilePermission();

    expect(files.writeDirect).not.toHaveBeenCalled();
    expect(controller.getSnapshot().meta.syncState).toBe('permission-required');
  });

  it('surfaces unexpected permission-renewal adapter failures without changing sync state', async () => {
    const handle = { name: 'attendance.csv' } as FileSystemFileHandle;
    db = createDb({
      state: { entries: [ENTRY] },
      meta: { fileName: 'attendance.csv', syncState: 'permission-required', revision: 4 },
      fileHandle: handle,
    });
    files = createFiles();
    files.requestWritePermission.mockRejectedValue(new Error('adapter unavailable'));
    controller = new AttendanceController(db, files);
    await controller.initialize();

    await expect(controller.requestFilePermission()).rejects.toThrow('adapter unavailable');

    expect(db.replace).not.toHaveBeenCalled();
    expect(controller.getSnapshot().meta.syncState).toBe('permission-required');
    expect(controller.getSnapshot().error).toBe('adapter unavailable');
  });

  it('does not misclassify a local persistence failure as permission denial', async () => {
    const handle = { name: 'attendance.csv' } as FileSystemFileHandle;
    db = createDb({
      state: { entries: [ENTRY] },
      meta: { fileName: 'attendance.csv', syncState: 'permission-required', revision: 4 },
      fileHandle: handle,
    });
    db.save.mockRejectedValue(new Error('IndexedDB unavailable'));
    files = createFiles();
    controller = new AttendanceController(db, files);
    await controller.initialize();

    await expect(controller.requestFilePermission()).rejects.toThrow('IndexedDB unavailable');

    expect(db.replace).not.toHaveBeenCalled();
    expect(controller.getSnapshot().meta.syncState).toBe('permission-required');
  });

  it('rejects when it cannot persist the permission-required transition', async () => {
    const handle = { name: 'attendance.csv' } as FileSystemFileHandle;
    db = createDb({
      state: EMPTY_STATE,
      meta: { fileName: 'attendance.csv', syncState: 'synced', revision: 0 },
      fileHandle: handle,
    });
    db.replace.mockRejectedValue(new Error('metadata database unavailable'));
    files = createFiles();
    files.writeDirect.mockRejectedValue(new FilePermissionError('denied'));
    controller = new AttendanceController(db, files);
    await controller.initialize();

    await expect(controller.clockIn(new Date('2026-08-15T08:43:00'))).rejects.toThrow('metadata database unavailable');

    expect(controller.getSnapshot().meta.syncState).toBe('pending');
    expect(controller.getSnapshot().error).toBe('metadata database unavailable');
  });

  it('imports valid CSV only after parsing and retains a direct file handle', async () => {
    const handle = { name: 'imported.csv' } as FileSystemFileHandle;
    files.importFile.mockResolvedValue({ name: 'imported.csv', text: CSV, handle } satisfies ImportedFile);

    await controller.importCsv();

    expect(db.replace).toHaveBeenCalledWith({
      state: { entries: [ENTRY] },
      meta: { fileName: 'imported.csv', syncState: 'synced', revision: 1 },
      fileHandle: handle,
    });
    expect(controller.getSnapshot().state).toEqual({ entries: [ENTRY] });
  });

  it('marks a handle-less imported snapshot synchronized', async () => {
    files.importFile.mockResolvedValue({ name: 'ios-attendance.csv', text: CSV } satisfies ImportedFile);

    await controller.importCsv();

    expect(db.replace).toHaveBeenCalledWith({
      state: { entries: [ENTRY] },
      meta: { fileName: 'ios-attendance.csv', syncState: 'synced', revision: 1 },
    });
    expect(controller.getSnapshot().meta).toEqual({
      fileName: 'ios-attendance.csv',
      syncState: 'synced',
      revision: 1,
    });
  });

  it('does not replace the local snapshot when import CSV is invalid', async () => {
    files.importFile.mockResolvedValue({ name: 'broken.csv', text: 'not CSV' } satisfies ImportedFile);

    await expect(controller.importCsv()).rejects.toThrow('invalid CSV header');

    expect(db.replace).not.toHaveBeenCalled();
    expect(controller.getSnapshot().state).toEqual(EMPTY_STATE);
  });

  it('requires an explicit discard before replacing unsynced local data', async () => {
    db = createDb({
      state: { entries: [ENTRY] },
      meta: { fileName: null, syncState: 'pending', revision: 1 },
    });
    files = createFiles();
    files.importFile.mockResolvedValue({ name: 'imported.csv', text: CSV } satisfies ImportedFile);
    controller = new AttendanceController(db, files);
    await controller.initialize();

    await expect(controller.importCsv()).rejects.toBeInstanceOf(PendingImportError);
    expect(files.importFile).not.toHaveBeenCalled();

    await controller.importCsv({ discardPending: true });
    expect(controller.getSnapshot().state).toEqual({ entries: [ENTRY] });
  });

  it.each(['pending', 'permission-required'] as const)(
    'protects an empty %s revision from replacement without explicit discard',
    async (syncState) => {
      db = createDb({
        state: EMPTY_STATE,
        meta: { fileName: 'attendance.csv', syncState, revision: 1 },
      });
      files = createFiles();
      files.importFile.mockResolvedValue({ name: 'imported.csv', text: CSV } satisfies ImportedFile);
      controller = new AttendanceController(db, files);
      await controller.initialize();

      await expect(controller.importCsv()).rejects.toBeInstanceOf(PendingImportError);

      expect(files.importFile).not.toHaveBeenCalled();
      expect(db.replace).not.toHaveBeenCalled();
    },
  );

  it('rechecks import safety after file selection before replacing newer local data', async () => {
    const imported = deferred<ImportedFile>();
    files.importFile.mockReturnValue(imported.promise);

    const importPromise = controller.importCsv();
    expect(files.importFile).toHaveBeenCalledOnce();
    await controller.clockIn(new Date('2026-08-15T08:43:00'));
    imported.resolve({ name: 'imported.csv', text: CSV });

    await expect(importPromise).rejects.toBeInstanceOf(PendingImportError);
    expect(db.replace).not.toHaveBeenCalled();
    expect(controller.getSnapshot().state.entries).toEqual([
      { date: '2026-08-15', clockIn: '08:43', clockOut: null },
    ]);
  });

  it('serializes direct writes so an older commit cannot overwrite a newer revision', async () => {
    const handle = { name: 'attendance.csv' } as FileSystemFileHandle;
    const firstWrite = deferred<void>();
    const secondWrite = deferred<void>();
    db = createDb({
      state: EMPTY_STATE,
      meta: { fileName: 'attendance.csv', syncState: 'synced', revision: 0 },
      fileHandle: handle,
    });
    files = createFiles();
    files.writeDirect
      .mockReturnValueOnce(firstWrite.promise)
      .mockReturnValueOnce(secondWrite.promise);
    controller = new AttendanceController(db, files);
    await controller.initialize();

    const clockIn = controller.clockIn(new Date('2026-08-15T08:43:00'));
    await vi.waitFor(() => expect(files.writeDirect).toHaveBeenCalledTimes(1));
    const clockOut = controller.clockOut(new Date('2026-08-15T17:12:00'));
    await Promise.resolve();

    expect(files.writeDirect).toHaveBeenCalledTimes(1);
    firstWrite.resolve();
    await vi.waitFor(() => expect(files.writeDirect).toHaveBeenCalledTimes(2));
    secondWrite.resolve();
    await Promise.all([clockIn, clockOut]);

    expect(controller.getSnapshot()).toMatchObject({
      state: { entries: [ENTRY] },
      meta: { fileName: 'attendance.csv', syncState: 'synced', revision: 2 },
    });
  });

  it('persists successful fallback export as synchronized using the effective filename', async () => {
    db = createDb({
      state: { entries: [ENTRY] },
      meta: { fileName: null, syncState: 'pending', revision: 1 },
    });
    files = createFiles();
    controller = new AttendanceController(db, files);
    await controller.initialize();

    await controller.exportCsv();

    expect(files.exportDownload).toHaveBeenCalledWith('attendance.csv', CSV);
    expect(db.replace).toHaveBeenCalledWith({
      state: { entries: [ENTRY] },
      meta: { fileName: 'attendance.csv', syncState: 'synced', revision: 1 },
    });
    expect(controller.getSnapshot().meta).toEqual({
      fileName: 'attendance.csv',
      syncState: 'synced',
      revision: 1,
    });
  });

  it.each([
    ['fails', new Error('Download failed')],
    ['is cancelled', new DOMException('Share cancelled', 'AbortError')],
  ])('leaves fallback export pending when the save or share handoff %s', async (_label, exportError) => {
    db = createDb({
      state: { entries: [ENTRY] },
      meta: { fileName: 'attendance.csv', syncState: 'pending', revision: 1 },
    });
    files = createFiles();
    files.exportDownload.mockRejectedValue(exportError);
    controller = new AttendanceController(db, files);
    await controller.initialize();

    await expect(controller.exportCsv()).rejects.toThrow(exportError.message);

    expect(db.replace).not.toHaveBeenCalled();
    expect(controller.getSnapshot().meta).toEqual({
      fileName: 'attendance.csv',
      syncState: 'pending',
      revision: 1,
    });
    expect(controller.getSnapshot().error).toContain(exportError.message);
  });

  it('reloads the synchronized metadata persisted after fallback export', async () => {
    durableDbSequence += 1;
    const durableDb = new AttendanceDb(`attendance-export-reload-${durableDbSequence}`);
    const firstFiles = createFiles();
    const firstController = new AttendanceController(durableDb, firstFiles);
    await firstController.initialize();
    await firstController.clockIn(new Date('2026-08-15T08:43:00'));

    await firstController.exportCsv();

    const reloaded = new AttendanceController(durableDb, createFiles());
    await reloaded.initialize();
    expect(reloaded.getSnapshot()).toMatchObject({
      state: { entries: [{ date: '2026-08-15', clockIn: '08:43', clockOut: null }] },
      meta: { fileName: 'attendance.csv', syncState: 'synced', revision: 1 },
      initialized: true,
      error: null,
    });
  });

  it('keeps a newer mutation pending when fallback export completes for an older revision', async () => {
    const exportHandoff = deferred<void>();
    db = createDb({
      state: { entries: [ENTRY] },
      meta: { fileName: 'attendance.csv', syncState: 'pending', revision: 1 },
    });
    files = createFiles();
    files.exportDownload.mockReturnValue(exportHandoff.promise);
    controller = new AttendanceController(db, files);
    await controller.initialize();

    const exportPromise = controller.exportCsv();
    await vi.waitFor(() => expect(files.exportDownload).toHaveBeenCalledOnce());
    await controller.clockIn(new Date('2026-08-16T09:00:00'));
    exportHandoff.resolve();
    await exportPromise;

    expect(controller.getSnapshot()).toMatchObject({
      state: { entries: [ENTRY, { date: '2026-08-16', clockIn: '09:00', clockOut: null }] },
      meta: { fileName: 'attendance.csv', syncState: 'pending', revision: 2 },
    });
    expect(db.replace).not.toHaveBeenCalledWith(expect.objectContaining({
      meta: expect.objectContaining({ syncState: 'synced', revision: 1 }),
    }));
  });

  it('edits and deletes entries through the durable commit path', async () => {
    db = createDb({
      state: { entries: [ENTRY] },
      meta: { fileName: null, syncState: 'pending', revision: 1 },
    });
    files = createFiles();
    controller = new AttendanceController(db, files);
    await controller.initialize();

    await controller.updateEntry('2026-08-15', { ...ENTRY, clockOut: '18:00' });
    await controller.deleteEntry('2026-08-15');

    expect(controller.getSnapshot().state).toEqual(EMPTY_STATE);
    expect(controller.getSnapshot().meta.revision).toBe(3);
    expect(db.save).toHaveBeenLastCalledWith(
      EMPTY_STATE,
      { fileName: null, syncState: 'pending', revision: 3 },
      undefined,
    );
  });
});
