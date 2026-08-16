import type { AttendanceState } from '../domain/attendance';

export type SyncState = 'synced' | 'pending' | 'permission-required';

export type PersistenceMeta = {
  fileName: string | null;
  syncState: SyncState;
  revision: number;
};

export type StoredSnapshot = {
  state: AttendanceState;
  meta: PersistenceMeta;
  fileHandle?: FileSystemFileHandle;
  directoryHandle?: FileSystemDirectoryHandle;
};

const STORE_NAME = 'app';
const SNAPSHOT_KEY = 'snapshot';

function emptySnapshot(): StoredSnapshot {
  return {
    state: { entries: [] },
    meta: { fileName: null, syncState: 'pending', revision: 0 },
  };
}

function openDatabase(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Unable to open attendance database'));
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Attendance database request failed'));
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('Attendance database transaction failed'));
    transaction.onabort = () => reject(transaction.error ?? new Error('Attendance database transaction aborted'));
  });
}

export class AttendanceDb {
  constructor(private readonly name = 'attendance-clock') {}

  async load(): Promise<StoredSnapshot> {
    const database = await openDatabase(this.name);
    try {
      const transaction = database.transaction(STORE_NAME, 'readonly');
      const result = requestResult(transaction.objectStore(STORE_NAME).get(SNAPSHOT_KEY));
      const complete = transactionComplete(transaction);
      const [snapshot] = await Promise.all([result, complete]);
      return snapshot ?? emptySnapshot();
    } finally {
      database.close();
    }
  }

  async save(
    state: AttendanceState,
    meta: PersistenceMeta,
    fileHandle?: FileSystemFileHandle,
    directoryHandle?: FileSystemDirectoryHandle,
  ): Promise<void> {
    const snapshot: StoredSnapshot = {
      state,
      meta,
      ...(fileHandle ? { fileHandle } : {}),
      ...(directoryHandle ? { directoryHandle } : {}),
    };
    await this.write(snapshot);
  }

  async replace(snapshot: StoredSnapshot): Promise<void> {
    await this.write(snapshot);
  }

  private async write(snapshot: StoredSnapshot): Promise<void> {
    const database = await openDatabase(this.name);
    try {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).put(snapshot, SNAPSHOT_KEY);
      await transactionComplete(transaction);
    } finally {
      database.close();
    }
  }
}
