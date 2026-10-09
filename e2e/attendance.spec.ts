import { expect, test } from 'playwright/test';

async function disableDirectFileAccess(page: import('playwright/test').Page) {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showOpenFilePicker', { configurable: true, value: undefined });
    Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: undefined });
  });
}

test('clock state survives reload and can be corrected', async ({ page }) => {
  await page.goto('/attendance-clock/');
  await page.getByRole('button', { name: 'Clock in' }).click();
  await expect(page.getByRole('button', { name: 'Clock out' })).toBeEnabled();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Clock out' })).toBeVisible();
  await page.getByRole('button', { name: 'Clock out' }).click();
  await page.getByRole('tab', { name: 'History' }).click();
  await expect(page.getByText('Completed')).toBeVisible();
});

test('cached application reloads offline', async ({ page, context }) => {
  await page.goto('/attendance-clock/');
  await page.waitForFunction(() => Boolean(navigator.serviceWorker?.controller));
  await page.getByRole('button', { name: 'Clock in' }).click();
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Attendance Clock' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Clock out' })).toBeVisible();
  await page.getByRole('button', { name: 'Clock out' }).click();
  await expect(page.getByRole('button', { name: 'Day completed' })).toBeDisabled();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Day completed' })).toBeDisabled();
});

test('malformed import preserves the local clock state', async ({ page }) => {
  await disableDirectFileAccess(page);
  await page.goto('/attendance-clock/');
  await page.getByRole('button', { name: 'Clock in' }).click();
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Import CSV' }).click();

  const fileChooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Discard and import' }).click();
  await (await fileChooser).setFiles({
    name: 'broken.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('not CSV'),
  });

  await expect(page.getByRole('dialog', { name: 'Pending local changes' }).getByRole('alert')).toContainText('invalid CSV header');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Close settings' }).click();
  await expect(page.getByText(/Working since/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Clock out' })).toBeVisible();
});

test('fallback mutations visibly remain pending for export', async ({ page }) => {
  await disableDirectFileAccess(page);
  await page.goto('/attendance-clock/');
  await page.getByRole('button', { name: 'Clock in' }).click();
  await expect(page.getByRole('status')).toHaveText('Saved locally — export pending');
});

test('history entries can be edited and deleted after confirmation', async ({ page }) => {
  await page.goto('/attendance-clock/');
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
  await page.goto('/attendance-clock/');
  const today = page.getByRole('tab', { name: 'Today' });
  await today.focus();
  await today.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'History' })).toBeFocused();
  await expect(page.getByRole('tab', { name: 'History' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('heading', { name: 'Attendance history' })).toBeVisible();
});

test('mobile tabs, file actions, dialog controls, and editor fields meet 44px targets', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/attendance-clock/');

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


const sampleCsv = 'date,clock_in,clock_out\n2026-08-10,09:00,17:00\n2026-08-11,22:00,06:00\n';

async function importSample(page: import('playwright/test').Page, text = sampleCsv) {
  await page.getByRole('button', { name: 'Settings' }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import CSV' }).click();
  await (await chooser).setFiles({ name: 'synthetic-attendance.csv', mimeType: 'text/csv', buffer: Buffer.from(text) });
  await expect(page.locator('.file-menu__filename')).toContainText('synthetic-attendance.csv');
  await page.getByRole('button', { name: 'Close settings' }).click();
}

test('CSV import and export round-trip real file contents', async ({ page }) => {
  await disableDirectFileAccess(page);
  await page.addInitScript(() => Object.defineProperty(navigator, 'share', { configurable: true, value: undefined }));
  await page.goto('/attendance-clock/');
  await importSample(page);
  await page.getByRole('tab', { name: 'History' }).click();
  await expect(page.locator('.history-row')).toHaveCount(2);
  await expect(page.locator('.history-row').first()).toContainText('8h 00m');
  await page.reload();
  await page.getByRole('tab', { name: 'History' }).click();
  await expect(page.locator('.history-row')).toHaveCount(2);
  await page.getByRole('button', { name: 'Settings' }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV' }).click();
  const stream = await (await download).createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  expect(Buffer.concat(chunks).toString()).toBe(sampleCsv);
});

test('repeated corrections, cancelled deletion, and invalid duplicate dates preserve history', async ({ page }) => {
  await disableDirectFileAccess(page);
  await page.goto('/attendance-clock/');
  await importSample(page);
  await page.getByRole('tab', { name: 'History' }).click();
  await page.locator('.history-row').last().click();
  await page.getByLabel('Date', { exact: true }).fill('2026-08-11');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('duplicate');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.locator('.history-row')).toHaveCount(2);
  for (const time of ['17:30', '18:15']) {
    await page.locator('.history-row').last().click();
    await page.getByLabel('Clock out', { exact: true }).fill(time);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.locator('.history-row').last()).toContainText(time);
  }
  await page.locator('.history-row').last().click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.reload();
  await page.getByRole('tab', { name: 'History' }).click();
  await expect(page.locator('.history-row')).toHaveCount(2);
  await expect(page.locator('.history-row').last()).toContainText('18:15');
});

test('Settings can close and reopen after cancelling a pending import', async ({ page }) => {
  await disableDirectFileAccess(page);
  await page.goto('/attendance-clock/');
  await page.getByRole('button', { name: 'Clock in' }).click();
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Import CSV' }).click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Settings', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Import CSV' })).toBeFocused();
  await page.getByRole('button', { name: 'Close settings' }).click();
  await expect(page.getByRole('button', { name: 'Settings' })).toBeFocused();
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByRole('dialog', { name: 'Settings', exact: true })).toBeVisible();
});

test('PWA manifest has installable icons and a scoped start URL', async ({ page, request }) => {
  await page.goto('/attendance-clock/');
  const manifestUrl = await page.locator('link[rel=manifest]').getAttribute('href');
  const response = await request.get(new URL(manifestUrl!, page.url()).href);
  expect(response.ok()).toBeTruthy();
  const manifest = await response.json();
  expect(manifest.display).toBe('standalone');
  expect(new URL(manifest.start_url, response.url()).pathname).toBe('/attendance-clock/');
  for (const icon of manifest.icons) {
    expect((await request.get(new URL(icon.src, response.url()).href)).ok()).toBeTruthy();
  }
});

test('desktop and mobile demo screens fit their viewport without script errors', async ({ page }, testInfo) => {
  const scriptErrors: string[] = [];
  page.on('pageerror', error => scriptErrors.push(error.message));
  await disableDirectFileAccess(page);
  await page.goto('/attendance-clock/');
  await importSample(page);
  await expect(page.getByRole('heading', { name: 'Attendance Clock' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('today.png'), fullPage: true });
  await page.getByRole('tab', { name: 'History' }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('history.png'), fullPage: true });
  expect(scriptErrors).toEqual([]);
});
