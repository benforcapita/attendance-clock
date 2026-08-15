import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const packageJson = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
const config = await readFile(new URL('playwright.config.ts', root), 'utf8');

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

requireCondition(
  packageJson.scripts['test:e2e'] === 'npm run build && playwright test',
  'test:e2e must build the current checkout before running Playwright',
);
requireCondition(
  packageJson.scripts['preview:e2e'] === 'vite preview --host 127.0.0.1 --port 4173 --strictPort',
  'preview:e2e must bind the fixed release port with --strictPort',
);
requireCondition(
  config.includes("command: 'npm run preview:e2e'"),
  'Playwright must start the checked preview:e2e server',
);
requireCondition(
  config.includes('reuseExistingServer: false'),
  'Playwright must not reuse an unverified preview server',
);

console.log('E2E release binding configuration verified');
