export type ColumnContract = {
  dataType: string;
  nullable: boolean;
  defaultExpr: string;
  identity: string;
  generated: string;
  enumType: string | null;
};

export type TableContract = {
  rlsEnabled: boolean;
  columns: Record<string, ColumnContract>;
  indexes: Record<string, string>;
  foreignKeys: Record<string, string>;
  checks: Record<string, string>;
  policies: Record<string, string>;
};

export type FunctionContract = {
  returnType: string;
  securityDefiner: boolean;
  searchPath: string;
  definitionHash: string;
  grants: string;
};

export type ContractSnapshot = {
  projectRef: string;
  capturedAt: string;
  tables: Record<string, TableContract>;
  functions: Record<string, FunctionContract>;
  triggers: Record<string, string>;
  views: Record<string, string>;
  enums: Record<string, string>;
  migrations: Array<{ version: string; name: string }>;
};

export type RequiredObject =
  | { kind: "table"; key: string }
  | { kind: "column"; key: string; dataType?: string }
  | { kind: "function"; key: string }
  | { kind: "trigger"; key: string }
  | { kind: "view"; key: string }
  | { kind: "enum"; key: string };

export type MigrationFact = {
  migrationName: string;
  requiredObjects: RequiredObject[];
};

export type DriftFinding = {
  severity: "FAIL" | "WARNING";
  code: string;
  object: string;
  detail: string;
};

export type DriftResult = {
  ok: boolean;
  findings: DriftFinding[];
  failures: number;
  warnings: number;
};

const matchesAny = (key: string, patterns: RegExp[]) => patterns.some((pattern) => pattern.test(key));

const findObject = (snapshot: ContractSnapshot, object: RequiredObject) => {
  if (object.kind === "table") return snapshot.tables[object.key] ?? null;
  if (object.kind === "function") return snapshot.functions[object.key] ?? null;
  if (object.kind === "trigger") return snapshot.triggers[object.key] ?? null;
  if (object.kind === "view") return snapshot.views[object.key] ?? null;
  if (object.kind === "enum") return snapshot.enums[object.key] ?? null;
  const separator = object.key.lastIndexOf(".");
  const tableKey = object.key.slice(0, separator);
  const columnName = object.key.slice(separator + 1);
  return snapshot.tables[tableKey]?.columns[columnName] ?? null;
};

export const verifyMigrationFacts = (
  snapshot: ContractSnapshot,
  facts: MigrationFact[],
): DriftFinding[] => {
  const applied = new Set(snapshot.migrations.map((migration) => migration.name));
  return facts.flatMap((fact) => {
    if (!applied.has(fact.migrationName)) return [];
    return fact.requiredObjects.flatMap((object) => {
      const actual = findObject(snapshot, object);
      if (!actual) {
        return [{
          severity: "FAIL" as const,
          code: "MIGRATION_HISTORY_OBJECT_MISSING",
          object: object.key,
          detail: `${fact.migrationName} is recorded as applied, but the required ${object.kind} is absent`,
        }];
      }
      if (object.kind === "column" && object.dataType && (actual as ColumnContract).dataType !== object.dataType) {
        return [{
          severity: "FAIL" as const,
          code: "MIGRATION_HISTORY_OBJECT_TYPE_MISMATCH",
          object: object.key,
          detail: `${fact.migrationName} requires ${object.dataType}, found ${(actual as ColumnContract).dataType}`,
        }];
      }
      return [];
    });
  });
};

