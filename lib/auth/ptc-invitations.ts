import type { SupabaseClient, User } from "@supabase/supabase-js";

const MARKER = "ptc_invitation_v1";
const PROVISIONING_BAN = "876000h";
const OPERATOR_ROLES = ["mechanic_operator", "vegetable_brigadier"] as const;
type OperatorRole = (typeof OPERATOR_ROLES)[number];
type Profile = { id: string; company_id: string | null; role: string | null; status: string | null };
type Person = { id: string; company_id: string; full_name: string; status: string; deleted_at: string | null };
type Marker = { state: "provisioning" | "ready"; company_id: string; role: OperatorRole };

export class TrafficInvitationError extends Error {
  constructor(message: string, public status = 409) { super(message); }
}

export function isTrafficOperatorRole(value: unknown): value is OperatorRole {
  return OPERATOR_ROLES.includes(value as OperatorRole);
}

function markerOf(user: User): Marker | null {
  const marker = user.app_metadata?.[MARKER];
  return marker && typeof marker === "object" ? marker as Marker : null;
}

function normalizedName(name: string) { return name.trim().replace(/\s+/g, " ").toLocaleLowerCase(); }
function isBanned(user: User) {
  // Auth admin responses include banned_until; this project's older auth-js User type omits it.
  const until = (user as User & { banned_until?: string | null }).banned_until;
  return !!until && Date.parse(until) > Date.now();
}

async function findUser(db: SupabaseClient, email: string): Promise<User | null> {
  for (let page = 1; ; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new TrafficInvitationError("Не удалось проверить существующий аккаунт. Повторите позже.", 503);
    const match = data.users.find(user => user.email?.toLowerCase() === email);
    if (match) return match;
    if (data.users.length < 200) return null;
  }
}

async function readProfile(db: SupabaseClient, id: string): Promise<Profile | null> {
  const { data, error } = await db.from("profiles").select("id,company_id,role,status").eq("id", id).maybeSingle();
  if (error) throw new TrafficInvitationError("Не удалось проверить профиль. Доступ не изменён.", 503);
  return data;
}

async function linkedPeople(db: SupabaseClient, userId: string): Promise<Person[]> {
  // Do not filter company/status here: a foreign/inactive link must cause rejection, not disappear.
  const { data, error } = await db.from("company_people")
    .select("id,company_id,full_name,status,deleted_at").eq("user_id", userId).is("deleted_at", null).limit(2);
  if (error) throw new TrafficInvitationError("Не удалось проверить связь с сотрудником.", 503);
  return data ?? [];
}

function requireAvailableLink(people: Person[], companyId: string): Person | null {
  if (people.length > 1 || people.some(person => person.company_id !== companyId || person.status !== "active")) {
    throw new TrafficInvitationError("Аккаунт уже связан с другим или недоступным сотрудником. Проверьте существующего пользователя.");
  }
  return people[0] ?? null;
}

type Invitation = {
  db: SupabaseClient; actorId: string; companyId: string; role: OperatorRole; email: string;
  fullName: string; personId: string | null; createPerson: boolean; redirectTo: string;
};

