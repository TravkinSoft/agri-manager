import { createClient } from "@supabase/supabase-js";

const KEEP_EMAIL = "aimbeks@gmail.com";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

async function listAllAuthUsers() {
  const all = [];
  let page = 1;
  const perPage = 200;

  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) throw error;

    const users = data?.users || [];
    all.push(...users);
    if (users.length < perPage) break;
    page += 1;
  }

  return all;
}

async function updateIfColumnExists(updateFn, label) {
  try {
    await updateFn();
  } catch (error) {
    console.warn(`[skip] ${label}: ${error?.message || error}`);
  }
}

async function main() {
  const keepEmail = normalizeEmail(KEEP_EMAIL);
  console.log(`[start] Keep only: ${keepEmail}`);

  const authUsers = await listAllAuthUsers();
  const keepAuthUser = authUsers.find(
    (u) => normalizeEmail(u?.email) === keepEmail
  );

  if (!keepAuthUser) {
    throw new Error(`Keep user not found in auth.users: ${keepEmail}`);
  }

  const usersToDelete = authUsers.filter(
    (u) => normalizeEmail(u?.email) !== keepEmail
  );
  const idsToDelete = usersToDelete.map((u) => u.id);

  console.log(`[info] auth.users total: ${authUsers.length}`);
  console.log(`[info] auth.users to delete: ${idsToDelete.length}`);

  // 1) Nullify operation assignees that reference profiles to be deleted
  if (idsToDelete.length > 0) {
    await updateIfColumnExists(async () => {
      const { error } = await supabase
        .from("operations")
        .update({ responsible_user_id: null })
        .in("responsible_user_id", idsToDelete);
      if (error) throw error;
    }, "operations.responsible_user_id -> NULL");

    await updateIfColumnExists(async () => {
      const { error } = await supabase
        .from("operations")
        .update({ assigned_to: null })
        .in("assigned_to", idsToDelete);
      if (error) throw error;
    }, "operations.assigned_to -> NULL");

    // 2) Delete chats for deleted users (messages cascade by chat_id FK)
    await updateIfColumnExists(async () => {
      const { error } = await supabase
        .from("chats")
        .delete()
        .in("user_id", idsToDelete);
      if (error) throw error;
    }, "delete chats by user_id");

    // 3) Delete profiles except keep user profile
    const { error: profileDeleteError } = await supabase
      .from("profiles")
      .delete()
      .neq("email", keepEmail);
    if (profileDeleteError) throw profileDeleteError;
  }

  // 4) Delete auth users except keep user (Admin API)
  for (const user of usersToDelete) {
    const { error } = await supabase.auth.admin.deleteUser(user.id);
    if (error) throw new Error(`Failed deleting auth user ${user.id}: ${error.message}`);
  }

  // 5) Remove orphan profiles (profiles without matching auth.users)
  const refreshedAuthUsers = await listAllAuthUsers();
  const authIdSet = new Set(refreshedAuthUsers.map((u) => u.id));
  const { data: remainingProfiles, error: remainingProfilesError } = await supabase
    .from("profiles")
    .select("id, email");
  if (remainingProfilesError) throw remainingProfilesError;

  const orphanProfileIds = (remainingProfiles || [])
    .filter((p) => !authIdSet.has(p.id))
    .map((p) => p.id);

  if (orphanProfileIds.length > 0) {
    const { error } = await supabase
      .from("profiles")
      .delete()
      .in("id", orphanProfileIds);
    if (error) throw error;
  }

  // 6) Ensure keep profile role/status
  const { error: keepUpdateError } = await supabase
    .from("profiles")
    .update({ role: "admin", status: "active" })
    .eq("id", keepAuthUser.id);
  if (keepUpdateError) throw keepUpdateError;

  // 7) Final verification
  const finalAuthUsers = await listAllAuthUsers();
  const finalKeepCount = finalAuthUsers.filter(
    (u) => normalizeEmail(u.email) === keepEmail
  ).length;

  const { data: finalProfiles, error: finalProfilesError } = await supabase
    .from("profiles")
    .select("id, email, role, status");
  if (finalProfilesError) throw finalProfilesError;

  console.log(`[done] auth.users count: ${finalAuthUsers.length}`);
  console.log(`[done] keep user count by email: ${finalKeepCount}`);
  console.log(`[done] profiles count: ${finalProfiles?.length || 0}`);
  console.log("[done] remaining profiles:", finalProfiles);

  if (finalAuthUsers.length !== 1 || finalKeepCount !== 1) {
    throw new Error("Verification failed: auth.users is not reduced to exactly one keep user.");
  }
}

main().catch((error) => {
  console.error("[fatal]", error?.message || error);
  process.exit(1);
});
