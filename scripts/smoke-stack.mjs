import https from 'node:https';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout } from 'node:timers/promises';
import { launch, stop } from './command.mjs';
const children = [
  launch('pnpm', ['--filter', '@yapesa/api', 'dev'], {
    detached: process.platform !== 'win32',
  }),
  launch('pnpm', ['--filter', '@yapesa/web', 'dev'], {
    detached: process.platform !== 'win32',
  }),
  launch('pnpm', ['--filter', '@yapesa/mobile', 'dev'], {
    env: { ...process.env, CI: '1' },
    detached: process.platform !== 'win32',
  }),
];
async function waitFor(name, check) {
  const deadline = Date.now() + 480_000;
  while (Date.now() < deadline) {
    try {
      if (await check()) {
        console.log(`${name}: ready`);
        return;
      }
    } catch {
      /* services may still be booting */
    }
    await setTimeout(2_000);
  }
  throw new Error(`${name} did not become ready`);
}
function fineractHealth() {
  return new Promise((resolve) => {
    // Only the loopback development certificate is self-signed.
    const req = https.get(
      'https://127.0.0.1:8443/fineract-provider/actuator/health',
      { rejectUnauthorized: false, timeout: 5000 },
      (res) => {
        res.resume();
        resolve(res.statusCode === 200);
      },
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => req.destroy());
  });
}
try {
  const { stdout } = await promisify(execFile)(process.execPath, [
    process.env.npm_execpath,
    'exec',
    'supabase',
    'status',
    '-o',
    'json',
  ]);
  const local = JSON.parse(stdout);
  const key = local.ANON_KEY ?? local.anon_key;
  if (!key) throw new Error('Local Supabase anonymous key missing');
  await Promise.all([
    waitFor(
      'API',
      async () => (await fetch('http://127.0.0.1:3000/health')).ok,
    ),
    waitFor('Web', async () => (await fetch('http://127.0.0.1:5173')).ok),
    waitFor('Metro', async () =>
      (await (await fetch('http://127.0.0.1:8081/status')).text()).includes(
        'packager-status:running',
      ),
    ),
    waitFor(
      'Supabase',
      async () =>
        (
          await fetch('http://127.0.0.1:54321/auth/v1/health', {
            headers: { apikey: key },
          })
        ).ok,
    ),
    waitFor('Fineract', fineractHealth),
  ]);
} finally {
  for (const child of children) stop(child);
}
