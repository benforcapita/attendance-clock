import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import App from './App';

afterEach(cleanup);

describe('App', () => {
  it('shows the attendance clock heading', async () => {
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Attendance Clock' })).toBeVisible();
  });

  it('switches to History with ArrowRight from the active tab', async () => {
    render(<App />);

    const todayTab = await screen.findByRole('tab', { name: 'Today' });
    todayTab.focus();
    fireEvent.keyDown(todayTab, { key: 'ArrowRight' });
    const historyTab = screen.getByRole('tab', { name: 'History' });

    expect(historyTab).toHaveFocus();
    expect(historyTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('heading', { name: 'Attendance history' })).toBeVisible();
  });
});
