import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const EXPECTED_DECISIONS = Object.freeze({
  SAFE_ATTACH_EXISTING: 3,
  SAFE_ALIAS: 33,
  SAFE_SAFENER: 6,
  KEEP_INACTIVE: 10,
  GARBAGE_REJECT: 1,
});

const CSV_FILES = Object.freeze({
  aliases: "aliases_utf8.csv",
  safeners: "safeners_utf8.csv",
  inactive_updates: "inactive_updates_utf8.csv",
  rejected_sources: "rejected_sources_utf8.csv",
});

const MOJIBAKE_PATTERNS = [
  /\uFFFD/u,
  /\u00C2/u,
  /\u00C3/u,
  /\u00D0/u,
  /\u00D1/u,
  /\u0420[\u0080-\u00BF]/u,
  /\u0421[\u0080-\u00BF]/u,
];

function parseArgs(argv) {
  const args = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || !value) {
      throw new Error(`Invalid argument pair near ${key ?? "<end>"}`);
    }
    args.set(key.slice(2), value);
  }
  return args;
}

function strictUtf8(buffer, filePath) {
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    throw new Error(`UTF-8 BOM is not allowed: ${filePath}`);
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch (error) {
    throw new Error(`Invalid UTF-8 in ${filePath}: ${error.message}`);
  }
}

async function readUtf8(filePath) {
  return strictUtf8(await readFile(filePath), filePath);
}

function normalizeDeep(value) {
  if (typeof value === "string") return value.normalize("NFC");
  if (Array.isArray(value)) return value.map(normalizeDeep);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalizeDeep(item)]));
  }
  return value;
}

function collectTextValues(value, output = []) {
  if (typeof value === "string") output.push(value);
  else if (Array.isArray(value)) value.forEach((item) => collectTextValues(item, output));
  else if (value && typeof value === "object") Object.values(value).forEach((item) => collectTextValues(item, output));
  return output;
}

