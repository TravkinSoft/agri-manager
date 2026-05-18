import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { normalizeComparable, normalizeText, parsePositiveNumber } from "@/lib/land-legal/normalizers";
import type { LandImportRawRow } from "@/lib/types/land-legal";

type ParsedRow = Record<string, string>;
type ParsedTableRow = { rowIndex: number; cells: ParsedRow };

const FIELD_HEADERS = ["№ поля", "n поля", "поле", "номер поля", "field", "field_no", "field_number"];
const CADASTRE_HEADERS = [
  "кадастровый номер участка",
  "кадастровый номер",
  "кадастр",
  "cadastre",
  "parcel",
];
const DISTRICT_HEADERS = ["сельский округ", "округ", "район", "rural_district", "district"];
const AREA_HEADERS = ["площадь, га", "площадь га", "площадь", "га", "area", "area_ha"];
const CROP_HEADERS = ["культура", "crop", "посев", "культ."];

const TOTAL_MARKERS = ["итого", "всего", "total", "sum"];

function normalizeHeader(value: string): string {
  return normalizeComparable(value).replace(/[^a-z0-9а-я]+/g, "");
}

function decodeBase64ToBuffer(base64: string): Buffer {
  const normalized = String(base64 || "").trim();
  if (!normalized) return Buffer.alloc(0);
  return Buffer.from(normalized, "base64");
}

function decodeBufferToUtf8(buffer: Buffer): string {
  if (!buffer.length) return "";
  return buffer.toString("utf8");
}

function removeBom(value: string): string {
  return value.replace(/^\uFEFF/, "");
}

function detectDelimiter(sample: string): string {
  const candidates = [",", ";", "\t", "|"];
  const counts = candidates.map((delimiter) => ({
    delimiter,
    count: sample.split(delimiter).length,
  }));
  counts.sort((a, b) => b.count - a.count);
  return counts[0]?.count > 1 ? counts[0].delimiter : ";";
}

