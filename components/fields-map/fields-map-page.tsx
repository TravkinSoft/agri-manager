"use client";

import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { Download, Eye, FileUp, Filter, LocateFixed, MapPinned, RotateCcw, Save, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { CROP_COLOR_LEGEND, resolveCropColor } from "@/lib/fields-map/colors";
import { parseKmlToGeoJson } from "@/lib/fields-map/kml";
import {
  confirmFieldMapImport,
  deleteFieldMapImport,
  downloadFieldMapImportKml,
  getFieldsMapBootstrap,
  listFieldMapImports,
  previewFieldMapImport,
  updateFieldMapImportAction,
} from "@/lib/services/fields-map";
import type {
  FieldMapFieldCard,
  FieldMapImportSummary,
  FieldMapPreviewMatch,
  FieldsMapBootstrapPayload,
  GeoJsonGeometry,
  ParsedKmlPolygonInput,
} from "@/lib/types/fields-map";

type PreviewState = {
  importId: string;
  seasonId: string | null;
  fileName: string;
  stats: {
    total_polygons: number;
    matched_polygons: number;
    unmatched_polygons: number;
    error_count: number;
  };
  matches: FieldMapPreviewMatch[];
};

type UploadState = {
  fileName: string;
  kmlText: string;
  polygons: ParsedKmlPolygonInput[];
  errors: string[];
};

type PreviewMapFeature = {
  geometry: GeoJsonGeometry;
  fieldId: string | null;
  label: string;
  areaHa: number | null;
  matchStatus: "matched" | "ambiguous" | "not_found";
};

type OverlayFeatureProperties = {
  overlay_mode: "field" | "preview";
  field_id: string | null;
  field_display_name: string | null;
  crop_name: string | null;
  label: string | null;
  area_ha: number | null;
  match_status: "matched" | "ambiguous" | "not_found" | null;
  fill_color: string;
  line_color: string;
};

type OverlayFeature = {
  type: "Feature";
  geometry: GeoJsonGeometry;
  properties: OverlayFeatureProperties;
};

type OverlayFeatureCollection = {
  type: "FeatureCollection";
  features: OverlayFeature[];
};

type MapLibreModule = typeof import("maplibre-gl");

type BaseLayerMode = "map" | "satellite" | "hybrid";
type FitBoundsReason = "initial_load" | "import_success" | "show_all_fields" | "reset_view" | "field_selected" | "none";
type GeolocationStatus = "idle" | "requesting" | "granted" | "denied" | "unsupported" | "error";

type MapRuntimeDebugState = {
  packageLoaded: boolean;
  containerReady: boolean;
  mapInstanceCreated: boolean;
  loadEventFired: boolean;
  styleLoaded: boolean;
  tilesLoading: boolean;
  mapReady: boolean;
  errorMessage: string | null;
  selectedBaseLayer: BaseLayerMode;
  fitBoundsReason: FitBoundsReason;
  userInteracted: boolean;
  geolocationStatus: GeolocationStatus;
  mapCenter: [number, number];
  mapZoom: number;
};

const DEFAULT_MAP_TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const DEFAULT_SATELLITE_TILE_URL = "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const DEFAULT_HYBRID_LABELS_TILE_URL = "https://a.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}.png";
const MAP_TILE_URL = process.env.NEXT_PUBLIC_MAP_TILE_URL || DEFAULT_MAP_TILE_URL;
const MAP_SATELLITE_TILE_URL = process.env.NEXT_PUBLIC_MAP_SATELLITE_TILE_URL || DEFAULT_SATELLITE_TILE_URL;
const MAP_HYBRID_LABELS_TILE_URL = process.env.NEXT_PUBLIC_MAP_HYBRID_LABELS_TILE_URL || DEFAULT_HYBRID_LABELS_TILE_URL;
const MAP_RASTER_SOURCE_ID = "travkin-base-map-raster";
const MAP_RASTER_LAYER_ID = "travkin-base-map-layer";
const MAP_SATELLITE_SOURCE_ID = "travkin-satellite-raster";
const MAP_SATELLITE_LAYER_ID = "travkin-satellite-layer";
const MAP_HYBRID_LABELS_SOURCE_ID = "travkin-hybrid-labels-raster";
const MAP_HYBRID_LABELS_LAYER_ID = "travkin-hybrid-labels-layer";
const MAP_SOURCE_ID = "travkin-fields-geojson-source";
const MAP_FILL_LAYER_ID = "travkin-fields-fill-layer";
const MAP_LINE_LAYER_ID = "travkin-fields-line-layer";
const DEFAULT_MAP_CENTER: [number, number] = [69.2, 54.9];
const DEFAULT_MAP_ZOOM = 6.2;

function isTileTemplateValid(url: string): boolean {
  return url.includes("{z}") && url.includes("{x}") && url.includes("{y}");
}

function applyBaseLayerVisibility(map: any, layer: BaseLayerMode) {
  const setVisibility = (layerId: string, visible: boolean) => {
    if (map.getLayer(layerId)) {
      map.setLayoutProperty(layerId, "visibility", visible ? "visible" : "none");
    }
  };
  setVisibility(MAP_RASTER_LAYER_ID, layer === "map");
  setVisibility(MAP_SATELLITE_LAYER_ID, layer === "satellite" || layer === "hybrid");
  setVisibility(MAP_HYBRID_LABELS_LAYER_ID, layer === "hybrid");
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function formatHa(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "-";
  return `${value.toLocaleString("ru-RU", { maximumFractionDigits: 2 })} га`;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return format(date, "dd.MM.yyyy HH:mm");
}

function includeByCrop(cropName: string | null | undefined, selected: string): boolean {
  if (selected === "all") return true;
  return String(cropName || "").trim() === selected;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function toNullableString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized ? normalized : null;
}

function toNullableNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function buildPopupHtml(feature: OverlayFeatureProperties, field: FieldMapFieldCard | null): string {
  if (feature.overlay_mode === "preview") {
    const statusLabel =
      feature.match_status === "matched"
        ? "сопоставлено"
        : feature.match_status === "ambiguous"
          ? "несколько совпадений"
          : "не сопоставлено";
    return `
      <div style="font-size:12px;line-height:1.4;padding:4px 2px;min-width:180px;">
        <div style="font-weight:600;">${escapeHtml(feature.label || "Полигон")}</div>
        <div>Площадь: ${escapeHtml(formatHa(feature.area_ha))}</div>
        <div>Статус: ${escapeHtml(statusLabel)}</div>
      </div>
    `;
  }

  const displayName = field?.field_display_name || feature.field_display_name || "—";
  const crop = field?.crop_plan?.crop_name || feature.crop_name || "Нет культуры";

  return `
    <div style="font-size:12px;line-height:1.4;padding:4px 2px;min-width:180px;">
      <div style="font-weight:600;">Поле ${escapeHtml(displayName)}</div>
      <div>Площадь: ${escapeHtml(formatHa(field?.field_area_ha ?? feature.area_ha))}</div>
      <div>Культура: ${escapeHtml(crop)}</div>
    </div>
  `;
}

function visitGeometryCoordinates(
  geometry: GeoJsonGeometry,
  visitor: (longitude: number, latitude: number) => void
) {
  const visitNode = (node: unknown) => {
    if (!Array.isArray(node)) return;
    if (node.length >= 2 && typeof node[0] === "number" && typeof node[1] === "number") {
      visitor(node[0], node[1]);
      return;
    }
    node.forEach(visitNode);
  };
  visitNode(geometry.coordinates);
}

function ensureOverlayLayers(map: any): boolean {
  if (!map || typeof map.getStyle !== "function" || !map.getStyle()) return false;

  if (!map.getSource(MAP_SOURCE_ID)) {
    map.addSource(MAP_SOURCE_ID, {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
  }

  if (!map.getLayer(MAP_FILL_LAYER_ID)) {
    map.addLayer({
      id: MAP_FILL_LAYER_ID,
      type: "fill",
      source: MAP_SOURCE_ID,
      paint: {
        "fill-color": ["coalesce", ["get", "fill_color"], "#3b82f6"],
        "fill-opacity": [
          "case",
          ["==", ["get", "overlay_mode"], "preview"],
          0.32,
          0.5,
        ],
      },
    });
  }

  if (!map.getLayer(MAP_LINE_LAYER_ID)) {
    map.addLayer({
      id: MAP_LINE_LAYER_ID,
      type: "line",
      source: MAP_SOURCE_ID,
      paint: {
        "line-color": ["coalesce", ["get", "line_color"], "#3b82f6"],
        "line-width": [
          "case",
          ["==", ["get", "overlay_mode"], "preview"],
          2.1,
          1.8,
        ],
        "line-opacity": 0.95,
      },
    });
  }

  return Boolean(map.getSource(MAP_SOURCE_ID) && map.getLayer(MAP_FILL_LAYER_ID) && map.getLayer(MAP_LINE_LAYER_ID));
}

export function FieldsMapPage() {
  const { toast } = useToast();
  const router = useRouter();

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const [mapContainerNode, setMapContainerNode] = useState<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const maplibreRef = useRef<MapLibreModule | null>(null);
  const geoMarkerRef = useRef<any>(null);
  const popupRef = useRef<any>(null);
  const fieldLookupRef = useRef<Map<string, FieldMapFieldCard>>(new Map());
  const fitRequestReasonRef = useRef<FitBoundsReason | null>("initial_load");
  const userInteractedRef = useRef(false);
  const selectedBaseLayerRef = useRef<BaseLayerMode>("satellite");
  const bindMapContainerRef = useCallback((node: HTMLDivElement | null) => {
    mapContainerRef.current = node;
    setMapContainerNode(node);
  }, []);

  const [loading, setLoading] = useState(true);
  const [bootstrap, setBootstrap] = useState<FieldsMapBootstrapPayload | null>(null);
  const [imports, setImports] = useState<FieldMapImportSummary[]>([]);
  const [selectedSeasonId, setSelectedSeasonId] = useState<string>("");
  const [selectedCrop, setSelectedCrop] = useState<string>("all");
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null);

  const [uploadState, setUploadState] = useState<UploadState | null>(null);
  const [previewState, setPreviewState] = useState<PreviewState | null>(null);
  const [overrides, setOverrides] = useState<Record<string, string>>({});

  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [historyBusyId, setHistoryBusyId] = useState<string | null>(null);
  const [selectedBaseLayer, setSelectedBaseLayer] = useState<BaseLayerMode>("satellite");
  const [geolocationStatus, setGeolocationStatus] = useState<GeolocationStatus>("idle");
  const [fitRequestNonce, setFitRequestNonce] = useState(0);
  const [mapDebug, setMapDebug] = useState<MapRuntimeDebugState>({
    packageLoaded: false,
    containerReady: false,
    mapInstanceCreated: false,
    loadEventFired: false,
    styleLoaded: false,
    tilesLoading: false,
    mapReady: false,
    errorMessage: null,
    selectedBaseLayer: "satellite",
    fitBoundsReason: "initial_load",
    userInteracted: false,
    geolocationStatus: "idle",
    mapCenter: DEFAULT_MAP_CENTER,
    mapZoom: DEFAULT_MAP_ZOOM,
  });

  const fields = bootstrap?.fields || [];

  const cropOptions = useMemo(() => {
    const set = new Set<string>();
    fields.forEach((field) => {
      const name = String(field.crop_plan?.crop_name || "").trim();
      if (name) set.add(name);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, "ru"));
  }, [fields]);

  const filteredFields = useMemo(
    () => fields.filter((field) => includeByCrop(field.crop_plan?.crop_name, selectedCrop)),
    [fields, selectedCrop]
  );

  const mappedFields = useMemo(() => filteredFields.filter((field) => !!field.geometry), [filteredFields]);

  const selectedField = useMemo(
    () => (selectedFieldId ? fields.find((field) => field.field_id === selectedFieldId) || null : null),
    [fields, selectedFieldId]
  );

  const unresolvedRows = useMemo(
    () => (previewState?.matches || []).filter((row) => row.match_status !== "matched"),
    [previewState]
  );

  const previewMapFeatures = useMemo<PreviewMapFeature[]>(() => {
    if (previewState) {
      return previewState.matches.map((row) => ({
        geometry: row.geometry,
        fieldId: row.field_id || null,
        label: row.polygon_name,
        areaHa: row.area_ha,
        matchStatus: row.match_status,
      }));
    }

    if (uploadState) {
      return uploadState.polygons.map((row) => ({
        geometry: row.geometry,
        fieldId: null,
        label: row.name,
        areaHa: row.area_ha,
        matchStatus: "not_found",
      }));
    }

    return [];
  }, [previewState, uploadState]);

  const mapCollection = useMemo<OverlayFeatureCollection>(() => {
    if (previewMapFeatures.length > 0) {
      return {
        type: "FeatureCollection",
        features: previewMapFeatures.map((row) => {
          const color = row.matchStatus === "matched" ? "#22c55e" : row.matchStatus === "ambiguous" ? "#eab308" : "#ef4444";
          return {
            type: "Feature",
            geometry: row.geometry,
            properties: {
              overlay_mode: "preview",
              field_id: row.fieldId,
              field_display_name: null,
              crop_name: null,
              label: row.label,
              area_ha: row.areaHa,
              match_status: row.matchStatus,
              fill_color: color,
              line_color: color,
            },
          };
        }),
      };
    }

    return {
      type: "FeatureCollection",
      features: mappedFields
        .filter((field): field is FieldMapFieldCard & { geometry: GeoJsonGeometry } => !!field.geometry)
        .map((field) => {
          const color = resolveCropColor(field.crop_plan?.crop_name || "");
          return {
            type: "Feature",
            geometry: field.geometry,
            properties: {
              overlay_mode: "field",
              field_id: field.field_id,
              field_display_name: field.field_display_name,
              crop_name: field.crop_plan?.crop_name || null,
              label: field.field_display_name,
              area_ha: field.field_area_ha,
              match_status: null,
              fill_color: color,
              line_color: color,
            },
          };
        }),
    };
  }, [mappedFields, previewMapFeatures]);

  const requestFitByReason = useCallback((reason: FitBoundsReason) => {
    fitRequestReasonRef.current = reason;
    setMapDebug((prev) => ({ ...prev, fitBoundsReason: reason }));
    setFitRequestNonce((prev) => prev + 1);
  }, []);

  const updateViewportDebug = useCallback((map: any) => {
    const center = map.getCenter?.();
    const zoom = map.getZoom?.();
    if (!center || typeof zoom !== "number") return;
    setMapDebug((prev) => ({
      ...prev,
      mapCenter: [Number(center.lng.toFixed(6)), Number(center.lat.toFixed(6))],
      mapZoom: Number(zoom.toFixed(2)),
    }));
  }, []);

  const fitMapForReason = useCallback(
    (map: any, maplibre: MapLibreModule, reason: FitBoundsReason) => {
      if (reason === "field_selected" && (!selectedField || !selectedField.geometry)) {
        setMapDebug((prev) => ({ ...prev, fitBoundsReason: reason }));
        return;
      }
      const selectedGeometryFeatures =
        reason === "field_selected" && selectedField?.geometry
          ? [
              {
                type: "Feature" as const,
                geometry: selectedField.geometry,
                properties: {},
              },
            ]
          : mapCollection.features;
      const featureList = selectedGeometryFeatures || [];

      if (!featureList.length) {
        map.easeTo({ center: DEFAULT_MAP_CENTER, zoom: DEFAULT_MAP_ZOOM, duration: 500 });
        setMapDebug((prev) => ({ ...prev, fitBoundsReason: reason }));
        updateViewportDebug(map);
        return;
      }

      const bounds = new maplibre.LngLatBounds();
      let hasCoordinates = false;

      featureList.forEach((feature) => {
        visitGeometryCoordinates(feature.geometry, (lng, lat) => {
          bounds.extend([lng, lat]);
          hasCoordinates = true;
        });
      });

      if (hasCoordinates) {
        map.fitBounds(bounds, { padding: 44, duration: 650, maxZoom: 15 });
      } else {
        map.easeTo({ center: DEFAULT_MAP_CENTER, zoom: DEFAULT_MAP_ZOOM, duration: 500 });
      }
      setMapDebug((prev) => ({ ...prev, fitBoundsReason: reason }));
      updateViewportDebug(map);
    },
    [mapCollection.features, selectedField, updateViewportDebug]
  );

  const loadBootstrap = async (seasonId?: string) => {
    const payload = await getFieldsMapBootstrap(seasonId);
    setBootstrap(payload);
    if (payload.selected_season_id) {
      setSelectedSeasonId(payload.selected_season_id);
    }
  };

  const loadImports = async () => {
    const rows = await listFieldMapImports();
    setImports(rows);
  };

  const refreshAll = async (seasonId?: string) => {
    setLoading(true);
    try {
      await Promise.all([loadBootstrap(seasonId), loadImports()]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refreshAll();
  }, []);

  useEffect(() => {
    fieldLookupRef.current = new Map(fields.map((field) => [field.field_id, field]));
  }, [fields]);

  useEffect(() => {
    if (loading) return;

    let cancelled = false;
    let readyResolved = false;
    let readyTimer: number | null = null;
    const container = mapContainerNode || mapContainerRef.current;
    const containerReady = !!container;
    setMapDebug((prev) => ({ ...prev, containerReady }));
    if (mapRef.current || !container) return;
    setMapReady(false);
    setMapError(null);
    setMapDebug((prev) => ({
      ...prev,
      mapInstanceCreated: false,
      loadEventFired: false,
      styleLoaded: false,
      tilesLoading: false,
      mapReady: false,
      errorMessage: null,
    }));

    const initializeMap = async () => {
      try {
        const invalidTiles = [MAP_TILE_URL, MAP_SATELLITE_TILE_URL, MAP_HYBRID_LABELS_TILE_URL].find(
          (tileUrl) => !isTileTemplateValid(tileUrl)
        );
        if (invalidTiles) {
          const message = `Invalid tile URL: ${invalidTiles}. Expected placeholders {z}/{x}/{y}.`;
          setMapError(message);
          setMapDebug((prev) => ({ ...prev, errorMessage: message }));
          return;
        }

        const maplibre = await import("maplibre-gl");
        if (cancelled || !container || mapRef.current) return;
        setMapDebug((prev) => ({ ...prev, packageLoaded: true }));

        const isSupported =
          typeof (maplibre as any).supported === "function" ? (maplibre as any).supported() : true;
        if (!isSupported) {
          const message = "MapLibre is not supported in this browser (WebGL required).";
          setMapError(message);
          setMapDebug((prev) => ({ ...prev, errorMessage: message }));
          return;
        }

        maplibreRef.current = maplibre;

        const map = new maplibre.Map({
          container,
          style: {
            version: 8,
            sources: {
              [MAP_RASTER_SOURCE_ID]: {
                type: "raster",
                tiles: [MAP_TILE_URL],
                tileSize: 256,
                attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
              },
              [MAP_SATELLITE_SOURCE_ID]: {
                type: "raster",
                tiles: [MAP_SATELLITE_TILE_URL],
                tileSize: 256,
                attribution:
                  "Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community",
              },
              [MAP_HYBRID_LABELS_SOURCE_ID]: {
                type: "raster",
                tiles: [MAP_HYBRID_LABELS_TILE_URL],
                tileSize: 256,
                attribution:
                  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; CARTO',
              },
            },
            layers: [
              {
                id: MAP_RASTER_LAYER_ID,
                type: "raster",
                source: MAP_RASTER_SOURCE_ID,
                layout: { visibility: selectedBaseLayer === "map" ? "visible" : "none" },
              },
              {
                id: MAP_SATELLITE_LAYER_ID,
                type: "raster",
                source: MAP_SATELLITE_SOURCE_ID,
                layout: { visibility: selectedBaseLayer === "map" ? "none" : "visible" },
              },
              {
                id: MAP_HYBRID_LABELS_LAYER_ID,
                type: "raster",
                source: MAP_HYBRID_LABELS_SOURCE_ID,
                layout: { visibility: selectedBaseLayer === "hybrid" ? "visible" : "none" },
              },
            ],
          },
          center: DEFAULT_MAP_CENTER,
          zoom: DEFAULT_MAP_ZOOM,
          attributionControl: { compact: true },
          dragPan: true,
          scrollZoom: true,
          doubleClickZoom: true,
          touchZoomRotate: true,
          keyboard: true,
        });

        mapRef.current = map;
        setMapDebug((prev) => ({ ...prev, mapInstanceCreated: true, tilesLoading: true }));
        popupRef.current = new maplibre.Popup({
          closeButton: false,
          closeOnClick: false,
          maxWidth: "280px",
          offset: 12,
        });

        map.addControl(new maplibre.NavigationControl({ showCompass: false }), "top-right");
        applyBaseLayerVisibility(map, selectedBaseLayer);

        const setRuntimeError = (message: string) => {
          setMapReady(false);
          setMapError(message);
          setMapDebug((prev) => ({
            ...prev,
            mapReady: false,
            tilesLoading: false,
            errorMessage: message,
          }));
        };

        const resolveReady = (strategy: "load" | "styledata" | "style-check") => {
          if (cancelled || readyResolved) return;
          try {
            ensureOverlayLayers(map);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            setRuntimeError(`Map overlay init error (${strategy}): ${message}`);
            return;
          }
          readyResolved = true;
          if (readyTimer != null) {
            window.clearTimeout(readyTimer);
            readyTimer = null;
          }
          map.resize();
          setMapReady(true);
          setMapError(null);
          setMapDebug((prev) => ({
            ...prev,
            mapReady: true,
            styleLoaded: true,
            tilesLoading: false,
            errorMessage: null,
          }));
          updateViewportDebug(map);
        };

        map.on("load", () => {
          setMapDebug((prev) => ({ ...prev, loadEventFired: true, styleLoaded: true }));
          resolveReady("load");
        });
        map.on("styledata", () => {
          const styleLoaded = typeof map.isStyleLoaded === "function" ? Boolean(map.isStyleLoaded()) : true;
          setMapDebug((prev) => ({ ...prev, styleLoaded }));
          if (styleLoaded) {
            resolveReady("styledata");
          }
        });
        map.on("dataloading", () => {
          setMapDebug((prev) => ({ ...prev, tilesLoading: true }));
        });
        map.on("idle", () => {
          setMapDebug((prev) => ({ ...prev, tilesLoading: false }));
        });
        map.on("dragstart", () => {
          userInteractedRef.current = true;
          setMapDebug((prev) => ({ ...prev, userInteracted: true }));
        });
        map.on("zoomstart", () => {
          userInteractedRef.current = true;
          setMapDebug((prev) => ({ ...prev, userInteracted: true }));
        });
        map.on("moveend", () => {
          updateViewportDebug(map);
        });
        map.on("zoomend", () => {
          updateViewportDebug(map);
        });

        const styleLoadedImmediately =
          typeof map.isStyleLoaded === "function" ? Boolean(map.isStyleLoaded()) : false;
        if (styleLoadedImmediately) {
          setMapDebug((prev) => ({ ...prev, styleLoaded: true }));
          resolveReady("style-check");
        }

        readyTimer = window.setTimeout(() => {
          if (readyResolved || cancelled) return;
          setRuntimeError(
            `Map initialization timeout: style/load event not received. Check tiles/CORS. URL: ${MAP_TILE_URL}`
          );
        }, 7000);

        map.on("error", (event: any) => {
          if (cancelled) return;
          const rawMessage =
            event?.error instanceof Error
              ? event.error.message
              : typeof event?.error === "string"
                ? event.error
                : "Unknown map runtime error.";
          const activeLayer = selectedBaseLayerRef.current;
          const sourceId = typeof event?.sourceId === "string" ? event.sourceId : null;
          const message = sourceId
            ? `${rawMessage} (source: ${sourceId}, layer: ${activeLayer})`
            : `${rawMessage} (layer: ${activeLayer})`;
          setRuntimeError(message);
        });

        map.on("mousemove", (event: any) => {
          if (!map.getLayer(MAP_FILL_LAYER_ID)) return;
          const features = map.queryRenderedFeatures(event.point, {
            layers: [MAP_FILL_LAYER_ID],
          });
          const feature = features[0];
          if (!feature) {
            map.getCanvas().style.cursor = "";
            popupRef.current?.remove();
            return;
          }

          map.getCanvas().style.cursor = "pointer";
          const properties = (feature.properties || {}) as Record<string, unknown>;
          const parsedProperties: OverlayFeatureProperties = {
            overlay_mode: toNullableString(properties.overlay_mode) === "preview" ? "preview" : "field",
            field_id: toNullableString(properties.field_id),
            field_display_name: toNullableString(properties.field_display_name),
            crop_name: toNullableString(properties.crop_name),
            label: toNullableString(properties.label),
            area_ha: toNullableNumber(properties.area_ha),
            match_status:
              toNullableString(properties.match_status) === "matched"
                ? "matched"
                : toNullableString(properties.match_status) === "ambiguous"
                  ? "ambiguous"
                  : toNullableString(properties.match_status) === "not_found"
                    ? "not_found"
                    : null,
            fill_color: toNullableString(properties.fill_color) || "#3b82f6",
            line_color: toNullableString(properties.line_color) || "#3b82f6",
          };
          const relatedField = parsedProperties.field_id ? fieldLookupRef.current.get(parsedProperties.field_id) || null : null;

          const html = buildPopupHtml(parsedProperties, relatedField);
          popupRef.current?.setLngLat(event.lngLat).setHTML(html).addTo(map);
        });

        map.on("mouseout", () => {
          map.getCanvas().style.cursor = "";
          popupRef.current?.remove();
        });

        map.on("click", (event: any) => {
          if (!map.getLayer(MAP_FILL_LAYER_ID)) return;
          const features = map.queryRenderedFeatures(event.point, {
            layers: [MAP_FILL_LAYER_ID],
          });
          const fieldId = toNullableString(features[0]?.properties?.field_id);
          if (fieldId) {
            handleSelectField(fieldId);
          }
        });
      } catch (error) {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : "Failed to initialize MapLibre.";
        setMapReady(false);
        setMapError(message);
        setMapDebug((prev) => ({ ...prev, mapReady: false, tilesLoading: false, errorMessage: message }));
      }
    };

    void initializeMap();

    return () => {
      cancelled = true;
      if (readyTimer != null) {
        window.clearTimeout(readyTimer);
      }
      popupRef.current?.remove();
      popupRef.current = null;
      geoMarkerRef.current?.remove?.();
      geoMarkerRef.current = null;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
      setMapReady(false);
      setMapDebug((prev) => ({ ...prev, mapReady: false, tilesLoading: false }));
    };
  }, [loading, mapContainerNode]);

  useEffect(() => {
    setMapDebug((prev) => ({
      ...prev,
      containerReady: !!mapContainerNode,
      mapReady,
      errorMessage: mapError,
      geolocationStatus,
      selectedBaseLayer,
    }));
  }, [loading, mapContainerNode, mapReady, mapError, geolocationStatus, selectedBaseLayer]);

  useEffect(() => {
    selectedBaseLayerRef.current = selectedBaseLayer;
  }, [selectedBaseLayer]);

  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    applyBaseLayerVisibility(mapRef.current, selectedBaseLayer);
    setMapDebug((prev) => ({ ...prev, selectedBaseLayer }));
  }, [mapReady, selectedBaseLayer]);

  useEffect(() => {
    if (!mapReady || !mapRef.current || !maplibreRef.current) return;

    const map = mapRef.current;
    const source = map.getSource(MAP_SOURCE_ID) as { setData: (data: OverlayFeatureCollection) => void } | undefined;
    if (!source) return;

    source.setData(mapCollection);

    const fitReason = fitRequestReasonRef.current;
    if (!fitReason || fitReason === "none") {
      return;
    }
    const maplibre = maplibreRef.current;
    fitMapForReason(map, maplibre, fitReason);
    fitRequestReasonRef.current = null;
  }, [fitMapForReason, fitRequestNonce, mapCollection, mapReady]);

  const handleSelectField = useCallback(
    (fieldId: string) => {
      setSelectedFieldId(fieldId);
      requestFitByReason("field_selected");
    },
    [requestFitByReason]
  );

  const handleShowAllFields = useCallback(() => {
    requestFitByReason("show_all_fields");
  }, [requestFitByReason]);

  const handleResetMapView = useCallback(() => {
    userInteractedRef.current = false;
    setMapDebug((prev) => ({ ...prev, userInteracted: false }));
    requestFitByReason("reset_view");
  }, [requestFitByReason]);

  const handleLocateMe = useCallback(() => {
    if (!mapReady || !mapRef.current || !maplibreRef.current) {
      toast({ title: "Карта ещё не готова", description: "Подождите и попробуйте снова.", variant: "destructive" });
      return;
    }
    if (!navigator.geolocation) {
      setGeolocationStatus("unsupported");
      setMapDebug((prev) => ({ ...prev, geolocationStatus: "unsupported" }));
      toast({ title: "Геолокация недоступна", description: "Браузер не поддерживает geolocation.", variant: "destructive" });
      return;
    }

    setGeolocationStatus("requesting");
    setMapDebug((prev) => ({ ...prev, geolocationStatus: "requesting" }));
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const map = mapRef.current;
        const maplibre = maplibreRef.current;
        if (!map || !maplibre) return;
        const lngLat: [number, number] = [position.coords.longitude, position.coords.latitude];

        geoMarkerRef.current?.remove?.();
        geoMarkerRef.current = new maplibre.Marker({ color: "#22c55e" }).setLngLat(lngLat).addTo(map);
        map.easeTo({ center: lngLat, zoom: Math.max(13, map.getZoom()), duration: 700 });
        setGeolocationStatus("granted");
        setMapDebug((prev) => ({
          ...prev,
          geolocationStatus: "granted",
          mapCenter: [Number(lngLat[0].toFixed(6)), Number(lngLat[1].toFixed(6))],
          mapZoom: Number(Math.max(13, map.getZoom()).toFixed(2)),
        }));
      },
      (error) => {
        let status: GeolocationStatus = "error";
        let message = "Не удалось получить местоположение.";
        if (error.code === error.PERMISSION_DENIED) {
          status = "denied";
          message = "Доступ к местоположению не разрешён.";
        } else if (error.code === error.TIMEOUT) {
          message = "Превышено время ожидания геолокации.";
        } else if (error.code === error.POSITION_UNAVAILABLE) {
          message = "Местоположение сейчас недоступно.";
        }
        setGeolocationStatus(status);
        setMapDebug((prev) => ({ ...prev, geolocationStatus: status }));
        toast({ title: "Геолокация", description: message, variant: "destructive" });
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
    );
  }, [mapReady, toast]);

  const handleSeasonChange = async (seasonId: string) => {
    setSelectedSeasonId(seasonId);
    await refreshAll(seasonId);
    requestFitByReason("show_all_fields");
  };

  const handleKmlSelect = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".kml")) {
      toast({ title: "Ошибка", description: "Разрешены только .kml файлы", variant: "destructive" });
      return;
    }

    try {
      const kmlText = await file.text();
      const parsed = parseKmlToGeoJson(kmlText);
      if (!parsed.features.length) {
        toast({ title: "Ошибка", description: parsed.errors[0] || "Полигонов не найдено", variant: "destructive" });
        return;
      }
      setUploadState({
        fileName: file.name,
        kmlText,
        polygons: parsed.features,
        errors: parsed.errors,
      });
      setPreviewState(null);
      setOverrides({});
      toast({
        title: "KML загружен",
        description: `Найдено полигонов: ${parsed.features.length}. Нажмите "Проверить совпадения полей".`,
      });
    } catch (error) {
      toast({
        title: "Ошибка",
        description: error instanceof Error ? error.message : "Не удалось прочитать файл",
        variant: "destructive",
      });
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const runPreview = async () => {
    if (!uploadState) return;
    setBusy(true);
    try {
      const preview = await previewFieldMapImport({
        fileName: uploadState.fileName,
        kmlText: uploadState.kmlText,
        seasonId: selectedSeasonId || null,
        polygons: uploadState.polygons,
      });
      setPreviewState({
        importId: preview.import_id,
        seasonId: preview.season_id,
        fileName: preview.file_name,
        stats: preview.stats,
        matches: preview.matches,
      });
      setOverrides({});
      toast({
        title: "Preview готов",
        description: `Совпадений: ${preview.stats.matched_polygons}, несопоставленных: ${preview.stats.unmatched_polygons}.`,
      });
      await loadImports();
    } catch (error) {
      toast({
        title: "Ошибка preview",
        description: error instanceof Error ? error.message : "Не удалось выполнить preview",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  const confirmImport = async () => {
    if (!previewState) return;
    setBusy(true);
    try {
      const overridesPayload = Object.entries(overrides)
        .filter(([, fieldId]) => !!fieldId)
        .map(([polygonId, fieldId]) => ({ polygon_id: polygonId, field_id: fieldId }));

      const result = await confirmFieldMapImport({
        import_id: previewState.importId,
        overrides: overridesPayload,
      });
      toast({
        title: "Импорт завершён",
        description: `Сохранено полигонов: ${result.saved_polygons}, пропущено: ${result.skipped_polygons}.`,
      });
      setPreviewState(null);
      setUploadState(null);
      setOverrides({});
      await refreshAll(selectedSeasonId || undefined);
      requestFitByReason("import_success");
    } catch (error) {
      toast({
        title: "Ошибка импорта",
        description: error instanceof Error ? error.message : "Не удалось подтвердить импорт",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  const cancelImport = () => {
    setUploadState(null);
    setPreviewState(null);
    setOverrides({});
  };

  const handleHistoryAction = async (importId: string, action: "activate" | "deactivate" | "delete") => {
    setHistoryBusyId(importId);
    try {
      await updateFieldMapImportAction(importId, action);
      await refreshAll(selectedSeasonId || undefined);
      toast({ title: "Готово", description: `Импорт: ${action}` });
    } catch (error) {
      toast({
        title: "Ошибка",
        description: error instanceof Error ? error.message : "Не удалось выполнить действие",
        variant: "destructive",
      });
    } finally {
      setHistoryBusyId(null);
    }
  };

  const handleDeleteImport = async (importId: string) => {
    setHistoryBusyId(importId);
    try {
      await deleteFieldMapImport(importId);
      await refreshAll(selectedSeasonId || undefined);
      toast({ title: "Удалено", description: "Импорт архивирован." });
    } catch (error) {
      toast({
        title: "Ошибка",
        description: error instanceof Error ? error.message : "Не удалось удалить импорт",
        variant: "destructive",
      });
    } finally {
      setHistoryBusyId(null);
    }
  };

  const handleDownloadImport = async (importId: string) => {
    setHistoryBusyId(importId);
    try {
      const { blob, fileName } = await downloadFieldMapImportKml(importId);
      downloadBlob(blob, fileName);
    } catch (error) {
      toast({
        title: "Ошибка",
        description: error instanceof Error ? error.message : "Не удалось скачать KML",
        variant: "destructive",
      });
    } finally {
      setHistoryBusyId(null);
    }
  };

  if (loading) {
    return <PageHeader title="Карта полей" description="Загрузка..." />;
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Карта полей"
        description="MapLibre + KML импорт + цвета полей по культуре сезона"
        action={{
          label: "Загрузить KML",
          icon: FileUp,
          onClick: () => fileInputRef.current?.click(),
        }}
      />

      <input ref={fileInputRef} type="file" accept=".kml" className="hidden" onChange={handleKmlSelect} />

      {mapError ? (
        <Card className="border-rose-500/40">
          <CardContent className="space-y-2 pt-6 text-sm text-rose-200">
            <div>{mapError}</div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardContent className="flex flex-wrap items-center gap-2 pt-5">
          <div className="w-[180px]">
            <Label className="mb-1 block text-xs">Сезон</Label>
            <Select value={selectedSeasonId || ""} onValueChange={(value) => void handleSeasonChange(value)}>
              <SelectTrigger>
                <SelectValue placeholder="Выберите сезон" />
              </SelectTrigger>
              <SelectContent>
                {(bootstrap?.seasons || []).map((season) => (
                  <SelectItem key={season.id} value={season.id}>
                    {season.year}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="w-[260px]">
            <Label className="mb-1 block text-xs">Культура</Label>
            <Select value={selectedCrop} onValueChange={setSelectedCrop}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Все культуры</SelectItem>
                {cropOptions.map((crop) => (
                  <SelectItem key={crop} value={crop}>
                    {crop}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="ml-auto flex items-end gap-2">
            <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
              <FileUp className="mr-2 h-4 w-4" />
              Загрузить KML
            </Button>
            <Button variant="outline" disabled={!uploadState || busy} onClick={() => void runPreview()}>
              <Eye className="mr-2 h-4 w-4" />
              Проверить совпадения
            </Button>
            <Button disabled={!previewState || busy} onClick={() => void confirmImport()}>
              <Save className="mr-2 h-4 w-4" />
              Подтвердить импорт
            </Button>
            <Button variant="ghost" disabled={!uploadState || busy} onClick={cancelImport}>
              <RotateCcw className="mr-2 h-4 w-4" />
              Отменить импорт
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[340px_1fr]">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Поля ({filteredFields.length})</CardTitle>
          </CardHeader>
          <CardContent className="travkin-scrollbar max-h-[700px] space-y-2 overflow-y-auto">
            {filteredFields.map((field) => {
              const isSelected = selectedFieldId === field.field_id;
              return (
                <button
                  key={field.field_id}
                  type="button"
                  onClick={() => handleSelectField(field.field_id)}
                  className={`w-full rounded-lg border p-3 text-left transition ${
                    isSelected ? "border-[#E0B100] bg-[#202738]" : "border-[#2B3448] bg-[#151C28] hover:bg-[#202738]"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-medium text-slate-100">Поле {field.field_display_name}</div>
                    {field.geometry ? (
                      <Badge className="bg-emerald-600 text-white">На карте</Badge>
                    ) : (
                      <Badge variant="outline">Без геометрии</Badge>
                    )}
                  </div>
                  <div className="mt-1 text-xs text-slate-400">
                    {formatHa(field.field_area_ha)} · {field.crop_plan?.crop_name || "Культура не задана"}
                  </div>
                </button>
              );
            })}
            {filteredFields.length === 0 ? <div className="text-sm text-slate-400">Поля по фильтру не найдены.</div> : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Карта</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[#2B3448] bg-[#151C28] p-2">
              <div className="text-xs text-slate-400">Вид:</div>
              <Button size="sm" variant={selectedBaseLayer === "map" ? "default" : "outline"} onClick={() => setSelectedBaseLayer("map")}>
                Карта
              </Button>
              <Button
                size="sm"
                variant={selectedBaseLayer === "satellite" ? "default" : "outline"}
                onClick={() => setSelectedBaseLayer("satellite")}
              >
                Спутник
              </Button>
              <Button
                size="sm"
                variant={selectedBaseLayer === "hybrid" ? "default" : "outline"}
                onClick={() => setSelectedBaseLayer("hybrid")}
              >
                Гибрид
              </Button>
              <div className="ml-auto flex flex-wrap items-center gap-2">
                <Button size="sm" variant="outline" onClick={handleLocateMe}>
                  <LocateFixed className="mr-2 h-4 w-4" />
                  Моё местоположение
                </Button>
                <Button size="sm" variant="outline" onClick={handleShowAllFields}>
                  Показать все поля
                </Button>
                <Button size="sm" variant="outline" onClick={handleResetMapView}>
                  Сбросить вид
                </Button>
              </div>
            </div>

            <div
              ref={bindMapContainerRef}
              className="h-[620px] w-full overflow-hidden rounded-xl border border-[#2B3448] bg-[#151C28]"
            />

            {!mapReady ? (
              <div className="rounded-xl border border-dashed border-[#2B3448] p-3 text-sm text-slate-400">Инициализация MapLibre…</div>
            ) : null}

            <div className="rounded-xl border border-[#2B3448] bg-[#151C28] p-3 text-xs text-slate-300">
              <div>maplibre package loaded: {mapDebug.packageLoaded ? "yes" : "no"}</div>
              <div>container ready: {mapDebug.containerReady ? "yes" : "no"}</div>
              <div>map instance created: {mapDebug.mapInstanceCreated ? "yes" : "no"}</div>
              <div>style loaded: {mapDebug.styleLoaded ? "yes" : "no"}</div>
              <div>load event fired: {mapDebug.loadEventFired ? "yes" : "no"}</div>
              <div>tiles loading: {mapDebug.tilesLoading ? "yes" : "no"}</div>
              <div>map ready: {mapDebug.mapReady ? "yes" : "no"}</div>
              <div>selected base layer: {mapDebug.selectedBaseLayer}</div>
              <div>fitBounds reason: {mapDebug.fitBoundsReason}</div>
              <div>user interacted: {mapDebug.userInteracted ? "yes" : "no"}</div>
              <div>geolocation status: {mapDebug.geolocationStatus}</div>
              <div>
                map center/zoom: {mapDebug.mapCenter[0].toFixed(5)}, {mapDebug.mapCenter[1].toFixed(5)} / {mapDebug.mapZoom}
              </div>
              <div>error message: {mapDebug.errorMessage || "—"}</div>
            </div>

            <div className="flex flex-wrap gap-2">
              {CROP_COLOR_LEGEND.map((item) => (
                <div key={item.key} className="flex items-center gap-2 rounded-md border border-[#2B3448] px-2 py-1 text-xs text-slate-300">
                  <span className="inline-block h-3 w-3 rounded-full" style={{ backgroundColor: item.color }} />
                  {item.label}
                </div>
              ))}
            </div>

            {selectedField ? (
              <div className="rounded-xl border border-[#2B3448] bg-[#151C28] p-3">
                <div className="mb-2 flex items-center justify-between">
                  <div className="text-sm font-semibold text-slate-100">Поле {selectedField.field_display_name}</div>
                  <Button size="sm" variant="outline" onClick={() => router.push(`/fields/${selectedField.field_id}`)}>
                    <MapPinned className="mr-2 h-4 w-4" />
                    Открыть карточку поля
                  </Button>
                </div>
                <div className="grid gap-1 text-sm text-slate-300">
                  <div>Площадь: {formatHa(selectedField.field_area_ha)}</div>
                  <div>План: {selectedField.crop_plan?.crop_name || "Не указано"}</div>
                  <div>Сорт: {selectedField.crop_plan?.variety_name || "—"}</div>
                  <div>Репродукция: {selectedField.crop_plan?.reproduction_name || "—"}</div>
                  <div>Последние операции: {selectedField.recent_operations.length || 0}</div>
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-[#2B3448] p-3 text-sm text-slate-400">
                Выберите поле на карте или в списке слева, чтобы открыть краткую карточку.
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Карта → Управление картой (KML Import Center)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
            <div className="rounded-lg border border-[#2B3448] bg-[#151C28] p-3 text-sm">
              <div className="font-medium">Шаг 1</div>
              <div className="text-slate-400">Загрузка файла</div>
            </div>
            <div className="rounded-lg border border-[#2B3448] bg-[#151C28] p-3 text-sm">
              <div className="font-medium">Шаг 2</div>
              <div className="text-slate-400">Предпросмотр карты</div>
            </div>
            <div className="rounded-lg border border-[#2B3448] bg-[#151C28] p-3 text-sm">
              <div className="font-medium">Шаг 3</div>
              <div className="text-slate-400">Сопоставление полей</div>
            </div>
            <div className="rounded-lg border border-[#2B3448] bg-[#151C28] p-3 text-sm">
              <div className="font-medium">Шаг 4</div>
              <div className="text-slate-400">Подтверждение</div>
            </div>
            <div className="rounded-lg border border-[#2B3448] bg-[#151C28] p-3 text-sm">
              <div className="font-medium">Шаг 5</div>
              <div className="text-slate-400">Сохранение в БД</div>
            </div>
          </div>

          {uploadState ? (
            <div className="rounded-xl border border-[#2B3448] bg-[#151C28] p-3 text-sm text-slate-300">
              Файл: <span className="font-medium">{uploadState.fileName}</span> · Полигонов: {uploadState.polygons.length}
              {uploadState.errors.length > 0 ? (
                <div className="mt-2 text-xs text-amber-300">Предупреждения: {uploadState.errors.join("; ")}</div>
              ) : null}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-[#2B3448] p-3 text-sm text-slate-400">
              Загрузите KML-файл, чтобы начать импорт.
            </div>
          )}

          {previewState ? (
            <div className="space-y-3 rounded-xl border border-[#2B3448] bg-[#151C28] p-3">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Badge variant="outline">Всего: {previewState.stats.total_polygons}</Badge>
                <Badge className="bg-emerald-600 text-white">Совпало: {previewState.stats.matched_polygons}</Badge>
                <Badge className="bg-amber-500 text-black">Несопоставлено: {previewState.stats.unmatched_polygons}</Badge>
                <Badge className="bg-rose-600 text-white">Ошибок: {previewState.stats.error_count}</Badge>
              </div>

              {unresolvedRows.length > 0 ? (
                <div className="space-y-2">
                  <div className="text-sm font-medium text-slate-100">Несопоставленные полигоны</div>
                  {unresolvedRows.map((row) => (
                    <div key={row.polygon_id} className="grid gap-2 rounded-lg border border-[#2B3448] p-2 md:grid-cols-[1fr_280px]">
                      <div className="text-sm text-slate-300">
                        <div className="font-medium">{row.polygon_name}</div>
                        <div className="text-xs text-slate-400">Площадь: {formatHa(row.area_ha)}</div>
                        {row.candidates.length > 0 ? (
                          <div className="text-xs text-slate-400">
                            Кандидаты: {row.candidates.map((item) => item.field_display_name).join(", ")}
                          </div>
                        ) : (
                          <div className="text-xs text-slate-400">Совпадений не найдено.</div>
                        )}
                      </div>
                      <div>
                        <Label className="mb-1 block text-xs">Ручное сопоставление</Label>
                        <Select
                          value={overrides[row.polygon_id] || "none"}
                          onValueChange={(value) =>
                            setOverrides((prev) => ({
                              ...prev,
                              [row.polygon_id]: value === "none" ? "" : value,
                            }))
                          }
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Выберите поле" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">Не выбрано</SelectItem>
                            {fields.map((field) => (
                              <SelectItem key={field.field_id} value={field.field_id}>
                                Поле {field.field_display_name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-lg border border-emerald-600/40 bg-emerald-600/10 p-3 text-sm text-emerald-200">
                  Все полигоны сопоставлены автоматически. Можно подтверждать импорт.
                </div>
              )}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">История импортов</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="px-2 py-2">Файл</th>
                  <th className="px-2 py-2">Дата</th>
                  <th className="px-2 py-2">Пользователь</th>
                  <th className="px-2 py-2">Полигонов</th>
                  <th className="px-2 py-2">Совпадения</th>
                  <th className="px-2 py-2">Ошибки</th>
                  <th className="px-2 py-2">Статус</th>
                  <th className="px-2 py-2">Действия</th>
                </tr>
              </thead>
              <tbody>
                {imports.map((row) => (
                  <tr key={row.id} className="border-t border-[#2B3448]">
                    <td className="px-2 py-2">{row.source_file_name}</td>
                    <td className="px-2 py-2">{formatDate(row.imported_at || row.created_at)}</td>
                    <td className="px-2 py-2">{row.imported_by_name || "—"}</td>
                    <td className="px-2 py-2">{row.total_polygons}</td>
                    <td className="px-2 py-2">{row.matched_polygons}</td>
                    <td className="px-2 py-2">{row.error_count}</td>
                    <td className="px-2 py-2">
                      <Badge variant={row.is_active ? "default" : "outline"}>{row.is_active ? "Активен" : row.status}</Badge>
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex flex-wrap gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={historyBusyId === row.id}
                          onClick={() => void handleHistoryAction(row.id, "activate")}
                        >
                          <Filter className="mr-1 h-3 w-3" />
                          Активировать
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={historyBusyId === row.id}
                          onClick={() => void handleHistoryAction(row.id, "deactivate")}
                        >
                          Деактивировать
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={historyBusyId === row.id}
                          onClick={() => void handleDownloadImport(row.id)}
                        >
                          <Download className="mr-1 h-3 w-3" />
                          Скачать KML
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          disabled={historyBusyId === row.id}
                          onClick={() => void handleDeleteImport(row.id)}
                        >
                          <Trash2 className="mr-1 h-3 w-3" />
                          Удалить
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {imports.length === 0 ? <div className="py-4 text-sm text-slate-400">История импортов пока пустая.</div> : null}
        </CardContent>
      </Card>
    </div>
  );
}
