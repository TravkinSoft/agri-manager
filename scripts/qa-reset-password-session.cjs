'use strict';
// Execute the actual page with deterministic React/Auth doubles. No browser,
// network, recovery emails, accounts or credentials are used.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require(path.resolve('node_modules/typescript'));
const { webcrypto } = require('node:crypto');
const sourcePath = process.argv[2] || process.env.RESET_PAGE_SOURCE;
const source = sourcePath
  ? fs.readFileSync(sourcePath, 'utf8')
  : fs.readFileSync('app/auth/reset-password/page.tsx', 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const clientCompiled = ts.transpileModule(fs.readFileSync('lib/supabase/client.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const flush = () => new Promise(resolve => setImmediate(resolve));
function makeSession({ method = 'recovery', sessionId = 'test-recovery-id', userId = 'test-user', exp = Math.floor(Date.now() / 1000) + 3600 } = {}) {
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const claims = { iss: 'http://127.0.0.1:9/auth/v1', sub: userId, aud: 'authenticated', exp, iat: Math.floor(Date.now() / 1000), role: 'authenticated', aal: 'aal1', session_id: sessionId, amr: [{ method, timestamp: Math.floor(Date.now() / 1000) }] };
  return { access_token: encode({ alg: 'HS256', typ: 'JWT' }) + '.' + encode(claims) + '.dGVzdC1vbmx5', refresh_token: 'test-only-refresh', token_type: 'bearer', expires_in: 3600, expires_at: exp, user: { id: userId } };
}
const validSession = makeSession();
const storageKey = 'tf-password-recovery:127.0.0.1:9';
const callbackKey = storageKey + ':callback';
const storageDouble = map => ({ getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, value), removeItem: key => map.delete(key) });

function harness(options = {}) {
  let cursor = 0;
  let effects = [];
  const slots = [];
  const listeners = [];
  let currentSession = options.session || null;
  let implicitEmitted = false;
  const emit = (event, session = currentSession) => listeners.forEach(listener => listener(event, session));
  const storage = options.storage || new Map();
  const calls = { exchange: 0, verify: 0, session: 0, claims: 0, user: 0, update: 0, signOut: 0, paths: [], replaced: [] };
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [slots[index], value => { slots[index] = value; }];
    },
    useRef(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { current: initial };
      return slots[index];
    },
    useEffect(callback) { effects.push(callback); },
  };
  const auth = {
    onAuthStateChange(callback) {
      listeners.push(callback);
      return { data: { subscription: { unsubscribe() {} } } };
    },
    async initialize() { if (options.initializeGate) await options.initializeGate; return { error: null }; },
    async exchangeCodeForSession(code) {
      calls.exchange++;
      assert.equal(code, options.expectedCode || 'test-code');
      if (!options.exchangeError && currentSession) emit('SIGNED_IN');
      return { data: { session: currentSession }, error: options.exchangeError || null };
    },
    async verifyOtp(params) {
      calls.verify++;
      assert.equal(params.type, 'recovery');
      assert.equal(params.token_hash, 'test-hash');
      if (!options.verifyError && currentSession) emit('PASSWORD_RECOVERY');
      return { data: { session: currentSession }, error: options.verifyError || null };
    },
    async getSession() {
      calls.session++;
      if (options.sessionGate) await options.sessionGate;
      if (options.implicitRecovery && !implicitEmitted) {
        implicitEmitted = true;
        setTimeout(() => emit('PASSWORD_RECOVERY'), 0);
      }
      return { data: { session: currentSession }, error: options.sessionError || null };
    },
    async getClaims(token, config) {
      calls.claims++;
      assert.equal(config, undefined, 'no expired-token or custom-key validation bypass');
      if (options.claimsGate) await options.claimsGate;
      const claims = options.claims || JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
      return { data: options.claimsError ? null : { claims }, error: options.claimsError || null };
    },
    async getUser(token) {
      calls.user++;
      if (options.userGate) await options.userGate;
      assert.equal(token, currentSession?.access_token, 'validate the exact session JWT');
      return { data: { user: options.user === null ? null : { id: options.userId || 'test-user' } }, error: options.userError || null };
    },
  };
  const clientLoaded = { exports: {} };
  const location = new URL('http://127.0.0.1:3212' + (options.pathname || '/auth/reset-password') + (options.query ? '?' + options.query : '') + (options.hash || ''));
  const browser = { location, sessionStorage: options.storageDenied ? { getItem() { throw new Error('storage denied'); }, setItem() { throw new Error('storage denied'); }, removeItem() { throw new Error('storage denied'); } } : storageDouble(storage), history: { state: null, replaceState(_state, _title, value) { calls.replaced.push(value); location.href = value; } } };
  vm.runInNewContext(clientCompiled, {
    module: clientLoaded, exports: clientLoaded.exports, setTimeout, URLSearchParams, URL, atob, TextEncoder,
    crypto: { subtle: { digest: async (...args) => { if (options.digestGate) await options.digestGate; return webcrypto.subtle.digest(...args); } } },
    process: { env: { NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:9', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test-only' } },
    window: browser,
    require(name) {
      assert.equal(name, '@supabase/supabase-js');
      return { createClient: (_url, _key, config) => {
        calls.manualPkce = config?.auth?.detectSessionInUrl === false;
        return { auth };
      } };
    },
  });
  if (options.recoveryBeforeMount) emit('PASSWORD_RECOVERY');
  const loaded = { exports: {} };
  const jsx = (type, props) => ({ type, props: props || {} });
  vm.runInNewContext(compiled, {
    module: loaded, exports: loaded.exports, URLSearchParams, URL,
    window: browser,
    require(name) {
      if (name === 'react') return react;
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
      if (name === 'next/navigation') return {
        useRouter: () => ({ push: value => calls.paths.push(value) }),
        useSearchParams: () => new URLSearchParams(options.query || ''),
      };
      if (name === 'next/link') return { default: 'Link', __esModule: true };
      if (name === '@/lib/supabase/client') return clientLoaded.exports;
      if (name === '@/lib/contexts/auth-context') return { useAuth: () => ({
        updatePassword: async () => { calls.update++; if (options.updateError) throw options.updateError; },
        signOut: async () => { calls.signOut++; },
      }) };
      if (name.startsWith('@/components/ui/') || name === 'lucide-react') return new Proxy({}, { get: (_, key) => key });
      throw new Error('Unexpected dependency: ' + name);
    },
  });
  function render() {
    cursor = 0;
    effects = [];
    const tree = loaded.exports.default();
    for (const effect of effects) effect();
    return tree;
  }
  function nodes(tree, match) {
    const found = [];
    function visit(node) {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) return node.forEach(visit);
      if (match(node)) found.push(node);
      visit(node.props?.children);
    }
    visit(tree);
    return found;
  }
  function text(tree) {
    if (tree == null || typeof tree === 'boolean') return '';
    if (typeof tree !== 'object') return String(tree);
    if (Array.isArray(tree)) return tree.map(text).join(' ');
    return text(tree.props?.children);
  }
  async function settle() { await flush(); await new Promise(resolve => setTimeout(resolve, 10)); return render(); }
  async function submit(tree, values = ['test-only-password', 'test-only-password']) {
    const inputs = nodes(tree, node => node.props?.type === 'password');
    inputs.forEach((input, index) => input.props.onChange({ target: { value: values[index] } }));
    tree = render();
    await nodes(tree, node => node.type === 'form')[0].props.onSubmit({ preventDefault() {} });
  }
  return { calls, render, nodes, text, settle, submit, emit, storage, location,
    setSession(session) { currentSession = session; } };
}

