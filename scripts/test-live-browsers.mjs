import { spawn } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { setTimeout, clearTimeout } from 'node:timers';

function loopback(value) {
  try {
    return ['127.0.0.1', 'localhost'].includes(new URL(value).hostname);
  } catch {
    return false;
  }
}
if (
  ![
    process.env.SUPABASE_URL,
    process.env.TEST_DB_URL,
    process.env.WEB_ORIGIN,
  ].every(loopback)
)
  throw new Error(
    'Live browser fixtures require disposable local Auth, database and web origins',
  );
const files = (await readdir('apps/web/browser'))
  .filter((name) => name.startsWith('secure') && name.endsWith('.spec.ts'))
  .map((name) => `apps/web/browser/${name}`);
if (!files.length) throw new Error('No secure browser checks found');

async function stop(child) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null)
    return;
  await new Promise((resolve) => {
    const timeout = setTimeout(() => child.kill('SIGKILL'), 5000);
    child.once('exit', () => {
      clearTimeout(timeout);
      resolve();
    });
    child.kill('SIGTERM');
  });
}
let failed = false;
for (const project of ['desktop', 'phone']) {
  // Separate API instances isolate in-memory per-IP counters between independent
  // browser profiles. All production rate limits remain enabled and unchanged.
  const api = spawn(
    process.execPath,
    ['--import', 'tsx', 'apps/api/src/server.ts'],
    {
      env: {
        ...process.env,
        PORT: '3000',
        API_HOST: '127.0.0.1',
        SERVE_WEB: 'false',
      },
      stdio: ['ignore', 'pipe', 'inherit'],
    },
  );
  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('Local browser API did not start')),
        10000,
      );
      const finish = (error) => {
        clearTimeout(timeout);
        if (error) reject(error);
        else resolve();
      };
      api.once('error', finish);
      api.once('exit', () =>
        finish(new Error('Local browser API exited before readiness')),
      );
      api.stdout.on('data', (chunk) => {
        process.stdout.write(chunk);
        if (String(chunk).includes('Yapesa API:')) finish();
      });
    });
    const code = await new Promise((resolve, reject) => {
      const browser = spawn(
        process.execPath,
        [
          'node_modules/@playwright/test/cli.js',
          'test',
          ...files,
          '--workers=1',
          `--project=${project}`,
          `--output=test-results/live-${project}`,
        ],
        { stdio: 'inherit' },
      );
      browser.once('error', reject);
      browser.once('exit', (code) => resolve(code ?? 1));
    });
    if (code !== 0) failed = true;
  } catch (error) {
    failed = true;
    console.error(
      error instanceof Error ? error.message : 'Local browser check failed',
    );
  } finally {
    await stop(api);
  }
}
if (failed) process.exitCode = 1;
