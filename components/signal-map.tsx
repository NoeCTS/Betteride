"use client";

import { Fragment, useEffect, useMemo, useRef } from "react";
import { divIcon } from "leaflet";
import {
  Circle,
  CircleMarker,
  MapContainer,
  Marker,
  Polyline,
  Rectangle,
  TileLayer,
  Tooltip,
  useMap,
  useMapEvents,
} from "react-leaflet";

import type {
  AppData,
  AreaAnalysisCircle,
  AreaAnalysisSummary,
  FlyerPlan,
  FlyerZoneScore,
  LayerVisibility,
  Mode,
  ZoneScore,
} from "@/lib/types";
import { clampKmRadius, distanceKm, offsetPointEast, round } from "@/lib/geo";
import { getModeAccent } from "@/lib/types";
import AreaAnalysisBrief from "./area-analysis-brief";
import css from "./ground-signal.module.css";

interface SignalMapProps {
  mode: Mode;
  scores: ZoneScore[];
  flyerScores: FlyerZoneScore[];
  flyerPlan: FlyerPlan | null;
  data: AppData;
  layerVisibility: LayerVisibility;
  analysisCircle: AreaAnalysisCircle;
  analysisSummary: AreaAnalysisSummary | null;
  placementMode: boolean;
  detailsPanelOpen: boolean;
  mapFullscreen: boolean;
  autoCenterZone: boolean;
  selectedZoneId: string | null;
  onSelectZone: (id: string) => void;
  onToggleDetailsPanel: () => void;
  onToggleMapFullscreen: () => void;
  onCreateAreaCircle: (center: { lat: number; lon: number }) => void;
  onMoveAreaCircle: (center: { lat: number; lon: number }) => void;
  onResizeAreaCircle: (radiusKm: number) => void;
  onClearAreaCircle: () => void;
  onSetAreaRadius: (radiusKm: number) => void;
}

const BERLIN_CENTER: [number, number] = [52.5, 13.4];
const BASE_ZOOM = 12.5;
const BERLIN_MAP_BOUNDS: [[number, number], [number, number]] = [
  [52.36, 13.02],
  [52.67, 13.78],
];

const COLORS = {
  partner: "#6c3cc1",
  partnerManual: "#ffcf4b",
  candidateFill: "#ebe5f9",
  candidateStroke: "#6d7390",
  stationSU: "#a14efd",
  stationS: "#8b5cf6",
  stationU: "#c4b5fd",
  nearHalo: "#161b26",
  analysis: "#6c3cc1",
  analysisFill: "#d9c7f8",
};

// Returns Betteride purple gradient color for flyer mode based on 0-100 score
function flyerZoneColor(flyerScore: number): string {
  const lightness = Math.round(86 - flyerScore * 0.36);
  return `hsl(270, 78%, ${lightness}%)`;
}

