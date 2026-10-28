const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const read = (path) => readFileSync(path, 'utf8');

test('request page is static and cannot delete or send data', () => {
  const page = read('app/account-deletion/page.tsx');
  assert.match(page, /travkin\.group@gmail\.com/);
  assert.match(page, /mailto:/);
  assert.match(page, /encodeURIComponent\(requestSubject\)/);
  assert.match(page, /encodeURIComponent\(requestBody\)/);
  assert.match(page, /не отправляет письмо/);
  assert.match(page, /Не присылайте пароль/);
  assert.match(page, /сроки хранения/);
  assert.doesNotMatch(page, /supabase|fetch\(|use server|<form|onClick|onSubmit/);
});

test('only the dedicated informational route becomes public', () => {
  const source = read('components/auth/public-aware-providers.tsx');
  assert.match(source, /new Set\(\["\/", "\/demo", "\/privacy", "\/account-deletion"\]\)/);
  assert.match(source, /<ProtectedApp>\{children\}<\/ProtectedApp>/);
});

test('request instructions are linked from privacy and profile menu', () => {
  assert.match(read('app/privacy/page.tsx'), /href="\/account-deletion"/);
  assert.match(read('components/layout/header.tsx'), /router\.push\("\/account-deletion"\)/);
});
