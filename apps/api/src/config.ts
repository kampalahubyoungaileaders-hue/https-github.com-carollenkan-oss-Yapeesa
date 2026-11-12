export interface ApiConfig {
  supabaseUrl: string;
  publishableKey: string;
  pinPepper: string;
  gatewayKey: string;
  cookieKey: Buffer;
  webOrigin: string;
  secureCookies: boolean;
  trustedProxyHops?: number;
  authAdminKey?: string;
  fineractGatewayOnly?: boolean;
  fineractInstances?: Record<string, { url: string; localTest?: boolean }>;
}
export function readConfig(): ApiConfig | undefined {
  const env = process.env;
  const values = [
    'SUPABASE_URL',
    'SUPABASE_PUBLISHABLE_KEY',
    'PIN_PEPPER',
    'AUTH_GATEWAY_KEY',
    'SESSION_COOKIE_KEY',
  ] as const;
  if (values.every((name) => !env[name])) return undefined;
  if (values.some((name) => !env[name]))
    throw new Error('Complete the server authentication configuration');
  const url = new URL(env['SUPABASE_URL']!);
  if (
    url.protocol !== 'https:' &&
    !(
      url.protocol === 'http:' &&
      ['localhost', '127.0.0.1'].includes(url.hostname)
    )
  )
    throw new Error('Supabase requires HTTPS');
  if (!/^[a-f0-9]{64}$/i.test(env['SESSION_COOKIE_KEY']!))
    throw new Error('SESSION_COOKIE_KEY must be 32 random bytes in hex');
  if (env['PIN_PEPPER']!.length < 32 || env['AUTH_GATEWAY_KEY']!.length < 32)
    throw new Error(
      'Authentication secrets must contain at least 32 characters',
    );
  const origin = new URL(
    env['WEB_ORIGIN'] ?? env['RENDER_EXTERNAL_URL'] ?? 'http://127.0.0.1:5173',
  ).origin;
  const trustedProxyHops = Number(env['TRUSTED_PROXY_HOPS'] ?? '0');
  if (
    !Number.isInteger(trustedProxyHops) ||
    trustedProxyHops < 0 ||
    trustedProxyHops > 3
  )
    throw new Error('Invalid TRUSTED_PROXY_HOPS');
  if (env['NODE_ENV'] === 'production' && !origin.startsWith('https://'))
    throw new Error('Production WEB_ORIGIN requires HTTPS');
  let fineractInstances: ApiConfig['fineractInstances'];
  if (env['FINERACT_INSTANCES']) {
    const raw: unknown = JSON.parse(env['FINERACT_INSTANCES']);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
      throw new Error('Invalid FINERACT_INSTANCES');
    fineractInstances = {};
    for (const [id, item] of Object.entries(raw)) {
      if (
        !/^[a-z][a-z0-9_-]{0,62}$/.test(id) ||
        !item ||
        typeof item !== 'object' ||
        !('url' in item) ||
        typeof item.url !== 'string'
      )
        throw new Error('Invalid Fineract instance');
      const endpoint = item as { url: string; localTest?: boolean };
      if (endpoint.localTest && env['NODE_ENV'] === 'production')
        throw new Error(
          'Local Fineract test bypass is forbidden in production',
        );
      const base = new URL(endpoint.url);
      if (
        base.protocol !== 'https:' ||
        base.username ||
        base.password ||
        base.search ||
        base.hash ||
        base.pathname !== '/fineract-provider/api/v1/'
      )
        throw new Error('Invalid Fineract URL');
      fineractInstances[id] = {
        url: base.href,
        ...(endpoint.localTest === true ? { localTest: true } : {}),
      };
    }
  }
  return {
    fineractGatewayOnly: env['FINERACT_GATEWAY_ONLY'] === 'true',
    ...(fineractInstances ? { fineractInstances } : {}),
    supabaseUrl: url.origin,
    publishableKey: env['SUPABASE_PUBLISHABLE_KEY']!,
    pinPepper: env['PIN_PEPPER']!,
    gatewayKey: env['AUTH_GATEWAY_KEY']!,
    cookieKey: Buffer.from(env['SESSION_COOKIE_KEY']!, 'hex'),
    webOrigin: origin,
    secureCookies: env['NODE_ENV'] === 'production',
    trustedProxyHops,
    ...(env['SUPABASE_AUTH_ADMIN_KEY']
      ? { authAdminKey: env['SUPABASE_AUTH_ADMIN_KEY'] }
      : {}),
  };
}
