import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { sendTrafficInvitation, assertTrafficActivationReady, TrafficInvitationError } from "../lib/auth/ptc-invitations";

const company = "company-a", otherCompany = "company-b", userId = "auth-1", personId = "person-1";
const role = process.env.QA_INVITE_ROLE === "fleet_manager" ? "fleet_manager" as const : "mechanic_operator" as const;
const copy = <T>(value: T): T => structuredClone(value);
let checks = 0;
const ok = (value: unknown) => { assert.ok(value); checks++; };
const equal = (a: unknown, b: unknown) => { assert.deepEqual(a, b); checks++; };
const rejects = async (fn: () => Promise<unknown>) => { await assert.rejects(fn); checks++; };

// Fault-injected Auth + DB boundary. No network, real accounts, email, or hosted writes.
class Fixture {
  users: any[] = [];
  profiles: any[] = [];
  people: any[] = [{ id: personId, company_id: company, full_name: "Existing Mechanic", status: "active", deleted_at: null, user_id: null }];
  trace: string[] = [];
  fail = "";
  created = 0;
  sent = 0;
  clock = 0;
  actionHook: ((action: string, fixture: Fixture) => void) | null = null;
  fault(action: string) {
    this.actionHook?.(action, this);
    if (this.fail === action) { this.fail = ""; return { message: "injected failure" }; }
    return null;
  }
  constructor() {
    this.db = {
      auth: {
        admin: {
          listUsers: async () => ({ data: { users: copy(this.users) }, error: this.fault("list") }),
          getUserById: async (id: string) => ({ data: { user: copy(this.users.find(user => user.id === id)) }, error: this.fault("get-user") }),
          createUser: async (attributes: any) => {
            this.trace.push("create");
            const error = this.fault("create-before");
            if (error || this.users.length) return { data: { user: null }, error: error ?? { message: "duplicate email" } };
            equal(attributes.email_confirm, false);
            ok(attributes.ban_duration && !attributes.password);
            const user = { id: userId, email: attributes.email, app_metadata: attributes.app_metadata, user_metadata: attributes.user_metadata,
              email_confirmed_at: null, banned_until: "2126-01-01T00:00:00Z" };
            this.users.push(user); this.created++;
            this.profiles.push({ id: userId, company_id: company, role: "specialist", status: "pending" });
            return { data: { user: copy(user) }, error: this.fault("create-after") };
          },
          updateUserById: async (id: string, attributes: any) => {
            this.trace.push("ready");
            equal(attributes.ban_duration, "none"); // Never re-ban a concurrently completed account.
            const error = this.fault("ready-before");
            if (error) return { error, data: { user: null } };
            const user = this.users.find(item => item.id === id);
            user.app_metadata = { ...user.app_metadata, ...attributes.app_metadata };
            user.banned_until = null;
            return { data: { user: copy(user) }, error: this.fault("ready-after") };
          },
          inviteUserByEmail: async () => {
            this.trace.push("email");
            const error = this.fault("email");
            if (!error) this.sent++;
            return { data: { user: this.users[0] }, error };
          },
        },
        resetPasswordForEmail: async () => {
          this.trace.push("recovery");
          const error = this.fault("email");
          if (!error) this.sent++;
          return { error };
        },
      },
      from: (table: string) => {
        const filters: ((item: any) => boolean)[] = [];
        let patch: any, limit = Infinity;
        const execute = () => {
          const error = this.fault(table === "profiles" && patch ? "repair" : `read-${table}`);
          if (error) return { data: null, error };
          const rows = (table === "profiles" ? this.profiles : this.people).filter(item => filters.every(filter => filter(item))).slice(0, limit);
          if (patch) { this.trace.push("repair"); rows.forEach(row => Object.assign(row, patch)); }
          return { data: copy(rows), error: null };
        };
        const query: any = {
          select: () => query,
          eq: (key: string, value: any) => { filters.push(item => item[key] === value); return query; },
          is: (key: string, value: any) => { filters.push(item => item[key] === value); return query; },
          limit: (value: number) => { limit = value; return query; },
          update: (value: any) => { patch = value; return query; },
          maybeSingle: async () => { const result = execute(); return { ...result, data: result.data?.[0] ?? null }; },
          then: (resolve: any, reject: any) => Promise.resolve(execute()).then(resolve, reject),
        };
        return query;
      },
      rpc: async (_name: string, args: any) => {
        this.trace.push("bind");
        equal(args.p_fresh_auth, false); // Never let a retry demote an activated account to pending.
        const error = this.fault("bind-before");
        if (error) return { error };
        const profile = this.profiles.find(row => row.id === args.p_user);
        if (!profile || profile.status !== "pending" || profile.role !== args.p_role || profile.company_id !== args.p_company) return { error: { message: "PTC_EXISTING_ACCOUNT_CONFLICT" } };
        let person = this.people.find(row => row.id === args.p_person);
        if (!args.p_person && args.p_create_person) {
          if (this.people.some(row => row.full_name === args.p_name)) return { error: { message: "PTC_SELECT_EXISTING_PERSON" } };
          person = { id: `new-${++this.clock}`, company_id: args.p_company, full_name: args.p_name, status: "active", deleted_at: null, user_id: null };
          this.people.push(person);
        }
        if (!person || person.company_id !== args.p_company || person.status !== "active" || (person.user_id && person.user_id !== args.p_user)) return { error: { message: "PTC_PERSON_ALREADY_LINKED_OR_UNAVAILABLE" } };
        person.user_id = args.p_user;
        return { error: this.fault("bind-after") };
      },
    } as any;
  }
  db: any;
  invite(overrides = {}) {
    return sendTrafficInvitation({ db: this.db, actorId: "admin", companyId: company, role, email: "ptc@example.test",
      fullName: "Existing Mechanic", personId, createPerson: false, redirectTo: "https://example.test/auth/set-password", ...overrides });
  }
  activate() { return assertTrafficActivationReady(this.db, copy(this.users[0]), copy(this.profiles[0])); }
  seed(marker: any = { state: "ready", company_id: company, role }) {
    this.users = [{ id: userId, email: "ptc@example.test", app_metadata: marker ? { ptc_invitation_v1: marker } : {},
      user_metadata: { role }, email_confirmed_at: null, banned_until: null }];
    this.profiles = [{ id: userId, company_id: company, role, status: "pending" }];
    this.people[0].user_id = userId;
  }
}

