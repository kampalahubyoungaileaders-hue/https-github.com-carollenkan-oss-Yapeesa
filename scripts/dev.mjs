import { run, launch, stop } from './command.mjs';
import { infrastructure } from './infra.mjs';
try {
  // pnpm dev is the fresh-clone entry point, including dependency installation.
  await run('pnpm', ['install', '--frozen-lockfile']);
  await infrastructure('up');
  const apps = launch('pnpm', ['dev:apps'], {
    detached: process.platform !== 'win32',
  });
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.once(signal, () => stop(apps));
  apps.once('error', (error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
  apps.once('exit', (code) => {
    process.exitCode = code ?? 1;
  });
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