function hasMojibake(value) {
  return MOJIBAKE_PATTERNS.some((pattern) => pattern.test(value));
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label}: expected ${expected}, got ${actual}`);
}

function csvEscape(value) {
  const text = value === null || value === undefined ? "" : String(value).normalize("NFC");
  return /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function csvFromRows(headers, rows) {
  return [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(",")),
  ].join("\n") + "\n";
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        cell += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(cell);
      cell = "";
    } else if (character === "\n") {
      row.push(cell.replace(/\r$/u, ""));
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += character;
    }
  }
  if (quoted) throw new Error("Unclosed quoted CSV field");
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function ensureAsciiSql(sql, name) {
  const nonAscii = Array.from(sql).filter((character) => character.codePointAt(0) > 0x7f);
  assertEqual(nonAscii.length, 0, `${name} non-ASCII code points`);
  if (!sql.includes("set local client_encoding = 'UTF8';")) {
    throw new Error(`${name} does not set client_encoding=UTF8`);
  }
  if (!sql.includes("current_setting('client_encoding') <> 'UTF8'")) {
    throw new Error(`${name} does not fail closed on client encoding drift`);
  }
}

function retargetSql(sql, applyToken, rollbackToken) {
  return sql
    .replaceAll("TZ-174", "TZ-178")
    .replaceAll("tz174", "tz178")
    .replaceAll("TZ174", "TZ178")
    .replace(/TZ178_APPLY_UTF8_[A-Z0-9_]+/gu, applyToken)
    .replace(/TZ178_ROLLBACK_UTF8_[A-Z0-9_]+/gu, rollbackToken)
    .normalize("NFC");
}

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const auditRoot = path.resolve(repoRoot, "..", "..", "audit-output");
const args = parseArgs(process.argv.slice(2));
const sourcePackage = path.resolve(args.get("source-package") || path.join(auditRoot, "TZ-174", "apply-package"));
const outputPackage = path.resolve(args.get("output-package") || path.join(auditRoot, "TZ-178", "apply-package"));

const sourceCanonicalPath = path.join(sourcePackage, "canonical_rows.json");
const sourceCanonicalText = await readUtf8(sourceCanonicalPath);
const sourceCanonical = normalizeDeep(JSON.parse(sourceCanonicalText));
const textValues = collectTextValues(sourceCanonical);
const mojibakeBefore = textValues.filter(hasMojibake);

assertEqual(sourceCanonical.apply_rows.length, 53, "Apply decision rows");
assertEqual(sourceCanonical.source_evidence_rows.length, 54, "Source evidence rows");
for (const [classification, expected] of Object.entries(EXPECTED_DECISIONS)) {
  const actual = sourceCanonical.apply_rows.filter((row) => row.classification === classification).length;
  assertEqual(actual, expected, classification);
}
assertEqual(sourceCanonical.humic_acids?.decision, "HOLD_OUT_OF_SCOPE", "Humic acids decision");
assertEqual(sourceCanonical.humic_acids?.changed, false, "Humic acids changed flag");
if (sourceCanonical.apply_rows.some((row) => row.source_row_id === sourceCanonical.humic_acids?.row?.source_row_id)) {
  throw new Error("Humic acids leaked into the 53-row apply set");
}
assertEqual(mojibakeBefore.length, 0, "Canonical source mojibake values");
assertEqual(textValues.filter((value) => value !== value.normalize("NFC")).length, 0, "Non-NFC source values");

const semanticHash = sha256(JSON.stringify({
  apply_rows: sourceCanonical.apply_rows,
  physical_rows: sourceCanonical.physical_rows,
  humic_acids: sourceCanonical.humic_acids,
}));
const tokenSuffix = semanticHash.slice(0, 16).toUpperCase();
const applyToken = `TZ178_APPLY_UTF8_${tokenSuffix}_53`;
const rollbackToken = `TZ178_ROLLBACK_UTF8_${tokenSuffix}_53`;
const generatedAt = new Date().toISOString();

const canonical = {
  ...sourceCanonical,
  package: "TZ-178 UTF-8-safe component apply package",
  generated_at: generatedAt,
  source_package: sourcePackage.replaceAll("\\", "/"),
  rebuild: {
    generator: "scripts/catalog/rebuild-component-utf8-package.mjs",
    semantic_hash_sha256: semanticHash,
    strict_utf8_decode: true,
    bom_allowed: false,
    normalization: "NFC",
    executable_sql: "ASCII-only PostgreSQL Unicode escape literals",
    apply_token: applyToken,
    rollback_token: rollbackToken,
  },
};

const files = new Map();
files.set("canonical_rows.json", JSON.stringify(canonical, null, 2).normalize("NFC") + "\n");

for (const [physicalKey, fileName] of Object.entries(CSV_FILES)) {
  const sourceCsv = await readUtf8(path.join(sourcePackage, fileName));
  const headers = sourceCsv.split(/\r?\n/u, 1)[0].split(",");
  const rows = canonical.physical_rows[physicalKey];
  if (!Array.isArray(rows)) throw new Error(`Missing physical_rows.${physicalKey}`);
  const csv = csvFromRows(headers, rows);
  const parsed = parseCsv(csv);
  assertEqual(parsed.length, rows.length + 1, `${fileName} CSV row count`);
  assertEqual(JSON.stringify(parsed[0]), JSON.stringify(headers), `${fileName} CSV headers`);
  rows.forEach((row, rowIndex) => {
    const expected = headers.map((header) => String(row[header] ?? "").normalize("NFC"));
    assertEqual(JSON.stringify(parsed[rowIndex + 1]), JSON.stringify(expected), `${fileName} row ${rowIndex + 1}`);
  });
  files.set(fileName, csv);
}

const applySql = retargetSql(await readUtf8(path.join(sourcePackage, "apply_preview.sql")), applyToken, rollbackToken);
const rollbackSql = retargetSql(await readUtf8(path.join(sourcePackage, "rollback_preview.sql")), applyToken, rollbackToken);
ensureAsciiSql(applySql, "apply_preview.sql");
ensureAsciiSql(rollbackSql, "rollback_preview.sql");
files.set("apply_preview.sql", applySql);
files.set("rollback_preview.sql", rollbackSql);

const generatedTextValues = Array.from(files.values()).flatMap((value) => collectTextValues(value));
const mojibakeAfter = generatedTextValues.filter(hasMojibake);
assertEqual(mojibakeAfter.length, 0, "Generated package mojibake values");

files.set("encoding_report.md", `# TZ-178 encoding report

