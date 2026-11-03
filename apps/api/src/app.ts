import Fastify from 'fastify';
export function buildApp() {
  const app = Fastify({ logger: false });
  app.get(
    '/health',
    {
      schema: {
        response: {
          200: {
            type: 'object',
            additionalProperties: false,
            required: ['status'],
            properties: { status: { type: 'string', const: 'ok' } },
          },
        },
      },
    },
    async () => ({ status: 'ok' as const }),
  );
  return app;
}
