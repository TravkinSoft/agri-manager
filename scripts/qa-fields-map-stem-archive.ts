import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { findAreaGeometryConflicts } from "../lib/fields-map/geometry-validation";
import { parseKmlToGeoJson } from "../lib/fields-map/kml-server";

const EXPECTED = {
  zipBytes: 887_804,
  zipSha256: "b5d927b63d16ea15e74cd647c9af4c1e46715b51c77ea58627e9b3d7b5e9aaa6",
  entryName: "Границы Полей STEM.kml",
  entryBytes: 3_527_503,
  compressedBytes: 887_566,
  entrySha256: "51abda21beb7a0ad276b3ac2ab926e95919f84682f107700e7b302620e619bf2",
  placemarks: 130,
  polygonParts: 131,
  rings: 939,
  positions: 73_212,
} as const;

const archivePath = path.resolve(
  process.argv[2] ||
    process.env.FIELD_MAP_STEM_ARCHIVE ||
    "C:\\Users\\TRAVKIN\\Downloads\\Границы Полей STEM.zip"
);

function sha256(value: Buffer): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

const crcTable = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) {
    crc = (crc & 1) !== 0 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return crc >>> 0;
});

function crc32(value: Buffer): number {
  let crc = 0xffffffff;
  for (let index = 0; index < value.length; index += 1) {
    crc = crcTable[(crc ^ value[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

type ZipEntry = {
  name: string;
  compressedSize: number;
  uncompressedSize: number;
  crc: number;
  method: number;
  flags: number;
  localHeaderOffset: number;
};

function findEndOfCentralDirectory(zip: Buffer): number {
  const minimum = Math.max(0, zip.length - 65_557);
  for (let offset = zip.length - 22; offset >= minimum; offset -= 1) {
    if (zip.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  throw new Error("ZIP End of Central Directory not found");
}

function readZipEntries(zip: Buffer): ZipEntry[] {
  const eocd = findEndOfCentralDirectory(zip);
  const diskNumber = zip.readUInt16LE(eocd + 4);
  const centralDisk = zip.readUInt16LE(eocd + 6);
  const entriesOnDisk = zip.readUInt16LE(eocd + 8);
  const entryCount = zip.readUInt16LE(eocd + 10);
  const centralOffset = zip.readUInt32LE(eocd + 16);
  assert.equal(diskNumber, 0, "multi-disk ZIP is forbidden");
  assert.equal(centralDisk, 0, "multi-disk ZIP is forbidden");
  assert.equal(entriesOnDisk, entryCount, "central directory entry count mismatch");

  const entries: ZipEntry[] = [];
  let offset = centralOffset;
  for (let index = 0; index < entryCount; index += 1) {
    assert.equal(zip.readUInt32LE(offset), 0x02014b50, `central directory entry ${index + 1}`);
    const flags = zip.readUInt16LE(offset + 8);
    const method = zip.readUInt16LE(offset + 10);
    const crc = zip.readUInt32LE(offset + 16);
    const compressedSize = zip.readUInt32LE(offset + 20);
    const uncompressedSize = zip.readUInt32LE(offset + 24);
    const fileNameLength = zip.readUInt16LE(offset + 28);
    const extraLength = zip.readUInt16LE(offset + 30);
    const commentLength = zip.readUInt16LE(offset + 32);
    const localHeaderOffset = zip.readUInt32LE(offset + 42);
    assert.equal(flags & 0x1, 0, "encrypted ZIP entries are forbidden");
    assert.notEqual(compressedSize, 0xffffffff, "ZIP64 is outside this immutable fixture contract");
    assert.notEqual(uncompressedSize, 0xffffffff, "ZIP64 is outside this immutable fixture contract");
    const nameBytes = zip.subarray(offset + 46, offset + 46 + fileNameLength);
    assert.notEqual(flags & 0x800, 0, "STEM fixture filename must be UTF-8 encoded");
    const name = nameBytes.toString("utf8");
    assert.ok(!name.includes("\ufffd"), "ZIP entry filename contains invalid UTF-8");
    entries.push({ name, compressedSize, uncompressedSize, crc, method, flags, localHeaderOffset });
    offset += 46 + fileNameLength + extraLength + commentLength;
  }
  return entries;
}

function inflateEntry(zip: Buffer, entry: ZipEntry): Buffer {
  const offset = entry.localHeaderOffset;
  assert.equal(zip.readUInt32LE(offset), 0x04034b50, "local file header signature");
  const fileNameLength = zip.readUInt16LE(offset + 26);
  const extraLength = zip.readUInt16LE(offset + 28);
  const dataOffset = offset + 30 + fileNameLength + extraLength;
  const compressed = zip.subarray(dataOffset, dataOffset + entry.compressedSize);
  let inflated: Buffer;
  if (entry.method === 0) {
    inflated = Buffer.from(compressed);
  } else if (entry.method === 8) {
    inflated = zlib.inflateRawSync(compressed);
  } else {
    throw new Error(`Unsupported ZIP compression method: ${entry.method}`);
  }
  assert.equal(inflated.length, entry.uncompressedSize, "uncompressed ZIP entry size");
  assert.equal(crc32(inflated), entry.crc, "ZIP entry CRC32");
  return inflated;
}

const before = fs.statSync(archivePath);
assert.equal(before.isFile(), true, "STEM archive must be a regular file");
const zip = fs.readFileSync(archivePath);
assert.equal(zip.length, EXPECTED.zipBytes, "immutable ZIP byte length");
assert.equal(sha256(zip), EXPECTED.zipSha256, "immutable ZIP SHA-256");

const entries = readZipEntries(zip);
assert.equal(entries.length, 1, "STEM ZIP must contain exactly one entry");
const entry = entries[0];
assert.equal(entry.name, EXPECTED.entryName, "Unicode KML entry name");
assert.equal(entry.compressedSize, EXPECTED.compressedBytes, "compressed KML byte length");
assert.equal(entry.uncompressedSize, EXPECTED.entryBytes, "KML byte length from central directory");

const kml = inflateEntry(zip, entry);
assert.equal(kml.length, EXPECTED.entryBytes, "inflated KML byte length");
assert.equal(sha256(kml), EXPECTED.entrySha256, "immutable KML SHA-256");
const kmlText = kml.toString("utf8");
assert.equal(Buffer.byteLength(kmlText, "utf8"), kml.length, "KML must be valid UTF-8");
assert.ok(!kmlText.includes("\ufffd"), "KML contains invalid UTF-8 replacement characters");
assert.match(kmlText, /http:\/\/www\.opengis\.net\/kml\/2\.2/u, "KML 2.2 namespace");
const sourcePlacemarkCount = (kmlText.match(/<(?:[\p{L}\p{N}_-]+:)?Placemark\b/gu) || []).length;
assert.equal(sourcePlacemarkCount, EXPECTED.placemarks, "source Placemark count");

const parsed = parseKmlToGeoJson(kmlText);
assert.deepEqual(parsed.errors, [], "server parser errors");
assert.equal(parsed.features.length, EXPECTED.placemarks, "parsed feature count");
assert.equal(new Set(parsed.features.map((feature) => feature.id)).size, parsed.features.length, "feature IDs");

let polygonParts = 0;
let rings = 0;
let positions = 0;
let areaHa = 0;
const bounds = {
  minLon: Number.POSITIVE_INFINITY,
  minLat: Number.POSITIVE_INFINITY,
  maxLon: Number.NEGATIVE_INFINITY,
  maxLat: Number.NEGATIVE_INFINITY,
};
for (const feature of parsed.features) {
  const polygons =
    feature.geometry.type === "Polygon"
      ? [feature.geometry.coordinates]
      : feature.geometry.coordinates;
  polygonParts += polygons.length;
  areaHa += feature.area_ha || 0;
  for (const polygon of polygons) {
    rings += polygon.length;
    for (const ring of polygon) {
      positions += ring.length;
      for (const [lon, lat] of ring) {
        bounds.minLon = Math.min(bounds.minLon, lon);
        bounds.minLat = Math.min(bounds.minLat, lat);
        bounds.maxLon = Math.max(bounds.maxLon, lon);
        bounds.maxLat = Math.max(bounds.maxLat, lat);
      }
    }
  }
}
assert.equal(polygonParts, EXPECTED.polygonParts, "polygon part count");
assert.equal(rings, EXPECTED.rings, "ring count");
assert.equal(positions, EXPECTED.positions, "position count");
assert.ok(areaHa > 21_233.9 && areaHa < 21_234.1, `geometric area ${areaHa.toFixed(4)} ha`);
const declaredAreas = Array.from(
  kmlText.matchAll(
    /<Data\s+name="calculated_area"[^>]*>[\s\S]*?<value>([0-9]+(?:\.[0-9]+)?)<\/value>[\s\S]*?<\/Data>/gu
  ),
  (match) => Number(match[1])
);
assert.equal(declaredAreas.length, EXPECTED.placemarks, "declared calculated_area count");
const declaredAreaHa = declaredAreas.reduce((sum, area) => sum + area, 0);
assert.ok(
  Math.abs(declaredAreaHa - 21_276.01413) < 0.00001,
  `declared calculated_area sum ${declaredAreaHa.toFixed(5)} ha`
);
assert.deepEqual(
  [bounds.minLon, bounds.minLat, bounds.maxLon, bounds.maxLat].map((value) => Number(value.toFixed(6))),
  [69.802157, 53.487527, 70.316471, 53.919218],
  "WGS84 archive bounds"
);

const names = parsed.features.map((feature) => feature.name.trim());
for (const unicodeName of ["Платина картофель", "Платина морковь", "Сад 2", "Поле 32"]) {
  assert.ok(names.includes(unicodeName), `Unicode name missing: ${unicodeName}`);
}
const duplicateNames = Array.from(
  names.reduce((counts, name) => counts.set(name, (counts.get(name) || 0) + 1), new Map<string, number>())
).filter(([, count]) => count > 1);
assert.deepEqual(duplicateNames, [["23", 2]], "trimmed duplicate names");

const conflicts = findAreaGeometryConflicts(parsed.features);
const nameById = new Map(parsed.features.map((feature) => [feature.id, feature.name.trim()]));
const conflictNames = new Set(
  conflicts.map((conflict) =>
    [nameById.get(conflict.firstId), nameById.get(conflict.secondId)].sort().join(" <> ")
  )
);
const expectedConflictPairs = [
  ["52/1 поле", "Платина 3"],
  ["Поле 32", "32 Поле"],
  ["Платина морковь", "49/2 поле"],
  ["28- 5", "28 поле (2)"],
  ["2/2 поле", "2-3"],
  ["Платина картофель", "49/2 поле"],
  ["Платина - 2", "49/2 поле (1)"],
  ["Платина - 1", "49/2 поле (1)"],
  ["Платина - 1", "49/2 поле"],
];
for (const pair of expectedConflictPairs) {
  const key = [...pair].sort().join(" <> ");
  assert.ok(conflictNames.has(key), `expected positive-area conflict missing: ${key}`);
}

const after = fs.statSync(archivePath);
assert.equal(after.size, before.size, "archive size changed during read-only preflight");
assert.equal(after.mtimeMs, before.mtimeMs, "archive mtime changed during read-only preflight");
assert.equal(sha256(fs.readFileSync(archivePath)), EXPECTED.zipSha256, "archive hash changed during preflight");

console.log(
  JSON.stringify(
    {
      archive: archivePath,
      zip_sha256: EXPECTED.zipSha256.toUpperCase(),
      kml_sha256: EXPECTED.entrySha256.toUpperCase(),
      placemarks: parsed.features.length,
      polygon_parts: polygonParts,
      rings,
      positions,
      geometric_area_ha: Number(areaHa.toFixed(4)),
      declared_area_ha: Number(declaredAreaHa.toFixed(5)),
      area_difference_ha: Number((declaredAreaHa - areaHa).toFixed(4)),
      duplicate_names: duplicateNames,
      positive_area_conflicts: conflicts.length,
      checked_conflict_pairs: expectedConflictPairs.length,
      immutable_after_read: true,
      remote_calls: 0,
    },
    null,
    2
  )
);