- Source package: ${sourcePackage.replaceAll("\\", "/")}
- Generator: scripts/catalog/rebuild-component-utf8-package.mjs
- Root cause: Windows PowerShell 5.1 decoded BOM-less UTF-8 with a legacy ANSI code page when Get-Content was used without an explicit UTF8 encoding.
- Source decoding: strict UTF-8 with fatal errors
- Output encoding: UTF-8 without BOM
- Unicode normalization: NFC
- Executable SQL: ASCII-only with PostgreSQL Unicode escape literals
- Database client guard: client_encoding must be UTF8
- Canonical text values checked: ${textValues.length}
- Mojibake values before rebuild: ${mojibakeBefore.length}
- Mojibake values after rebuild: ${mojibakeAfter.length}
- Apply decisions: 53
- Humic acids: HOLD_OUT_OF_SCOPE, excluded from apply
- Semantic SHA-256: ${semanticHash}
`);

files.set("owner_review.md", `# TZ-178 owner review

## Scope preserved

- SAFE_ATTACH_EXISTING: 3
- SAFE_ALIAS: 33
- SAFE_SAFENER: 6
- KEEP_INACTIVE: 10
- GARBAGE_REJECT: 1
- Total decisions: 53
- Humic acids: HOLD_OUT_OF_SCOPE, zero changes

## Physical rows

- Alias rows: ${canonical.physical_rows.aliases.length}
- Safener components: ${canonical.physical_rows.safeners.length}
- Inactive/archive updates: ${canonical.physical_rows.inactive_updates.length}
- Rejected source rows: ${canonical.physical_rows.rejected_sources.length}
- Source attachments: ${canonical.physical_rows.source_attachments.length}

This package changes only the encoding transport. It does not reclassify or expand the owner-approved TZ-172 decisions. Production apply remains a separate approval step.
`);

await mkdir(outputPackage, { recursive: true });
for (const [fileName, content] of files) {
  await writeFile(path.join(outputPackage, fileName), content.normalize("NFC"), "utf8");
}

const manifestEntries = [];
for (const fileName of Array.from(files.keys()).sort()) {
  const buffer = await readFile(path.join(outputPackage, fileName));
  strictUtf8(buffer, path.join(outputPackage, fileName));
  manifestEntries.push(`${sha256(buffer)}  ${fileName}`);
}
const manifest = manifestEntries.join("\n") + "\n";
await writeFile(path.join(outputPackage, "manifest.sha256"), manifest, "utf8");

for (const line of manifestEntries) {
  const [expectedHash, fileName] = line.split(/\s{2}/u);
  const actualHash = sha256(await readFile(path.join(outputPackage, fileName)));
  assertEqual(actualHash, expectedHash, `Manifest hash for ${fileName}`);
}

console.log(JSON.stringify({
  status: "PASS",
  sourcePackage,
  outputPackage,
  applyDecisions: canonical.apply_rows.length,
  classifications: EXPECTED_DECISIONS,
  humicAcidsChanged: false,
  textValuesChecked: textValues.length,
  mojibakeBefore: mojibakeBefore.length,
  mojibakeAfter: mojibakeAfter.length,
  sqlAsciiOnly: true,
  clientEncodingGuard: "UTF8",
  manifestEntries: manifestEntries.length,
  semanticHash,
}, null, 2));
