import { writeFile } from 'node:fs/promises';
import openapiTS, { astToString } from 'openapi-typescript';
import { buildApp } from '../apps/api/src/app.js';
const app = buildApp();
try {
  await app.ready();
  const spec = app.swagger();
  await writeFile(
    'packages/api-client/openapi.json',
    JSON.stringify(spec, null, 2) + '\n',
  );
  const types = await openapiTS(spec as Parameters<typeof openapiTS>[0]);
  await writeFile('packages/api-client/src/schema.ts', astToString(types));
} finally {
  await app.close();
}
