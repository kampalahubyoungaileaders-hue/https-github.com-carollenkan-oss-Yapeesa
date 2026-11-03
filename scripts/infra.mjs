import { access, copyFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { root, run } from './command.mjs';
export const compose = [
  'compose',
  '--env-file',
  '.env',
  '-f',
  'infra/fineract/docker-compose.yml',
];
export async function infrastructure(action) {
  await run('docker', ['info', '--format', '{{.ServerVersion}}']);
  try {
    await access(`${root}/.env`);
  } catch {
    await copyFile(`${root}/.env.example`, `${root}/.env`);
  }
  if (action === 'up') {
    await run('docker', [...compose, 'config', '--quiet']);
    await run('pnpm', ['exec', 'supabase', 'start']);
    await run('docker', [...compose, 'up', '-d']);
  } else if (action === 'down') {
    await run('docker', [...compose, 'down']);
    await run('pnpm', ['exec', 'supabase', 'stop']);
  } else throw new Error('Expected up or down');
}
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  infrastructure(process.argv[2]).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
