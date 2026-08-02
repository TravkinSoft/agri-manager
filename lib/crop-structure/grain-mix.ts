export const GRAIN_MIX_MIN_COMPONENTS = 2;
export const GRAIN_MIX_MAX_COMPONENTS = 10;

export type GrainMixComponent = {
  id?: string;
  crop_id: string | null;
  variety_id: string | null;
  reproduction_id: string | null;
  seed_rate_kg_ha: number | null;
  sort_order?: number;
};

type CropOption = { id?: string | null; name?: string | null; name_ru?: string | null; name_en?: string | null };
type VarietyOption = { id?: string | null; crop_id?: string | null };

export type GrainMixValidation =
  | { ok: true; components: GrainMixComponent[] }
  | { ok: false; components: GrainMixComponent[]; componentIndex: number | null; message: string };

const componentIdentity = (component: GrainMixComponent) =>
  [component.crop_id, component.variety_id, component.reproduction_id].join(":");

export function validateGrainMixComponents(params: {
  components: GrainMixComponent[];
  cropsById?: ReadonlyMap<string, CropOption>;
  varietiesById?: ReadonlyMap<string, VarietyOption>;
}): GrainMixValidation {
  const components = params.components.map((component, index) => ({
    ...component,
    seed_rate_kg_ha:
      component.seed_rate_kg_ha == null || component.seed_rate_kg_ha === ("" as unknown as number)
        ? null
        : Number(component.seed_rate_kg_ha),
    sort_order: index + 1,
  }));

  if (components.length < GRAIN_MIX_MIN_COMPONENTS) {
    return {
      ok: false,
      components,
      componentIndex: null,
      message: "В зерносмеси должно быть не меньше двух компонентов.",
    };
  }
  if (components.length > GRAIN_MIX_MAX_COMPONENTS) {
    return {
      ok: false,
      components,
      componentIndex: null,
      message: "В зерносмеси можно сохранить не больше десяти компонентов.",
    };
  }

  const seen = new Set<string>();
  for (let index = 0; index < components.length; index += 1) {
    const component = components[index];
    if (!component.crop_id || !component.variety_id || !component.reproduction_id) {
      return {
        ok: false,
        components,
        componentIndex: index,
        message: "Для каждого компонента укажите культуру, сорт и репродукцию.",
      };
    }
    if (!Number.isFinite(component.seed_rate_kg_ha) || Number(component.seed_rate_kg_ha) <= 0) {
      return {
        ok: false,
        components,
        componentIndex: index,
        message: "Норма каждого компонента должна быть больше нуля.",
      };
    }
    if (params.cropsById && !params.cropsById.has(component.crop_id)) {
      return {
        ok: false,
        components,
        componentIndex: index,
        message: "Культура компонента недоступна.",
      };
    }
    if (
      params.varietiesById &&
      params.varietiesById.get(component.variety_id)?.crop_id !== component.crop_id
    ) {
      return {
        ok: false,
        components,
        componentIndex: index,
        message: "Выбранный сорт не относится к культуре компонента.",
      };
    }
    const identity = componentIdentity(component);
    if (seen.has(identity)) {
      return {
        ok: false,
        components,
        componentIndex: index,
        message: "Одинаковый компонент уже добавлен в зерносмесь.",
      };
    }
    seen.add(identity);
  }

  return { ok: true, components };
}

export function grainMixComponentTotalKg(areaHa: number | null | undefined, seedRateKgHa: number | null | undefined) {
  const area = Number(areaHa || 0);
  const rate = Number(seedRateKgHa || 0);
  return Number.isFinite(area) && Number.isFinite(rate) ? Number((area * rate).toFixed(4)) : 0;
}

export function grainMixTotalKg(areaHa: number | null | undefined, components: GrainMixComponent[]) {
  return components.reduce(
    (sum, component) => sum + grainMixComponentTotalKg(areaHa, component.seed_rate_kg_ha),
    0
  );
}

export function grainMixDisplayName(
  components: GrainMixComponent[],
  cropsById: ReadonlyMap<string, CropOption>
) {
  const labels = components
    .map((component) => {
      const crop = component.crop_id ? cropsById.get(component.crop_id) : null;
      return String(crop?.name_ru || crop?.name || crop?.name_en || "").trim();
    })
    .filter(Boolean);
  const uniqueLabels = Array.from(new Set(labels));
  if (!uniqueLabels.length) return "Зерносмесь";
  const shown = uniqueLabels.slice(0, 3);
  const remainder = uniqueLabels.length - shown.length;
  return `Зерносмесь: ${shown.join(" + ")}${remainder > 0 ? ` + ещё ${remainder}` : ""}`;
}

export function grainMixFingerprint(components: GrainMixComponent[]) {
  return JSON.stringify(
    components.map((component, index) => [
      component.crop_id || null,
      component.variety_id || null,
      component.reproduction_id || null,
      component.seed_rate_kg_ha == null ? null : Number(component.seed_rate_kg_ha),
      index + 1,
    ])
  );
}
