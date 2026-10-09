import { useEffect, useRef, useState } from 'react';
import { PendingImportError, type ControllerSnapshot } from '../application/attendanceController';

type SettingsDrawerProps = {
  open: boolean;
  onClose: () => void;
  snapshot: ControllerSnapshot;
  folderSupported?: boolean;
  onChooseFolder?: () => Promise<void>;
  onImport: (options?: { discardPending?: boolean }) => Promise<void>;
  onExport: () => Promise<void>;
  onGrantAccess?: () => Promise<void>;
};

function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function SettingsDrawer({
  open,
  onClose,
  snapshot,
  folderSupported = false,
  onChooseFolder,
  onImport,
  onExport,
  onGrantAccess,
}: SettingsDrawerProps) {
  const [isBusy, setIsBusy] = useState(false);
  const [pendingImport, setPendingImport] = useState(false);
  const [backupExported, setBackupExported] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const pendingDialogRef = useRef<HTMLDialogElement>(null);
  const pendingExportRef = useRef<HTMLButtonElement>(null);
  const importButtonRef = useRef<HTMLButtonElement>(null);

  const closePendingImport = () => {
    const dialog = pendingDialogRef.current;
    if (dialog?.open) dialog.close();
    setPendingImport(false);
    setBackupExported(false);
    window.setTimeout(() => importButtonRef.current?.focus(), 0);
  };

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  useEffect(() => {
    if (!pendingImport) return;
    const dialog = pendingDialogRef.current;
    if (!dialog) return;
    dialog.showModal();
    pendingExportRef.current?.focus();
  }, [pendingImport]);

  const run = async (action: () => Promise<void>) => {
    setIsBusy(true);
    setError(null);
    try {
      await action();
      return true;
    } catch (actionError) {
      setError(messageFor(actionError));
      return false;
    } finally {
      setIsBusy(false);
    }
  };

  const importCsv = async (discardPending = false) => {
    setIsBusy(true);
    setError(null);
    try {
      await onImport(discardPending ? { discardPending: true } : undefined);
      if (discardPending) closePendingImport();
    } catch (importError) {
      if (importError instanceof PendingImportError) {
        setPendingImport(true);
      } else {
        setError(messageFor(importError));
      }
    } finally {
      setIsBusy(false);
    }
  };

  const exportPending = async () => {
    if (!await run(onExport)) return;
    if ((snapshot.fileHandle || snapshot.directoryHandle) && snapshot.meta.syncState !== 'synced') {
      setBackupExported(true);
    } else {
      closePendingImport();
    }
  };

  const fileName = snapshot.meta.fileName ?? 'No CSV selected';
  const hasFolder = Boolean(snapshot.directoryHandle);
  const hasFile = Boolean(snapshot.fileHandle);

  return (
    <dialog
      ref={dialogRef}
      className="settings-drawer"
      aria-label="Settings"
      onClose={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      onCancel={(event) => {
        if (event.target !== event.currentTarget) return;
        event.preventDefault();
        if (!isBusy) onClose();
      }}
    >
      <header className="settings-drawer__header">
        <h2 id="settings-heading">Settings</h2>
        <button
          className="settings-drawer__close"
          type="button"
          aria-label="Close settings"
          onClick={onClose}
          disabled={isBusy}
        >
          ✕
        </button>
      </header>

      <section className="settings-section" aria-labelledby="settings-storage-heading">
        <h3 id="settings-storage-heading">Storage folder</h3>
        <p className="settings-section__hint">
          {folderSupported
            ? 'Choose an empty folder to save attendance.csv automatically. Existing files are never replaced when choosing a folder.'
            : 'This browser saves attendance locally. Use Export CSV to back up to Files and Import CSV to restore it.'}
        </p>
        <p className="file-menu__filename"><span className="visually-hidden">Selected storage: </span>{hasFolder ? `${snapshot.directoryHandle!.name} / attendance.csv` : fileName}</p>
        {hasFolder && (
          <p className="settings-section__capability">{snapshot.meta.syncState === 'synced' ? 'CSV saved to this folder' : 'Local changes are waiting to be saved to this folder'}</p>
        )}
        {!hasFolder && !hasFile && (
          <p className="settings-section__capability">Local browser storage</p>
        )}
        {folderSupported && <button
          type="button"
          onClick={() => onChooseFolder && void run(onChooseFolder)}
          disabled={isBusy || !folderSupported || !onChooseFolder}
        >
          Choose folder
        </button>}
      </section>

      <section className="settings-section" aria-labelledby="settings-data-heading">
        <h3 id="settings-data-heading">Data</h3>
        <div className="file-menu__actions">
          <button ref={importButtonRef} type="button" onClick={() => void importCsv()} disabled={isBusy}>Import CSV</button>
          <button type="button" onClick={() => void run(onExport)} disabled={isBusy}>Export CSV</button>
        </div>
        {snapshot.meta.syncState === 'permission-required' && onGrantAccess && (
          <div className="file-menu__actions">
            <button type="button" onClick={() => void run(onGrantAccess)} disabled={isBusy}>Grant access</button>
          </div>
        )}
      </section>

      {!pendingImport && (error ?? snapshot.error) && <p className="attendance-error" role="alert">{error ?? snapshot.error}</p>}

      {pendingImport && (
        <dialog
          ref={pendingDialogRef}
          className="file-menu__dialog"
          aria-label="Pending local changes"
          onCancel={(event) => {
            event.stopPropagation();
            event.preventDefault();
            if (!isBusy) closePendingImport();
          }}
        >
          <h2>Export local changes first?</h2>
          <p>Importing a CSV replaces your local records. Export a backup first. If the selected file or folder still needs a save, use Discard and import after backing up.</p>
          {backupExported && <p role="status">Backup exported. The selected file or folder has not been updated. You can now discard and import to replace your local records.</p>}
          {(error ?? snapshot.error) && <p className="attendance-error" role="alert">{error ?? snapshot.error}</p>}
          <div className="dialog-actions">
            <button type="button" onClick={closePendingImport} disabled={isBusy}>Cancel</button>
            <button ref={pendingExportRef} type="button" onClick={() => void exportPending()} disabled={isBusy}>Export</button>
            <button className="button-danger" type="button" onClick={() => void importCsv(true)} disabled={isBusy}>Discard and import</button>
          </div>
        </dialog>
      )}
    </dialog>
  );
}
