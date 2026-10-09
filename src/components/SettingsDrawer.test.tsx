import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PendingImportError, type ControllerSnapshot } from '../application/attendanceController';
import { SettingsDrawer } from './SettingsDrawer';

const snapshot: ControllerSnapshot = {
  state: { entries: [] },
  meta: { fileName: null, syncState: 'pending', revision: 1 },
  initialized: true,
  error: null,
};
afterEach(cleanup);

function setup(overrides: Record<string, unknown> = {}) {
  const props = { open: true, onClose: vi.fn(), snapshot, onImport: vi.fn(), onExport: vi.fn(), ...overrides };
  render(<SettingsDrawer {...props} />);
  return props;
}

describe('SettingsDrawer recovery', () => {
  it('explains the local backup workflow when folder access is unavailable', () => {
    setup();
    expect(screen.getByText(/This browser saves attendance locally/)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Choose folder' })).not.toBeInTheDocument();
  });

  it('names the actual folder and avoids claiming a failed write succeeded', () => {
    setup({ folderSupported: true, onChooseFolder: vi.fn(), snapshot: {
      ...snapshot, directoryHandle: { name: 'Work records' },
      meta: { fileName: 'attendance.csv', syncState: 'permission-required', revision: 2 },
    } });
    expect(screen.getByText('Work records / attendance.csv')).toBeVisible();
    expect(screen.queryByText('CSV saved to this folder')).not.toBeInTheDocument();
  });

  it('shows an invalid import error inside the active confirmation dialog', async () => {
    const onImport = vi.fn().mockRejectedValueOnce(new PendingImportError()).mockRejectedValueOnce(new Error('invalid CSV header'));
    setup({ onImport });
    fireEvent.click(screen.getByRole('button', { name: 'Import CSV' }));
    const confirmation = await screen.findByRole('dialog', { name: 'Pending local changes' });
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Discard and import' }));
    await waitFor(() => expect(within(confirmation).getByRole('alert')).toHaveTextContent('invalid CSV header'));
    expect(within(confirmation).getByRole('button', { name: 'Discard and import' })).toBeEnabled();
  });

  it('closes the warning after a successful backup and returns focus to Import CSV', async () => {
    setup({ onImport: vi.fn().mockRejectedValue(new PendingImportError()), onExport: vi.fn().mockResolvedValue(undefined) });
    fireEvent.click(screen.getByRole('button', { name: 'Import CSV' }));
    const confirmation = await screen.findByRole('dialog', { name: 'Pending local changes' });
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Export' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Pending local changes' })).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Import CSV' })).toHaveFocus();
  });

  it('keeps destination recovery and discard available after backing up an unsynced folder', async () => {
    setup({ snapshot: { ...snapshot, directoryHandle: { name: 'Records' } }, onImport: vi.fn().mockRejectedValue(new PendingImportError()), onExport: vi.fn().mockResolvedValue(undefined) });
    fireEvent.click(screen.getByRole('button', { name: 'Import CSV' }));
    const confirmation = await screen.findByRole('dialog', { name: 'Pending local changes' });
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Export' }));
    await waitFor(() => expect(within(confirmation).getByRole('status')).toHaveTextContent('Backup exported'));
    expect(within(confirmation).getByRole('button', { name: 'Discard and import' })).toBeEnabled();
  });

  it('keeps the confirmation open after a failed backup', async () => {
    setup({ onImport: vi.fn().mockRejectedValue(new PendingImportError()), onExport: vi.fn().mockRejectedValue(new Error('download failed')) });
    fireEvent.click(screen.getByRole('button', { name: 'Import CSV' }));
    const confirmation = await screen.findByRole('dialog', { name: 'Pending local changes' });
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Export' }));
    await waitFor(() => expect(within(confirmation).getByRole('alert')).toHaveTextContent('download failed'));
  });

  it('cancelling a nested import warning leaves Settings open', async () => {
    const props = setup({ onImport: vi.fn().mockRejectedValue(new PendingImportError()) });
    fireEvent.click(screen.getByRole('button', { name: 'Import CSV' }));
    const confirmation = await screen.findByRole('dialog', { name: 'Pending local changes' });
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Pending local changes' })).not.toBeInTheDocument());
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it('does not dismiss Settings with Escape while a file action is pending', async () => {
    let finish!: () => void;
    const props = setup({ onExport: vi.fn(() => new Promise<void>(resolve => { finish = resolve; })) });
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    fireEvent(screen.getByRole('dialog', { name: 'Settings' }), new Event('cancel', { cancelable: true }));
    expect(props.onClose).not.toHaveBeenCalled();
    finish();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Export CSV' })).toBeEnabled());
  });
});
