export type ImportedFile = {
  name: string;
  text: string;
  handle?: FileSystemFileHandle;
};

export type DirectoryFile = {
  directoryHandle: FileSystemDirectoryHandle;
  name: string;
  text: string;
};

export interface FileAdapter {
  supportsDirectAccess(): boolean;
  supportsDirectories(): boolean;
  chooseFolder(): Promise<{ name: string; handle: FileSystemDirectoryHandle; existingCsv?: string }>;
  chooseOrCreate(): Promise<ImportedFile>;
  importFile(): Promise<ImportedFile>;
  writeDirect(handle: FileSystemFileHandle, csv: string): Promise<void>;
  writeDirectInFolder(handle: FileSystemDirectoryHandle, name: string, csv: string): Promise<void>;
  requestWritePermission(handle: FileSystemFileHandle): Promise<boolean>;
  requestFolderWritePermission(handle: FileSystemDirectoryHandle): Promise<boolean>;
  exportDownload(name: string, csv: string): Promise<void>;
}

export class FilePermissionError extends Error {
  constructor(message = 'Permission to write the attendance CSV was denied') {
    super(message);
    this.name = 'FilePermissionError';
  }
}

const CSV_FILE_TYPES: FilePickerAcceptType[] = [
  { description: 'CSV files', accept: { 'text/csv': ['.csv'] } },
];

export class BrowserFileAdapter implements FileAdapter {
  supportsDirectAccess(): boolean {
    return typeof window.showSaveFilePicker === 'function'
      && typeof window.showOpenFilePicker === 'function';
  }

  supportsDirectories(): boolean {
    return typeof window.showDirectoryPicker === 'function';
  }

  async chooseFolder(): Promise<{ name: string; handle: FileSystemDirectoryHandle; existingCsv?: string }> {
    if (typeof window.showDirectoryPicker !== 'function') {
      throw new FilePermissionError('Folder selection is unavailable in this browser');
    }
    const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
    try {
      const existing = await handle.getFileHandle('attendance.csv');
      const file = await existing.getFile();
      return { name: handle.name, handle, existingCsv: await file.text() };
    } catch (error) {
      if (error instanceof DOMException && error.name === 'NotFoundError') {
        return { name: handle.name, handle };
      }
      throw error;
    }
  }

  async chooseOrCreate(): Promise<ImportedFile> {
    if (typeof window.showSaveFilePicker !== 'function') {
      throw new FilePermissionError('Direct file access is unavailable in this browser');
    }

    const handle = await window.showSaveFilePicker({
      suggestedName: 'attendance.csv',
      types: CSV_FILE_TYPES,
    });
    return { name: handle.name, text: '', handle };
  }

  async importFile(): Promise<ImportedFile> {
    if (typeof window.showOpenFilePicker === 'function') {
      const [handle] = await window.showOpenFilePicker({ multiple: false, types: CSV_FILE_TYPES });
      if (!handle) {
        throw new DOMException('No file selected', 'AbortError');
      }
      const file = await handle.getFile();
      return { name: file.name, text: await file.text(), handle };
    }

    return this.importWithInput();
  }

  async writeDirect(handle: FileSystemFileHandle, csv: string): Promise<void> {
    if (!await this.hasWritePermission(handle)) {
      throw new FilePermissionError();
    }

    let writable: FileSystemWritableFileStream;
    try {
      writable = await handle.createWritable();
    } catch (error) {
      throw this.normalizePermissionError(error);
    }

    try {
      await writable.write(csv);
    } catch (error) {
      // close() commits the temporary file. Abort on write failure so the
      // previous CSV is preserved, even if cleanup itself also fails.
      try { await writable.abort(); } catch { /* Preserve the original error. */ }
      throw this.normalizePermissionError(error);
    }
    try {
      await writable.close();
    } catch (error) {
      throw this.normalizePermissionError(error);
    }
  }

  async writeDirectInFolder(handle: FileSystemDirectoryHandle, name: string, csv: string): Promise<void> {
    let fileHandle: FileSystemFileHandle;
    try {
      fileHandle = await handle.getFileHandle(name, { create: true });
    } catch (error) {
      throw this.normalizePermissionError(error);
    }
    await this.writeDirect(fileHandle, csv);
  }

  async requestWritePermission(handle: FileSystemFileHandle): Promise<boolean> {
    if (await this.hasWritePermission(handle)) {
      return true;
    }
    return (await handle.requestPermission({ mode: 'readwrite' })) === 'granted';
  }

  async requestFolderWritePermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
    if (await this.hasFolderWritePermission(handle)) {
      return true;
    }
    return (await handle.requestPermission({ mode: 'readwrite' })) === 'granted';
  }

  async exportDownload(name: string, csv: string): Promise<void> {
    const file = new File([csv], name, { type: 'text/csv;charset=utf-8' });
    if (typeof navigator.share === 'function'
      && typeof navigator.canShare === 'function'
      && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file] });
      return;
    }

    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.style.display = 'none';
    document.body.append(link);
    try {
      link.click();
    } finally {
      link.remove();
      URL.revokeObjectURL(url);
    }
  }

  private async hasWritePermission(handle: FileSystemFileHandle): Promise<boolean> {
    return (await handle.queryPermission({ mode: 'readwrite' })) === 'granted';
  }

  private async hasFolderWritePermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
    return (await handle.queryPermission({ mode: 'readwrite' })) === 'granted';
  }

  private normalizePermissionError(error: unknown): unknown {
    if (error instanceof DOMException && error.name === 'NotAllowedError') {
      return new FilePermissionError(error.message);
    }
    return error;
  }

  private importWithInput(): Promise<ImportedFile> {
    return new Promise((resolve, reject) => {
      const input = document.createElement('input');
      let settled = false;
      let pickerBlurred = false;
      input.type = 'file';
      input.accept = '.csv,text/csv';
      input.style.display = 'none';

      const cleanup = () => {
        input.removeEventListener('change', onChange);
        input.removeEventListener('cancel', cancel);
        window.removeEventListener('blur', markPickerBlurred);
        window.removeEventListener('focus', cancelAfterFocus);
        input.remove();
      };
      const fail = (error: unknown) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      };
      const succeed = (file: ImportedFile) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(file);
      };
      const cancel = () => fail(new DOMException('No file selected', 'AbortError'));
      const markPickerBlurred = () => {
        pickerBlurred = true;
      };
      const cancelAfterFocus = () => {
        if (!pickerBlurred) return;
        window.setTimeout(() => {
          if (!input.files?.length) cancel();
        }, 0);
      };
      const onChange = async () => {
        try {
          const file = input.files?.[0];
          if (!file) {
            cancel();
            return;
          }
          succeed({ name: file.name, text: await file.text() });
        } catch (error) {
          fail(error);
        }
      };
      input.addEventListener('change', onChange);
      input.addEventListener('cancel', cancel, { once: true });
      window.addEventListener('blur', markPickerBlurred, { once: true });
      window.addEventListener('focus', cancelAfterFocus);
      document.body.append(input);
      try {
        input.click();
      } catch (error) {
        fail(error);
      }
    });
  }
}
