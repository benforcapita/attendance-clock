import { afterEach, describe, expect, it, vi } from 'vitest';
import { BrowserFileAdapter, FilePermissionError } from './fileAdapter';

const originalSavePicker = window.showSaveFilePicker;
const originalOpenPicker = window.showOpenFilePicker;
const originalCreateObjectUrl = URL.createObjectURL;
const originalRevokeObjectUrl = URL.revokeObjectURL;
const originalShare = navigator.share;
const originalCanShare = navigator.canShare;

afterEach(() => {
  Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: originalSavePicker });
  Object.defineProperty(window, 'showOpenFilePicker', { configurable: true, value: originalOpenPicker });
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: originalCreateObjectUrl });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: originalRevokeObjectUrl });
  Object.defineProperty(navigator, 'share', { configurable: true, value: originalShare });
  Object.defineProperty(navigator, 'canShare', { configurable: true, value: originalCanShare });
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function setSavePicker(value: unknown): void {
  Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value });
}

function setOpenPicker(value: unknown): void {
  Object.defineProperty(window, 'showOpenFilePicker', { configurable: true, value });
}

describe('BrowserFileAdapter', () => {
  it('detects direct file access only when both browser pickers are available', () => {
    setSavePicker(vi.fn());
    setOpenPicker(vi.fn());
    expect(new BrowserFileAdapter().supportsDirectAccess()).toBe(true);

    setOpenPicker(undefined);
    expect(new BrowserFileAdapter().supportsDirectAccess()).toBe(false);
  });

  it('creates a CSV file with the native save picker when supported', async () => {
    const handle = { name: 'attendance.csv' };
    const picker = vi.fn().mockResolvedValue(handle);
    setSavePicker(picker);

    await expect(new BrowserFileAdapter().chooseOrCreate()).resolves.toEqual({
      name: 'attendance.csv', handle,
      text: '',
    });
    expect(picker).toHaveBeenCalledWith({
      suggestedName: 'attendance.csv',
      types: [{ description: 'CSV files', accept: { 'text/csv': ['.csv'] } }],
    });
  });

  it('propagates native picker cancellation', async () => {
    const cancellation = new DOMException('cancelled', 'AbortError');
    setSavePicker(vi.fn().mockRejectedValue(cancellation));

    await expect(new BrowserFileAdapter().chooseOrCreate()).rejects.toBe(cancellation);
  });

  it('imports the selected native file and retains its handle', async () => {
    const handle = {
      getFile: vi.fn().mockResolvedValue({ name: 'existing.csv', text: vi.fn().mockResolvedValue('csv') }),
    };
    setOpenPicker(vi.fn().mockResolvedValue([handle]));

    await expect(new BrowserFileAdapter().importFile()).resolves.toEqual({ name: 'existing.csv', text: 'csv', handle });
  });

  it('writes through a granted desktop file handle and closes after writing', async () => {
    const writable = { write: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined) };
    const handle = {
      queryPermission: vi.fn().mockResolvedValue('granted'),
      createWritable: vi.fn().mockResolvedValue(writable),
    };

    await new BrowserFileAdapter().writeDirect(handle as never, 'csv');

    expect(writable.write).toHaveBeenCalledWith('csv');
    expect(writable.close).toHaveBeenCalledAfter(writable.write as never);
  });

  it('throws a typed permission error without attempting a write', async () => {
    const handle = { queryPermission: vi.fn().mockResolvedValue('denied'), createWritable: vi.fn() };

    await expect(new BrowserFileAdapter().writeDirect(handle as never, 'csv')).rejects.toBeInstanceOf(FilePermissionError);
    expect(handle.createWritable).not.toHaveBeenCalled();
  });

  it('maps a permission denial while opening the writable stream to a typed error', async () => {
    const handle = {
      queryPermission: vi.fn().mockResolvedValue('granted'),
      createWritable: vi.fn().mockRejectedValue(new DOMException('revoked', 'NotAllowedError')),
    };

    await expect(new BrowserFileAdapter().writeDirect(handle as never, 'csv')).rejects.toBeInstanceOf(FilePermissionError);
  });

  it('preserves a primary write failure when closing the stream also fails', async () => {
    const writeFailure = new DOMException('revoked', 'NotAllowedError');
    const closeFailure = new Error('close failed');
    const writable = {
      write: vi.fn().mockRejectedValue(writeFailure),
      close: vi.fn().mockRejectedValue(closeFailure),
    };
    const handle = {
      queryPermission: vi.fn().mockResolvedValue('granted'),
      createWritable: vi.fn().mockResolvedValue(writable),
    };

    await expect(new BrowserFileAdapter().writeDirect(handle as never, 'csv')).rejects.toBeInstanceOf(FilePermissionError);
    expect(writable.close).toHaveBeenCalledOnce();
  });

  it('maps a permission denial while closing a successfully written stream to a typed error', async () => {
    const writable = {
      write: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockRejectedValue(new DOMException('revoked', 'NotAllowedError')),
    };
    const handle = {
      queryPermission: vi.fn().mockResolvedValue('granted'),
      createWritable: vi.fn().mockResolvedValue(writable),
    };

    await expect(new BrowserFileAdapter().writeDirect(handle as never, 'csv')).rejects.toBeInstanceOf(FilePermissionError);
  });

  it('requests write permission when the existing permission is not granted', async () => {
    const handle = {
      queryPermission: vi.fn().mockResolvedValue('prompt'),
      requestPermission: vi.fn().mockResolvedValue('granted'),
    };

    await expect(new BrowserFileAdapter().requestWritePermission(handle as never)).resolves.toBe(true);
    expect(handle.requestPermission).toHaveBeenCalledWith({ mode: 'readwrite' });
  });

  it('returns false when write permission is denied', async () => {
    const handle = {
      queryPermission: vi.fn().mockResolvedValue('denied'),
      requestPermission: vi.fn().mockResolvedValue('denied'),
    };

    await expect(new BrowserFileAdapter().requestWritePermission(handle as never)).resolves.toBe(false);
  });

  it('imports through a temporary file input when native access is unavailable', async () => {
    setOpenPicker(undefined);
    const adapter = new BrowserFileAdapter();
    const imported = adapter.importFile();
    const input = document.querySelector('input[type=file]') as HTMLInputElement;
    const file = { name: 'phone.csv', text: vi.fn().mockResolvedValue('mobile csv') } as unknown as File;
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    input.dispatchEvent(new Event('change'));

    await expect(imported).resolves.toEqual({ name: 'phone.csv', text: 'mobile csv' });
    expect(document.querySelector('input[type=file]')).toBeNull();
  });

  it('rejects and removes the temporary input when fallback selection is cancelled', async () => {
    setOpenPicker(undefined);
    const imported = new BrowserFileAdapter().importFile();
    const input = document.querySelector('input[type=file]') as HTMLInputElement;

    input.dispatchEvent(new Event('cancel'));

    await expect(imported).rejects.toMatchObject({ name: 'AbortError' });
    expect(document.querySelector('input[type=file]')).toBeNull();
  });

  it('uses focus return as a cancellation fallback when the file input does not emit cancel', async () => {
    vi.useFakeTimers();
    setOpenPicker(undefined);
    const imported = new BrowserFileAdapter().importFile();
    const rejected = expect(imported).rejects.toMatchObject({ name: 'AbortError' });
    window.dispatchEvent(new Event('blur'));
    window.dispatchEvent(new Event('focus'));
    await vi.runAllTimersAsync();

    await rejected;
    expect(document.querySelector('input[type=file]')).toBeNull();
  });

  it('shares a CSV file when browser file sharing is available', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'share', { configurable: true, value: share });
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: vi.fn().mockReturnValue(true) });

    await new BrowserFileAdapter().exportDownload('attendance.csv', 'csv');

    expect(share).toHaveBeenCalledWith(expect.objectContaining({ files: [expect.any(File)] }));
  });

  it('downloads a CSV and cleans up its temporary URL when sharing is unavailable', async () => {
    Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: undefined });
    const createObjectURL = vi.fn().mockReturnValue('blob:attendance');
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

    await new BrowserFileAdapter().exportDownload('attendance.csv', 'csv');

    expect(click).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:attendance');
    expect(document.querySelector('a[download]')).toBeNull();
  });
});
