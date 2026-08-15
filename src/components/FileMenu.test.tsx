import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PendingImportError, type ControllerSnapshot } from '../application/attendanceController';
import { FileMenu } from './FileMenu';

const pendingSnapshot: ControllerSnapshot = {
  state: { entries: [] },
  meta: { fileName: 'local-attendance.csv', syncState: 'pending', revision: 1 },
  initialized: true,
  error: null,
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('FileMenu', () => {
  it('offers export before replacing pending data', async () => {
    const importCsv = vi.fn().mockRejectedValueOnce(new PendingImportError());
    const exportCsv = vi.fn().mockResolvedValue(undefined);
    render(
      <FileMenu
        snapshot={pendingSnapshot}
        directAccessSupported
        onChooseOrCreate={vi.fn()}
        onImport={importCsv}
        onExport={exportCsv}
        onGrantAccess={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Import CSV' }));

    expect(await screen.findByRole('button', { name: 'Export' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Discard and import' })).toBeVisible();
  });

  it('retries import with discardPending after confirmation', async () => {
    const importCsv = vi.fn()
      .mockRejectedValueOnce(new PendingImportError())
      .mockResolvedValueOnce(undefined);
    render(
      <FileMenu
        snapshot={pendingSnapshot}
        directAccessSupported={false}
        onChooseOrCreate={vi.fn()}
        onImport={importCsv}
        onExport={vi.fn()}
        onGrantAccess={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Import CSV' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Discard and import' }));

    expect(importCsv).toHaveBeenLastCalledWith({ discardPending: true });
  });

  it('returns to the pending-import decision after exporting', async () => {
    const importCsv = vi.fn().mockRejectedValueOnce(new PendingImportError());
    let resolveExport!: () => void;
    const exportCsv = vi.fn(() => new Promise<void>((resolve) => { resolveExport = resolve; }));
    render(<FileMenu snapshot={pendingSnapshot} onImport={importCsv} onExport={exportCsv} />);

    fireEvent.click(screen.getByRole('button', { name: 'Import CSV' }));
    const exportButton = await screen.findByRole('button', { name: 'Export' });
    const dialog = screen.getByRole('dialog', { name: 'Pending local changes' });
    fireEvent.click(exportButton);

    expect(exportCsv).toHaveBeenCalledOnce();
    expect(dialog).toBeVisible();
    expect(exportButton).toBeDisabled();

    resolveExport();

    await waitFor(() => expect(exportButton).toBeEnabled());
    expect(dialog).toBeVisible();
  });

  it('cancels the pending-import decision without importing and restores the import action focus', async () => {
    const importCsv = vi.fn().mockRejectedValueOnce(new PendingImportError());
    const exportCsv = vi.fn().mockResolvedValue(undefined);
    render(<FileMenu snapshot={pendingSnapshot} onImport={importCsv} onExport={exportCsv} />);
    const importButton = screen.getByRole('button', { name: 'Import CSV' });

    fireEvent.click(importButton);
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(importCsv).toHaveBeenCalledOnce();
    expect(exportCsv).not.toHaveBeenCalled();
    expect(importButton).toHaveFocus();
  });

  it('closes the pending-import decision with Escape and restores import focus', async () => {
    const importCsv = vi.fn().mockRejectedValueOnce(new PendingImportError());
    render(<FileMenu snapshot={pendingSnapshot} onImport={importCsv} onExport={vi.fn()} />);
    const importButton = screen.getByRole('button', { name: 'Import CSV' });

    fireEvent.click(importButton);
    const dialog = await screen.findByRole('dialog');
    fireEvent(dialog, new Event('cancel', { cancelable: true }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(importButton).toHaveFocus();
  });

  it('opens the pending-import decision with native modal behavior and focuses its first action', async () => {
    const showModal = vi.spyOn(HTMLDialogElement.prototype, 'showModal');
    const importCsv = vi.fn().mockRejectedValueOnce(new PendingImportError());
    render(<FileMenu snapshot={pendingSnapshot} onImport={importCsv} onExport={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Import CSV' }));

    expect(await screen.findByRole('button', { name: 'Export' })).toHaveFocus();
    expect(showModal).toHaveBeenCalledOnce();
  });

  it('shows the selected filename, direct-save capability, and permission action', async () => {
    const grantAccess = vi.fn().mockResolvedValue(undefined);
    render(
      <FileMenu
        snapshot={{ ...pendingSnapshot, meta: { ...pendingSnapshot.meta, syncState: 'permission-required' } }}
        directAccessSupported
        onChooseOrCreate={vi.fn()}
        onImport={vi.fn()}
        onExport={vi.fn()}
        onGrantAccess={grantAccess}
      />,
    );

    expect(screen.getByText('local-attendance.csv')).toBeVisible();
    expect(screen.getByText('Direct file saving available')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Grant access' }));
    expect(grantAccess).toHaveBeenCalledOnce();
  });
});
