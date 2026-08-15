import { afterEach, describe, expect, it } from 'vitest';
import { AttendanceDb, type StoredSnapshot } from './attendanceDb';

const databaseNames: string[] = [];

function databaseName(): string {
  const name = `attendance-db-test-${crypto.randomUUID()}`;
  databaseNames.push(name);
  return name;
}

function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

afterEach(async () => {
  await Promise.all(databaseNames.splice(0).map(deleteDatabase));
});

describe('AttendanceDb', () => {
  it('returns an empty pending snapshot before anything is saved', async () => {
    const snapshot = await new AttendanceDb(databaseName()).load();

    expect(snapshot).toEqual({
      state: { entries: [] },
      meta: { fileName: null, syncState: 'pending', revision: 0 },
    });
  });

  it('persists state and metadata across repository instances', async () => {
    const name = databaseName();
    await new AttendanceDb(name).save(
      { entries: [{ date: '2026-08-15', clockIn: '08:43', clockOut: null }] },
      { fileName: 'attendance.csv', syncState: 'pending', revision: 1 },
    );

    expect(await new AttendanceDb(name).load()).toEqual({
      state: { entries: [{ date: '2026-08-15', clockIn: '08:43', clockOut: null }] },
      meta: { fileName: 'attendance.csv', syncState: 'pending', revision: 1 },
    });
  });

  it('atomically replaces the stored snapshot', async () => {
    const name = databaseName();
    const database = new AttendanceDb(name);
    await database.save(
      { entries: [{ date: '2026-08-15', clockIn: '08:43', clockOut: null }] },
      { fileName: null, syncState: 'pending', revision: 1 },
    );
    const replacement: StoredSnapshot = {
      state: { entries: [{ date: '2026-08-15', clockIn: '08:43', clockOut: '17:12' }] },
      meta: { fileName: 'attendance.csv', syncState: 'synced', revision: 2 },
    };

    await database.replace(replacement);

    expect(await database.load()).toEqual(replacement);
  });

  it('rejects a save when IndexedDB cannot clone the snapshot', async () => {
    const name = databaseName();

    await expect(new AttendanceDb(name).save(
      { entries: [] },
      { fileName: null, syncState: 'pending', revision: 1 },
      { uncloneable: () => undefined } as unknown as FileSystemFileHandle,
    )).rejects.toBeInstanceOf(Error);
  });
});
