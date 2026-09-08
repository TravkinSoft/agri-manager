import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

type Check = { name: string; run: () => void };

const source = readFileSync(resolve(process.cwd(), "app/(platform)/platform/page.tsx"), "utf8");
const companyListStart = source.indexOf("{companies.map((company) => {");
const companyListEnd = source.indexOf("</CardContent>", companyListStart);
const companyList = source.slice(companyListStart, companyListEnd);
const companyButtonEnd = companyList.indexOf("</button>");
const deleteButtonStart = companyList.indexOf('variant="destructive"');

const checks: Check[] = [
  {
    name: "company chooser follows the page header and precedes diagnostics",
    run: () => {
      const header = source.indexOf("TravkinFlow: глобальная консоль");
      const chooser = source.indexOf("Компании платформы");
      const diagnostics = source.indexOf("Движок знаний");
      assert.ok(header >= 0 && header < chooser && chooser < diagnostics);
    },
  },
  {
    name: "company surface is a native button wired to the existing open action",
    run: () => {
      assert.ok(companyListStart >= 0 && companyListEnd > companyListStart);
      assert.match(companyList, /<button[\s\S]*?type="button"[\s\S]*?onClick=\{\(\) => openCompanyContext\(company\.id\)\}/);
      assert.match(companyList, /aria-label=\{`Открыть компанию \$\{company\.name\}`\}/);
    },
  },
  {
    name: "native company button exposes keyboard focus and loading state",
    run: () => {
      assert.match(companyList, /focus-visible:ring-2/);
      assert.match(companyList, /disabled=\{openingCompanyId !== null\}/);
      assert.match(companyList, /aria-busy=\{isOpening\}/);
      assert.match(companyList, /Открываем\.\.\./);
    },
  },
  {
    name: "redundant visible enter-company action is absent",
    run: () => assert.doesNotMatch(source, /Войти в компанию/),
  },
  {
    name: "delete control is a separate labelled button after the company button",
    run: () => {
      assert.ok(companyButtonEnd >= 0 && deleteButtonStart > companyButtonEnd);
      assert.match(companyList, /variant="destructive"[\s\S]*?aria-label=\{`Удалить компанию \$\{company\.name\}`\}/);
    },
  },
  {
    name: "delete activation cannot open the company",
    run: () => {
      assert.match(
        companyList,
        /onClick=\{\(event\) => \{[\s\S]*?event\.preventDefault\(\);[\s\S]*?event\.stopPropagation\(\);[\s\S]*?openDeleteDialog\(company\);/
      );
    },
  },
  {
    name: "list loading and empty states remain visible",
    run: () => {
      assert.match(source, /\{loading \? <p[^>]*>Загрузка\.\.\.<\/p> : null\}/);
      assert.match(source, /!loading && companies\.length === 0/);
    },
  },
  {
    name: "company open keeps POST, context, toast and router contracts",
    run: () => {
      const action = source.slice(source.indexOf("const openCompanyContext"), source.indexOf("const createCompany"));
      assert.match(action, /fetch\("\/api\/global-admin\/companies"/);
      assert.match(action, /method: "POST"/);
      assert.match(action, /setGlobalAdminCompanyContext\(nextCompanyId\)/);
      assert.match(action, /title: "Вход в компанию"/);
      assert.match(action, /router\.push\("\/dashboard"\)/);
    },
  },
];

for (const check of checks) {
  check.run();
  console.log(`PASS ${check.name}`);
}

console.log(`TRAVKINFLOW 2 PLATFORM COMPANIES: ${checks.length}/${checks.length} PASS`);
