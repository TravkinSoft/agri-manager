(() => {
  const userId = "11111111-1111-4111-8111-111111111111";
  const companyId = "22222222-2222-4222-8222-222222222222";
  const email = "browser.qa@example.invalid";
  const encode = (value) => btoa(JSON.stringify(value))
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
  const expiresAt = Math.floor(Date.now() / 1000) + 86400;
  const accessToken = `${encode({ alg: "none", typ: "JWT" })}.${encode({
    sub: userId,
    aud: "authenticated",
    role: "authenticated",
    email,
    exp: expiresAt,
  })}.x`;
  const user = {
    id: userId,
    aud: "authenticated",
    role: "authenticated",
    email,
    email_confirmed_at: "2026-09-09T00:00:00.000Z",
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: {},
    identities: [],
    created_at: "2026-09-09T00:00:00.000Z",
    updated_at: "2026-09-09T00:00:00.000Z",
  };
  localStorage.setItem("sb-localhost-auth-token", JSON.stringify({
    access_token: accessToken,
    token_type: "bearer",
    expires_in: 86400,
    expires_at: expiresAt,
    refresh_token: "local-browser-refresh",
    user,
  }));
  localStorage.setItem("travkin.auth.ui.v1", JSON.stringify({
    savedAt: Date.now(),
    user: { id: userId, email },
    profile: {
      id: userId,
      full_name: "Browser QA Admin",
      email,
      role: "global_admin",
      company_id: companyId,
      home_company_id: companyId,
      context_company_id: companyId,
      is_owner: true,
      status: "active",
      is_impersonating: false,
      created_at: "2026-09-09T00:00:00.000Z",
      updated_at: "2026-09-09T00:00:00.000Z",
    },
  }));
  return {
    auth: Boolean(localStorage.getItem("sb-localhost-auth-token")),
    profile: Boolean(localStorage.getItem("travkin.auth.ui.v1")),
  };
})()
