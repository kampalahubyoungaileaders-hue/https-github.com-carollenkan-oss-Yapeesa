import { createStaffAdminHandler } from './handler.ts';
declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (request: Request) => Promise<Response>): unknown;
};
Deno.serve(
  createStaffAdminHandler({
    url: Deno.env.get('SUPABASE_URL'),
    publishableKey: Deno.env.get('SUPABASE_ANON_KEY'),
    adminKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
  }),
);
