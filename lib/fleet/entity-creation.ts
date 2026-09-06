import { z } from "zod";

export type FleetEntityKind = "vehicle" | "driver";
export type FleetDuplicateLevel = "exact" | "potential";

export interface FleetDuplicateCandidate {
  id: string;
  kind: FleetEntityKind;
  level: FleetDuplicateLevel;
  title: string;
  subtitle: string | null;
  reason: string;
  score: number;
}

export interface VehicleDuplicateSource {
  id: string;
  name: string | null;
  full_name?: string | null;
  plate_number: string | null;
  license_plate?: string | null;
}

export interface DriverDuplicateSource {
  id: string;
  full_name: string;
}

const companyId = z.string().uuid().optional();
const confirmation = z.boolean().optional().default(false);
const requiredText = (label: string, max: number) => z.string().trim()
  .min(2, `${label}: минимум 2 символа`)
  .max(max, `${label}: слишком длинное значение`);

export const fleetEntityCreateCommand = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("vehicle"),
    companyId,
    name: requiredText("Название машины", 140),
    plate: requiredText("Номер машины", 40),
    confirmPotentialDuplicate: confirmation,
  }).strict(),
  z.object({
    kind: z.literal("driver"),
    companyId,
    fullName: requiredText("ФИО водителя", 180).refine(
      value => normalizePersonName(value).split(" ").filter(Boolean).length >= 2,
      "Укажите хотя бы фамилию и имя",
    ),
    confirmPotentialDuplicate: confirmation,
  }).strict(),
]);

export type FleetEntityCreateCommand = z.infer<typeof fleetEntityCreateCommand>;

const visualCyrillicToLatin: Record<string, string> = {
  А: "A", В: "B", Е: "E", К: "K", М: "M", Н: "H", О: "O",
  Р: "P", С: "C", Т: "T", У: "Y", Х: "X", Ё: "E",
};

export function normalizeVehiclePlate(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKC")
    .toLocaleUpperCase("ru-RU")
    .replace(/[АВЕКМНОРСТУХЁ]/g, letter => visualCyrillicToLatin[letter] ?? letter)
    .replace(/[^A-Z0-9]/g, "");
}

