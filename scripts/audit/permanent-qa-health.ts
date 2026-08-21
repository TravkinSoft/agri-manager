const QA_PROJECT_REF = "gsglkmudcwkdetqtocae";
const PRODUCTION_PROJECT_REF = "bhsemlvmkikpntabctml";
const QA_URL = "https://qa.travkinflow.com";
const QA_COMPANY = "Астык-STEM QA";
const accessToken = process.env.SUPABASE_ACCESS_TOKEN;
const requestedProject = process.env.QA_HEALTH_PROJECT_REF || QA_PROJECT_REF;

if (requestedProject === PRODUCTION_PROJECT_REF) {
  throw new Error("Permanent QA health check refuses the Production project");
}
if (requestedProject !== QA_PROJECT_REF) {
  throw new Error(`Unexpected QA project: ${requestedProject}`);
}
if (!accessToken) {
  throw new Error("SUPABASE_ACCESS_TOKEN is required and is never printed");
}

const query = `
select jsonb_build_object(
  'company_id', c.id,
  'company_name', c.name,
  'active_profiles', (
    select count(*) from public.profiles p
    where p.company_id = c.id and coalesce(p.is_active, true)
  ),
  'active_people', (
    select count(*) from public.company_people cp
    where cp.company_id = c.id and coalesce(cp.is_active, true)
  )
) as health
from public.companies c
where c.name = '${QA_COMPANY.replaceAll("'", "''")}'
limit 1`;

async function main() {
  const [webResponse, databaseResponse] = await Promise.all([
    fetch(`${QA_URL}/auth/login`, { redirect: "manual", cache: "no-store" }),
    fetch(`https://api.supabase.com/v1/projects/${requestedProject}/database/query`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query }),
    }),
  ]);

  if (webResponse.status !== 200) {
    throw new Error(`Permanent QA login returned HTTP ${webResponse.status}`);
  }
  if (!databaseResponse.ok) {
    throw new Error(`QA Supabase health query returned HTTP ${databaseResponse.status}`);
  }

  const rows = await databaseResponse.json() as Array<{
    health?: {
      company_id?: string;
      company_name?: string;
      active_profiles?: number;
      active_people?: number;
    };
  }>;
  const health = rows[0]?.health;
  if (!health || health.company_name !== QA_COMPANY || !health.company_id) {
    throw new Error("Canonical permanent QA company was not found");
  }
  if (Number(health.active_profiles || 0) < 1) {
    throw new Error("Canonical permanent QA company has no active profiles");
  }

  console.log(JSON.stringify({
    status: "PASS",
    permanentQaUrl: QA_URL,
    projectRef: requestedProject,
    company: health.company_name,
    companyId: health.company_id,
    activeProfiles: Number(health.active_profiles || 0),
    activePeople: Number(health.active_people || 0),
    http: webResponse.status,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
