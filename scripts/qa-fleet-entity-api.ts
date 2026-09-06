import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { z } from "zod";
import * as matching from "../lib/fleet/entity-creation";

const company = "00000000-0000-4000-8000-000000000001";
const foreign = "00000000-0000-4000-8000-000000000002";
const actorId = "00000000-0000-4000-8000-000000000003";
let checks = 0;
const equal = (actual: unknown, expected: unknown, message?: string) => {
  assert.deepEqual(actual, expected, message);
  checks++;
};

class SessionAuthError extends Error {
  constructor(message: string, public status = 403) { super(message); }
}

async function main() {
  let role = "fleet_manager";
  let queries = 0;
  let rpcCalls = 0;
  const vehicles = [{
    id: "00000000-0000-4000-8000-000000000010",
    company_id: company,
    name: "ZIL MMZ 554",
    full_name: "ZIL MMZ 554",
    plate_number: "T-309 BK",
    license_plate: "T-309 BK",
    archived: false,
  }];
  const people = [{
    id: "00000000-0000-4000-8000-000000000011",
    company_id: company,
    full_name: "Цалко Андрей",
    role_type: "worker",
    deleted_at: null,
  }];
  const specialists: unknown[] = [];

  const db = {
    from(table: string) {
      queries++;
      let rows: any[] = table === "reference_vehicles" ? [...vehicles]
        : table === "company_people" ? [...people] : [...specialists];
      let start = 0;
      let end = Number.POSITIVE_INFINITY;
      const query: any = {
        select: () => query,
        order: () => query,
        eq: (key: string, value: unknown) => { rows = rows.filter(row => row[key] === value); return query; },
        is: (key: string, value: unknown) => { rows = rows.filter(row => row[key] === value); return query; },
        range: (from: number, to: number) => { start = from; end = to; return query; },
        then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
          Promise.resolve({ data: rows.slice(start, end + 1), error: null }).then(resolve, reject),
      };
      return query;
    },
    async rpc(_name: string, args: Record<string, unknown>) {
      rpcCalls++;
      return {
        error: null,
        data: {
          status: "created",
          kind: args.p_kind,
          entity: {
            id: "00000000-0000-4000-8000-000000000012",
            name: args.p_name,
            ...(args.p_kind === "vehicle" ? { plate: args.p_plate } : {}),
          },
        },
      };
    },
  };

  const source = ts.transpileModule(fs.readFileSync("lib/fleet/entity-creation-server.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} as any };
  vm.runInNewContext(source, {
    module,
    exports: module.exports,
    require: (name: string) => {
      if (name === "next/server") return { NextResponse: { json: (body: unknown, init: ResponseInit) =>
        new Response(JSON.stringify(body), init) } };
      if (name === "zod") return { z };
      if (name === "@/lib/auth/server-acl") return { assertActorAccess: async (options: any) => {
        equal(options.actorUserId, actorId);
        return { status: "active", role, company_id: company };
      } };
      if (name === "@/lib/auth/server-session") return {
        SessionAuthError,
        getServerActorFromSession: async (_request: unknown, options: unknown) => {
          equal(JSON.parse(JSON.stringify(options)), { ignoreImpersonation: true, skipCache: true });
          return { id: actorId, authUserId: actorId, role, companyId: company };
        },
        resolveCompanyForActor: (_actor: unknown, requested?: string) => {
          if (requested && requested !== company) throw new SessionAuthError("Чужая компания", 403);
          return company;
        },
      };
      if (name === "@/lib/supabase/service") return { getServiceClient: () => db };
      if (name === "./entity-creation") return matching;
      throw new Error(`Unexpected import: ${name}`);
    },
  });
  const api = module.exports;
  const request = (body: unknown, origin = "https://test.local") => ({
    nextUrl: new URL("https://test.local/api/fleet/entities"),
    headers: new Headers({ origin, "sec-fetch-site": origin === "https://test.local" ? "same-origin" : "cross-site" }),
    json: async () => body,
  });
  const call = async (body: unknown, origin?: string) => {
    try {
      const req = request(body, origin);
      api.fleetEntitySameOrigin(req);
      return api.fleetEntityResponse(await api.createFleetEntity(req), 201) as Response;
    } catch (error) {
      return api.fleetEntityFailure(error) as Response;
    }
  };

  const beforeCrossSite = queries;
  equal((await call({ kind: "vehicle" }, "https://evil.invalid")).status, 403);
  equal(queries, beforeCrossSite, "cross-site request never reaches data");

  role = "agronomist";
  const beforeForbidden = queries;
  equal((await call({ kind: "vehicle", name: "КАМАЗ", plate: "001 AA 01" })).status, 403);
  equal(queries, beforeForbidden, "forbidden role never reads references");
  role = "fleet_manager";

  const exactVehicle = await call({ kind: "vehicle", companyId: company, name: "Другая машина", plate: "Т 309 ВК" });
  equal(exactVehicle.status, 409);
  equal((await exactVehicle.json()).code, "exact_duplicate");
  equal(rpcCalls, 0, "exact duplicate never reaches mutation");

  const possibleVehicle = await call({ kind: "vehicle", companyId: company, name: "ЗИЛ", plate: "309" });
  equal(possibleVehicle.status, 409);
  equal((await possibleVehicle.json()).code, "potential_duplicate");
  equal(rpcCalls, 0, "potential duplicate requires confirmation");

  const confirmedVehicle = await call({
    kind: "vehicle", companyId: company, name: "ЗИЛ", plate: "309", confirmPotentialDuplicate: true,
  });
  equal(confirmedVehicle.status, 201);
  equal((await confirmedVehicle.json()).created.name, "ЗИЛ");
  equal(rpcCalls, 1);

  const exactDriver = await call({ kind: "driver", companyId: company, fullName: "Андрей Цалко" });
  equal(exactDriver.status, 409);
  equal((await exactDriver.json()).code, "exact_duplicate");
  equal(rpcCalls, 1);

  const createdDriver = await call({ kind: "driver", companyId: company, fullName: "Новый Водитель" });
  equal(createdDriver.status, 201);
  equal((await createdDriver.json()).kind, "driver");
  equal(rpcCalls, 2);

  equal((await call({ kind: "driver", companyId: foreign, fullName: "Новый Водитель" })).status, 403);
  equal((await call({ kind: "driver", fullName: "ОдноИмя", extra: true })).status, 400);
  equal((await call({ kind: "vehicle", name: "", plate: "" })).status, 400);

  console.log(`Fleet entity API PASS: ${checks} checks; no hosted writes.`);
}

void main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
