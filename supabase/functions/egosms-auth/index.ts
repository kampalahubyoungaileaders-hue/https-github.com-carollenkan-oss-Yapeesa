import { createSmsHandler } from './handler.ts';

// Minimal runtime port keeps this entrypoint typechecked in Node CI as well as Deno.
declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (request: Request) => Promise<Response>): unknown;
};
Deno.serve(
  createSmsHandler({
    username: Deno.env.get('EGOSMS_API_USERNAME'),
    password: Deno.env.get('EGOSMS_API_PASSWORD'),
    senderId: Deno.env.get('EGOSMS_SENDER_ID'),
    hookSecret: Deno.env.get('SEND_SMS_HOOK_SECRET'),
  }),
);