async function main() {
  const happy = new Fixture();
  equal(await happy.invite(), "recovery");
  equal(happy.trace, ["create", "repair", "bind", "ready", "recovery"]);
  await happy.activate(); checks++;
  await happy.invite(); equal(happy.created, 1); equal(happy.people.length, 1);

  for (const fail of ["create-before", "repair", "bind-before", "bind-after", "ready-before", "ready-after", "email"]) {
    const f = new Fixture(); f.fail = fail;
    await rejects(() => f.invite()); equal(f.sent, 0);
    if (f.users.length && f.users[0].app_metadata.ptc_invitation_v1.state !== "ready") await rejects(() => f.activate());
    await f.invite(); equal(f.created, 1); equal(f.people.length, 1); equal(f.sent, 1); await f.activate(); checks++;
  }

  const uncertainCreate = new Fixture(); uncertainCreate.fail = "create-after";
  await uncertainCreate.invite(); equal(uncertainCreate.created, 1); equal(uncertainCreate.sent, 1);

  const duplicate = new Fixture();
  await rejects(() => duplicate.invite({ personId: null, createPerson: true }));
  equal(duplicate.sent, 0); equal(duplicate.people.length, 1); await rejects(() => duplicate.activate());
  await duplicate.invite(); equal(duplicate.created, 1); equal(duplicate.sent, 1);

  const newPerson = new Fixture(); newPerson.fail = "email";
  const newInput = { personId: null, createPerson: true, fullName: "New Receiver", role: "vegetable_brigadier" };
  await rejects(() => newPerson.invite(newInput)); equal(newPerson.people.length, 2);
  await newPerson.invite(newInput); equal(newPerson.people.length, 2); equal(newPerson.created, 1);

  const foreignPerson = new Fixture(); foreignPerson.people[0].user_id = "different-user";
  await rejects(() => foreignPerson.invite()); equal(foreignPerson.sent, 0); equal(foreignPerson.people[0].user_id, "different-user");

  for (const scenario of ["foreign-company", "wrong-role", "active", "revoked", "foreign-marker", "missing-profile", "foreign-link", "ambiguous-link"]) {
    const f = new Fixture(); f.seed();
    if (scenario === "foreign-company") f.profiles[0].company_id = otherCompany;
    if (scenario === "wrong-role") f.profiles[0].role = "company_admin";
    if (scenario === "active" || scenario === "revoked") f.profiles[0].status = scenario;
    if (scenario === "foreign-marker") f.users[0].app_metadata.ptc_invitation_v1.company_id = otherCompany;
    if (scenario === "missing-profile") f.profiles = [];
    if (scenario === "foreign-link") f.people[0].company_id = otherCompany;
    if (scenario === "ambiguous-link") f.people.push({ ...f.people[0], id: "person-2" });
    const before = copy({ users: f.users, profiles: f.profiles, people: f.people });
    await rejects(() => f.invite()); equal(f.sent, 0);
    equal({ users: f.users, profiles: f.profiles, people: f.people }, before);
  }

  for (const scenario of ["provisioning", "malformed", "wrong-marker-company", "wrong-marker-role", "banned", "fallback-specialist", "missing-person", "inactive-person", "foreign-person", "ambiguous-person"]) {
    const f = new Fixture(); f.seed();
    if (scenario === "provisioning") f.users[0].app_metadata.ptc_invitation_v1.state = "provisioning";
    if (scenario === "malformed") f.users[0].app_metadata.ptc_invitation_v1 = "ready";
    if (scenario === "wrong-marker-company") f.users[0].app_metadata.ptc_invitation_v1.company_id = otherCompany;
    if (scenario === "wrong-marker-role") f.users[0].app_metadata.ptc_invitation_v1.role = "vegetable_brigadier";
    if (scenario === "banned") f.users[0].banned_until = "2126-01-01T00:00:00Z";
    if (scenario === "fallback-specialist") { f.profiles[0].role = "specialist"; f.users[0].app_metadata = {}; }
    if (scenario === "missing-person") f.people = [];
    if (scenario === "inactive-person") f.people[0].status = "inactive";
    if (scenario === "foreign-person") f.people[0].company_id = otherCompany;
    if (scenario === "ambiguous-person") f.people.push({ ...f.people[0], id: "second" });
    await rejects(() => f.activate());
  }

  const legacy = new Fixture(); legacy.seed(null);
  await legacy.activate(); checks++;
  legacy.users[0].email_confirmed_at = "2026-09-01T00:00:00Z";
  equal(await legacy.invite(), "recovery"); equal(legacy.trace, ["recovery"]);
  const regular = new Fixture(); regular.seed(null); regular.profiles[0].role = "agronomist";
  regular.users[0].user_metadata.role = "agronomist"; regular.people = [];
  await regular.activate(); checks++;

  const concurrentActivation = new Fixture();
  concurrentActivation.actionHook = (action, f) => { if (action === "bind-before") f.profiles[0].status = "active"; };
  await rejects(() => concurrentActivation.invite()); equal(concurrentActivation.profiles[0].status, "active"); equal(concurrentActivation.sent, 0);

  const banned = new Fixture(); banned.seed(); banned.users[0].banned_until = "2126-01-01T00:00:00Z";
  await rejects(() => banned.invite()); equal(banned.sent, 0); equal(banned.trace, []);

  // Execute the real complete-signup route with dependency-injected network boundaries.
  // This verifies that failed readiness and a concurrent revoke cannot activate a profile.
  const completeSource = fs.readFileSync("app/api/auth/complete-signup/route.ts", "utf8");
  async function complete(f: Fixture) {
    const id = "40000000-0000-4000-8000-000000000001";
    f.users[0].id = id; f.users[0].email_confirmed_at = "2026-09-04T00:00:00Z";
    f.profiles[0].id = id; f.people.forEach(person => { if (person.user_id === userId) person.user_id = id; });
    const output = ts.transpileModule(completeSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const routeModule = { exports: {} as any };
    vm.runInNewContext(output, { module: routeModule, exports: routeModule.exports, process: { env: { NEXT_PUBLIC_SUPABASE_URL: "https://example.test", NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-only" } },
      require: (name: string) => {
        if (name === "next/server") return { NextResponse: { json: (body: unknown, init: any = {}) => new Response(JSON.stringify(body), init) } };
        if (name === "@supabase/supabase-js") return { createClient: () => ({ auth: { getUser: async () => ({ data: { user: copy(f.users[0]) }, error: null }) } }) };
        if (name === "@/lib/supabase/service") return { getServiceClient: () => f.db };
        if (name === "@/lib/auth/ptc-invitations") return { assertTrafficActivationReady, TrafficInvitationError };
        throw new Error(`Unexpected route dependency ${name}`);
      },
    });
    return routeModule.exports.POST(new Request("https://example.test/api/auth/complete-signup", { method: "POST", headers: { Authorization: "Bearer local-test" } })) as Promise<Response>;
  }
  const routeReady = new Fixture(); routeReady.seed();
  equal((await complete(routeReady)).status, 200); equal(routeReady.profiles[0].status, "active");
  const routeBlocked = new Fixture(); routeBlocked.seed({ state: "provisioning", company_id: company, role });
  equal((await complete(routeBlocked)).status, 403); equal(routeBlocked.profiles[0].status, "pending");
  const routeRevoked = new Fixture(); routeRevoked.seed();
  routeRevoked.actionHook = (action, f) => { if (action === "repair") f.profiles[0].status = "revoked"; };
  equal((await complete(routeRevoked)).status, 409); equal(routeRevoked.profiles[0].status, "revoked");
  const routeRoleChanged = new Fixture(); routeRoleChanged.seed();
  routeRoleChanged.actionHook = (action, f) => { if (action === "repair") f.profiles[0].role = "specialist"; };
  equal((await complete(routeRoleChanged)).status, 409); equal(routeRoleChanged.profiles[0].status, "pending");

  const activationSource = fs.readFileSync("app/api/auth/complete-signup/route.ts", "utf8");
  ok(activationSource.indexOf("assertTrafficActivationReady(supabase") < activationSource.indexOf('.update({ status: "active"'));
  ok(activationSource.includes('activation.eq("status", profile.status)') && activationSource.includes('activation.eq("role", profile.role)') && activationSource.includes('activation.eq("company_id", profile.company_id)'));
  const inviteSource = fs.readFileSync("app/api/invite-user/route.ts", "utf8");
  ok(inviteSource.indexOf("await sendTrafficInvitation(") < inviteSource.indexOf("await supabaseAdmin.auth.admin.inviteUserByEmail("));
  const helperSource = fs.readFileSync("lib/auth/ptc-invitations.ts", "utf8");
  ok(!helperSource.includes(".inviteUserByEmail(")); // Delivery cannot create a replacement Auth.
  console.log(`PTC invitation lifecycle PASS: ${checks} checks (fault-injected local tests; no emails or hosted writes)`);
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
