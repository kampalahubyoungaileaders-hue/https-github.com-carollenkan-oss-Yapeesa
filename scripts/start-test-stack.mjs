import { readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';

// Only the disposable local stack uses placeholder SMS settings. The CLI
// otherwise disables phone/password login when no delivery provider is enabled.
// No SMS is sent: users are created confirmed by the local fixture provisioner.
const path = 'supabase/config.toml';
const original = await readFile(path, 'utf8');
const testConfig = original
  .replace(
    '# [auth.sms.test_otp]',
    '[auth.sms.test_otp]\n256700000016 = "654321"\n256700000017 = "654321"\n256700000023 = "654321"\n256700000024 = "654321"\n256700000025 = "654321"\n256700000026 = "654321"\n256700000028 = "654321"\n256700000029 = "654321"',
  )
  .replace(
    /\[auth\.sms\.twilio\][\s\S]*?(?=\n\[auth\.mfa\])/,
    '[auth.sms.twilio]\nenabled = true\naccount_sid = "local-test-only"\nmessage_service_sid = "local-test-only"\nauth_token = "local-test-only"\n',
  );
if (testConfig === original)
  throw new Error('SMS configuration section missing');
try {
  await writeFile(path, testConfig);
  const code = await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        process.env.npm_execpath,
        'exec',
        'supabase',
        'start',
        '--exclude',
        'realtime,storage-api,imgproxy,postgres-meta,studio,edge-runtime,logflare,vector,supavisor',
      ],
      { stdio: 'inherit' },
    );
    child.on('error', reject);
    child.on('exit', resolve);
  });
  if (code !== 0) process.exitCode = 1;
} finally {
  await writeFile(path, original);
}
