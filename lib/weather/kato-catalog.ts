import catalogJson from "./kato-localities.json";

export type KatoRegion = {
  code: string;
  nameRu: string;
  nameKz: string;
};

export type KatoDistrict = KatoRegion & {
  regionCode: string;
};

type KatoLocalityRow = {
  code: string;
  nameRu: string;
  nameKz: string;
  districtCode: string;
};

export type KatoLocality = KatoLocalityRow & {
  districtRu: string;
  districtKz: string;
  regionCode: string;
  regionRu: string;
  regionKz: string;
};

type KatoCatalog = {
  source: {
    authority: string;
    classifier: string;
    publishedAt: string;
    url: string;
  };
  regions: KatoRegion[];
  districts: KatoDistrict[];
  localities: KatoLocalityRow[];
};

const catalog = catalogJson as KatoCatalog;
const regionByCode = new Map(catalog.regions.map((row) => [row.code, row]));
const districtByCode = new Map(catalog.districts.map((row) => [row.code, row]));

const kazakhToRussian: Record<string, string> = {
  ә: "а",
  ғ: "г",
  қ: "к",
  ң: "н",
  ө: "о",
  ұ: "у",
  ү: "у",
  һ: "х",
  і: "и",
  ё: "е",
};

export function normalizeKatoSearch(value: string): string {
  return String(value || "")
    .trim()
    .toLocaleLowerCase("ru")
    .replace(/[әғқңөұүһіё]/g, (letter) => kazakhToRussian[letter] || letter)
    .replace(/(^|\s)(?:г|с|п|пос|ст|рзд|уч)\.(?=\s|\p{L})/gu, "$1")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/([аеёиоуыэюя])\1+/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function expand(row: KatoLocalityRow): KatoLocality | null {
  const district = districtByCode.get(row.districtCode);
  const region = district
    ? regionByCode.get(district.regionCode)
    : regionByCode.get(row.districtCode);
  if (!region) return null;
  return {
    ...row,
    districtRu: district?.nameRu || region.nameRu,
    districtKz: district?.nameKz || region.nameKz,
    regionCode: region.code,
    regionRu: region.nameRu,
    regionKz: region.nameKz,
  };
}

const localities = catalog.localities
  .map(expand)
  .filter((row): row is KatoLocality => Boolean(row));
const localityByCode = new Map(localities.map((row) => [row.code, row]));

function searchScore(row: KatoLocality, query: string): number {
  const ru = normalizeKatoSearch(row.nameRu);
  const kz = normalizeKatoSearch(row.nameKz);
  if (ru === query || kz === query) return 0;
  if (ru.startsWith(query) || kz.startsWith(query)) return 1;
  if (ru.includes(query) || kz.includes(query)) return 2;
  return 3;
}

export function getKatoSource() {
  return catalog.source;
}

export function getKatoLocality(code: string): KatoLocality | null {
  return localityByCode.get(String(code || "").trim()) || null;
}

export function getKatoRegions(): KatoRegion[] {
  return [...catalog.regions].sort((a, b) => a.nameRu.localeCompare(b.nameRu, "ru"));
}

export function getKatoDistricts(regionCode: string): KatoDistrict[] {
  return catalog.districts
    .filter((row) => row.regionCode === regionCode)
    .sort((a, b) => a.nameRu.localeCompare(b.nameRu, "ru"));
}

export function getKatoLocalities(districtCode: string): KatoLocality[] {
  return localities
    .filter((row) => row.districtCode === districtCode)
    .sort((a, b) => a.nameRu.localeCompare(b.nameRu, "ru"));
}

export function searchKatoLocalities(rawQuery: string, limit = 60): KatoLocality[] {
  const query = normalizeKatoSearch(rawQuery);
  if (query.length < 2) return [];
  const terms = query.split(" ").filter(Boolean);
  return localities
    .filter((row) => {
      const haystack = normalizeKatoSearch([
        row.nameRu,
        row.nameKz,
        row.districtRu,
        row.districtKz,
        row.regionRu,
        row.regionKz,
      ].join(" "));
      return terms.every((term) => haystack.includes(term));
    })
    .sort((a, b) => {
      const score = searchScore(a, query) - searchScore(b, query);
      return score || a.regionRu.localeCompare(b.regionRu, "ru") || a.districtRu.localeCompare(b.districtRu, "ru") || a.nameRu.localeCompare(b.nameRu, "ru");
    })
    .slice(0, Math.max(1, Math.min(limit, 100)));
}

export function katoNamesEquivalent(actual: string | null | undefined, expected: string | null | undefined): boolean {
  const left = normalizeKatoSearch(actual || "")
    .replace(/(^|\s)(?:область|облысы|район|ауданы|городская администрация|г а|им|имени)(?=\s|$)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const right = normalizeKatoSearch(expected || "")
    .replace(/(^|\s)(?:область|облысы|район|ауданы|городская администрация|г а|им|имени)(?=\s|$)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return Boolean(left && right && (left === right || left.includes(right) || right.includes(left)));
}