/** No email, password or usable session exists before the atomic personnel binding succeeds. */
export async function sendTrafficInvitation(input: Invitation): Promise<"invite" | "recovery"> {
  const { db, actorId, companyId, role, email, fullName, redirectTo } = input;
  let user = await findUser(db, email);
  if (!user) {
    const { data, error } = await db.auth.admin.createUser({
      email,
      email_confirm: false,
      ban_duration: PROVISIONING_BAN,
      // Server-controlled marker is created in the same Auth transaction as the temporary ban.
      app_metadata: { [MARKER]: { state: "provisioning", company_id: companyId, role } },
      user_metadata: { role, invited_by_company: companyId, full_name: fullName },
    });
    if (!error && data.user) user = data.user;
    else {
      // A concurrent request or a lost response can have created the same email. Resume only
      // after proving ownership of that preparation below; never create a second identity.
      user = await findUser(db, email);
      if (!user) throw new TrafficInvitationError("Не удалось подготовить аккаунт. Письмо не отправлено; повторите приглашение.", 503);
    }
  }

  const fresh = await db.auth.admin.getUserById(user.id);
  if (fresh.error || !fresh.data.user) throw new TrafficInvitationError("Не удалось проверить подготовку аккаунта. Письмо не отправлено.", 503);
  user = fresh.data.user;
  const marker = markerOf(user);
  const markerPresent = Object.prototype.hasOwnProperty.call(user.app_metadata ?? {}, MARKER);
  if (markerPresent && (!marker || marker.company_id !== companyId || marker.role !== role
    || !["provisioning", "ready"].includes(marker.state))) {
    throw new TrafficInvitationError("Этот email подготовлен для другого аккаунта. Его компанию или роль не изменяем.");
  }
  const profile = await readProfile(db, user.id);
  const ownedPreparation = marker?.state === "provisioning";
  // Only our banned preparation may repair handle_new_user's legacy specialist fallback.
  if (!profile || (profile && (profile.company_id !== companyId || profile.status !== "pending"
    || (profile.role !== role && !(ownedPreparation && profile.role === "specialist"))))) {
    throw new TrafficInvitationError("Этот email уже связан с аккаунтом. Не меняем его компанию, роль или действующий доступ через приглашение.");
  }

  const linked = requireAvailableLink(await linkedPeople(db, user.id), companyId);
  let personId = input.personId;
  if (linked) {
    if ((personId && personId !== linked.id) || (!personId && (!input.createPerson || normalizedName(linked.full_name) !== normalizedName(fullName)))) {
      throw new TrafficInvitationError("Этот аккаунт уже связан с другим сотрудником.");
    }
    personId = linked.id; // Safe retry after a previous successful bind (including create-person).
  }
  if (marker?.state === "ready" && !linked) {
    throw new TrafficInvitationError("Связь подготовленного аккаунта с сотрудником утрачена. Проверьте пользователя.");
  }
  if (!marker && !linked) {
    throw new TrafficInvitationError("Существующее приглашение не связано с сотрудником. Проверьте пользователя; чужой или незавершённый аккаунт автоматически не присоединяем.");
  }
  if (!ownedPreparation && isBanned(user)) {
    throw new TrafficInvitationError("Аккаунт заблокирован. Повторное приглашение не снимает установленное ограничение.");
  }

  if (ownedPreparation) {
    // The ban was applied atomically at Auth creation; NEVER re-ban a resumed account.
    // Another concurrent request may already have completed it. Repair only our known
    // legacy-trigger fallback with a compare-and-set, then require pending in the binding RPC.
    if (profile.role === "specialist") {
      const repair = await db.from("profiles").update({ role }).eq("id", user.id)
        .eq("company_id", companyId).eq("status", "pending").eq("role", "specialist").select("id").maybeSingle();
      if (repair.error) throw new TrafficInvitationError("Не удалось подготовить роль аккаунта. Письмо не отправлено.", 503);
    }
    const { error } = linked ? { error: null } : await db.rpc("ptc_bind_invited_profile_v1", {
      p_actor: actorId, p_user: user.id, p_company: companyId, p_role: role,
      p_name: fullName, p_email: email, p_person: personId,
      p_create_person: personId ? false : input.createPerson, p_fresh_auth: false,
    });
    if (error) {
      const messages: Record<string, string> = {
        PTC_SELECT_EXISTING_PERSON: "Такой сотрудник уже есть. Выберите его из списка — дубль не создаём.",
        PTC_PERSON_ALREADY_LINKED_OR_UNAVAILABLE: "Сотрудник уже связан с аккаунтом или недоступен. Обновите список.",
        PTC_USER_ALREADY_LINKED: "Этот аккаунт уже связан с другим сотрудником.",
        PTC_EXISTING_ACCOUNT_CONFLICT: "Не изменяем компанию или роль существующего аккаунта через приглашение.",
      };
      const reason = Object.entries(messages).find(([key]) => error.message.includes(key))?.[1];
      throw new TrafficInvitationError(`${reason || "Не удалось связать аккаунт с сотрудником."} Письмо этим запросом не отправлено. Незавершённый аккаунт не активируется; повторите приглашение после исправления.`);
    }
    // Read the committed result before lifting quarantine, including on resumed requests.
    const boundProfile = await readProfile(db, user.id);
    const boundPerson = requireAvailableLink(await linkedPeople(db, user.id), companyId);
    if (!boundProfile || boundProfile.company_id !== companyId || boundProfile.role !== role
      || boundProfile.status !== "pending" || !boundPerson) {
      throw new TrafficInvitationError("Привязка аккаунта не подтверждена. Он остаётся заблокированным; письмо не отправлено.");
    }
    const ready = await db.auth.admin.updateUserById(user.id, {
      ban_duration: "none",
      app_metadata: { [MARKER]: { state: "ready", company_id: companyId, role } },
    });
    if (ready.error) throw new TrafficInvitationError("Не удалось завершить подготовку аккаунта. Повторите приглашение; новый сотрудник не будет создан.", 503);
  }

  // Auth recoverVerify confirms an unconfirmed user's email when the recovery link is
  // redeemed. Unlike /invite, /recover NEVER creates a user if the email disappeared
  // concurrently; no unbound replacement identity can be created at the delivery step.
  // Official implementation: supabase/auth internal/api/recover.go + verify.go.
  const { error } = await db.auth.resetPasswordForEmail(email, { redirectTo });
  if (error) throw new TrafficInvitationError("Аккаунт подготовлен, но письмо не отправлено. Используйте «Переотправить» у этого пользователя или повторите приглашение.", 503);
  return "recovery";
}

/** Defense in depth for complete-signup; only server metadata and real DB links can permit activation. */
export async function assertTrafficActivationReady(db: SupabaseClient, user: User, profile: Profile): Promise<void> {
  const markerPresent = Object.prototype.hasOwnProperty.call(user.app_metadata ?? {}, MARKER);
  const trafficProfile = isTrafficOperatorRole(profile.role);
  // User metadata can only trigger an extra denial check; it never grants a role or company.
  if (!trafficProfile && !markerPresent && !isTrafficOperatorRole(user.user_metadata?.role)) return;
  const fresh = await db.auth.admin.getUserById(user.id);
  if (fresh.error || !fresh.data.user) throw new TrafficInvitationError("Не удалось проверить готовность приглашения.", 503);
  const current = fresh.data.user;
  const marker = markerOf(current);
  const currentMarkerPresent = Object.prototype.hasOwnProperty.call(current.app_metadata ?? {}, MARKER);
  if (!trafficProfile || !profile.company_id || isBanned(current)
    || (currentMarkerPresent && (!marker || marker.state !== "ready" || marker.company_id !== profile.company_id || marker.role !== profile.role))) {
    throw new TrafficInvitationError("Приглашение ещё не готово или не связано с сотрудником. Обратитесь к администратору.", 403);
  }
  const person = requireAvailableLink(await linkedPeople(db, user.id), profile.company_id);
  if (!person) throw new TrafficInvitationError("Аккаунт не связан с действующим сотрудником компании.", 403);
}