export default function SignalMap({
  mode,
  scores,
  flyerScores,
  flyerPlan,
  data,
  layerVisibility,
  analysisCircle,
  analysisSummary,
  placementMode,
  detailsPanelOpen,
  mapFullscreen,
  autoCenterZone,
  selectedZoneId,
  onSelectZone,
  onToggleDetailsPanel,
  onToggleMapFullscreen,
  onCreateAreaCircle,
  onMoveAreaCircle,
  onResizeAreaCircle,
  onClearAreaCircle,
  onSetAreaRadius,
}: SignalMapProps) {
  const accent = getModeAccent(mode);
  const isFlyerMode = mode === "flyer-distribution";
  const selectedScore = scores.find((score) => score.zone.id === selectedZoneId) ?? null;
  const selectedFlyerScore = flyerScores.find((s) => s.zone.id === selectedZoneId) ?? null;
  const selectedZone = isFlyerMode ? selectedFlyerScore?.zone ?? null : selectedScore?.zone ?? null;

  const top5Ids = useMemo(
    () => new Set(
      isFlyerMode
        ? flyerScores.slice(0, 5).map((s) => s.zone.id)
        : scores.slice(0, 5).map((score) => score.zone.id),
    ),
    [scores, flyerScores, isFlyerMode],
  );

  const selectedNearbyShops = new Map(
    (selectedZone?.nearbyShops ?? []).map((shop) => [shop.item.osmId, shop]),
  );

  const selectedNearbyStations = new Map(
    (selectedZone?.nearbyStations ?? []).map((station) => [
      station.item.id,
      station,
    ]),
  );

  const candidateShops = data.shops.filter((shop) => !shop.isPartner);
  const osmPartners = data.shops.filter((shop) => shop.shopTag === "partner_osm");
  const manualPartners = data.shops.filter((shop) => shop.shopTag === "partner_manual");
  const plannerAssignments = useMemo(
    () =>
      flyerPlan?.assignments.filter(
        (assignment) => assignment.status === "assigned" && assignment.spot,
      ) ?? [],
    [flyerPlan],
  );
  const plannerMarkerPositions = useMemo(() => {
    const positions = new Map<number, [number, number]>();
    const assignmentsBySpot = new Map<string, typeof plannerAssignments>();

    plannerAssignments.forEach((assignment) => {
      const key = plannerAssignmentSpotKey(assignment);
      const existing = assignmentsBySpot.get(key);
      if (existing) {
        existing.push(assignment);
        return;
      }

      assignmentsBySpot.set(key, [assignment]);
    });

    assignmentsBySpot.forEach((assignments) => {
      assignments
        .slice()
        .sort((left, right) => left.personIndex - right.personIndex)
        .forEach((assignment, index, sortedAssignments) => {
          const basePosition: [number, number] = [assignment.spot!.lat, assignment.spot!.lon];

          if (sortedAssignments.length === 1) {
            positions.set(assignment.personIndex, basePosition);
            return;
          }

          const angleDegrees = -90 + (360 / sortedAssignments.length) * index;
          const offset = offsetPointRadial(
            { lat: assignment.spot!.lat, lon: assignment.spot!.lon },
            0.045,
            angleDegrees,
          );

          positions.set(assignment.personIndex, [offset.lat, offset.lon]);
        });
    });

    return positions;
  }, [plannerAssignments]);

  // Compute walking route connecting all assigned spots using nearest-neighbor
  const walkingRoute = useMemo<[number, number][]>(() => {
    if (plannerAssignments.length < 2) return [];

    // Get unique spot positions (dedupe spots shared by multiple reps)
    const seen = new Set<string>();
    const points: [number, number][] = [];
    for (const a of plannerAssignments) {
      const key = `${a.spot!.lat.toFixed(5)},${a.spot!.lon.toFixed(5)}`;
      if (!seen.has(key)) {
        seen.add(key);
        points.push([a.spot!.lat, a.spot!.lon]);
      }
    }

    if (points.length < 2) return [];

    // Nearest-neighbor ordering
    const remaining = [...points];
    const route: [number, number][] = [remaining.shift()!];
    while (remaining.length > 0) {
      const last = route[route.length - 1];
      let bestIdx = 0;
      let bestDist = Infinity;
      for (let i = 0; i < remaining.length; i++) {
        const d = distanceKm(
          { lat: last[0], lon: last[1] },
          { lat: remaining[i][0], lon: remaining[i][1] },
        );
        if (d < bestDist) {
          bestDist = d;
          bestIdx = i;
        }
      }
      route.push(remaining.splice(bestIdx, 1)[0]);
    }

    return route;
  }, [plannerAssignments]);

  const centerHandleIcon = useMemo(
    () =>
      divIcon({
        className: css.analysisHandleMarker,
        html: `<span class="${css.analysisHandleCenter}"></span>`,
        iconSize: [20, 20],
        iconAnchor: [10, 10],
      }),
    [],
  );

  const radiusHandleIcon = useMemo(
    () =>
      divIcon({
        className: css.analysisHandleMarker,
        html: `<span class="${css.analysisHandleRadius}"></span>`,
        iconSize: [22, 22],
        iconAnchor: [11, 11],
      }),
    [],
  );

  const radiusHandlePosition = analysisCircle.center
    ? offsetPointEast(analysisCircle.center, analysisCircle.radiusKm)
    : null;

  const assignmentIcons = useMemo(
    () =>
      new Map(
        plannerAssignments.map((assignment) => [
          assignment.personIndex,
          divIcon({
            className: css.assignmentMarker,
            html: `<span class="${css.assignmentMarkerInner}">${assignment.personIndex}</span>`,
            iconSize: [30, 30],
            iconAnchor: [15, 15],
          }),
        ]),
      ),
    [plannerAssignments],
  );

  return (
    <div
      className={`${css.mapWrap} ${placementMode ? css.mapWrapPlacement : ""} ${
        mapFullscreen ? css.mapWrapFullscreen : ""
      }`}
    >
      <MapContainer
        center={BERLIN_CENTER}
        zoom={BASE_ZOOM}
        zoomSnap={0.25}
        zoomDelta={0.5}
        minZoom={11}
        maxBounds={BERLIN_MAP_BOUNDS}
        maxBoundsViscosity={1}
        scrollWheelZoom={mapFullscreen}
        zoomControl
        dragging
        keyboard
        preferCanvas
        worldCopyJump={false}
        style={{ height: "100%", width: "100%" }}
      >
        <MapController
          mode={mode}
          autoCenterLat={autoCenterZone ? selectedZone?.lat ?? null : null}
          autoCenterLon={autoCenterZone ? selectedZone?.lon ?? null : null}
          autoCenterZoneId={autoCenterZone ? selectedZone?.id ?? null : null}
          detailsPanelOpen={detailsPanelOpen}
          mapFullscreen={mapFullscreen}
        />
        <AnalysisPlacementEvents
          onCreateAreaCircle={onCreateAreaCircle}
          placementMode={placementMode}
        />

        <TileLayer
          attribution='&copy; <a href="https://carto.com">CARTO</a>'
          url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
        />

        {layerVisibility.zones && !isFlyerMode
          ? scores.map((score) => {
              const isSelected = score.zone.id === selectedZoneId;
              const isTop5 = top5Ids.has(score.zone.id);
              const radius = 300 + (score.opportunity / 100) * 600;

              return (
                <Circle
                  key={score.zone.id}
                  center={[score.zone.lat, score.zone.lon]}
                  radius={radius}
                  interactive={false}
                  pathOptions={{
                    color: isSelected ? accent : isTop5 ? accent : "transparent",
                    fillColor: accent,
                    fillOpacity: isSelected ? 0.28 : isTop5 ? 0.15 : 0.06,
                    weight: isSelected ? 2.5 : isTop5 ? 1.2 : 0,
                  }}
                />
              );
            })
          : null}

        {layerVisibility.zones && !isFlyerMode
          ? scores.map((score) => {
              const isSelected = score.zone.id === selectedZoneId;
              const isTop5 = top5Ids.has(score.zone.id);
              const cyclistsPerDay = score.zone.nearbyCounters.reduce(
                (sum, counter) => sum + counter.item.avgDaily,
                0,
              );

              return (
                <CircleMarker
                  key={`${score.zone.id}-pin`}
                  center={[score.zone.lat, score.zone.lon]}
                  radius={isSelected ? 8 : isTop5 ? 6 : 5}
                  pathOptions={{
                    color: "#ffffff",
                    fillColor: accent,
                    fillOpacity: isSelected ? 1 : 0.9,
                    weight: isSelected ? 2.5 : 1.5,
                  }}
                  eventHandlers={{ click: () => onSelectZone(score.zone.id) }}
                >
                  <Tooltip direction="top" offset={[0, -10]} sticky>
                    <div className={css.tooltipCard}>
                      <div className={css.tooltipKicker}>
                        {isSelected
                          ? "Selected zone"
                          : isTop5
                            ? "Top opportunity"
                            : "Opportunity zone"}
                      </div>
                      <div className={css.tooltipTitle}>{score.zone.name}</div>
                      <div className={css.tooltipMeta}>
                        Opportunity <strong>{round(score.opportunity, 0)}</strong>
                      </div>
                      <div className={css.tooltipMeta}>
                        {score.zone.shopCount} shops · {score.zone.partnerCount} partners
                      </div>
                      <div className={css.tooltipMeta}>
                        {cyclistsPerDay.toLocaleString()} cyclists/day nearby
                      </div>
                    </div>
                  </Tooltip>
                </CircleMarker>
              );
            })
          : null}

        {/* Flyer mode: green-gradient zones sized by prospects/hr */}
        {layerVisibility.zones && isFlyerMode
          ? flyerScores.map((fs) => {
              const isSelected = fs.zone.id === selectedZoneId;
              const isTop5 = top5Ids.has(fs.zone.id);
              const zoneColor = flyerZoneColor(fs.flyerScore);
              const radius = Math.min(1100, Math.max(300, 300 + fs.prospectsPerHour / 10));

              return (
                <Circle
                  key={fs.zone.id}
                  center={[fs.zone.lat, fs.zone.lon]}
                  radius={radius}
                  interactive={false}
                  pathOptions={{
                    color: isSelected ? zoneColor : isTop5 ? zoneColor : "transparent",
                    fillColor: zoneColor,
                    fillOpacity: isSelected ? 0.35 : isTop5 ? 0.20 : 0.08,
                    weight: isSelected ? 2.5 : isTop5 ? 1.5 : 0,
                  }}
                />
              );
            })
          : null}

        {layerVisibility.zones && isFlyerMode
          ? flyerScores.map((fs) => {
              const isSelected = fs.zone.id === selectedZoneId;
              const isTop5 = top5Ids.has(fs.zone.id);
              const zoneColor = flyerZoneColor(fs.flyerScore);
              const bestWindow = fs.bestWindows[0];

              return (
                <CircleMarker
                  key={`${fs.zone.id}-pin`}
                  center={[fs.zone.lat, fs.zone.lon]}
                  radius={isSelected ? 8 : isTop5 ? 6.5 : 5.5}
                  pathOptions={{
                    color: "#ffffff",
                    fillColor: zoneColor,
                    fillOpacity: 0.98,
                    weight: isSelected ? 2.5 : 1.5,
                  }}
                  eventHandlers={{ click: () => onSelectZone(fs.zone.id) }}
                >
                  <Tooltip direction="top" offset={[0, -10]} sticky>
                    <div className={css.tooltipCard}>
                      <div className={css.tooltipKicker}>
                        {isSelected ? "Selected flyer zone" : isTop5 ? "Top flyer zone" : "Flyer zone"}
                      </div>
                      <div className={css.tooltipTitle}>{fs.zone.name}</div>
                      <div className={css.tooltipMeta}>
                        Score <strong>{round(fs.flyerScore, 0)}</strong> · {fs.prospectsPerHour}/hr prospects
                      </div>
                      <div className={css.tooltipMeta}>
                        ~{fs.estimatedCyclistsPerHour.toLocaleString()} cyclists/hr
                      </div>
                      {bestWindow && (
                        <div className={css.tooltipMeta}>
                          Best: {bestWindow.label}
                        </div>
                      )}
                    </div>
                  </Tooltip>
                </CircleMarker>
              );
            })
          : null}

        {layerVisibility.zones && !isFlyerMode && selectedScore ? (
          <Circle
            center={[selectedScore.zone.lat, selectedScore.zone.lon]}
            radius={1500}
            interactive={false}
            pathOptions={{
              color: accent,
              fillColor: "transparent",
              fillOpacity: 0,
              weight: 1,
              dashArray: "6 4",
              opacity: 0.45,
            }}
          />
        ) : null}

        {layerVisibility.zones && isFlyerMode && selectedFlyerScore ? (
          <Circle
            center={[selectedFlyerScore.zone.lat, selectedFlyerScore.zone.lon]}
            radius={1500}
            interactive={false}
            pathOptions={{
              color: flyerZoneColor(selectedFlyerScore.flyerScore),
              fillColor: "transparent",
              fillOpacity: 0,
              weight: 1,
              dashArray: "6 4",
              opacity: 0.50,
            }}
          />
        ) : null}

        {isFlyerMode && walkingRoute.length >= 2 ? (
          <Polyline
            positions={walkingRoute}
            pathOptions={{
              color: "var(--brand-purple, #6c3cc1)",
              weight: 3,
              opacity: 0.6,
              dashArray: "8 6",
              lineCap: "round",
              lineJoin: "round",
            }}
          />
        ) : null}

        {isFlyerMode
          ? plannerAssignments.map((assignment) => (
              <Marker
                key={`planner-${assignment.personIndex}`}
                icon={assignmentIcons.get(assignment.personIndex)}
                position={
                  plannerMarkerPositions.get(assignment.personIndex) ?? [
                    assignment.spot!.lat,
                    assignment.spot!.lon,
                  ]
                }
                eventHandlers={{
                  click: () => {
                    if (assignment.zoneId) {
                      onSelectZone(assignment.zoneId);
                    }
                  },
                }}
              >
                <Tooltip direction="top" offset={[0, -10]} sticky>
                  <div className={css.tooltipCard}>
                    <div className={css.tooltipKicker}>Person {assignment.personIndex}</div>
                    <div className={css.tooltipTitle}>{assignment.spot!.name}</div>
                    <div className={css.tooltipMeta}>
                      {assignment.zoneName} · {assignment.expectedProspectsPerHour}/hr prospects
                    </div>
                    <div className={css.tooltipMeta}>{assignment.rationale}</div>
                  </div>
                </Tooltip>
              </Marker>
            ))
          : null}

        {analysisCircle.enabled && analysisCircle.center ? (
          <>
            <Circle
              center={[analysisCircle.center.lat, analysisCircle.center.lon]}
              radius={analysisCircle.radiusKm * 1000}
              interactive={false}
              pathOptions={{
                color: COLORS.analysis,
                fillColor: COLORS.analysisFill,
                fillOpacity: 0.12,
                weight: 1.8,
                dashArray: "8 6",
              }}
            />

            <Marker
              draggable
              icon={centerHandleIcon}
              position={[analysisCircle.center.lat, analysisCircle.center.lon]}
              eventHandlers={{
                dragend: (event) => {
                  const { lat, lng } = getMarkerLatLng(event.target);
                  onMoveAreaCircle({ lat, lon: lng });
                },
              }}
            >
              <Tooltip direction="top" offset={[0, -10]}>
                Move analysis circle
              </Tooltip>
            </Marker>

            {radiusHandlePosition ? (
              <Marker
                draggable
                icon={radiusHandleIcon}
                position={[radiusHandlePosition.lat, radiusHandlePosition.lon]}
                eventHandlers={{
                  dragend: (event) => {
                    const { lat, lng } = getMarkerLatLng(event.target);
                    onResizeAreaCircle(
                      clampKmRadius(distanceKm(analysisCircle.center!, { lat, lon: lng })),
                    );
                  },
                }}
              >
                <Tooltip direction="top" offset={[0, -10]}>
                  Resize analysis radius
                </Tooltip>
              </Marker>
            ) : null}
          </>
        ) : null}

        {layerVisibility.stations
          ? data.stations.map((station) => {
              const nearbyStation = selectedNearbyStations.get(station.id);
              const stationColor = getStationColor(station);
              const radius = nearbyStation ? 5.8 : station.type === "S+U" ? 4.6 : 3.4;

              return (
                <Fragment key={station.id}>
                  {nearbyStation ? (
                    <CircleMarker
                      center={[station.lat, station.lon]}
                      interactive={false}
                      radius={radius + 3}
                      pathOptions={{
                        color: accent,
                        fillColor: accent,
                        fillOpacity: 0.08,
                        weight: 1.2,
                      }}
                    />
                  ) : null}

                  <CircleMarker
                    center={[station.lat, station.lon]}
                    interactive={false}
                    radius={radius}
                    pathOptions={{
                      color: COLORS.nearHalo,
                      fillColor: stationColor,
                      fillOpacity: nearbyStation ? 0.88 : 0.5,
                      weight: station.type === "S+U" ? 1.4 : 0.9,
                    }}
                  />
                </Fragment>
              );
            })
          : null}

        {layerVisibility.candidates
          ? candidateShops.map((shop) => {
              const nearbyShop = selectedNearbyShops.get(shop.osmId);
              const isUnnamed = shop.name === "Unnamed shop";
              const size = nearbyShop ? 68 : isUnnamed ? 34 : 46;

              return (
                <Fragment key={shop.osmId}>
                  {nearbyShop ? (
                    <Rectangle
                      bounds={squareBounds(shop.lat, shop.lon, size + 34)}
                      pathOptions={{
                        color: accent,
                        fillColor: accent,
                        fillOpacity: 0.08,
                        weight: 1,
                      }}
                      interactive={false}
                    />
                  ) : null}

                  <Rectangle
                    bounds={squareBounds(shop.lat, shop.lon, size)}
                    interactive={false}
                    pathOptions={{
                      color: COLORS.candidateStroke,
                      fillColor: COLORS.candidateFill,
                      fillOpacity: isUnnamed ? 0.14 : nearbyShop ? 0.44 : 0.24,
                      weight: nearbyShop ? 1.1 : 0.7,
                    }}
                  />
                </Fragment>
              );
            })
          : null}

        {layerVisibility.partners
          ? osmPartners.map((shop) => {
              const nearbyShop = selectedNearbyShops.get(shop.osmId);
              const size = nearbyShop ? 90 : 76;

              return (
                <Fragment key={shop.osmId}>
                  {nearbyShop ? (
                    <Rectangle
                      bounds={squareBounds(shop.lat, shop.lon, size + 34)}
                      pathOptions={{
                        color: accent,
                        fillColor: accent,
                        fillOpacity: 0.1,
                        weight: 1.1,
                      }}
                      interactive={false}
                    />
                  ) : null}

                  <Rectangle
                    bounds={squareBounds(shop.lat, shop.lon, size)}
                    interactive={false}
                    pathOptions={{
                      color: "#ffffff",
                      fillColor: COLORS.partner,
                      fillOpacity: 0.96,
                      weight: nearbyShop ? 2.5 : 2,
                    }}
                  />

                  <Rectangle
                    bounds={squareBounds(shop.lat, shop.lon, 26)}
                    pathOptions={{
                      color: "#ffffff",
                      fillColor: COLORS.nearHalo,
                      fillOpacity: 0.88,
                      weight: 0.8,
                    }}
                    interactive={false}
                  />
                </Fragment>
              );
            })
          : null}

        {layerVisibility.partners
          ? manualPartners.map((shop) => {
              const nearbyShop = selectedNearbyShops.get(shop.osmId);
              const size = nearbyShop ? 94 : 80;

              return (
                <Fragment key={shop.osmId}>
                  {nearbyShop ? (
                    <Rectangle
                      bounds={squareBounds(shop.lat, shop.lon, size + 34)}
                      pathOptions={{
                        color: accent,
                        fillColor: accent,
                        fillOpacity: 0.1,
                        weight: 1.1,
                      }}
                      interactive={false}
                    />
                  ) : null}

                  <Rectangle
                    bounds={squareBounds(shop.lat, shop.lon, size)}
                    interactive={false}
                    pathOptions={{
                      color: COLORS.partner,
                      fillColor: "#ffffff",
                      fillOpacity: 0.96,
                      weight: 2.4,
                    }}
                  />

                  <Rectangle
                    bounds={squareBounds(shop.lat, shop.lon, 34)}
                    pathOptions={{
                      color: "#ffffff",
                      fillColor: COLORS.partnerManual,
                      fillOpacity: 0.98,
                      weight: 1,
                    }}
                    interactive={false}
                  />
                </Fragment>
              );
            })
          : null}
      </MapContainer>

      <AreaAnalysisBrief
        circle={analysisCircle}
        onClear={onClearAreaCircle}
        onSetRadius={onSetAreaRadius}
        summary={analysisSummary}
      />

      <div className={css.mapActions}>
        <button
          className={`${css.mapActionButton} ${detailsPanelOpen ? "" : css.mapActionButtonSupport}`}
          onClick={onToggleDetailsPanel}
          type="button"
        >
          {detailsPanelOpen ? "Hide panel" : "Show zones"}
        </button>
        <button
          className={`${css.mapActionButton} ${mapFullscreen ? "" : css.mapActionButtonBrand}`}
          onClick={onToggleMapFullscreen}
          type="button"
        >
          {mapFullscreen ? "Exit" : "Expand"}
        </button>
      </div>
    </div>
  );
}

