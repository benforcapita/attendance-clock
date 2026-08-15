# Task 9 release verification report

## Delivered

- Added Playwright release coverage for Chromium desktop and iPhone-sized WebKit:
  reload persistence, offline reload, invalid-import preservation, fallback
  pending status, correction/delete confirmation, and tab keyboard navigation.
- Added a reproducible Playwright preview-server configuration and `test:e2e`
  script.
- Scoped Vitest to `src/**/*.test.ts(x)` so it does not collect Playwright
  specs as unit tests.
- Made completed history entries visibly identify themselves as **Completed**.
- Added an explicit PWA navigation fallback and operator documentation covering
  local data, CSV schema, desktop direct writes, iOS Files workflows, offline
  use, backup, and manual cross-device transfer.

## Verification

| Check | Result |
| --- | --- |
| `npm run test:run` | Passed: 9 files, 80 tests |
| `npm run build` | Passed; generated `dist/manifest.webmanifest`, `dist/sw.js`, and Workbox assets |
| `npm run test:e2e -- --list` | Passed; discovered 12 cases across Chromium desktop and iPhone-sized WebKit |
| `npm run test:e2e` | Blocked before test execution: Playwright Chromium and WebKit binaries are absent |

## E2E environment blocker

Playwright reports the missing executables at:

- `/root/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell`
- `/root/.cache/ms-playwright/webkit-2336/pw_run.sh`

`npx playwright install chromium webkit` was attempted. The Chromium download
from `https://cdn.playwright.dev/builds/cft/151.0.7922.34/linux64/chrome-linux64.zip`
returned a 0 MiB/truncated payload and failed with `End of central directory
record signature not found`, so browser binaries could not be installed in this
environment. Re-run `npx playwright install chromium webkit` with normal
network access, then `npm run build && npm run test:e2e`.

## Remaining manual release checks

- Chrome desktop: choose/create an attendance CSV, write a mutation, reopen the
  file, and exercise permission renewal.
- Physical iPhone/iPad Safari: Add to Home Screen, work offline after first
  load, import from Files, and export to Files.

## Review follow-up: deterministic release runner

The E2E runner now prevents stale-build and unrelated-server false positives:

- `npm run test:e2e` runs `npm run build` before invoking Playwright.
- Playwright starts `npm run preview:e2e`, which binds
  `127.0.0.1:4173` with Vite's `--strictPort` option.
- `reuseExistingServer` is explicitly `false`, so Playwright will not adopt a
  server that another checkout or application started.
- `npm run test:e2e:config` checks these bindings, and `npm run test:release`
  includes that check before the E2E runner.

README setup now uses `npm ci` and documents the required browser bootstrap:
`npx playwright install chromium webkit` (or
`npx playwright install --with-deps chromium webkit` where Linux system
libraries are needed).

### Follow-up verification

| Check | Result |
| --- | --- |
| `npm run test:e2e:config` | Passed: release binding configuration verified |
| `npm run test:run` | Passed: 9 files, 80 tests |
| `npm run build` | Passed; manifest and service worker emitted |
| `npm run test:e2e -- --list` | Passed: rebuilt the current checkout, then discovered all 12 E2E cases |
| occupied-port check | Passed: `npm run preview:e2e` failed with `Port 4173 is already in use` instead of choosing a different port |
| Chromium E2E execution | Still externally blocked by the missing Playwright executable, after the current checkout rebuild completed |
