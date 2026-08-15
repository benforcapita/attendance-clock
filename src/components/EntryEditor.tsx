import { useEffect, useRef, useState } from 'react';
import type { AttendanceEntry } from '../domain/attendance';

type EntryEditorProps = {
  entry: AttendanceEntry;
  onSave: (entry: AttendanceEntry) => Promise<void>;
  onDelete: () => Promise<void>;
  onCancel: () => void;
  returnFocusTo: HTMLElement | null;
  fallbackFocusTo?: HTMLElement | null;
};

function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function EntryEditor({ entry, onSave, onDelete, onCancel, returnFocusTo, fallbackFocusTo = null }: EntryEditorProps) {
  const [draft, setDraft] = useState(entry);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);
  const confirmDeleteRef = useRef<HTMLButtonElement>(null);

  const closeAndReturnFocus = () => {
    const dialog = dialogRef.current;
    if (dialog?.open) dialog.close();
    onCancel();
    returnFocusTo?.focus();
    window.setTimeout(() => {
      (returnFocusTo?.isConnected ? returnFocusTo : fallbackFocusTo)?.focus();
    }, 0);
  };

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return undefined;
    dialog.showModal();
    firstFieldRef.current?.focus();
    return () => {
      if (dialog.open) dialog.close();
    };
  }, []);

  useEffect(() => {
    setDraft(entry);
    setConfirmingDelete(false);
    setError(null);
  }, [entry]);

  useEffect(() => {
    if (confirmingDelete) confirmDeleteRef.current?.focus();
  }, [confirmingDelete]);

  const save = async () => {
    setIsSaving(true);
    setError(null);
    try {
      await onSave(draft);
      closeAndReturnFocus();
    } catch (saveError) {
      setError(messageFor(saveError));
    } finally {
      setIsSaving(false);
    }
  };

  const remove = async () => {
    setIsSaving(true);
    setError(null);
    try {
      await onDelete();
      closeAndReturnFocus();
    } catch (deleteError) {
      setError(messageFor(deleteError));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <dialog
      ref={dialogRef}
      className="entry-editor"
      aria-label="Edit attendance entry"
      onCancel={(event) => {
        event.preventDefault();
        closeAndReturnFocus();
      }}
    >
      <form onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <header className="entry-editor__header">
          <p className="eyebrow">Correction</p>
          <h2>{confirmingDelete ? 'Delete attendance entry?' : 'Edit attendance entry'}</h2>
        </header>

        {confirmingDelete ? (
          <p className="entry-editor__warning">This permanently removes the entry for {entry.date}.</p>
        ) : (
          <div className="entry-editor__fields">
            <label>
              Date
              <input
                type="date"
                ref={firstFieldRef}
                value={draft.date}
                onChange={(event) => setDraft({ ...draft, date: event.target.value })}
                required
              />
            </label>
            <label>
              Clock in
              <input
                type="time"
                value={draft.clockIn}
                onChange={(event) => setDraft({ ...draft, clockIn: event.target.value })}
                required
              />
            </label>
            <label>
              Clock out
              <input
                type="time"
                value={draft.clockOut ?? ''}
                onChange={(event) => setDraft({ ...draft, clockOut: event.target.value || null })}
              />
            </label>
          </div>
        )}

        {error && <p className="attendance-error" role="alert">{error}</p>}

        <footer className="dialog-actions">
          <button type="button" onClick={closeAndReturnFocus} disabled={isSaving}>Cancel</button>
          {confirmingDelete ? (
            <button ref={confirmDeleteRef} className="button-danger" type="button" onClick={() => void remove()} disabled={isSaving}>
              {isSaving ? 'Deleting…' : 'Confirm delete'}
            </button>
          ) : (
            <>
              <button className="button-danger" type="button" onClick={() => setConfirmingDelete(true)} disabled={isSaving}>Delete</button>
              <button className="button-primary" type="submit" disabled={isSaving}>{isSaving ? 'Saving…' : 'Save'}</button>
            </>
          )}
        </footer>
      </form>
    </dialog>
  );
}