export function normalizePersonName(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function personTokens(value: unknown): string[] {
  return normalizePersonName(value).split(" ").filter(Boolean).sort((a, b) => a.localeCompare(b, "ru"));
}

export function normalizedPersonKey(value: unknown): string {
  return personTokens(value).join(" ");
}

export function textSimilarity(left: string, right: string): number {
  if (left === right) return 1;
  if (!left.length || !right.length) return 0;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row++) {
    const current = [row];
    for (let column = 1; column <= right.length; column++) {
      current[column] = Math.min(
        current[column - 1] + 1,
        previous[column] + 1,
        previous[column - 1] + (left[row - 1] === right[column - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return 1 - previous[right.length] / Math.max(left.length, right.length);
}

function boundedScore(value: number) {
  return Math.round(Math.max(0, Math.min(1, value)) * 1000) / 1000;
}

function bestTokenScore(source: string[], target: string[]) {
  if (!source.length || !target.length) return 0;
  return source.reduce((sum, token) => sum + Math.max(...target.map(candidate => textSimilarity(token, candidate))), 0) / source.length;
}

export function findDriverDuplicates(
  fullName: string,
  rows: DriverDuplicateSource[],
): FleetDuplicateCandidate[] {
  const wantedTokens = personTokens(fullName);
  const wantedKey = wantedTokens.join(" ");
  const candidates = rows.flatMap((row): FleetDuplicateCandidate[] => {
    const candidateTokens = personTokens(row.full_name);
    const candidateKey = candidateTokens.join(" ");
    if (!candidateKey) return [];
    if (candidateKey === wantedKey) return [{
      id: row.id,
      kind: "driver",
      level: "exact",
      title: row.full_name,
      subtitle: null,
      reason: normalizePersonName(row.full_name) === normalizePersonName(fullName)
        ? "Такое ФИО уже есть"
        : "То же ФИО, но слова стоят в другом порядке",
      score: 1,
    }];

    const exactShared = wantedTokens.filter((token, index) =>
      candidateTokens.includes(token) && wantedTokens.indexOf(token) === index).length;
    const shorterIsSubset = Math.min(wantedTokens.length, candidateTokens.length) >= 2 &&
      exactShared === Math.min(wantedTokens.length, candidateTokens.length);
    const compactScore = textSimilarity(wantedKey.replace(/\s/g, ""), candidateKey.replace(/\s/g, ""));
    const forward = bestTokenScore(wantedTokens, candidateTokens);
    const backward = bestTokenScore(candidateTokens, wantedTokens);
    const tokenScore = (forward + backward) / 2;
    const shorterScore = wantedTokens.length <= candidateTokens.length ? forward : backward;
    const score = shorterIsSubset ? 0.96 : Math.max(compactScore, tokenScore, shorterScore * 0.96);
    if (score < 0.78) return [];
    return [{
      id: row.id,
      kind: "driver",
      level: "potential",
      title: row.full_name,
      subtitle: null,
      reason: shorterIsSubset ? "Совпадают фамилия и имя" : "ФИО очень похоже — возможна опечатка",
      score: boundedScore(score),
    }];
  });
  return candidates.sort((left, right) =>
    (left.level === right.level ? 0 : left.level === "exact" ? -1 : 1) ||
    right.score - left.score || left.title.localeCompare(right.title, "ru"));
}

function displayVehicleName(row: VehicleDuplicateSource) {
  return String(row.name || row.full_name || "Машина").trim() || "Машина";
}

function displayVehiclePlate(row: VehicleDuplicateSource) {
  return String(row.license_plate || row.plate_number || "").trim();
}

export function findVehicleDuplicates(
  input: { name: string; plate: string },
  rows: VehicleDuplicateSource[],
): FleetDuplicateCandidate[] {
  const wantedPlate = normalizeVehiclePlate(input.plate);
  const wantedName = normalizePersonName(input.name).replace(/\s/g, "");
  const candidates = rows.flatMap((row): FleetDuplicateCandidate[] => {
    const plate = displayVehiclePlate(row);
    const candidatePlate = normalizeVehiclePlate(plate);
    const candidateName = normalizePersonName(displayVehicleName(row)).replace(/\s/g, "");
    if (!candidatePlate) return [];
    if (candidatePlate === wantedPlate) return [{
      id: row.id,
      kind: "vehicle",
      level: "exact",
      title: displayVehicleName(row),
      subtitle: plate || null,
      reason: "Этот номер уже есть — учтены пробелы, дефисы и похожие русские/латинские буквы",
      score: 1,
    }];

    const plateScore = textSimilarity(wantedPlate, candidatePlate);
    const nameScore = textSimilarity(wantedName, candidateName);
    const containsNumber = Math.min(wantedPlate.length, candidatePlate.length) >= 3 &&
      (wantedPlate.includes(candidatePlate) || candidatePlate.includes(wantedPlate));
    const combined = plateScore * 0.8 + nameScore * 0.2;
    const score = Math.max(containsNumber ? 0.9 : 0, plateScore, combined);
    if (!(containsNumber || (plateScore >= 0.72 && Math.abs(wantedPlate.length - candidatePlate.length) <= 3) ||
      (plateScore >= 0.58 && nameScore >= 0.82))) return [];
    return [{
      id: row.id,
      kind: "vehicle",
      level: "potential",
      title: displayVehicleName(row),
      subtitle: plate || null,
      reason: containsNumber ? "Номер входит в уже существующий номер" : "Похожий номер — проверьте возможную опечатку",
      score: boundedScore(score),
    }];
  });
  return candidates.sort((left, right) =>
    (left.level === right.level ? 0 : left.level === "exact" ? -1 : 1) ||
    right.score - left.score || left.title.localeCompare(right.title, "ru"));
}

export function uniqueTopCandidates(candidates: FleetDuplicateCandidate[], limit = 4) {
  const seen = new Set<string>();
  return candidates.filter(candidate => {
    const key = `${candidate.kind}:${candidate.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, limit);
}