export const compareContracts = ({
  qa,
  production,
  requiredObjects,
  migrationFacts,
  expectedQaAhead = [],
}: {
  qa: ContractSnapshot;
  production: ContractSnapshot;
  requiredObjects: RequiredObject[];
  migrationFacts: MigrationFact[];
  expectedQaAhead?: RegExp[];
}): DriftResult => {
  const findings: DriftFinding[] = [];
  const add = (finding: DriftFinding) => findings.push(finding);

  for (const required of requiredObjects) {
    for (const [environment, snapshot] of [["QA", qa], ["Production", production]] as const) {
      const actual = findObject(snapshot, required);
      if (!actual) {
        add({ severity: "FAIL", code: "REQUIRED_OBJECT_MISSING", object: required.key, detail: `${environment}: required ${required.kind} is absent` });
      } else if (required.kind === "column" && required.dataType && (actual as ColumnContract).dataType !== required.dataType) {
        add({ severity: "FAIL", code: "REQUIRED_COLUMN_TYPE_MISMATCH", object: required.key, detail: `${environment}: expected ${required.dataType}, found ${(actual as ColumnContract).dataType}` });
      }
    }
  }

  const compareMap = <T>(
    prefix: string,
    qaMap: Record<string, T>,
    prodMap: Record<string, T>,
    serialize: (value: T) => string,
  ) => {
    for (const [key, qaValue] of Object.entries(qaMap)) {
      const objectKey = `${prefix}:${key}`;
      if (!(key in prodMap)) {
        add({
          severity: "WARNING",
          code: matchesAny(objectKey, expectedQaAhead) ? "EXPECTED_QA_AHEAD" : "QA_ONLY_OBJECT",
          object: key,
          detail: "Present in QA and absent in Production",
        });
      } else if (serialize(qaValue) !== serialize(prodMap[key])) {
        add({
          severity: matchesAny(objectKey, expectedQaAhead) ? "WARNING" : "FAIL",
          code: matchesAny(objectKey, expectedQaAhead) ? "EXPECTED_QA_AHEAD" : "CONTRACT_MISMATCH",
          object: key,
          detail: "QA and Production definitions differ",
        });
      }
    }
    for (const key of Object.keys(prodMap)) {
      if (!(key in qaMap)) add({ severity: "FAIL", code: "PRODUCTION_ONLY_OBJECT", object: key, detail: "Present in Production and absent in QA" });
    }
  };

  for (const [tableKey, qaTable] of Object.entries(qa.tables)) {
    const prodTable = production.tables[tableKey];
    if (!prodTable) {
      add({ severity: "WARNING", code: matchesAny(`table:${tableKey}`, expectedQaAhead) ? "EXPECTED_QA_AHEAD" : "QA_ONLY_OBJECT", object: tableKey, detail: "Table is present in QA and absent in Production" });
      continue;
    }
    if (qaTable.rlsEnabled !== prodTable.rlsEnabled) {
      add({ severity: "FAIL", code: "RLS_MISMATCH", object: tableKey, detail: `QA=${qaTable.rlsEnabled}, Production=${prodTable.rlsEnabled}` });
    }
    for (const [columnName, qaColumn] of Object.entries(qaTable.columns)) {
      const columnKey = `${tableKey}.${columnName}`;
      const prodColumn = prodTable.columns[columnName];
      if (!prodColumn) {
        add({ severity: "WARNING", code: matchesAny(`table:${columnKey}`, expectedQaAhead) ? "EXPECTED_QA_AHEAD" : "QA_ONLY_COLUMN", object: columnKey, detail: "Column is present in QA and absent in Production" });
      } else if (JSON.stringify(qaColumn) !== JSON.stringify(prodColumn)) {
        add({ severity: matchesAny(`table:${columnKey}`, expectedQaAhead) ? "WARNING" : "FAIL", code: matchesAny(`table:${columnKey}`, expectedQaAhead) ? "EXPECTED_QA_AHEAD" : "COLUMN_CONTRACT_MISMATCH", object: columnKey, detail: "Type, nullability, default, identity, generated, or enum contract differs" });
      }
    }
    for (const columnName of Object.keys(prodTable.columns)) {
      if (!(columnName in qaTable.columns)) add({ severity: "FAIL", code: "PRODUCTION_ONLY_COLUMN", object: `${tableKey}.${columnName}`, detail: "Column is present in Production and absent in QA" });
    }
    for (const [kind, qaValues, prodValues] of [
      ["index", qaTable.indexes, prodTable.indexes],
      ["foreign-key", qaTable.foreignKeys, prodTable.foreignKeys],
      ["check", qaTable.checks, prodTable.checks],
      ["policy", qaTable.policies, prodTable.policies],
    ] as const) {
      compareMap(`${kind}:${tableKey}`, qaValues, prodValues, String);
    }
  }
  for (const tableKey of Object.keys(production.tables)) {
    if (!(tableKey in qa.tables)) add({ severity: "FAIL", code: "PRODUCTION_ONLY_OBJECT", object: tableKey, detail: "Table is present in Production and absent in QA" });
  }
  compareMap("function", qa.functions, production.functions, (value) => JSON.stringify(value));
  compareMap("trigger", qa.triggers, production.triggers, String);
  compareMap("view", qa.views, production.views, String);
  compareMap("enum", qa.enums, production.enums, String);
  findings.push(...verifyMigrationFacts(qa, migrationFacts));
  findings.push(...verifyMigrationFacts(production, migrationFacts));

  const failures = findings.filter((finding) => finding.severity === "FAIL").length;
  const warnings = findings.filter((finding) => finding.severity === "WARNING").length;
  return { ok: failures === 0, findings, failures, warnings };
};
