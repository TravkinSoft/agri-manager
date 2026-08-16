import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildHumanPesticideCard,
  cleanHumanText,
  HUMAN_PESTICIDE_CARD_ROW_ORDER,
  isCropParserFragment,
  type HumanPesticideUsageRuleInput,
} from "../lib/glbd/human-pesticide-card";

let passed = 0;

function check(name: string, run: () => void) {
  run();
  passed += 1;
  console.log(`PASS ${passed}: ${name}`);
}

function rowValue(card: ReturnType<typeof buildHumanPesticideCard>, label: string): string | null {
  return card.rows.find((row) => row.label === label)?.value || null;
}

function build(rules: HumanPesticideUsageRuleInput[] = []) {
  return buildHumanPesticideCard({
    product: {
      id: "84724bc9-8618-46ce-8914-7b2c8fbc2590",
      trade_name: "Celest Top",
      name_ru: "Селест Топ",
      pesticide_category: "seed_treatment",
      formulation: "КС",
      manufacturer: "Syngenta",
      mode_of_action_type: "systemic",
      is_active: true,
      archived: false,
    },
    aliases: ["Селест Топ"],
    composition: [
      {
        role_in_product: "active",
        concentration_value: 25,
        concentration_unit: "g/l",
        component: { name_ru: "Дифеноконазол", component_type: "active_ingredient" },
      },
      {
        role_in_product: "safener",
        concentration_value: 10,
        concentration_unit: "g/l",
        component: { name_ru: "Тестовый сафенер", component_type: "safener" },
      },
    ],
    usageRules: rules,
    safety: {
      read_allowed: true,
      recommendation_allowed: false,
      missing_critical_fields: ["registration"],
    },
  });
}

const fullRule: HumanPesticideUsageRuleInput = {
  crop: { name_ru: "Пшеница" },
  crop_name_raw: "Пшеница яровая",
  crop_name_original: "Пшеница яровая",
  target: { name_ru: "Овсюг" },
  rate_min: 0.7,
  rate_max: 1,
  rate_unit: "l/ha",
  working_fluid_min: 200,
  working_fluid_max: 300,
  working_fluid_unit: "l/ha",
  application_method: "Опрыскивание",
  application_timing: "Весной",
  crop_stage: "2–3 листа",
  max_treatments: 1,
  harvest_interval_days: 30,
  restrictions: "Не применять в водоохранной зоне",
};

