import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./storage/attendanceDb', () => ({
  AttendanceDb: class {
    async load() {
      throw new Error('IndexedDB is unavailable');
    }

    async save() {
      throw new Error('IndexedDB is unavailable');
    }

    async replace() {
      throw new Error('IndexedDB is unavailable');
    }
  },
}));

import App from './App';

afterEach(cleanup);

describe('App storage initialization failure', () => {
  it('blocks mutation and file controls when durable storage cannot initialize', async () => {
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Attendance storage unavailable' })).toBeVisible();
    expect(screen.getByRole('alert')).toHaveTextContent('IndexedDB is unavailable');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
    expect(screen.queryByText('Import CSV')).not.toBeInTheDocument();
  });
});
