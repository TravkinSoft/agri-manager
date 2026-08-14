import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import ExcelJS from "exceljs";

const input = process.argv[2];
const output = process.argv[3] || "lib/weather/kato-localities.json";

if (!input) {
  throw new Error("Usage: node scripts/generate-kato-weather-catalog.mjs <KATO.xlsx> [output.json]");
}

const sourceBytes = await readFile(resolve(input));
const workbook = new ExcelJS.Workbook();
await workbook.xlsx.load(sourceBytes);
const sheet = workbook.getWorksheet("katonew1");
if (!sheet) throw new Error("KATO sheet katonew1 was not found");

const rows = [];
sheet.eachRow((row, rowNumber) => {
  if (rowNumber === 1) return;
  const values = row.values;
  rows.push({
    code: String(values[1] || "").padStart(9, "0"),
    ab: String(values[2] || "").padStart(2, "0"),
    cd: String(values[3] || "").padStart(2, "0"),
    ef: String(values[4] || "").padStart(2, "0"),
    hij: String(values[5] || "").padStart(3, "0"),
    nameKz: String(values[7] || "").trim(),
    nameRu: String(values[8] || "").trim(),
  });
});

const byCode = new Map(rows.map((row) => [row.code, row]));
const localityPrefix = /^(?:г\.|с\.|п\.|пос\.|ст\.|рзд\.|уч\.|аул\s+|село\s+|станция\s+|разъезд\s+|точка\s+|зимовка\s+)\s*/i;
const localitySuffixKz = /\s+(?:қ\.|а\.|к\.|е\.м\.|ст\.|т\.ж\.ст\.)$/i;

function cleanLocalityName(value, language) {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  return language === "kz"
    ? normalized.replace(localitySuffixKz, "").trim()
    : normalized.replace(localityPrefix, "").trim();
}

function isLocality(row) {
  if (row.hij !== "000") return true;
  return /^(?:г\.|с\.|п\.|пос\.|ст\.)/i.test(row.nameRu);
}

const regions = rows
  .filter((row) => row.cd === "00" && row.ef === "00" && row.hij === "000")
  .map((row) => ({ code: row.code, nameRu: row.nameRu, nameKz: row.nameKz }));

const districts = rows
  .filter((row) => row.cd !== "00" && row.ef === "00" && row.hij === "000")
  .map((row) => ({
    code: row.code,
    regionCode: `${row.code.slice(0, 2)}0000000`,
    nameRu: row.nameRu,
    nameKz: row.nameKz,
  }))
  .filter((row) => byCode.has(row.regionCode));

const localities = rows
  .filter(isLocality)
  .map((row) => {
    const regionCode = `${row.code.slice(0, 2)}0000000`;
    const districtCode = `${row.code.slice(0, 4)}00000`;
    const region = byCode.get(regionCode);
    const district = byCode.get(districtCode);
    if (!region || !district) return null;
    return {
      code: row.code,
      nameRu: cleanLocalityName(row.nameRu, "ru"),
      nameKz: cleanLocalityName(row.nameKz, "kz"),
      districtCode,
    };
  })
  .filter(Boolean);

const catalog = {
  source: {
    authority: "Бюро национальной статистики Республики Казахстан",
    classifier: "КАТО НК РК 11-2025",
    publishedAt: "2026-07-17",
    url: "https://stat.gov.kz/ru/classifiers/statistical/21/",
  },
  regions,
  districts,
  localities,
};

await writeFile(resolve(output), `${JSON.stringify(catalog)}\n`, "utf8");
console.log(JSON.stringify({ output: resolve(output), regions: regions.length, districts: districts.length, localities: localities.length }));
