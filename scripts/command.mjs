import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
export const root = fileURLToPath(new URL('../', import.meta.url));
// Resolve pnpm through Node rather than executing a Windows .cmd via a shell.
export function launch(command, args, options = {}) {
  const pnpm = command === 'pnpm';
  return spawn(
    pnpm ? process.execPath : command,
    pnpm ? [process.env.npm_execpath, ...args] : args,
    { cwd: root, stdio: 'inherit', ...options },
  );
}
export function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = launch(command, args);
    child.once('error', reject);
    child.once('exit', (code, signal) =>
      code === 0
        ? resolve()
        : reject(new Error(`${command} failed (${signal ?? code})`)),
    );
  });
}

export function stop(child) {
  if (child.pid && child.exitCode === null) {
    if (process.platform === 'win32') child.kill('SIGTERM');
    else {
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch (error) {
        if (error.code !== 'ESRCH') throw error;
      }
    }
  }
}