check("row order is contract order", () => {
  const card = build([fullRule]);
  const indexes = card.rows.map((row) => HUMAN_PESTICIDE_CARD_ROW_ORDER.indexOf(row.label));
  assert.deepEqual(indexes, [...indexes].sort((left, right) => left - right));
});
check("empty rows are hidden", () => assert.equal(build([]).rows.some((row) => row.label === "Культуры"), false));
check("name includes canonical name", () => assert.match(rowValue(build(), "Название") || "", /^Celest Top/));
check("aliases do not duplicate the main name", () => assert.equal(rowValue(build(), "Название"), "Celest Top"));
check("category is localized", () => assert.equal(rowValue(build(), "Категория"), "Протравитель"));
check("mode of action is localized", () => assert.equal(rowValue(build(), "Тип действия"), "Системный"));
check("formulation is present", () => assert.equal(rowValue(build(), "Препаративная форма"), "КС"));
check("manufacturer is present", () => assert.equal(rowValue(build(), "Производитель"), "Syngenta"));
check("active ingredient role is explicit", () => assert.match(rowValue(build(), "Действующие вещества") || "", /Действующее вещество:/));
check("safener role is explicit", () => assert.match(rowValue(build(), "Действующие вещества") || "", /Сафенер:/));
check("concentration unit is localized", () => assert.match(rowValue(build(), "Действующие вещества") || "", /25 г\/л/));
check("canonical crop has priority", () => assert.match(rowValue(build([fullRule]), "Культуры") || "", /^Пшеница/));
check("crop qualifier is preserved", () => assert.match(rowValue(build([fullRule]), "Культуры") || "", /Пшеница яровая/));
check("canonical target is displayed", () => assert.equal(rowValue(build([fullRule]), "Вредный объект"), "Овсюг"));
check("rate range is localized", () => assert.equal(rowValue(build([fullRule]), "Норма расхода препарата"), "0,7–1 л/га"));
check("working fluid is displayed", () => assert.equal(rowValue(build([fullRule]), "Расход рабочей жидкости"), "200–300 л/га"));
check("timing values are retained", () => assert.match(rowValue(build([fullRule]), "Фаза и срок обработки") || "", /Весной/));
check("application method is displayed", () => assert.equal(rowValue(build([fullRule]), "Способ применения"), "Опрыскивание"));
check("max treatments is human readable", () => assert.equal(rowValue(build([fullRule]), "Максимальное количество обработок"), "1 обработка"));
check("harvest interval is human readable", () => assert.equal(rowValue(build([fullRule]), "До уборки"), "30 дн."));
check("restrictions are displayed", () => assert.match(rowValue(build([fullRule]), "Ограничения") || "", /водоохранной/));
check("missing rate unit is not guessed", () => {
  const card = build([{ crop_name_raw: "Пшеница", original_rate_value_text: "0,5" }]);
  assert.equal(rowValue(card, "Норма расхода препарата"), "0,5");
});
check("original rate text is preserved", () => {
  const card = build([{ crop_name_raw: "Пшеница", original_rate_text: "0,5–0,7 кг/га" }]);
  assert.equal(rowValue(card, "Норма расхода препарата"), "0,5–0,7 кг/га");
});
check("working fluid extraction is deterministic", () => {
  const card = build([{ crop_name_raw: "Пшеница", usage_summary: "Расход рабочей жидкости — 150–200 л/га." }]);
  assert.equal(rowValue(card, "Расход рабочей жидкости"), "150–200 л/га");
});
check("unrelated numbers do not become working fluid", () => {
  const card = build([{ crop_name_raw: "Пшеница", notes: "Обработка при температуре 15–20 C." }]);
  assert.equal(rowValue(card, "Расход рабочей жидкости"), null);
});
check("parser fragment is detected", () => assert.equal(isCropParserFragment("устойчивые к имидазолинон ам)"), true));
check("valid crop phrase is not a parser fragment", () => assert.equal(isCropParserFragment("Подсолнечник (сорта и гибриды)"), false));
check("truncated crop phrase is a parser fragment", () => assert.equal(isCropParserFragment("Подсолнечник (сорта и гибриды"), true));
check("parser fragment is not displayed as crop", () => {
  const card = build([{ crop_name_raw: "устойчивые к имидазолинон ам)" }]);
  assert.equal(rowValue(card, "Культуры"), null);
});
check("broken imidazolinone spacing is normalized", () => {
  assert.equal(cleanHumanText("Нут, устойчивый к имидазолинон ам"), "Нут, устойчивый к имидазолинонам");
});
check("raw target JSON array is displayed", () => {
  const card = build([{ crop_name_raw: "Пшеница", target_names_raw: ["Овсюг", "Щетинник"] }]);
  assert.equal(rowValue(card, "Вредный объект"), "Овсюг, Щетинник");
});
check("different rates retain crop context", () => {
  const card = build([
    { crop_name_raw: "Пшеница", rate_min: 0.5, rate_unit: "l/ha" },
    { crop_name_raw: "Ячмень", rate_min: 0.7, rate_unit: "l/ha" },
  ]);
  assert.match(rowValue(card, "Норма расхода препарата") || "", /Пшеница — 0,5 л\/га/);
  assert.match(rowValue(card, "Норма расхода препарата") || "", /Ячмень — 0,7 л\/га/);
});
check("same rate is collapsed", () => {
  const card = build([
    { crop_name_raw: "Пшеница", rate_min: 0.5, rate_unit: "l/ha" },
    { crop_name_raw: "Ячмень", rate_min: 0.5, rate_unit: "l/ha" },
  ]);
  assert.equal(rowValue(card, "Норма расхода препарата"), "0,5 л/га");
});
check("no-rule notice is exact", () => {
  assert.equal(build([]).usageNotice, "В текущей GLBD нет заполненного регламента применения.");
});
check("technical description is replaced", () => {
  const card = buildHumanPesticideCard({
    product: {
      id: "1",
      trade_name: "Curamin",
      description: "Canonical branch-only QA reference usage_rules dataset",
      pesticide_category: "fungicide",
      is_active: true,
    },
    aliases: [],
    composition: [],
    usageRules: [],
  });
  assert.doesNotMatch(card.description || "", /canonical|usage_rules|dataset/i);
});
check("Phomazin technical description is replaced", () => {
  const card = buildHumanPesticideCard({
    product: {
      id: "2",
      trade_name: "Phomazin",
      description: "Branch-only QA placeholder imported for assistant validation",
      pesticide_category: "fungicide",
      is_active: true,
    },
    aliases: [],
    composition: [],
    usageRules: [],
  });
  assert.doesNotMatch(card.description || "", /branch-only|placeholder|assistant validation/i);
});
check("safety metadata stays in response", () => {
  const card = build([]);
  assert.equal(card.metadata.recommendationAllowed, false);
  assert.deepEqual(card.metadata.missingCriticalFields, ["registration"]);
});
check("primary rows contain no technical flags", () => {
  const serialized = JSON.stringify(build([fullRule]).rows);
  assert.doesNotMatch(serialized, /recommendation_allowed|missing_critical_fields|source_id|uuid/i);
});

const routeSource = readFileSync("app/api/global-admin/pesticide-card/[id]/route.ts", "utf8");
const dialogSource = readFileSync("components/platform/full-pesticide-card-dialog.tsx", "utf8");

check("endpoint requires global admin", () => assert.match(routeSource, /actor\.role !== "global_admin"/));
check("endpoint authenticates the server actor before cached catalog access", () => {
  assert.match(routeSource, /getServerActorFromSession/);
  assert(routeSource.indexOf('actor.role !== "global_admin"') < routeSource.indexOf("getCachedPesticideCard(productId)"));
});
check("endpoint loads only referenced catalog identities", () => {
  assert.match(routeSource, /\.in\("id", componentIds\)/);
  assert.match(routeSource, /\.in\("id", cropIds\)/);
  assert.match(routeSource, /\.eq\("id", product\.manufacturer_id\)/);
});
check("usage rules are queried once", () => {
  assert.equal((routeSource.match(/from\("glbd_product_usage_rules"\)/g) || []).length, 1);
});
check("dialog uses one table", () => assert.equal((dialogSource.match(/<table/g) || []).length, 1));
check("dialog hides technical sections", () => assert.doesNotMatch(dialogSource, /Источники|Регистрация|Готовность для ассистента|UUID/));
check("dialog uses neutral white surface", () => assert.match(dialogSource, /bg-white/));

console.log(`TZ-237 pesticide card contract: ${passed}/${passed} PASS`);
