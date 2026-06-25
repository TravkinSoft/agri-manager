export type CatalogProductLike = {
  id: string;
  name?: string | null;
  trade_name?: string | null;
  normalized_name?: string | null;
  company_id?: string | null;
  manufacturer?: string | null;
  product_type?: string | null;
  type?: string | null;
  category?: string | null;
  subcategory?: string | null;
  pesticide_category?: string | null;
  fertilizer_type?: string | null;
  unit?: string | null;
  stock_unit?: string | null;
  base_uom?: string | null;
  default_unit?: string | null;
  application_unit?: string | null;
  default_rate_type?: string | null;
  default_rate_unit?: string | null;
  source_name?: string | null;
  notes?: string | null;
};

type AliasPair = {
  canonical: string;
  aliases: string[];
};

const FORMULATION_EQUIVALENTS: Record<string, string> = {
  "вдг": "wg",
  "в д г": "wg",
  "wg": "wg",
  "кс": "sc",
  "к с": "sc",
  "sc": "sc",
  "кэ": "ec",
  "к е": "ec",
  "ec": "ec",
  "вр": "sl",
  "в р": "sl",
  "врк": "sl",
  "sl": "sl",
};

const RU_EN_ALIAS_PAIRS: AliasPair[] = [
  { canonical: "curamin foliar", aliases: ["curamin foliar", "курамин фолиар", "курамин"] },
  { canonical: "phomazin", aliases: ["phomazin", "фомазин", "swissgrow phomazin", "swissgrow фомазин"] },
  { canonical: "revus top", aliases: ["revus top", "ревус топ"] },
  { canonical: "ridomil gold", aliases: ["ridomil gold", "ридомил голд"] },
  { canonical: "tilt", aliases: ["tilt", "тилт"] },
  { canonical: "technofit", aliases: ["technofit", "текнофит", "технофит"] },
  { canonical: "karate zeon", aliases: ["karate zeon", "каратэ зеон"] },
  { canonical: "yaramila", aliases: ["yaramila", "ярамила", "yara mila", "яра мила"] },
  { canonical: "yaravita", aliases: ["yaravita", "яравита", "yara vita", "яра вита"] },
];

const KNOWN_MANUFACTURER_PREFIXES = [
  "SwissGrow",
  "Swissgrow",
  "Yara",
  "YaraMila",
  "YaraVita",
  "Valagro",
  "Tradecorp",
  "Miller",
  "Agritecno",
  "EuroChem",
  "KazAzot",
  "Kazphosphate",
  "Bayer",
  "BASF",
  "Syngenta",
  "Corteva",
  "Adama",
  "Technofit",
  "TechnoFit",
  "Dupont",
  "DuPont",
  "ICL",
];

const MANUFACTURER_DISPLAY: Record<string, string> = {
  swissgrow: "SwissGrow",
  technofit: "TechnoFit",
  yara: "Yara",
  yaramila: "YaraMila",
  yaravita: "YaraVita",
  eurochem: "EuroChem",
  kazazot: "KazAzot",
  kazphosphate: "Kazphosphate",
  basf: "BASF",
  dupont: "DuPont",
  icl: "ICL",
};

type VerifiedProductIdentity = {
  canonicalTradeName: string;
  displayManufacturer?: string;
  stockUnit?: string;
  aliases: string[];
};

