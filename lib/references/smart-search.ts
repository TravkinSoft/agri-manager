const cyrillicToLatin: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "i",
  к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f",
  х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};

const cyrillicKeyboardToLatin: Record<string, string> = {
  й: "q", ц: "w", у: "e", к: "r", е: "t", н: "y", г: "u", ш: "i", щ: "o", з: "p", х: "[", ъ: "]",
  ф: "a", ы: "s", в: "d", а: "f", п: "g", р: "h", о: "j", л: "k", д: "l", ж: ";", э: "'",
  я: "z", ч: "x", с: "c", м: "v", и: "b", т: "n", ь: "m", б: ",", ю: ".", ё: "`",
};

const cyrillicPlateToLatin: Record<string, string> = {
  а: "a", в: "b", е: "e", к: "k", м: "m", н: "h", о: "o", р: "p", с: "c", т: "t", у: "y", х: "x",
};

function cleanSearchText(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("ru-RU")
    .replace(/[^a-zа-я0-9]+/g, " ")
    .trim();
}

function translate(value: string, alphabet: Record<string, string>): string {
  return Array.from(value, (character) => alphabet[character] ?? character).join("");
}

function addSearchForm(forms: Set<string>, value: string): void {
  const normalized = value.replace(/[^a-z0-9]+/g, " ").trim();
  if (!normalized) return;
  forms.add(normalized);
  forms.add(normalized.replace(/\s+/g, ""));
}

/**
 * Produces comparable forms for Cyrillic/Latin spelling, a mistaken RU keyboard
 * layout and the visually equivalent alphabet used by Kazakhstan/Russia plates.
 */
export function referenceSearchForms(value: unknown): string[] {
  const clean = cleanSearchText(value);
  if (!clean) return [];

  const forms = new Set<string>();
  addSearchForm(forms, translate(clean, cyrillicToLatin));
  addSearchForm(forms, translate(clean, cyrillicKeyboardToLatin));
  const hasOnlyPlateCyrillic = Array.from(clean).every((character) =>
    !/[а-я]/.test(character) || character in cyrillicPlateToLatin
  );
  if (hasOnlyPlateCyrillic) addSearchForm(forms, translate(clean, cyrillicPlateToLatin));
  return Array.from(forms);
}

export function buildReferenceSearchIndex(values: unknown[]): string[] {
  return referenceSearchForms(values.filter((value) => value !== null && value !== undefined).join(" "));
}

export function referenceMatchesSmartSearch(values: unknown[], query: string): boolean {
  const queryForms = referenceSearchForms(query);
  if (queryForms.length === 0) return true;

  const indexForms = buildReferenceSearchIndex(values);
  return queryForms.some((queryForm) => {
    const tokens = queryForm.split(" ").filter(Boolean);
    return tokens.length > 0 && tokens.every((token) => indexForms.some((indexForm) => indexForm.includes(token)));
  });
}