function AnalysisPlacementEvents({
  placementMode,
  onCreateAreaCircle,
}: {
  placementMode: boolean;
  onCreateAreaCircle: (center: { lat: number; lon: number }) => void;
}) {
  useMapEvents({
    click(event) {
      if (!placementMode) {
        return;
      }

      onCreateAreaCircle({ lat: event.latlng.lat, lon: event.latlng.lng });
    },
  });

  return null;
}

/**
 * Unified map viewport controller.
 *
 * Replaces three separate sync components (MapViewportSync,
 * MapModeResetSync, MapResizeSync) that could race against each other.
 *
 * Critical ordering: invalidateSize() FIRST (so Leaflet knows the real
 * container dimensions), then setView() (so pixel calculations are correct).
 */
function MapController({
  mode,
  autoCenterLat,
  autoCenterLon,
  autoCenterZoneId,
  detailsPanelOpen,
  mapFullscreen,
}: {
  mode: Mode;
  autoCenterLat: number | null;
  autoCenterLon: number | null;
  autoCenterZoneId: string | null;
  detailsPanelOpen: boolean;
  mapFullscreen: boolean;
}) {
  const map = useMap();
  const prevModeRef = useRef(mode);

  // 1. Mode change — invalidate size, then reset to Berlin center
  useEffect(() => {
    const modeChanged = prevModeRef.current !== mode;
    prevModeRef.current = mode;
    if (!modeChanged) return;

    const frame = requestAnimationFrame(() => {
      map.invalidateSize({ animate: false });
      map.setView(BERLIN_CENTER, BASE_ZOOM, { animate: false });
    });
    return () => cancelAnimationFrame(frame);
  }, [map, mode]);

  // 2. Layout change (panel, fullscreen, mode) — keep center stable
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      map.invalidateSize({ animate: false });
    });
    return () => cancelAnimationFrame(frame);
  }, [detailsPanelOpen, map, mapFullscreen, mode]);

  // 3. Zone selection — pan to zone
  useEffect(() => {
    if (autoCenterLat === null || autoCenterLon === null || autoCenterZoneId === null) return;

    if (!isWithinBerlinBounds(autoCenterLat, autoCenterLon)) {
      map.setView(BERLIN_CENTER, BASE_ZOOM, { animate: false });
      return;
    }

    const nextZoom = Math.max(map.getZoom(), BASE_ZOOM);
    map.setView([autoCenterLat, autoCenterLon], nextZoom, { animate: false });
  }, [autoCenterLat, autoCenterLon, autoCenterZoneId, map]);

  // 4. scrollWheelZoom — MapContainer props are immutable after mount
  useEffect(() => {
    if (mapFullscreen) {
      map.scrollWheelZoom.enable();
    } else {
      map.scrollWheelZoom.disable();
    }
  }, [map, mapFullscreen]);

  return null;
}

