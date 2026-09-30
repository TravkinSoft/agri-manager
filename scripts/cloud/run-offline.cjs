'use strict';
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const root = path.resolve(__dirname, '../..');
const command = process.argv[2];
if (!['build', 'start', 'dev', 'typecheck', 'lint', 'unit'].includes(command)) throw new Error('Expected build/start/dev/typecheck/lint/unit');
const envFiles = fs.readdirSync(root).filter(name => /^\.env(?:$|\.)/.test(name) && name !== '.env.example');
if (envFiles.length) throw new Error('TRA11_OFFLINE: remove environment files from this disposable copy before running');
const env = { ...process.env };
for (const key of Object.keys(env)) {
  if (/^(NEXT_PUBLIC_|SUPABASE_|OPENAI_|ANTHROPIC_|AGRO_|UAV_|WEB_PUSH_|CRON_|APP_URL$|INVITE_APP_URL$|DATABASE_URL$|TF_ASSIST_)/.test(key)) delete env[key];
}
Object.assign(env, {
  NEXT_TELEMETRY_DISABLED: '1', TF_CLOUD_OFFLINE: '1',
  NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:9',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'offline-test-key-not-a-credential',
  NEXT_PUBLIC_SITE_URL: 'http://127.0.0.1:3211',
  NEXT_PUBLIC_APP_URL: 'http://127.0.0.1:3211',
  TRA11_BUILD_FONTS: command === 'build' ? '1' : '0',
});
const guard = path.join(__dirname, 'no-network.cjs');
env.NODE_OPTIONS = `${env.NODE_OPTIONS || ''} --require ${JSON.stringify(guard)}`.trim();
let args;
if (command === 'typecheck') args = ['node_modules/typescript/bin/tsc', '--noEmit', '--incremental', 'false'];
else if (command === 'unit') {
  const file = process.argv[3];
  const allowed = ['qa-agro-a1-calculation.ts', 'qa-agro-c1-calculation.ts', 'qa-agro-d1-summary.ts', 'account-deletion-contract.test.cjs'];
  if (!allowed.includes(file)) throw new Error('Unit script is not in reviewed offline allowlist');
  args = file.endsWith('.cjs') ? ['--test', `scripts/${file}`] : ['node_modules/tsx/dist/cli.mjs', `scripts/${file}`];
} else args = ['node_modules/next/dist/bin/next', command, ...(['start', 'dev'].includes(command) ? ['-H', '127.0.0.1', '-p', process.env.PORT || '3211'] : [])];
const result = spawnSync(process.execPath, args, { cwd: root, env, stdio: 'inherit' });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
