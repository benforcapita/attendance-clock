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
marks the single active session. There is one entry per calendar day; once
finished, correct the entry in **History** instead of starting another session.
An overnight shift shorter than 24 hours is represented by a clock-out earlier
than its clock-in time. Clock-out rejects a reversed system time or a stale
session of 24 hours or more because the CSV cannot represent its end date.
Correct such a session in History. Invalid imports are rejected before they
replace the current local data.

## Desktop workflow

Open **Settings** for file actions. On browsers with folder access support,
use **Choose folder** to save `attendance.csv` automatically. Choosing a folder
checks any existing `attendance.csv` first and refuses to replace different
contents; import that file first or choose an empty folder. Changes are first
committed locally, then written to the selected folder.

**Import CSV** replaces the local working copy only after validation. It also
clears the previous folder destination so importing a backup cannot silently
write into an unrelated folder. On desktop, importing a file may retain its
file handle for subsequent writes; on iOS it remains a local copy. If permission must be renewed, the app shows **Grant access**;
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

## Release and demo builds

Pull requests run the complete `test:release` gate on Chromium desktop and
WebKit with an iPhone viewport. The Pages deployment runs the same gate before
uploading its artifact; failed tests prevent publication. Browser evidence is
available as the `attendance-browser-evidence` artifact on verification runs.

The default build targets GitHub Pages at `/attendance-clock/`. For an isolated
portfolio preview, build with a separate output folder and portable asset URLs:

```bash
ATTENDANCE_BASE_PATH=./ npm run build -- --outDir demo-dist
```

Serve previews over HTTP on localhost or HTTPS. Do not open the files with a
`file:` URL: installability, durable storage and offline caching require a
secure origin. The app starts empty; `demo/synthetic-attendance.csv` is optional
fictional data to import through Settings. Demo builds never embed attendance
records. Browser data is local to the origin, so use a separate origin for
previews when you also use a production copy.

Use one active tab at a time. This release does not coordinate simultaneous
edits across browser tabs. Physical iPhone Home Screen installation and native
folder-picker permission prompts remain manual release checks in addition to
browser automation.

### Offline verification

Playwright is pinned to 1.64.0, which includes the fix for its earlier WebKit
service-worker offline-emulation bug ([upstream fix](https://github.com/microsoft/playwright/pull/42894)).
Both browsers run the offline tests without skips.

In addition to offline emulation, a separate test runs on both engines: it stops
a dedicated origin server, proves that a fresh non-service-worker context
cannot load it, then requires the cached app to reload with a successful
service-worker response and persist a clock-out. Airplane mode on physical iOS
remains a manual acceptance check.
