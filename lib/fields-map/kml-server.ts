import { SaxesParser } from "saxes";
import { validateAreaGeometry } from "@/lib/fields-map/geometry-validation";
import type {
  GeoJsonAreaGeometry,
  GeoJsonLinearRing,
  GeoJsonPosition,
  ParsedKmlPolygonInput,
} from "@/lib/types/fields-map";

type ParseResult = {
  features: ParsedKmlPolygonInput[];
  errors: string[];
};

type ParsedPolygon = {
  outer: GeoJsonLinearRing | null;
  holes: GeoJsonLinearRing[];
};

type ParsedPlacemark = {
  name: string;
  polygons: GeoJsonLinearRing[][];
};

function parseCoordinateSequence(raw: string): {
  positions: GeoJsonPosition[];
  error: string | null;
} {
  const tokens = String(raw || "")
    .trim()
    .split(/\s+/u)
    .map((token) => token.trim())
    .filter(Boolean);
  const positions: GeoJsonPosition[] = [];

  for (const token of tokens) {
    const parts = token.split(",");
    if (parts.length < 2 || parts.length > 3) {
      return {
        positions: [],
        error: "Координата должна иметь формат долгота,широта[,высота].",
      };
    }
    const values = parts.map(Number);
    if (values.some((value) => !Number.isFinite(value))) {
      return {
        positions: [],
        error: "Контур содержит некорректные координаты.",
      };
    }
    positions.push([values[0], values[1]]);
  }

  return { positions, error: null };
}

function placemarkLabel(placemark: ParsedPlacemark | null, index: number): string {
  return placemark?.name || "Поле " + index;
}

export function parseKmlToGeoJson(kmlText: string): ParseResult {
  const result: ParseResult = { features: [], errors: [] };
  const raw = String(kmlText || "").trim();
  if (!raw) {
    result.errors.push("Файл KML пустой.");
    return result;
  }

  const tagStack: string[] = [];
  let currentPlacemark: ParsedPlacemark | null = null;
  let currentPolygon: ParsedPolygon | null = null;
  let currentBoundary: "outer" | "inner" | null = null;
  let textBuffer = "";
  let parseError: string | null = null;
  let sawDoctype = false;
  let placemarkCount = 0;

  const parser = new SaxesParser({ xmlns: true, position: true });
  parser.on("doctype", () => {
    sawDoctype = true;
  });
  parser.on("error", (error) => {
    parseError = error.message;
  });
  parser.on("opentag", (tag) => {
    const local = String(tag.local || tag.name || "").toLowerCase();
    tagStack.push(local);
    textBuffer = "";

    if (local === "placemark") {
      placemarkCount += 1;
      currentPlacemark = { name: "", polygons: [] };
    } else if (local === "polygon" && currentPlacemark) {
      currentPolygon = { outer: null, holes: [] };
    } else if (local === "outerboundaryis" && currentPolygon) {
      currentBoundary = "outer";
    } else if (local === "innerboundaryis" && currentPolygon) {
      currentBoundary = "inner";
    }
  });

  const appendText = (text: string) => {
    const current = tagStack[tagStack.length - 1];
    if (current === "name" || current === "coordinates") {
      textBuffer += text;
    }
  };
  parser.on("text", appendText);
  parser.on("cdata", appendText);

  parser.on("closetag", (tag) => {
    const local = String(tag.local || tag.name || "").toLowerCase();
    const label = placemarkLabel(currentPlacemark, placemarkCount);

    if (
      local === "name" &&
      currentPlacemark &&
      tagStack[tagStack.length - 2] === "placemark"
    ) {
      currentPlacemark.name = textBuffer.trim();
    } else if (local === "coordinates" && currentPolygon && currentBoundary) {
      const parsed = parseCoordinateSequence(textBuffer);
      if (parsed.error) {
        result.errors.push(label + ": " + parsed.error);
      } else if (currentBoundary === "outer") {
        if (currentPolygon.outer) {
          result.errors.push(label + ": внешний контур указан повторно.");
        } else {
          currentPolygon.outer = parsed.positions;
        }
      } else {
        currentPolygon.holes.push(parsed.positions);
      }
    } else if (
      local === "outerboundaryis" ||
      local === "innerboundaryis"
    ) {
      currentBoundary = null;
    } else if (local === "polygon" && currentPlacemark && currentPolygon) {
      if (currentPolygon.outer) {
        currentPlacemark.polygons.push([
          currentPolygon.outer,
          ...currentPolygon.holes,
        ]);
      } else {
        result.errors.push(label + ": отсутствует внешний контур.");
      }
      currentPolygon = null;
      currentBoundary = null;
    } else if (local === "placemark" && currentPlacemark) {
      if (currentPlacemark.polygons.length > 0) {
        const name = currentPlacemark.name.trim() || "Поле " + placemarkCount;
        const geometry: GeoJsonAreaGeometry =
          currentPlacemark.polygons.length === 1
            ? {
                type: "Polygon",
                coordinates: currentPlacemark.polygons[0],
              }
            : {
                type: "MultiPolygon",
                coordinates: currentPlacemark.polygons,
              };
        const validated = validateAreaGeometry(geometry, name);
        if (validated.ok) {
          result.features.push({
            id: "poly-" + (result.features.length + 1),
            name,
            geometry: validated.geometry,
            area_ha: validated.areaHa,
          });
        } else {
          result.errors.push(validated.error);
        }
      }
      currentPlacemark = null;
      currentPolygon = null;
      currentBoundary = null;
    }

    tagStack.pop();
    textBuffer = "";
  });

  try {
    parser.write(raw).close();
  } catch (error) {
    parseError =
      error instanceof Error ? error.message : "Не удалось разобрать KML.";
  }

  if (sawDoctype) {
    return {
      features: [],
      errors: ["DOCTYPE и пользовательские XML-сущности в KML запрещены."],
    };
  }
  if (parseError) {
    return { features: [], errors: ["Некорректный XML в KML-файле."] };
  }
  if (placemarkCount === 0) {
    result.errors.push("В KML не найдено ни одного Placemark.");
  } else if (result.features.length === 0 && result.errors.length === 0) {
    result.errors.push("В KML не найдено валидных полигонов.");
  }

  return result;
}
