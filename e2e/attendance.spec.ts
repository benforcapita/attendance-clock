import { expect, test } from 'playwright/test';

async function disableDirectFileAccess(page: import('playwright/test').Page) {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showOpenFilePicker', { configurable: true, value: undefined });
    Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: undefined });
  });
}

test('clock state survives reload and can be corrected', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Clock in' }).click();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Clock out' })).toBeVisible();
  await page.getByRole('button', { name: 'Clock out' }).click();
  await page.getByRole('tab', { name: 'History' }).click();
  await expect(page.getByText('Completed')).toBeVisible();
});

test('cached application reloads offline', async ({ page, context }) => {
  await page.goto('/');
  await page.waitForFunction(() => navigator.serviceWorker?.controller !== null);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Attendance Clock' })).toBeVisible();
});

test('malformed import preserves the local clock state', async ({ page }) => {
  await disableDirectFileAccess(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Clock in' }).click();
  await page.getByRole('button', { name: 'Import CSV' }).click();

  const fileChooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Discard and import' }).click();
  await (await fileChooser).setFiles({
    name: 'broken.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('not CSV'),
  });

  await expect(page.getByRole('alert')).toContainText('invalid CSV header');
  await expect(page.getByText(/Working since/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Clock out' })).toBeVisible();
});

test('fallback mutations visibly remain pending for export', async ({ page }) => {
  await disableDirectFileAccess(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Clock in' }).click();
  await expect(page.getByRole('status')).toHaveText('Saved locally — export pending');
});

test('history entries can be edited and deleted after confirmation', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Clock in' }).click();
  await page.getByRole('button', { name: 'Clock out' }).click();
  await page.getByRole('tab', { name: 'History' }).click();

  await page.locator('.history-row').click();
  await page.getByLabel('Clock out').fill('18:00');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('.history-row')).toContainText('18:00');

  await page.locator('.history-row').click();
  await page.getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByRole('button', { name: 'Confirm delete' })).toBeVisible();
  await page.getByRole('button', { name: 'Confirm delete' }).click();
  await expect(page.getByText('No attendance entries yet.')).toBeVisible();
});

test('tabs support keyboard navigation', async ({ page }) => {
  await page.goto('/');
  const today = page.getByRole('tab', { name: 'Today' });
  await today.focus();
  await today.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'History' })).toBeFocused();
  await expect(page.getByRole('tab', { name: 'History' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('heading', { name: 'Attendance history' })).toBeVisible();
});

test('mobile tabs, file actions, dialog controls, and editor fields meet 44px targets', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');

  const undersizedTargets = async () => page.locator('button:visible, input:visible').evaluateAll((elements) => (
    elements
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          label: element.getAttribute('aria-label') ?? element.textContent?.trim() ?? element.tagName,
          width: rect.width,
          height: rect.height,
        };
      })
      .filter(({ width, height }) => width < 44 || height < 44)
  ));

  expect(await undersizedTargets()).toEqual([]);

  await page.getByRole('button', { name: 'Clock in' }).click();
  await page.getByRole('button', { name: 'Clock out' }).click();
  await page.getByRole('tab', { name: 'History' }).click();
  await page.locator('.history-row').click();

  expect(await undersizedTargets()).toEqual([]);
});
