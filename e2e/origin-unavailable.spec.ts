import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { expect, test } from 'playwright/test';

const dist = resolve(process.cwd(), 'dist');
const types: Record<string, string> = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png',
};

// A dedicated loopback origin per test lets us stop the real server without
// disrupting parallel tests. This complements offline emulation with a real
// origin outage and a negative control. Physical iPhone airplane mode remains
// a separate manual acceptance check.
async function startOrigin() {
  const server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url!, 'http://localhost').pathname);
      if (!pathname.startsWith('/attendance-clock/')) {
        response.writeHead(404).end();
        return;
      }
      const relative = pathname.slice('/attendance-clock/'.length) || 'index.html';
      const file = resolve(dist, relative);
      if (!file.startsWith(dist + sep)) {
        response.writeHead(404).end();
        return;
      }
      const data = await readFile(file);
      response.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream' });
      response.end(data);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Origin did not start');
  return {
    url: `http://127.0.0.1:${address.port}/attendance-clock/`,
    async stop() {
      if (!server.listening) return;
      const stopped = new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      server.closeAllConnections();
      await stopped;
    },
  };
}

test('cached attendance stays durable after its origin server is stopped', async ({ page, browser }) => {
  const origin = await startOrigin();
  try {
    await page.goto(origin.url);
    await page.waitForFunction(() => Boolean(navigator.serviceWorker?.controller));
    await page.getByRole('button', { name: 'Clock in', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Clock out', exact: true })).toBeEnabled();

    await origin.stop();
    // A fresh, non-SW context must fail against the same now-unreachable URL.
    // This rules out accidentally testing an online or browser-HTTP-cache path.
    const control = await browser.newContext({ serviceWorkers: 'block' });
    try {
      const uncached = await control.newPage();
      await expect(uncached.goto(origin.url, { timeout: 5000 })).rejects.toThrow();
    } finally {
      await control.close();
    }

    const restored = await page.reload();
    expect(restored?.status()).toBe(200);
    expect(restored?.fromServiceWorker()).toBe(true);
    await expect(page.getByRole('button', { name: 'Clock out', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Clock out', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Day completed', exact: true })).toBeDisabled();
    const reopened = await page.reload();
    expect(reopened?.fromServiceWorker()).toBe(true);
    await expect(page.getByRole('button', { name: 'Day completed', exact: true })).toBeDisabled();
    await page.getByRole('tab', { name: 'History', exact: true }).click();
    await expect(page.locator('.history-row')).toHaveCount(1);
    await expect(page.locator('.history-row')).toContainText('Completed');
  } finally {
    await origin.stop();
  }
});
