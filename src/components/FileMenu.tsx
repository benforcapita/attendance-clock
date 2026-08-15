import { useEffect, useRef, useState } from 'react';
import { PendingImportError, type ControllerSnapshot } from '../application/attendanceController';

type FileMenuProps = {
  snapshot: ControllerSnapshot;
  directAccessSupported?: boolean;
  onChooseOrCreate?: () => Promise<void>;
  onImport: (options?: { discardPending?: boolean }) => Promise<void>;
  onExport: () => Promise<void>;
  onGrantAccess?: () => Promise<void>;
};

function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function FileMenu({
  snapshot,
  directAccessSupported = false,
  onChooseOrCreate,
  onImport,
  onExport,
  onGrantAccess,
}: FileMenuProps) {
  const [isBusy, setIsBusy] = useState(false);
  const [pendingImport, setPendingImport] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const importButtonRef = useRef<HTMLButtonElement>(null);
  const pendingDialogRef = useRef<HTMLDialogElement>(null);
  const pendingExportRef = useRef<HTMLButtonElement>(null);

  const closePendingImport = () => {
    const dialog = pendingDialogRef.current;
    if (dialog?.open) dialog.close();
    setPendingImport(false);
    importButtonRef.current?.focus();
  };

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

  return (
    <section className="file-menu" aria-labelledby="file-menu-heading">
      <h2 id="file-menu-heading">File</h2>
      <p className="file-menu__filename"><span className="visually-hidden">Selected file: </span>{fileName}</p>
      <p className="file-menu__capability">
        {directAccessSupported ? 'Direct file saving available' : 'Direct file saving unavailable'}
      </p>
      <div className="file-menu__actions">
        <button
          type="button"
          onClick={() => onChooseOrCreate && void run(onChooseOrCreate)}
          disabled={isBusy || !directAccessSupported || !onChooseOrCreate}
        >
          Choose or create CSV
        </button>
        <button
          ref={importButtonRef}
          type="button"
          onClick={() => void importCsv()}
          disabled={isBusy}
        >
          Import CSV
        </button>
        <button type="button" onClick={() => void run(onExport)} disabled={isBusy}>Export CSV</button>
        {snapshot.meta.syncState === 'permission-required' && onGrantAccess && (
          <button type="button" onClick={() => void run(onGrantAccess)} disabled={isBusy}>Grant access</button>
        )}
      </div>
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
    </section>
  );
}
