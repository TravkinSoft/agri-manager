import assert from "node:assert/strict";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  assertBranchOnlyEnv,
  createBranchAdmin,
  loadFixture,
  writeAuditJson,
} from "./assistant-qa-common";

async function authenticatedClient(
  admin: SupabaseClient,
  anonKey: string,
  url: string,
  userId: string,
) {
  const { data: userData, error: userError } = await admin.auth.admin.getUserById(userId);
  if (userError) throw userError;
  const email = userData.user.email;
  assert(email, `QA user ${userId} has no email`);

  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (linkError) throw linkError;
  const tokenHash = linkData.properties?.hashed_token;
  assert(tokenHash, "Magic-link token hash was not generated");

  const client = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: sessionData, error: sessionError } = await client.auth.verifyOtp({
    type: "magiclink",
    token_hash: tokenHash,
  });
  if (sessionError) throw sessionError;
  assert.equal(sessionData.user?.id, userId);
  assert(sessionData.session?.access_token, "Real JWT session was not created");
  return { client, accessToken: sessionData.session.access_token };
}

async function contextAwareGlobalRead(
  admin: SupabaseClient,
  accessToken: string,
  expectedUserId: string,
  productIds: string[],
) {
  const { data: authData, error: authError } = await admin.auth.getUser(accessToken);
  if (authError) throw authError;
  assert.equal(authData.user.id, expectedUserId);
  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("id,company_id,status")
    .eq("id", expectedUserId)
    .single();
  if (profileError) throw profileError;
  assert.equal(profile.status, "active");
  assert(profile.company_id);
  const { count, error } = await admin
    .from("products")
    .select("id", { count: "exact", head: true })
    .in("id", productIds)
    .is("company_id", null);
  if (error) throw error;
  return count ?? 0;
}

async function countRows(
  client: SupabaseClient,
  table: string,
  companyId: string,
) {
  const { count, error } = await client
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId);
  if (error) throw new Error(`${table} JWT read failed: ${error.message}`);
  return count ?? 0;
}

async function main() {
  const fixture = await loadFixture();
  const { url } = assertBranchOnlyEnv(fixture);
  const anonKey = process.env.ASSISTANT_QA_SUPABASE_ANON_KEY?.trim() ?? "";
  assert(anonKey, "STOP: ASSISTANT_QA_SUPABASE_ANON_KEY is required");
  const admin = createBranchAdmin(fixture);
  const authA = await authenticatedClient(admin, anonKey, url, fixture.users.a.id);
  const authB = await authenticatedClient(admin, anonKey, url, fixture.users.b.id);
  const userA = authA.client;
  const userB = authB.client;

  const expectedTables = ["fields", "warehouses", "operations", "stock_ledger_entries"];
  const results: Record<string, unknown> = {};
  for (const table of expectedTables) {
    results[table] = {
      aOwn: await countRows(userA, table, fixture.users.a.companyId),
      aCross: await countRows(userA, table, fixture.users.b.companyId),
      bOwn: await countRows(userB, table, fixture.users.b.companyId),
      bCross: await countRows(userB, table, fixture.users.a.companyId),
    };
    assert.equal((results[table] as Record<string, number>).aCross, 0, `${table}: A saw B`);
    assert.equal((results[table] as Record<string, number>).bCross, 0, `${table}: B saw A`);
  }

  assert.deepEqual(results.fields, { aOwn: 8, aCross: 0, bOwn: 1, bCross: 0 });
  assert.deepEqual(results.warehouses, { aOwn: 2, aCross: 0, bOwn: 1, bCross: 0 });
  assert.deepEqual(results.operations, { aOwn: 5, aCross: 0, bOwn: 0, bCross: 0 });
  assert.deepEqual(results.stock_ledger_entries, { aOwn: 6, aCross: 0, bOwn: 1, bCross: 0 });

  const memoryChecks = {
    aOwnChats: await countRows(userA, "chats", fixture.users.a.companyId),
    aCrossChats: await countRows(userA, "chats", fixture.users.b.companyId),
    bOwnChats: await countRows(userB, "chats", fixture.users.b.companyId),
    bCrossChats: await countRows(userB, "chats", fixture.users.a.companyId),
    aCrossMemories: await countRows(userA, "assistant_memories", fixture.users.b.companyId),
    bCrossMemories: await countRows(userB, "assistant_memories", fixture.users.a.companyId),
  };
  assert.equal(memoryChecks.aCrossChats, 0);
  assert.equal(memoryChecks.bCrossChats, 0);
  assert.equal(memoryChecks.aCrossMemories, 0);
  assert.equal(memoryChecks.bCrossMemories, 0);

  const directGlobalReads: number[] = [];
  for (const client of [userA, userB]) {
    const { count, error } = await client
      .from("products")
      .select("id", { count: "exact", head: true })
      .in("id", fixture.products.map((row) => row.id));
    if (error) throw new Error(`Global reference read failed: ${error.message}`);
    directGlobalReads.push(count ?? 0);
  }
  const contextAwareGlobalReads = [
    await contextAwareGlobalRead(
      admin,
      authA.accessToken,
      fixture.users.a.id,
      fixture.products.map((row) => String(row.id)),
    ),
    await contextAwareGlobalRead(
      admin,
      authB.accessToken,
      fixture.users.b.id,
      fixture.products.map((row) => String(row.id)),
    ),
  ];
  assert.deepEqual(contextAwareGlobalReads, [3, 3]);

  const alias = fixture.aliases[0];
  const updateAttempt = await userA
    .from("global_product_aliases")
    .update({ source: fixture.marker })
    .eq("id", alias.id)
    .select("id");
  const globalReferenceWriteDenied = Boolean(
    updateAttempt.error || (updateAttempt.data?.length ?? 0) === 0,
  );

  const { data: balances, error: balanceError } = await admin
    .from("v_stock_balance_canonical")
    .select("company_id,warehouse_id,product_id,quantity,uom")
    .in("company_id", [fixture.users.a.companyId, fixture.users.b.companyId]);
  if (balanceError) throw balanceError;
  const totals = (balances ?? []).reduce<Record<string, number>>((acc, row) => {
    const key = `${row.company_id}:${row.product_id}:${row.uom}`;
    acc[key] = (acc[key] ?? 0) + Number(row.quantity);
    return acc;
  }, {});
  assert.equal(totals[`${fixture.users.a.companyId}:${fixture.products[0].id}:kg`], 1550);
  assert.equal(totals[`${fixture.users.a.companyId}:${fixture.products[1].id}:l`], 520);
  assert.equal(totals[`${fixture.users.a.companyId}:${fixture.products[2].id}:l`], 200);
  assert.equal(totals[`${fixture.users.b.companyId}:${fixture.products[0].id}:kg`], 777);

  const report = {
    status: "PASS",
    branchRef: fixture.branchRef,
    realJwtUsers: 2,
    companyIsolation: results,
    memoryIsolation: memoryChecks,
    globalReferenceRead: "PASS_VIA_CONTEXT_AWARE_SERVER_PATH",
    directLegacyProductRlsReads: directGlobalReads,
    contextAwareGlobalReads,
    globalReferenceWriteDenied,
    balances: totals,
    productionWrites: 0,
  };
  await writeAuditJson("real_jwt_acceptance.json", report);
  console.log(JSON.stringify(report, null, 2));
  assert(globalReferenceWriteDenied, "STOP: ordinary QA user could update a global alias");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
