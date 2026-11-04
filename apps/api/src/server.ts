import { buildApp } from './app.js';
import { readConfig } from './config.js';
import { resolve } from 'node:path';
import { stat } from 'node:fs/promises';
const webRoot =
  process.env['SERVE_WEB'] === 'true'
    ? resolve(import.meta.dirname, '../../web/dist')
    : undefined;
if (webRoot) await stat(resolve(webRoot, 'index.html'));
const app = buildApp(readConfig(), webRoot);
const port = Number(process.env['PORT'] ?? '3000');
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error('Invalid PORT');
await app.listen({ port, host: process.env['API_HOST'] ?? '127.0.0.1' });
console.log(`Yapesa API: http://127.0.0.1:${port}`);
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void app.close().then(() => process.exit(0));
  });
}
