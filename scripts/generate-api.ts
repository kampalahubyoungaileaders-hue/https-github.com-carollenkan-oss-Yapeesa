import { writeFile } from 'node:fs/promises';
import openapiTS, { astToString } from 'openapi-typescript';
import { format, resolveConfig } from 'prettier';
import { buildApp } from '../apps/api/src/app.js';
const app = buildApp();
try {
  await app.ready();
  const spec = app.swagger();
  await writeFile(
    'packages/api-client/openapi.json',
    await format(JSON.stringify(spec, null, 2), { parser: 'json' }),
  );
  const types = await openapiTS(spec as Parameters<typeof openapiTS>[0]);
  const path = 'packages/api-client/src/schema.ts';
  await writeFile(
    path,
    await format(astToString(types), {
      ...(await resolveConfig(path)),
      filepath: path,
    }),
  );
} finally {
  await app.close();
}
