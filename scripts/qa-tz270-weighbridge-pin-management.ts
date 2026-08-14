import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

const migration = read("supabase/migrations/20260814173238_tz270_weighbridge_operator_pin_admin_v1.sql");
const accessRoute = read("app/api/references/company-people/[id]/weighbridge-access/route.ts");
const operatorRoute = read("app/api/weighbridge/operator-session/route.ts");
const referencesPage = read("app/(dashboard)/references/page.tsx");
const weighbridgePage = read("app/(dashboard)/weighbridge/page.tsx");
const accessService = read("lib/services/weighbridge-operator-access.ts");

let passed = 0;
function check(name: string, test: () => void) {
  test();
  passed += 1;
  process.stdout.write(`PASS ${passed}: ${name}\n`);
}

check("existing private credential model is reused", () => {
  assert.match(migration, /private\.weighbridge_operator_credentials/);
  assert.doesNotMatch(migration, /create\s+table/i);
});

check("PIN management is limited to global and company administrators", () => {
  const manager = migration.match(/create or replace function public\.set_weighbridge_operator_pin_v1[\s\S]*?\$function\$;/)?.[0] || "";
  assert.match(manager, /v_actor\.role not in \('global_admin', 'company_admin'\)/);
  assert.doesNotMatch(manager, /'director'/);
  assert.match(accessRoute, /const ADMIN_ROLES = \["global_admin", "company_admin"\]/);
});

check("PIN remains exactly six digits", () => {
  assert.match(migration, /p_pin !~ '\^\[0-9\]\{6\}\$'/);
  assert.match(accessRoute, /!\/\^\\d\{6\}\$\//);
});

check("PIN is hashed by the existing bcrypt mechanism", () => {
  assert.match(migration, /extensions\.crypt\(p_pin, extensions\.gen_salt\('bf', 12\)\)/);
  assert.doesNotMatch(accessRoute, /pin_hash/);
  assert.doesNotMatch(accessService, /pin_hash/);
});

check("setting or changing PIN revokes active operator sessions", () => {
  assert.match(migration, /update private\.weighbridge_operator_sessions[\s\S]*person_id = p_person_id[\s\S]*status = 'active'/);
});

check("disabling access keeps history and only disables credentials", () => {
  assert.match(migration, /if p_active then[\s\S]*else[\s\S]*set is_active = false/);
  assert.doesNotMatch(migration, /delete\s+from\s+(public\.)?(tickets|ticket_weighings|weighbridge_shifts)/i);
});

check("archiving or changing operator role revokes access", () => {
  assert.match(migration, /company_people_revoke_weighbridge_access_v1/);
  assert.match(migration, /new\.role_type <> 'weighbridge_operator'[\s\S]*new\.status <> 'active'[\s\S]*new\.deleted_at is not null/);
});

check("revoked sessions cannot remain unlocked", () => {
  assert.match(migration, /not exists \([\s\S]*cred\.is_active[\s\S]*set status = 'revoked'/);
});

check("only configured and enabled operators are selectable", () => {
  assert.match(migration, /join private\.weighbridge_operator_credentials cred[\s\S]*and cred\.is_active/);
  assert.match(weighbridgePage, /eligibleOperators[\s\S]*operator\.has_pin !== false[\s\S]*operator\.pin_active !== false/);
});

check("unconfigured operator gets an actionable message and no PIN field", () => {
  assert.match(weighbridgePage, /PIN не настроен\. Обратитесь к администратору компании\./);
  assert.match(weighbridgePage, /eligibleOperators\.length \? \([\s\S]*<Label>PIN<\/Label>/);
});

check("PIN setup was removed from the weighbridge session endpoint", () => {
  assert.doesNotMatch(operatorRoute, /action === "set_pin"/);
  assert.doesNotMatch(weighbridgePage, /Настроить PIN|setWeighbridgeOperatorPin/);
});

check("employee card shows access and PIN status", () => {
  assert.match(referencesPage, /Доступ к Весовой/);
  assert.match(referencesPage, /workerAccess\.access_enabled \? "Включён" : "Отключён"/);
  assert.match(referencesPage, /workerAccess\.pin_configured \? "Установлен" : "Не установлен"/);
});

check("employee card requires PIN confirmation", () => {
  assert.match(referencesPage, /workerPin !== workerPinConfirm/);
  assert.match(referencesPage, /Новый PIN/);
  assert.match(referencesPage, /Повторите PIN/);
});

check("employee card exposes set, change, and disable actions", () => {
  assert.match(referencesPage, /workerAccess\.pin_configured \? "Сменить PIN" : "Установить PIN"/);
  assert.match(referencesPage, /Отключить доступ к Весовой/);
});

check("PIN is not printed to logs, console, or status responses", () => {
  for (const source of [migration, accessRoute, operatorRoute, referencesPage, accessService]) {
    assert.doesNotMatch(source, /console\.(log|info|debug|warn)\([^\n]*pin/i);
  }
  const statusFunction = migration.match(/create or replace function public\.weighbridge_operator_access_state_v1[\s\S]*?\$function\$;/)?.[0] || "";
  assert.doesNotMatch(statusFunction, /pin_hash/);
});

process.stdout.write(`TZ270 checks: ${passed}/${passed} PASS\n`);
