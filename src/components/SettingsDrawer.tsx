import { useEffect, useRef, useState } from 'react';
import { PendingImportError, type ControllerSnapshot } from '../application/attendanceController';

type SettingsDrawerProps = {
  open: boolean;
  onClose: () => void;
  snapshot: ControllerSnapshot;
  folderSupported?: boolean;
  fileSupported?: boolean;
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
  fileSupported = false,
  onChooseFolder,
  onImport,
  onExport,
  onGrantAccess,
}: SettingsDrawerProps) {
  const [isBusy, setIsBusy] = useState(false);
  const [pendingImport, setPendingImport] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const pendingDialogRef = useRef<HTMLDialogElement>(null);
  const pendingExportRef = useRef<HTMLButtonElement>(null);

  const closePendingImport = () => {
    const dialog = pendingDialogRef.current;
    if (dialog?.open) dialog.close();
    setPendingImport(false);
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
    } catch (actionError) {
      setError(messageFor(actionError));
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
    await run(onExport);
  };

  const fileName = snapshot.meta.fileName ?? 'No CSV selected';
  const hasFolder = Boolean(snapshot.directoryHandle);
  const hasFile = Boolean(snapshot.fileHandle);

  return (
    <dialog
      ref={dialogRef}
      className="settings-drawer"
      aria-label="Settings"
      onClose={onClose}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
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
          Choose a folder where your attendance CSV will be saved automatically.
        </p>
        <p className="file-menu__filename"><span className="visually-hidden">Selected folder: </span>{fileName}</p>
        {hasFolder && (
          <p className="settings-section__capability">CSV saved to this folder</p>
        )}
        {!hasFolder && !hasFile && (
          <p className="settings-section__capability">No folder selected yet</p>
        )}
        <button
          type="button"
          onClick={() => onChooseFolder && void run(onChooseFolder)}
          disabled={isBusy || !folderSupported || !onChooseFolder}
        >
          Choose folder
        </button>
      </section>

      <section className="settings-section" aria-labelledby="settings-data-heading">
        <h3 id="settings-data-heading">Data</h3>
        <div className="file-menu__actions">
          <button type="button" onClick={() => void importCsv()} disabled={isBusy}>Import CSV</button>
          <button type="button" onClick={() => void run(onExport)} disabled={isBusy}>Export CSV</button>
        </div>
        {snapshot.meta.syncState === 'permission-required' && onGrantAccess && (
          <div className="file-menu__actions">
            <button type="button" onClick={() => void run(onGrantAccess)} disabled={isBusy}>Grant access</button>
          </div>
        )}
      </section>

      {(error ?? snapshot.error) && <p className="attendance-error" role="alert">{error ?? snapshot.error}</p>}

      {pendingImport && (
        <dialog
          ref={pendingDialogRef}
          className="file-menu__dialog"
          aria-label="Pending local changes"
          onCancel={(event) => {
            event.preventDefault();
            closePendingImport();
          }}
        >
          <h2>Export local changes first?</h2>
          <p>Importing a CSV will replace unsaved local changes.</p>
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
