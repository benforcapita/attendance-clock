import {
  clockIn as clockInState,
  clockOut as clockOutState,
  deleteEntry as deleteEntryFromState,
  updateEntry as updateEntryInState,
  type AttendanceEntry,
  type AttendanceState,
} from '../domain/attendance';
import { parseAttendanceCsv, serializeAttendanceCsv } from '../csv/attendanceCsv';
import { FilePermissionError, type FileAdapter } from '../files/fileAdapter';
import {
  type AttendanceDb,
  type PersistenceMeta,
  type StoredSnapshot,
} from '../storage/attendanceDb';

export type ControllerSnapshot = StoredSnapshot & {
  initialized: boolean;
  error: string | null;
};

export class PendingImportError extends Error {
  constructor(message = 'Export or discard pending local changes before importing a CSV') {
    super(message);
    this.name = 'PendingImportError';
  }
}

type CommitTarget = {
  fileName?: string | null;
  fileHandle?: FileSystemFileHandle;
};

function initialSnapshot(): ControllerSnapshot {
  return {
    state: { entries: [] },
    meta: { fileName: null, syncState: 'pending', revision: 0 },
    initialized: false,
    error: null,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class AttendanceController {
  private snapshot: ControllerSnapshot = initialSnapshot();

  private readonly listeners = new Set<() => void>();

  private mutationTail: Promise<void> = Promise.resolve();

  private initialization: Promise<void> | null = null;

  constructor(
    private readonly db: AttendanceDb,
    private readonly files: FileAdapter,
  ) {}

  async initialize(): Promise<void> {
    if (this.initialization) return this.initialization;

    this.initialization = this.loadInitialSnapshot();
    try {
      await this.initialization;
    } finally {
      this.initialization = null;
    }
  }

  private async loadInitialSnapshot(): Promise<void> {
    try {
      const snapshot = await this.db.load();
      this.setSnapshot({ ...snapshot, initialized: true, error: null });
    } catch (error) {
      this.setSnapshot({ ...this.snapshot, initialized: false, error: errorMessage(error) });
      throw error;
    }
  }

  getSnapshot(): ControllerSnapshot {
    return this.snapshot;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async clockIn(now = new Date()): Promise<void> {
    await this.enqueueMutation(() => this.commit(clockInState(this.currentState(), now)));
  }

  async clockOut(now = new Date()): Promise<void> {
    await this.enqueueMutation(() => this.commit(clockOutState(this.currentState(), now)));
  }

  async updateEntry(originalDate: string, entry: AttendanceEntry): Promise<void> {
    await this.enqueueMutation(() => this.commit(updateEntryInState(this.currentState(), originalDate, entry)));
  }

  async deleteEntry(date: string): Promise<void> {
    await this.enqueueMutation(() => this.commit(deleteEntryFromState(this.currentState(), date)));
  }

  async chooseOrCreateFile(): Promise<void> {
    this.ensureInitialized();
    try {
      const file = await this.files.chooseOrCreate();
      await this.enqueueMutation(() => this.commit(
        this.snapshot.state,
        { fileName: file.name, fileHandle: file.handle },
      ));
    } catch (error) {
      this.setError(errorMessage(error));
      throw error;
    }
  }

  async importCsv(options?: { discardPending?: boolean }): Promise<void> {
    this.ensureInitialized();
    const startingRevision = this.snapshot.meta.revision;
    if (this.hasPendingChanges() && options?.discardPending !== true) {
      throw new PendingImportError();
    }

    let imported: Awaited<ReturnType<FileAdapter['importFile']>>;
    let state: AttendanceState;
    try {
      imported = await this.files.importFile();
      state = parseAttendanceCsv(imported.text);
    } catch (error) {
      this.setError(errorMessage(error));
      throw error;
    }

    await this.enqueueMutation(async () => {
      if (this.snapshot.meta.revision !== startingRevision
        || (this.hasPendingChanges() && options?.discardPending !== true)) {
        throw new PendingImportError();
      }
      const meta: PersistenceMeta = {
        fileName: imported.name,
        syncState: 'synced',
        revision: this.snapshot.meta.revision + 1,
      };
      const next: StoredSnapshot = imported.handle === undefined
        ? { state, meta }
        : { state, meta, fileHandle: imported.handle };
      try {
        await this.db.replace(next);
      } catch (error) {
        this.setError(errorMessage(error));
        throw error;
      }
      this.setSnapshot({ ...next, initialized: true, error: null });
    });
  }

  async exportCsv(): Promise<void> {
    this.ensureInitialized();
    const exportedRevision = this.snapshot.meta.revision;
    const fileName = this.snapshot.meta.fileName ?? 'attendance.csv';
    try {
      await this.files.exportDownload(fileName, serializeAttendanceCsv(this.snapshot.state));
    } catch (error) {
      this.setError(errorMessage(error));
      throw error;
    }

    await this.enqueueMutation(async () => {
      if (this.snapshot.meta.revision !== exportedRevision) return;

      const meta: PersistenceMeta = {
        ...this.snapshot.meta,
        fileName,
        syncState: 'synced',
      };
      const synchronized: StoredSnapshot = this.snapshot.fileHandle === undefined
        ? { state: this.snapshot.state, meta }
        : { state: this.snapshot.state, meta, fileHandle: this.snapshot.fileHandle };
      try {
        await this.db.replace(synchronized);
      } catch (error) {
        this.setError(errorMessage(error));
        throw error;
      }
      this.setSnapshot({ ...synchronized, initialized: true, error: null });
    });
  }

  async requestFilePermission(): Promise<void> {
    this.ensureInitialized();
    const handle = this.snapshot.fileHandle;
    if (!handle) {
      await this.enqueueMutation(() => this.markPermissionRequired('No attendance file is selected'));
      return;
    }

    let granted: boolean;
    try {
      granted = await this.files.requestWritePermission(handle);
    } catch (error) {
      if (error instanceof FilePermissionError) {
        await this.enqueueMutation(() => this.markPermissionRequired(errorMessage(error)));
        return;
      }
      this.setError(errorMessage(error));
      throw error;
    }

    await this.enqueueMutation(async () => {
      if (this.snapshot.fileHandle !== handle) {
        const error = new Error('Attendance file changed while permission was requested');
        this.setError(error.message);
        throw error;
      }

      if (granted) {
        await this.commit(this.snapshot.state);
        return;
      }
      await this.markPermissionRequired('Permission to write the attendance CSV was denied');
    });
  }

  private async commit(nextState: AttendanceState, target: CommitTarget = {}): Promise<void> {
    this.ensureInitialized();
    const fileName = 'fileName' in target ? target.fileName ?? null : this.snapshot.meta.fileName;
    const fileHandle = 'fileHandle' in target ? target.fileHandle : this.snapshot.fileHandle;
    const meta: PersistenceMeta = {
      fileName,
      syncState: 'pending',
      revision: this.snapshot.meta.revision + 1,
    };

    await this.db.save(nextState, meta, fileHandle);
    this.setSnapshot({ state: nextState, meta, ...(fileHandle ? { fileHandle } : {}), initialized: true, error: null });

    if (!fileHandle) return;

    try {
      await this.files.writeDirect(fileHandle, serializeAttendanceCsv(nextState));
      const syncedMeta: PersistenceMeta = { ...meta, syncState: 'synced' };
      await this.db.replace({ state: nextState, meta: syncedMeta, fileHandle });
      this.setSnapshot({
        state: nextState,
        meta: syncedMeta,
        fileHandle,
        initialized: true,
        error: null,
      });
    } catch (error) {
      if (error instanceof FilePermissionError) {
        await this.markPermissionRequired(errorMessage(error));
        return;
      }
      this.setError(errorMessage(error));
    }
  }

  private async markPermissionRequired(error: string): Promise<void> {
    const meta: PersistenceMeta = { ...this.snapshot.meta, syncState: 'permission-required' };
    try {
      const snapshot: StoredSnapshot = this.snapshot.fileHandle === undefined
        ? { state: this.snapshot.state, meta }
        : { state: this.snapshot.state, meta, fileHandle: this.snapshot.fileHandle };
      await this.db.replace(snapshot);
      this.setSnapshot({
        state: this.snapshot.state,
        meta,
        ...(this.snapshot.fileHandle ? { fileHandle: this.snapshot.fileHandle } : {}),
        initialized: true,
        error,
      });
    } catch (saveError) {
      this.setError(errorMessage(saveError));
      throw saveError;
    }
  }

  private currentState(): AttendanceState {
    this.ensureInitialized();
    return this.snapshot.state;
  }

  private hasPendingChanges(): boolean {
    return this.snapshot.meta.revision > 0 && this.snapshot.meta.syncState !== 'synced';
  }

  private enqueueMutation<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationTail.then(operation, operation);
    this.mutationTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private ensureInitialized(): void {
    if (!this.snapshot.initialized) {
      throw new Error('Attendance controller has not been initialized');
    }
  }

  private setError(error: string | null): void {
    if (this.snapshot.error === error) return;
    this.setSnapshot({ ...this.snapshot, error });
  }

  private setSnapshot(snapshot: ControllerSnapshot): void {
    this.snapshot = snapshot;
    for (const listener of this.listeners) listener();
  }
}