const VERIFIED_PRODUCT_IDENTITIES: VerifiedProductIdentity[] = [
  {
    canonicalTradeName: "Phomazin",
    displayManufacturer: "SG",
    stockUnit: "l",
    aliases: [
      "phomazin",
      "swissgrow phomazin",
      "\u0444\u043e\u043c\u0430\u0437\u0438\u043d",
      "swissgrow \u0444\u043e\u043c\u0430\u0437\u0438\u043d",
    ],
  },
  {
    canonicalTradeName: "Curamin Foliar",
    stockUnit: "l",
    aliases: [
      "curamin foliar",
      "curamin",
      "\u043a\u0443\u0440\u0430\u043c\u0438\u043d \u0444\u043e\u043b\u0438\u0430\u0440",
      "\u043a\u0443\u0440\u0430\u043c\u0438\u043d",
    ],
  },
];

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function compactSpaces(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeFormulations(value: string) {
  let next = value;
  for (const [source, target] of Object.entries(FORMULATION_EQUIVALENTS)) {
    next = next.replace(new RegExp(`(^|\\s)${escapeRegex(source)}(?=\\s|$)`, "giu"), `$1${target}`);
  }
  return next;
}

export function normalizeCatalogName(name: string | null | undefined) {
  return normalizeFormulations(
    compactSpaces(String(name || "")
      .toLowerCase()
      .replace(/ё/g, "е")
      .replace(/[“”„«»]/g, "\"")
      .replace(/[’`]/g, "'")
      .replace(/\b(рн|pн|ph)\b/giu, "ph")
      .replace(/\./g, " ")
      .replace(/[^\p{L}\p{N}]+/gu, " "))
  ).replace(/\s+/g, "");
}

function normalizeLooseWords(name: string | null | undefined) {
  return normalizeFormulations(
    compactSpaces(String(name || "")
      .toLowerCase()
      .replace(/ё/g, "е")
      .replace(/[“”„«»]/g, "\"")
      .replace(/[’`]/g, "'")
      .replace(/\b(рн|pн|ph)\b/giu, "ph")
      .replace(/\./g, " ")
      .replace(/[^\p{L}\p{N}]+/gu, " "))
  );
}

function productName(product: CatalogProductLike) {
  return product.trade_name || product.name || product.normalized_name || "";
}

function productGroup(product: CatalogProductLike) {
  return product.product_type || product.type || product.category || "";
}

function sourceFromNotes(notes: string | null | undefined) {
  const text = String(notes || "");
  return text.match(/source=([^\n;]+)/i)?.[1]?.trim() || text.match(/source_name=([^\n;]+)/i)?.[1]?.trim() || "";
}

function normalizeManufacturer(value: string | null | undefined) {
  return normalizeCatalogName(value);
}

function manufacturerDisplay(value: string | null | undefined) {
  const raw = compactSpaces(String(value || ""));
  const key = normalizeManufacturer(raw);
  if (["unknown", "неизвестно", "various", "разные"].includes(key)) return "";
  return MANUFACTURER_DISPLAY[key] || raw;
}

function aliasesForName(name: string | null | undefined) {
  const normalized = normalizeCatalogName(name);
  const pair = RU_EN_ALIAS_PAIRS.find((item) => item.aliases.some((alias) => normalizeCatalogName(alias) === normalized));
  return pair ? itemAliases(pair) : [];
}

function itemAliases(pair: AliasPair) {
  return Array.from(new Set([pair.canonical, ...pair.aliases]));
}

function canonicalAliasName(name: string | null | undefined) {
  const normalized = normalizeCatalogName(name);
  const pair = RU_EN_ALIAS_PAIRS.find((item) => item.aliases.some((alias) => normalizeCatalogName(alias) === normalized));
  return pair ? normalizeCatalogName(pair.canonical) : normalized;
}

function verifiedIdentityForName(name: string | null | undefined): VerifiedProductIdentity | null {
  const normalized = canonicalAliasName(name);
  return (
    VERIFIED_PRODUCT_IDENTITIES.find((identity) => {
      const candidates = [identity.canonicalTradeName, ...identity.aliases].map((alias) => canonicalAliasName(alias));
      return candidates.includes(normalized);
    }) || null
  );
}

export function getVerifiedProductIdentity(productOrName: CatalogProductLike | string | null | undefined): VerifiedProductIdentity | null {
  const stripped = stripManufacturerPrefixCandidate(productOrName);
  return verifiedIdentityForName(stripped.proposedTradeName || stripped.originalName);
}

export function stripManufacturerPrefixCandidate(productOrName: CatalogProductLike | string | null | undefined) {
  const name = typeof productOrName === "string" || productOrName == null ? String(productOrName || "") : productName(productOrName);
  const manufacturer = typeof productOrName === "string" || productOrName == null ? "" : productOrName.manufacturer || "";
  let current = compactSpaces(name);
  const candidates = [manufacturer, ...KNOWN_MANUFACTURER_PREFIXES].filter(Boolean);
  for (const maker of candidates) {
    const makerText = compactSpaces(String(maker));
    if (!makerText) continue;
    const currentNorm = normalizeCatalogName(current);
    const makerNorm = normalizeCatalogName(makerText);
    if (currentNorm.startsWith(makerNorm) && currentNorm.length > makerNorm.length + 2) {
      const stripped = compactSpaces(current.replace(new RegExp(`^${escapeRegex(makerText)}\\s+`, "iu"), ""));
      if (stripped && stripped !== current) {
        return {
          isCandidate: true,
          originalName: name,
          manufacturer: manufacturerDisplay(manufacturer || makerText),
          proposedTradeName: stripped,
        };
      }
    }
  }
  return {
    isCandidate: false,
    originalName: name,
    manufacturer: manufacturerDisplay(manufacturer),
    proposedTradeName: current,
  };
}

export function detectRuEnAliasCandidate(left: CatalogProductLike | string | null | undefined, right?: CatalogProductLike | string | null | undefined) {
  const leftName = typeof left === "string" || left == null ? String(left || "") : productName(left);
  const leftCanonical = canonicalAliasName(stripManufacturerPrefixCandidate(left).proposedTradeName);
  if (right === undefined) {
    return RU_EN_ALIAS_PAIRS.some((pair) => pair.aliases.some((alias) => normalizeCatalogName(alias) === leftCanonical));
  }
  const rightCanonical = canonicalAliasName(stripManufacturerPrefixCandidate(right).proposedTradeName);
  const rightName = typeof right === "string" || right == null ? String(right || "") : productName(right);
  return Boolean(leftName && rightName && leftCanonical === rightCanonical && normalizeCatalogName(leftName) !== normalizeCatalogName(rightName));
}

export function buildCatalogIdentityKey(product: CatalogProductLike, options: { includeManufacturer?: boolean } = {}) {
  const stripped = stripManufacturerPrefixCandidate(product);
  const verifiedIdentity = verifiedIdentityForName(stripped.proposedTradeName || productName(product));
  const canonicalName = verifiedIdentity
    ? normalizeCatalogName(verifiedIdentity.canonicalTradeName)
    : canonicalAliasName(stripped.proposedTradeName || productName(product));
  const group = normalizeCatalogName(productGroup(product));
  if (verifiedIdentity) return `${canonicalName}|${group}`;
  if (options.includeManufacturer === false) return `${canonicalName}|${group}`;
  return `${canonicalName}|${normalizeManufacturer(product.manufacturer)}|${group}`;
}

export function buildProductDisplayLabel(product: CatalogProductLike) {
  const stripped = stripManufacturerPrefixCandidate(product);
  const verifiedIdentity = verifiedIdentityForName(stripped.proposedTradeName || productName(product));
  if (verifiedIdentity) {
    return verifiedIdentity.displayManufacturer
      ? `${verifiedIdentity.canonicalTradeName} \u2014 ${verifiedIdentity.displayManufacturer}`
      : verifiedIdentity.canonicalTradeName;
  }
  const tradeName = stripped.proposedTradeName || productName(product);
  const manufacturer = manufacturerDisplay(product.manufacturer || stripped.manufacturer);
  if (manufacturer && normalizeCatalogName(tradeName) !== normalizeCatalogName(manufacturer)) {
    return `${tradeName} — ${manufacturer}`;
  }
  return tradeName;
}

export function getVerifiedProductStockUnit(product: CatalogProductLike | string | null | undefined): string | null {
  return getVerifiedProductIdentity(product)?.stockUnit || null;
}

export function matchCatalogSearch(product: CatalogProductLike, query: string) {
  const normalizedQuery = normalizeCatalogName(query);
  if (!normalizedQuery) return true;
  const stripped = stripManufacturerPrefixCandidate(product);
  const verifiedIdentity = verifiedIdentityForName(stripped.proposedTradeName || productName(product));
  const aliasTexts = [
    ...aliasesForName(stripped.proposedTradeName || productName(product)),
    ...(verifiedIdentity ? [verifiedIdentity.canonicalTradeName, ...verifiedIdentity.aliases] : []),
  ];
  const haystack = [
    product.name,
    product.trade_name,
    product.normalized_name,
    stripped.proposedTradeName,
    buildProductDisplayLabel(product),
    manufacturerDisplay(product.manufacturer),
    product.product_type,
    product.type,
    product.category,
    product.subcategory,
    product.pesticide_category,
    product.fertilizer_type,
    sourceFromNotes(product.notes),
    ...aliasTexts,
  ];
  return haystack.some((value) => normalizeCatalogName(value).includes(normalizedQuery));
}

function productCompletenessScore(product: CatalogProductLike) {
  return [
    product.application_unit,
    product.default_unit,
    product.unit,
    product.base_uom,
    product.manufacturer,
    product.category,
    product.subcategory,
    product.notes,
  ].filter(Boolean).length;
}

function preferProduct(current: CatalogProductLike, candidate: CatalogProductLike) {
  if (current.company_id && !candidate.company_id) return current;
  if (!current.company_id && candidate.company_id) return candidate;
  return productCompletenessScore(candidate) > productCompletenessScore(current) ? candidate : current;
}

export function dedupeProductsForSelect<T extends CatalogProductLike>(products: T[]) {
  const preferTypedProduct = (current: T, candidate: T) => preferProduct(current, candidate) as T;
  const baseGroups = new Map<string, T[]>();
  for (const product of products) {
    const key = buildCatalogIdentityKey(product, { includeManufacturer: false });
    if (!key.replace(/\|/g, "")) continue;
    if (!baseGroups.has(key)) baseGroups.set(key, []);
    baseGroups.get(key)!.push(product);
  }

  const selected: T[] = [];
  for (const group of Array.from(baseGroups.values())) {
    const companyProducts = group.filter((product: T) => product.company_id);
    if (companyProducts.length) {
      const manufacturerBuckets = new Map<string, T[]>();
      for (const product of group) {
        const manufacturer = normalizeManufacturer(product.manufacturer);
        const key = manufacturer || "unknown";
        if (!manufacturerBuckets.has(key)) manufacturerBuckets.set(key, []);
        manufacturerBuckets.get(key)!.push(product);
      }

      for (const bucket of Array.from(manufacturerBuckets.values())) {
        const companyInBucket = bucket.filter((product: T) => product.company_id);
        const bucketManufacturer = normalizeManufacturer(bucket[0]?.manufacturer);
        if (companyInBucket.length) {
          selected.push(companyInBucket.reduce(preferTypedProduct));
        } else if (!bucketManufacturer) {
          continue;
        } else if (!companyProducts.some((companyProduct: T) => !normalizeManufacturer(companyProduct.manufacturer))) {
          selected.push(bucket.reduce(preferTypedProduct));
        }
      }
      continue;
    }

    const exactBuckets = new Map<string, T[]>();
    for (const product of group) {
      const key = buildCatalogIdentityKey(product);
      if (!exactBuckets.has(key)) exactBuckets.set(key, []);
      exactBuckets.get(key)!.push(product);
    }
    for (const bucket of Array.from(exactBuckets.values())) selected.push(bucket.reduce(preferTypedProduct));
  }

  return selected.sort((left, right) => buildProductDisplayLabel(left).localeCompare(buildProductDisplayLabel(right), "ru"));
}

export function buildProductSearchText(product: CatalogProductLike) {
  const stripped = stripManufacturerPrefixCandidate(product);
  const verifiedIdentity = verifiedIdentityForName(stripped.proposedTradeName || productName(product));
  const aliases = [
    ...aliasesForName(stripped.proposedTradeName || productName(product)),
    ...(verifiedIdentity ? [verifiedIdentity.canonicalTradeName, ...verifiedIdentity.aliases] : []),
  ];
  return [
    product.name,
    product.trade_name,
    product.normalized_name,
    stripped.proposedTradeName,
    buildProductDisplayLabel(product),
    manufacturerDisplay(product.manufacturer),
    product.product_type,
    product.type,
    product.category,
    product.subcategory,
    product.pesticide_category,
    product.fertilizer_type,
    product.unit,
    product.base_uom,
    product.default_unit,
    product.application_unit,
    sourceFromNotes(product.notes),
    ...aliases,
    normalizeLooseWords(productName(product)),
  ]
    .filter(Boolean)
    .join(" ");
}
