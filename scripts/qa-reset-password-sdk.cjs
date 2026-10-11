'use strict';
// Actual pinned SDK and actual application helper, with a deterministic Auth
// HTTP double. No requests leave this process and no real credentials exist.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const ts = require(path.resolve('node_modules/typescript'));
const { createClient } = require(path.resolve('node_modules/@supabase/supabase-js'));
const compiled = ts.transpileModule(fs.readFileSync('lib/supabase/client.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const storage = map => ({ getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, value), removeItem: key => map.delete(key) });
function token(method, exp = Math.floor(Date.now() / 1000) + 3600) {
  return encode({ alg: 'HS256', typ: 'JWT' }) + '.' + encode({ iss: 'http://127.0.0.1:9/auth/v1', sub: 'test-user', aud: 'authenticated', role: 'authenticated', aal: 'aal1', session_id: 'test-recovery-id', exp, iat: Math.floor(Date.now() / 1000), amr: [{ method, timestamp: Math.floor(Date.now() / 1000) }] }) + '.dGVzdC1vbmx5';
}
function authFixture(method, options = {}) {
  const sdkStorage = new Map([['reset-sdk-code-verifier', 'test-verifier']]);
  const tabStorage = new Map();
  const events = [];
  const calls = { exchange: 0, verify: 0, user: 0 };
  let rejectUser = false;
  const session = { access_token: token(method), refresh_token: 'test-only-refresh', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: 'test-user' } };
  const newClient = () => createClient('http://127.0.0.1:9', 'test-only', {
    auth: { storageKey: 'reset-sdk', flowType: 'pkce', autoRefreshToken: false, detectSessionInUrl: false, storage: storage(sdkStorage) },
    global: { fetch: async (url, init) => {
      const pathname = new URL(url).pathname;
      if (pathname === '/auth/v1/token') {
        assert.equal(new URL(url).searchParams.get('grant_type'), 'pkce');
        const body = JSON.parse(init.body);
        assert.equal(body.auth_code, 'test-code');
        assert.equal(body.code_verifier, 'test-verifier');
        calls.exchange++;
        options.exchangeEntered?.();
        if (options.exchangeGate) await options.exchangeGate;
        return Response.json(session);
      }
      if (pathname === '/auth/v1/verify') {
        assert.deepEqual(JSON.parse(init.body), { type: 'recovery', token_hash: 'test-hash', gotrue_meta_security: {} });
        calls.verify++;
        return Response.json(session);
      }
      if (pathname === '/auth/v1/logout') return new Response(null, { status: 204 });
      assert.equal(pathname, '/auth/v1/user', 'no other Auth or application endpoints are permitted');
      calls.user++;
      assert.equal(new Headers(init.headers).get('authorization'), 'Bearer ' + session.access_token);
      return rejectUser ? Response.json({ message: 'invalid test session' }, { status: 401 }) : Response.json(session.user);
    } },
  });
  function load(client) {
    client.auth.onAuthStateChange(event => events.push(event));
    const loaded = { exports: {} };
    vm.runInNewContext(compiled, {
      module: loaded, exports: loaded.exports, URL, URLSearchParams, atob, setTimeout, crypto: webcrypto, TextEncoder,
      process: { env: { NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:9', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test-only' } },
      window: { location: new URL('http://127.0.0.1:3212/auth/reset-password'), sessionStorage: storage(tabStorage) },
      require: name => { assert.equal(name, '@supabase/supabase-js'); return { createClient: () => client }; },
    });
    return loaded.exports;
  }
  return { newClient, load, calls, events, sdkStorage, tabStorage, session, rejectUser: () => { rejectUser = true; } };
}

test('PKCE recovery uses verified public claims and survives actual SDK SIGNED_IN restore', async () => {
  const f = authFixture('recovery');
  const client = f.newClient();
  const helper = f.load(client);
  await helper.exchangePasswordRecoveryCode('test-code');
  const current = (await client.auth.getSession()).data.session;
  assert.equal(await helper.isPasswordRecoverySession(current), true);
  assert.ok(f.events.includes('SIGNED_IN'));
  assert.equal(f.events.includes('PASSWORD_RECOVERY'), false, 'pinned PKCE exchange does not emit recovery');
  assert.equal(f.sdkStorage.has('reset-sdk-code-verifier'), false);
  const reloadedClient = f.newClient();
  const reloadedHelper = f.load(reloadedClient);
  const reloaded = (await reloadedClient.auth.getSession()).data.session;
  assert.equal(await reloadedHelper.isPasswordRecoverySession(reloaded), true);
  assert.equal(f.calls.exchange, 1, 'reload must not reuse an Auth code');
  const marker = JSON.parse([...f.tabStorage.values()][0]);
  assert.deepEqual(marker, { userId: 'test-user', sessionId: 'test-recovery-id' });
  assert.ok(!JSON.stringify(marker).includes(current.access_token));
  f.rejectUser();
  assert.equal(await reloadedHelper.isPasswordRecoverySession(reloaded), false, 'Auth server rejection still blocks a saved marker');
});

test('normal SDK SIGNED_IN restore of an ordinary session still permits a fresh recovery code', async () => {
  const f = authFixture('recovery');
  f.sdkStorage.set('reset-sdk', JSON.stringify({ ...f.session, access_token: token('password') }));
  const client = f.newClient();
  const helper = f.load(client);
  await helper.exchangePasswordRecoveryCode('test-code');
  assert.equal(await helper.isPasswordRecoverySession((await client.auth.getSession()).data.session), true);
  assert.equal(f.calls.exchange, 1);
});

for (const method of ['password', 'oauth', 'magiclink']) test('ordinary ' + method + ' PKCE cannot enable recovery despite successful HTTP exchange', async () => {
  const f = authFixture(method);
  const client = f.newClient();
  const helper = f.load(client);
  await assert.rejects(helper.exchangePasswordRecoveryCode('test-code'), /ссылка восстановления/);
  assert.equal(await helper.isPasswordRecoverySession((await client.auth.getSession()).data.session), false);
  assert.equal(f.tabStorage.size, 0);
});

test('public verifyOtp PASSWORD_RECOVERY event supports OTP-method recovery across reload', async () => {
  const f = authFixture('otp');
  const client = f.newClient();
  const helper = f.load(client);
  const verified = await client.auth.verifyOtp({ type: 'recovery', token_hash: 'test-hash' });
  assert.equal(verified.error, null);
  assert.ok(f.events.includes('PASSWORD_RECOVERY'));
  assert.equal(await helper.isPasswordRecoverySession(verified.data.session), true);
  const reloadedClient = f.newClient();
  const reloadedHelper = f.load(reloadedClient);
  assert.equal(await reloadedHelper.isPasswordRecoverySession((await reloadedClient.auth.getSession()).data.session), true);
  assert.equal(f.calls.verify, 1);
});

test('SDK persisted PKCE can resume during pending claims validation without reusing consumed code', async () => {
  const f = authFixture('recovery');
  const client = f.newClient();
  const getClaims = client.auth.getClaims.bind(client.auth);
  let release, entered;
  const gate = new Promise(resolve => { release = resolve; });
  const validationStarted = new Promise(resolve => { entered = resolve; });
  client.auth.getClaims = async (...args) => { entered(); await gate; return getClaims(...args); };
  const helper = f.load(client);
  const exchange = helper.exchangePasswordRecoveryCode('test-code');
  await validationStarted;
  assert.equal(f.sdkStorage.has('reset-sdk-code-verifier'), false);
  const receipt = JSON.parse(f.tabStorage.get('tf-password-recovery:127.0.0.1:9:callback'));
  assert.equal(receipt.kind, 'code');
  assert.match(receipt.digest, /^[a-f0-9]{64}$/);
  const reloaded = f.load(f.newClient());
  assert.equal(await reloaded.resumePasswordRecoveryCallback('code', 'test-code'), true);
  assert.equal(await reloaded.resumePasswordRecoveryCallback('code', 'other-code'), false);
  assert.equal(f.calls.exchange, 1);
  release(); await exchange;
});

test('SDK recovery OTP receipt resumes saved session and is invalidated by public signout', async () => {
  const f = authFixture('otp');
  const client = f.newClient();
  const helper = f.load(client);
  await helper.verifyPasswordRecoveryToken('test-hash');
  const reloadedClient = f.newClient();
  const reloaded = f.load(reloadedClient);
  assert.equal(await reloaded.resumePasswordRecoveryCallback('token_hash', 'test-hash'), true);
  assert.equal(f.calls.verify, 1);
  await reloadedClient.auth.signOut({ scope: 'local' });
  assert.equal(await reloaded.resumePasswordRecoveryCallback('token_hash', 'test-hash'), false);
  assert.equal(f.tabStorage.size, 0);
});

test('parallel callback helper rejects before Auth and cannot bind A session to B digest', async () => {
  let release, entered;
  const exchangeGate = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  const f = authFixture('recovery', { exchangeGate, exchangeEntered: entered });
  const helper = f.load(f.newClient());
  const first = helper.exchangePasswordRecoveryCode('test-code');
  await started;
  await assert.rejects(helper.exchangePasswordRecoveryCode('other-code'), /уже выполняется/);
  assert.equal(f.calls.exchange, 1, 'rejected B must never reach Auth or clear active A');
  release(); await first;
  const reloaded = f.load(f.newClient());
  assert.equal(await reloaded.resumePasswordRecoveryCallback('code', 'test-code'), true);
  assert.equal(await reloaded.resumePasswordRecoveryCallback('code', 'other-code'), false);
  await helper.verifyPasswordRecoveryToken('test-hash');
  assert.equal(f.calls.verify, 1, 'completed operation releases its own lock');
});

for (const method of ['password', 'oauth', 'magiclink']) test('verified ordinary ' + method + ' JWT rejects a matching forged tab marker', async () => {
  const f = authFixture(method);
  f.sdkStorage.set('reset-sdk', JSON.stringify(f.session));
  f.tabStorage.set('tf-password-recovery:127.0.0.1:9', JSON.stringify({ userId: 'test-user', sessionId: 'test-recovery-id' }));
  const client = f.newClient();
  const helper = f.load(client);
  const current = (await client.auth.getSession()).data.session;
  assert.ok(current, 'the ordinary signed session must actually be restored by the SDK');
  assert.equal(await helper.isPasswordRecoverySession(current), false);
});

test('pinned getClaims rejects expired tokens before accepting the Auth response', async () => {
  const f = authFixture('recovery');
  const client = f.newClient();
  const expired = token('recovery', Math.floor(Date.now() / 1000) - 60);
  await assert.rejects(client.auth.getClaims(expired), /expired/);
  const helper = f.load(client);
  assert.equal(await helper.isPasswordRecoverySession({ ...f.session, access_token: expired }), false);
  assert.equal(f.calls.user, 0);
});

test('pinned getClaims verifies asymmetric signatures and rejects forged recovery claims', async () => {
  const pair = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const publicKey = { ...await webcrypto.subtle.exportKey('jwk', pair.publicKey), kid: 'test-only-ephemeral', alg: 'ES256' };
  const header = encode({ alg: 'ES256', typ: 'JWT', kid: publicKey.kid });
  const payload = token('recovery').split('.')[1];
  const body = header + '.' + payload;
  const signature = Buffer.from(await webcrypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, Buffer.from(body))).toString('base64url');
  const client = createClient('http://127.0.0.1:9', 'test-only', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async url => { assert.match(String(url), /\/\.well-known\/jwks.json$/); return Response.json({ keys: [publicKey] }); } },
  });
  const valid = await client.auth.getClaims(body + '.' + signature);
  assert.equal(valid.error, null);
  assert.equal(valid.data.claims.amr[0].method, 'recovery');
  const forged = await client.auth.getClaims(header + '.' + encode({ ...valid.data.claims, sub: 'forged-user' }) + '.' + signature);
  assert.ok(forged.error);
  assert.equal(forged.data, null);
});