function parseDelimitedLine(line: string, delimiter: string): string[] {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (!inQuotes && ch === delimiter) {
      values.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  values.push(current);
  return values.map((value) => normalizeText(value));
}

function parseDelimitedTable(text: string): ParsedTableRow[] {
  const prepared = removeBom(text).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = prepared
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (!lines.length) return [];

  const delimiter = detectDelimiter(lines[0]);
  const header = parseDelimitedLine(lines[0], delimiter);
  const body = lines.slice(1);

  return body.map((line, index) => {
    const cols = parseDelimitedLine(line, delimiter);
    const row: ParsedRow = {};
    header.forEach((key, headerIndex) => {
      row[key] = cols[headerIndex] || "";
    });
    return {
      rowIndex: index + 2,
      cells: row,
    };
  });
}

function findKey(row: ParsedRow, aliases: string[]): string | null {
  const keys = Object.keys(row);
  const normalizedMap = new Map(keys.map((key) => [normalizeHeader(key), key]));
  for (const alias of aliases) {
    const found = normalizedMap.get(normalizeHeader(alias));
    if (found) return found;
  }
  return null;
}

function isTotalsRow(values: string[]): boolean {
  return values.some((value) => {
    const normalized = normalizeComparable(value);
    return TOTAL_MARKERS.some((marker) => normalized.includes(marker));
  });
}

function parseOfficeRowsWithPowerShell(args: {
  fileName: string;
  ext: string;
  binary: Buffer;
  sheetName?: string;
}): { rows: ParsedTableRow[]; warnings: string[] } {
  const warnings: string[] = [];

  if (process.platform !== "win32") {
    warnings.push("DOCX/XLSX автоматический разбор доступен только в Windows-режиме. Используйте CSV.");
    return { rows: [], warnings };
  }

  const rootPath = process.cwd();
  const scriptPath =
    args.ext === "docx"
      ? path.join(rootPath, "scripts", "parse-docx-table.ps1")
      : path.join(rootPath, "scripts", "parse-xlsx-sheet.ps1");

  if (!existsSync(scriptPath)) {
    warnings.push(`Парсер ${args.ext.toUpperCase()} не найден: ${scriptPath}`);
    return { rows: [], warnings };
  }

  const tempName = `land-legal-import-${Date.now()}-${Math.random().toString(36).slice(2)}.${args.ext}`;
  const tempPath = path.join(os.tmpdir(), tempName);

  try {
    writeFileSync(tempPath, args.binary);
    const powershellExe = "C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";
    const commandArgs =
      args.ext === "docx"
        ? [
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            scriptPath,
            "-FilePath",
            tempPath,
          ]
        : [
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            scriptPath,
            "-FilePath",
            tempPath,
            "-SheetName",
            args.sheetName || "2026",
          ];

    const result = spawnSync(powershellExe, commandArgs, { encoding: "utf8" });
    if (result.error || result.status !== 0) {
      warnings.push(
        `Не удалось разобрать ${args.ext.toUpperCase()} через PowerShell: ${
          result.error?.message || result.stderr || result.stdout || "unknown error"
        }`
      );
      return { rows: [], warnings };
    }

    const payload = JSON.parse(String(result.stdout || "").trim().replace(/^\uFEFF/, ""));
    const rows = Array.isArray(payload?.rows)
      ? payload.rows.map((row: any) => ({
          rowIndex: Number(row?.rowIndex || 0),
          cells: (row?.cells || {}) as ParsedRow,
        }))
      : [];
    return { rows, warnings };
  } catch (error) {
    warnings.push(
      `Ошибка разбора ${args.ext.toUpperCase()}: ${error instanceof Error ? error.message : "unknown error"}`
    );
    return { rows: [], warnings };
  } finally {
    try {
      unlinkSync(tempPath);
    } catch {
      // no-op
    }
  }
}

function normalizeParsedRows(rows: ParsedTableRow[], fileName: string): LandImportRawRow[] {
  const normalized: LandImportRawRow[] = [];

  rows.forEach((sourceRow, index) => {
    const row = sourceRow.cells || {};
    const fieldKey = findKey(row, FIELD_HEADERS);
    const cadastreKey = findKey(row, CADASTRE_HEADERS);
    const districtKey = findKey(row, DISTRICT_HEADERS);
    const areaKey = findKey(row, AREA_HEADERS);
    const cropKey = findKey(row, CROP_HEADERS);

    const field = normalizeText(row[fieldKey || ""]);
    const cadastralNumber = normalizeText(row[cadastreKey || ""]);
    const ruralDistrict = normalizeText(row[districtKey || ""]);
    const areaRaw = normalizeText(row[areaKey || ""]);
    const crop = normalizeText(row[cropKey || ""]);
    const area = parsePositiveNumber(areaRaw);

    const values = [field, cadastralNumber, ruralDistrict, areaRaw, crop];
    if (!values.some(Boolean)) return;
    if (isTotalsRow(values)) return;

    normalized.push({
      row_no: Number(sourceRow.rowIndex || index + 1),
      field,
      cadastral_number: cadastralNumber,
      rural_district: ruralDistrict,
      area_ha: area,
      crop,
      source_document: fileName,
      source_company_hint: null,
      inferred_usage_legal_entity_name: null,
      raw: Object.fromEntries(
        Object.entries(row).map(([key, value]) => [normalizeText(key), normalizeText(value)])
      ),
    });
  });

  return normalized;
}

function parseDocxOrXlsxFallback(text: string): ParsedTableRow[] {
  const candidateLines = removeBom(text)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (!candidateLines.length) return [];

  const synthetic = candidateLines.map((line) => line.replace(/\s{2,}/g, ";"));
  return parseDelimitedTable(synthetic.join("\n"));
}

export function parseLandImportContent(payload: {
  fileName: string;
  fileType: string;
  contentBase64: string;
  sheetName?: string;
}): { rows: LandImportRawRow[]; warnings: string[] } {
  const warnings: string[] = [];
  const fileName = normalizeText(payload.fileName);
  const fileType = normalizeText(payload.fileType).toLowerCase();
  const ext = String(fileName.split(".").pop() || "").toLowerCase();
  const binary = decodeBase64ToBuffer(payload.contentBase64);

  if (!binary.length) {
    return {
      rows: [],
      warnings: ["Файл пустой или не удалось декодировать содержимое."],
    };
  }

  let parsedRows: ParsedTableRow[] = [];
  if (ext === "csv" || fileType.includes("csv")) {
    parsedRows = parseDelimitedTable(decodeBufferToUtf8(binary));
  } else if (ext === "docx" || ext === "xlsx") {
    const officeParsed = parseOfficeRowsWithPowerShell({
      fileName,
      ext,
      binary,
      sheetName: payload.sheetName,
    });
    warnings.push(...officeParsed.warnings);
    parsedRows = officeParsed.rows;
    if (!parsedRows.length) {
      warnings.push(
        `${ext.toUpperCase()} обработан в fallback-режиме. Для лучшего качества сохраните таблицу как CSV.`
      );
      parsedRows = parseDocxOrXlsxFallback(decodeBufferToUtf8(binary));
    }
  } else {
    warnings.push("Формат не распознан автоматически. Попробуйте CSV.");
    parsedRows = parseDelimitedTable(decodeBufferToUtf8(binary));
  }

  const normalizedRows = normalizeParsedRows(parsedRows, payload.fileName);
  if (!normalizedRows.length) {
    warnings.push("Не найдено валидных строк для импорта.");
  }

  return {
    rows: normalizedRows,
    warnings,
  };
}