let passed = 0;
async function check(name, run) { await run(); passed++; console.log('PASS ' + name); }
function assertDisabled(h, tree) {
  const controls = h.nodes(tree, node => node.props?.type === 'password' || node.props?.type === 'submit');
  assert.equal(controls.length, 3);
  assert.ok(controls.every(node => node.props.disabled === true), 'password controls must remain disabled');
}
function assertEnabled(h, tree) {
  const controls = h.nodes(tree, node => node.props?.type === 'password' || node.props?.type === 'submit');
  assert.equal(controls.length, 3);
  assert.ok(controls.every(node => node.props.disabled === false));
}

(async () => {
  await check('bare URL shows actionable error, disables password controls and blocks submit', async () => {
    const h = harness();
    h.render();
    const tree = await h.settle();
    assert.match(h.text(tree), /[Сс]сылк.*восстанов|[Сс]есси.*восстанов/);
    assertDisabled(h, tree);
    assert.ok(h.nodes(tree, node => node.props?.href === '/auth/forgot-password').length);
    await h.submit(tree);
    assert.equal(h.calls.update, 0);
    assert.equal(h.calls.signOut, 0);
    assert.equal(h.calls.user, 0);
    assert.deepEqual(h.calls.paths, []);
  });
  await check('controls stay disabled while implicit SDK session initialization is pending', async () => {
    let release;
    const sessionGate = new Promise(resolve => { release = resolve; });
    const h = harness({ session: validSession, sessionGate, implicitRecovery: true, hash: '#type=recovery&access_token=test&refresh_token=test' });
    const tree = h.render();
    assertDisabled(h, tree);
    await h.submit(tree);
    assert.equal(h.calls.update, 0);
    release();
    assertEnabled(h, await h.settle());
  });
  for (const [name, options] of [
    ['PKCE', { query: 'code=test-code', session: validSession }],
    ['token_hash recovery', { query: 'token_hash=test-hash&type=recovery', session: validSession }],
    ['implicit SDK-consumed URL', { session: validSession, implicitRecovery: true }],
    ['recovery event received before page mount', { session: validSession, recoveryBeforeMount: true }],
  ]) await check(name + ' permits update only after session and user validation', async () => {
    const h = harness(options);
    h.render();
    const tree = await h.settle();
    assertEnabled(h, tree);
    assert.equal(h.calls.session, 2);
    assert.equal(h.calls.user, 1);
    await h.submit(tree);
    assert.equal(h.calls.update, 1);
    assert.equal(h.calls.signOut, 1);
    assert.deepEqual(h.calls.paths, ['/auth/login?password_reset=1']);
    if (name === 'PKCE') {
      assert.equal(h.calls.exchange, 1);
      assert.equal(h.calls.manualPkce, true, 'SDK must leave recovery PKCE code to page validation');
    }
    if (name === 'token_hash recovery') assert.equal(h.calls.verify, 1);
  });
  for (const [name, options] of [
    ['PKCE rejected despite pre-existing session', { query: 'code=test-code', session: validSession, exchangeError: new Error('expired code') }],
    ['recovery token rejected despite pre-existing session', { query: 'token_hash=test-hash&type=recovery', session: validSession, verifyError: new Error('expired link') }],
    ['PKCE success without session', { query: 'code=test-code' }],
    ['wrong token_hash type without session', { query: 'token_hash=test-hash&type=signup' }],
    ['ordinary authenticated session without recovery proof', { session: validSession }],
    ['type=recovery query alone with ordinary session', { query: 'type=recovery', session: validSession }],
    ['type=recovery fragment alone with ordinary session', { hash: '#type=recovery', session: validSession }],
    ['ordinary PKCE login callback', { query: 'code=test-code', session: makeSession({ method: 'password', sessionId: 'ordinary-login' }) }],
    ['unverified JWT claims', { session: validSession, recoveryBeforeMount: true, claimsError: new Error('bad signature') }],
    ['verified claims from another user', { session: validSession, recoveryBeforeMount: true, claims: { sub: 'other-user', session_id: 'test-recovery-id' } }],
    ['verified claims from another session', { session: validSession, recoveryBeforeMount: true, claims: { sub: 'test-user', session_id: 'other-session' } }],
    ['session read error', { sessionError: new Error('session unavailable') }],
    ['recovery session rejected by Auth server', { session: validSession, implicitRecovery: true, userError: new Error('expired session') }],
    ['recovery session without verified user', { session: validSession, implicitRecovery: true, user: null }],
    ['Auth user differs from recovery session', { session: validSession, implicitRecovery: true, userId: 'other-user' }],
    ['query callback error with cached session', { query: 'error=access_denied&error_description=expired', session: validSession }],
    ['fragment callback error with cached session', { hash: '#error=access_denied&error_description=expired', session: validSession }],
  ]) await check(name + ' leaves update blocked', async () => {
    const h = harness(options);
    h.render();
    const tree = await h.settle();
    assertDisabled(h, tree);
    assert.ok(h.nodes(tree, node => node.props?.variant === 'destructive').length);
    await h.submit(tree);
    assert.equal(h.calls.update, 0);
    assert.equal(h.calls.signOut, 0);
  });
  await check('recovery token refresh remains permitted for the same recovery user', async () => {
    const h = harness({ session: validSession, recoveryBeforeMount: true });
    h.render();
    const tree = await h.settle();
    assertEnabled(h, tree);
    const refreshed = makeSession({ exp: Math.floor(Date.now() / 1000) + 7200 });
    h.setSession(refreshed);
    h.emit('TOKEN_REFRESHED', refreshed);
    await h.submit(tree);
    assert.equal(h.calls.update, 1);
  });
  for (const event of ['SIGNED_OUT', 'USER_UPDATED']) {
    await check(event + ' after recovery clears provenance and blocks stale form submit', async () => {
      const h = harness({ session: validSession, recoveryBeforeMount: true });
      h.render();
      const tree = await h.settle();
      assertEnabled(h, tree);
      h.emit(event, event === 'SIGNED_OUT' ? null : validSession);
      await h.submit(tree);
      assert.equal(h.calls.update, 0);
      assertDisabled(h, h.render());
    });
  }
  await check('SIGNED_IN restoration for the same session preserves recovery', async () => {
    const h = harness({ session: validSession, recoveryBeforeMount: true });
    h.render();
    assertEnabled(h, await h.settle());
    h.emit('SIGNED_IN', validSession);
    await h.submit(h.render());
    assert.equal(h.calls.update, 1);
  });
  for (const event of ['SIGNED_IN', 'TOKEN_REFRESHED']) await check(event + ' with a different session for the same user blocks stale submit', async () => {
    const h = harness({ session: validSession, recoveryBeforeMount: true });
    h.render();
    assertEnabled(h, await h.settle());
    const other = makeSession({ sessionId: 'ordinary-login-id', method: 'password' });
    h.setSession(other);
    h.emit(event, other);
    await h.submit(h.render());
    assert.equal(h.calls.update, 0);
    assertDisabled(h, h.render());
    assert.equal(h.storage.has(storageKey), false);
  });
  for (const kind of ['PKCE', 'token_hash', 'implicit']) await check(kind + ' survives full reload in the same tab without reusing the callback', async () => {
    const storage = new Map();
    const options = kind === 'PKCE' ? { query: 'code=test-code&keep=1' } : kind === 'token_hash' ? { query: 'token_hash=test-hash&type=recovery&keep=1' } : { implicitRecovery: true };
    const first = harness({ ...options, storage, session: validSession });
    first.render();
    assertEnabled(first, await first.settle());
    assert.equal(first.location.searchParams.has('code'), false);
    assert.equal(first.location.searchParams.has('token_hash'), false);
    assert.equal(first.location.searchParams.has('type'), false);
    if (kind !== 'implicit') assert.equal(first.location.searchParams.get('keep'), '1');
    assert.deepEqual(JSON.parse(storage.get(storageKey)), { userId: 'test-user', sessionId: 'test-recovery-id' });
    const reloaded = harness({ storage, session: validSession });
    reloaded.emit('SIGNED_IN'); // Actual SDK restore behavior, not INITIAL_SESSION alone.
    reloaded.render();
    const tree = await reloaded.settle();
    assertEnabled(reloaded, tree);
    assert.equal(reloaded.calls.exchange, 0);
    assert.equal(reloaded.calls.verify, 0);
    await reloaded.submit(tree);
    assert.equal(reloaded.calls.update, 1);
  });
  for (const [name, options] of [
    ['new tab', {}],
    ['malformed saved provenance', { storage: new Map([[storageKey, '{']]) }],
    ['foreign saved provenance', { storage: new Map([[storageKey, JSON.stringify({ userId: 'test-user', sessionId: 'other-session' })]]) }],
  ]) await check(name + ' does not inherit recovery permission', async () => {
    const h = harness({ ...options, session: validSession });
    h.render();
    assertDisabled(h, await h.settle());
  });
  for (const method of ['password', 'oauth', 'magiclink']) await check('matching forged marker cannot open ordinary ' + method + ' session', async () => {
    const storage = new Map([[storageKey, JSON.stringify({ userId: 'test-user', sessionId: 'test-recovery-id' })]]);
    const h = harness({ storage, session: makeSession({ method }) });
    h.render();
    const tree = await h.settle();
    assertDisabled(h, tree);
    await h.submit(tree);
    assert.equal(h.calls.update, 0);
  });
  await check('ordinary OTP matching marker remains editable UX provenance, not server authorization', async () => {
    const storage = new Map([[storageKey, JSON.stringify({ userId: 'test-user', sessionId: 'test-recovery-id' })]]);
    const h = harness({ storage, session: makeSession({ method: 'otp' }) });
    h.render();
    assertEnabled(h, await h.settle());
    assert.equal(h.calls.exchange, 0);
    assert.equal(h.calls.verify, 0);
    assert.equal(h.calls.update, 0, 'UI admission alone is no password mutation or API privilege');
  });
  for (const kind of ['code', 'token_hash']) for (const phase of ['claims', 'user']) await check(kind + ' interrupted before ' + phase + ' validation resumes without callback replay', async () => {
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const storage = new Map();
    const query = kind === 'code' ? 'code=test-code' : 'token_hash=test-hash&type=recovery';
    const first = harness({ query, storage, session: validSession, [phase + 'Gate']: gate });
    first.render();
    assertDisabled(first, await first.settle());
    const receipt = JSON.parse(storage.get(callbackKey));
    assert.equal(receipt.kind, kind);
    assert.match(receipt.digest, /^[a-f0-9]{64}$/);
    assert.equal(receipt.userId, 'test-user');
    assert.equal(receipt.sessionId, 'test-recovery-id');
    assert.ok(!storage.get(callbackKey).includes('test-code') && !storage.get(callbackKey).includes('test-hash'));
    const reload = harness({ query, storage, session: validSession, exchangeError: new Error('consumed code'), verifyError: new Error('consumed OTP') });
    reload.emit('SIGNED_IN');
    reload.render();
    assertEnabled(reload, await reload.settle());
    assert.equal(reload.calls.exchange, 0);
    assert.equal(reload.calls.verify, 0);
    assert.equal(reload.location.searchParams.has(kind), false);
    release();
    await first.settle();
  });
  await check('different callback cannot reuse an earlier consumed receipt', async () => {
    const storage = new Map();
    const first = harness({ query: 'code=test-code', storage, session: validSession });
    first.render();
    assertEnabled(first, await first.settle());
    const second = harness({ query: 'code=other-code', expectedCode: 'other-code', storage, session: validSession, exchangeError: new Error('different invalid code') });
    second.render();
    assertDisabled(second, await second.settle());
    assert.equal(second.calls.exchange, 1);
    assert.equal(storage.size, 0);
  });
  await check('signout while PKCE claims are pending cannot recreate saved proof', async () => {
    let release;
    const claimsGate = new Promise(resolve => { release = resolve; });
    const h = harness({ query: 'code=test-code', session: validSession, claimsGate });
    h.render();
    await h.settle();
    assert.ok(h.storage.has(callbackKey));
    h.emit('SIGNED_OUT', null);
    release();
    assertDisabled(h, await h.settle());
    assert.equal(h.storage.size, 0);
    const reloaded = harness({ session: validSession, storage: h.storage });
    reloaded.render();
    assertDisabled(reloaded, await reloaded.settle());
  });
  for (const phase of ['initialize', 'digest']) for (const event of ['SIGNED_OUT', 'USER_UPDATED']) await check(event + ' during ' + phase + ' cancels callback before Auth exchange', async () => {
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const h = harness({ query: 'code=test-code', session: validSession, [phase + 'Gate']: gate });
    h.render();
    assertDisabled(h, await h.settle());
    assert.equal(h.calls.exchange, 0);
    h.emit(event, event === 'SIGNED_OUT' ? null : validSession);
    release();
    assertDisabled(h, await h.settle());
    assert.equal(h.calls.exchange, 0);
    assert.equal(h.storage.size, 0);
  });
  await check('concurrent submit callbacks update once and successful update closes recovery', async () => {
    const h = harness({ session: validSession, recoveryBeforeMount: true });
    h.render();
    let tree = await h.settle();
    h.nodes(tree, node => node.props?.type === 'password').forEach(input => input.props.onChange({ target: { value: 'test-only-password' } }));
    tree = h.render();
    const submit = h.nodes(tree, node => node.type === 'form')[0].props.onSubmit;
    await Promise.all([submit({ preventDefault() {} }), submit({ preventDefault() {} })]);
    assert.equal(h.calls.update, 1);
    assert.equal(h.calls.signOut, 1);
    assertDisabled(h, h.render());
    assert.equal(h.storage.size, 0);
    await h.submit(h.render());
    assert.equal(h.calls.update, 1);
  });
  await check('storage unavailable preserves current-page recovery and fails closed after reload', async () => {
    const h = harness({ session: validSession, storageDenied: true, recoveryBeforeMount: true });
    h.render();
    assertEnabled(h, await h.settle());
    const reloaded = harness({ session: validSession, storageDenied: true });
    reloaded.render();
    assertDisabled(reloaded, await reloaded.settle());
  });
  await check('sign-out during claims validation invalidates an in-flight recovery check', async () => {
    let release;
    const claimsGate = new Promise(resolve => { release = resolve; });
    const h = harness({ session: validSession, recoveryBeforeMount: true, claimsGate });
    h.render();
    h.emit('SIGNED_OUT', null);
    release();
    assertDisabled(h, await h.settle());
  });
  for (const [name, values, error] of [
    ['mismatched passwords', ['test-only-password', 'different'], /не совпадают/],
    ['short password', ['short', 'short'], /не менее 6/],
  ]) await check(name + ' leaves password unchanged', async () => {
    const h = harness({ session: validSession, recoveryBeforeMount: true });
    h.render();
    await h.submit(await h.settle(), values);
    assert.equal(h.calls.update, 0);
    assert.equal(h.calls.signOut, 0);
    assert.match(h.text(h.render()), error);
  });
  await check('update failure retains an actionable error and does not sign out or redirect', async () => {
    const h = harness({ session: validSession, recoveryBeforeMount: true, updateError: new Error('test-only update refused') });
    h.render();
    await h.submit(await h.settle());
    assert.equal(h.calls.update, 1);
    assert.equal(h.calls.signOut, 0);
    assert.deepEqual(h.calls.paths, []);
    assert.match(h.text(h.render()), /update refused/);
  });
  console.log(`Reset password session regression: ${passed}/${passed} PASS`);
})().catch(error => { console.error(error); process.exitCode = 1; });
