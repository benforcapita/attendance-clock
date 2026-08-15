# Attendance Clock

An installable, offline-first attendance clock. It keeps a local working copy in
the browser and optionally writes a single CSV file when the browser supports
the File System Access API.

## Run and verify

Use Node.js 22.13 or newer in the Node 22 line, or Node.js 24.x, with npm
10 or 11. The repository includes `.nvmrc`, npm engine checks, and exact direct
dependency versions so a regenerated lockfile stays on the reviewed toolchain.

For a clean, lockfile-based install and full E2E setup:

```bash
npm ci
npx playwright install chromium webkit
npm run dev
```

On Linux CI or development hosts that do not already have Playwright's system
libraries, use the browser bootstrap command with its OS dependencies instead:

```bash
npx playwright install --with-deps chromium webkit
```

`npm ci` installs the exact dependency versions in `package-lock.json`.
The Playwright browser step is required before `npm run test:e2e`; it downloads
the Chromium and WebKit executables used by the release suite.

Create a production build and serve it locally with:

```bash
npm run build
npm run preview
```

The automated release checks are:

```bash
npm run typecheck
npm run test:run
npm run test:e2e:config
npm run test:e2e
```

`test:e2e` always builds the current checkout, starts its own production preview
on strict port 4173, and exercises Chromium desktop plus an iPhone-sized WebKit
viewport. It intentionally refuses to reuse a process already listening on
that port, preventing a release check from targeting an unrelated server. Run
`npm run test:release` for the unit, release-configuration, and E2E gates
together.

## Attendance data

The portable backup format is UTF-8 CSV with LF line endings and exactly this
header:

```csv
date,clock_in,clock_out
2026-08-15,08:43,17:12
2026-08-16,09:01,
```

Dates use `YYYY-MM-DD`, times use 24-hour `HH:mm`, and an empty `clock_out`
marks the single active session. An overnight shift is represented by a
clock-out earlier than its clock-in time. Invalid imports are rejected before
they replace the current local data.

## Desktop workflow

On browsers with File System Access support, use **Choose or create CSV** to
select the attendance file. Changes are first committed locally, then written
to that file. If permission must be renewed, the app shows **Grant access**;
if a write cannot finish, the app keeps the local mutation and identifies it as
pending rather than discarding it.

## iPhone and iPad workflow

iOS Safari does not offer the same persistent direct-file write capability.
Use the attendance clock as a local browser/PWA copy, then use **Export CSV**
to save or share a backup through Files. Use **Import CSV** to load a file from
Files when needed. After first loading the app successfully, add it to the
Home Screen if desired; the installed app works offline with its cached shell
and locally stored attendance data.

## Backup and transfer

Export a CSV regularly, especially before clearing browser data, changing
devices, or importing a replacement file. Import/export is the intentional
cross-device transfer mechanism: this app has no account, cloud sync, or
automatic device-to-device transfer. Keep backups somewhere you control, such
as Files or your approved storage provider.