function getMarkerLatLng(target: unknown) {
  const marker = target as { getLatLng: () => { lat: number; lng: number } };
  return marker.getLatLng();
}

function getStationColor(station: { type: "S" | "U" | "S+U" }) {
  if (station.type === "S+U") return COLORS.stationSU;
  if (station.type === "S") return COLORS.stationS;
  return COLORS.stationU;
}

function plannerAssignmentSpotKey(assignment: {
  spot: { name: string; lat: number; lon: number } | null;
}) {
  return assignment.spot
    ? `${assignment.spot.name}:${assignment.spot.lat.toFixed(6)}:${assignment.spot.lon.toFixed(6)}`
    : "missing";
}

function offsetPointRadial(
  point: { lat: number; lon: number },
  distanceKm: number,
  angleDegrees: number,
) {
  const radians = (angleDegrees * Math.PI) / 180;
  const latOffsetKm = Math.sin(radians) * distanceKm;
  const lonOffsetKm = Math.cos(radians) * distanceKm;
  const kmPerDegreeLat = 110.574;
  const kmPerDegreeLon = 111.32 * Math.cos((point.lat * Math.PI) / 180);

  return {
    lat: point.lat + latOffsetKm / kmPerDegreeLat,
    lon: point.lon + lonOffsetKm / Math.max(0.000001, kmPerDegreeLon),
  };
}

function isWithinBerlinBounds(lat: number, lon: number) {
  return (
    lat >= BERLIN_MAP_BOUNDS[0][0]
    && lat <= BERLIN_MAP_BOUNDS[1][0]
    && lon >= BERLIN_MAP_BOUNDS[0][1]
    && lon <= BERLIN_MAP_BOUNDS[1][1]
  );
}

function squareBounds(lat: number, lon: number, sizeMeters: number) {
  const halfSize = sizeMeters / 2;
  const latOffset = halfSize / 111320;
  const lonOffset = halfSize / (111320 * Math.cos((lat * Math.PI) / 180));

  return [
    [lat - latOffset, lon - lonOffset],
    [lat + latOffset, lon + lonOffset],
  ] as [[number, number], [number, number]];
}
