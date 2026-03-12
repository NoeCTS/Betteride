"use client";

import { Fragment, useMemo } from "react";
import { divIcon } from "leaflet";
import {
  Circle,
  CircleMarker,
  MapContainer,
  Marker,
  Rectangle,
  TileLayer,
  Tooltip,
  useMapEvents,
} from "react-leaflet";

import type {
  AppData,
  AreaAnalysisCircle,
  AreaAnalysisSummary,
  LayerVisibility,
  Mode,
  Station,
  TimeSlice,
  ZoneScore,
} from "@/lib/types";
import { clampKmRadius, distanceKm, offsetPointEast, round } from "@/lib/geo";
import { getModeAccent } from "@/lib/types";
import SelectedZoneBrief from "./selected-zone-brief";
import AreaAnalysisBrief from "./area-analysis-brief";
import css from "./ground-signal.module.css";

interface SignalMapProps {
  mode: Mode;
  timeSlice: TimeSlice;
  scores: ZoneScore[];
  data: AppData;
  layerVisibility: LayerVisibility;
  analysisCircle: AreaAnalysisCircle;
  analysisSummary: AreaAnalysisSummary | null;
  placementMode: boolean;
  selectedZoneId: string | null;
  onSelectZone: (id: string) => void;
  onCreateAreaCircle: (center: { lat: number; lon: number }) => void;
  onMoveAreaCircle: (center: { lat: number; lon: number }) => void;
  onResizeAreaCircle: (radiusKm: number) => void;
  onClearAreaCircle: () => void;
  onSetAreaRadius: (radiusKm: number) => void;
}

const BERLIN_CENTER: [number, number] = [52.5, 13.4];
const BASE_ZOOM = 12;

const COLORS = {
  partner: "#16a34a",
  partnerManual: "#f59e0b",
  candidateFill: "#94a3b8",
  candidateStroke: "#475569",
  stationSU: "#7c3aed",
  stationS: "#4f46e5",
  stationU: "#818cf8",
  nearHalo: "#0f172a",
  analysis: "#2563eb",
  analysisFill: "#60a5fa",
};

export default function SignalMap({
  mode,
  timeSlice,
  scores,
  data,
  layerVisibility,
  analysisCircle,
  analysisSummary,
  placementMode,
  selectedZoneId,
  onSelectZone,
  onCreateAreaCircle,
  onMoveAreaCircle,
  onResizeAreaCircle,
  onClearAreaCircle,
  onSetAreaRadius,
}: SignalMapProps) {
  const accent = getModeAccent(mode);
  const selectedScore = scores.find((score) => score.zone.id === selectedZoneId) ?? null;

  const top5Ids = useMemo(
    () => new Set(scores.slice(0, 5).map((score) => score.zone.id)),
    [scores],
  );

  const selectedNearbyShops = useMemo(
    () =>
      new Map(
        (selectedScore?.zone.nearbyShops ?? []).map((shop) => [shop.item.osmId, shop]),
      ),
    [selectedScore],
  );

  const selectedNearbyStations = useMemo(
    () =>
      new Map(
        (selectedScore?.zone.nearbyStations ?? []).map((station) => [
          station.item.id,
          station,
        ]),
      ),
    [selectedScore],
  );

  const stationCoverage = useMemo(() => {
    return new Map(
      data.stations.map((station) => {
        let shopCount = 0;
        let partnerCount = 0;

        for (const shop of data.shops) {
          const shopDistance = distanceKm(station, shop);
          if (shopDistance > 1.2) continue;
          shopCount += 1;
          if (shop.isPartner) {
            partnerCount += 1;
          }
        }

        return [station.id, { shopCount, partnerCount }];
      }),
    );
  }, [data.shops, data.stations]);

  const candidateShops = data.shops.filter((shop) => !shop.isPartner);
  const osmPartners = data.shops.filter((shop) => shop.shopTag === "partner_osm");
  const manualPartners = data.shops.filter((shop) => shop.shopTag === "partner_manual");

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

  return (
    <div className={`${css.mapWrap} ${placementMode ? css.mapWrapPlacement : ""}`}>
      <MapContainer
        center={BERLIN_CENTER}
        zoom={BASE_ZOOM}
        scrollWheelZoom
        zoomControl={false}
        style={{ height: "100%", width: "100%" }}
      >
        <AnalysisPlacementEvents
          onCreateAreaCircle={onCreateAreaCircle}
          placementMode={placementMode}
        />

        <TileLayer
          attribution='&copy; <a href="https://carto.com">CARTO</a>'
          url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
        />

        {layerVisibility.zones
          ? scores.map((score) => {
              const isSelected = score.zone.id === selectedZoneId;
              const isTop5 = top5Ids.has(score.zone.id);
              const radius = 300 + (score.opportunity / 100) * 600;
              const cyclistsPerDay = score.zone.nearbyCounters.reduce(
                (sum, counter) => sum + counter.item.avgDaily,
                0,
              );

              return (
                <Circle
                  key={score.zone.id}
                  center={[score.zone.lat, score.zone.lon]}
                  radius={radius}
                  pathOptions={{
                    color: isSelected ? accent : isTop5 ? accent : "transparent",
                    fillColor: accent,
                    fillOpacity: isSelected ? 0.28 : isTop5 ? 0.15 : 0.06,
                    weight: isSelected ? 2.5 : isTop5 ? 1.2 : 0,
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
                </Circle>
              );
            })
          : null}

        {layerVisibility.zones && selectedScore ? (
          <Circle
            center={[selectedScore.zone.lat, selectedScore.zone.lon]}
            radius={1500}
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

        {analysisCircle.enabled && analysisCircle.center ? (
          <>
            <Circle
              center={[analysisCircle.center.lat, analysisCircle.center.lon]}
              radius={analysisCircle.radiusKm * 1000}
              pathOptions={{
                color: COLORS.analysis,
                fillColor: COLORS.analysisFill,
                fillOpacity: 0.12,
                weight: 1.8,
                dashArray: "8 6",
              }}
            >
              <Tooltip direction="top" offset={[0, -8]} sticky>
                <div className={css.tooltipCard}>
                  <div className={css.tooltipKicker}>Manual area analysis</div>
                  <div className={css.tooltipTitle}>{round(analysisCircle.radiusKm, 2)} km radius</div>
                  <div className={css.tooltipMeta}>
                    {analysisSummary?.estimatedCyclistsThroughArea.toLocaleString() ?? "0"} modeled cyclists
                  </div>
                  <div className={css.tooltipMeta}>
                    {analysisSummary?.observedCounterVolume.toLocaleString() ?? "0"} observed in selected slice
                  </div>
                  <div className={css.tooltipMeta}>
                    {analysisSummary?.networkPriorEstimate.toLocaleString() ?? "0"} network prior · {formatConfidenceLabel(analysisSummary?.estimateConfidence)} confidence
                  </div>
                  <div className={css.tooltipMeta}>
                    {analysisSummary?.shopCount ?? 0} shops · {analysisSummary?.stationCount ?? 0} stations
                  </div>
                </div>
              </Tooltip>
            </Circle>

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
              const coverage = stationCoverage.get(station.id);
              const stationColor = getStationColor(station);
              const radius = nearbyStation ? 5.8 : station.type === "S+U" ? 4.6 : 3.4;

              return (
                <Fragment key={station.id}>
                  {nearbyStation ? (
                    <CircleMarker
                      center={[station.lat, station.lon]}
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
                    radius={radius}
                    pathOptions={{
                      color: COLORS.nearHalo,
                      fillColor: stationColor,
                      fillOpacity: nearbyStation ? 0.88 : 0.5,
                      weight: station.type === "S+U" ? 1.4 : 0.9,
                    }}
                  >
                    <Tooltip direction="top" offset={[0, -6]}>
                      <div className={css.tooltipCard}>
                        <div className={css.tooltipKicker}>Transit station</div>
                        <div className={css.tooltipTitle}>{station.name}</div>
                        <div className={css.tooltipMeta}>{formatStationType(station.type)}</div>
                        <div className={css.tooltipMeta}>
                          {coverage?.shopCount ?? 0} shops · {coverage?.partnerCount ?? 0} partners within 1.2 km
                        </div>
                        {nearbyStation ? (
                          <div className={css.tooltipMeta}>
                            {formatNearbyRef(nearbyStation)} from selected zone
                          </div>
                        ) : null}
                      </div>
                    </Tooltip>
                  </CircleMarker>
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
                    pathOptions={{
                      color: COLORS.candidateStroke,
                      fillColor: COLORS.candidateFill,
                      fillOpacity: isUnnamed ? 0.14 : nearbyShop ? 0.44 : 0.24,
                      weight: nearbyShop ? 1.1 : 0.7,
                    }}
                  >
                    <Tooltip
                      className={css.candidateShopTooltip}
                      direction="top"
                      offset={[0, -8]}
                      opacity={1}
                      sticky
                    >
                      <div className={css.shopHoverCard}>
                        <div className={css.shopHoverName}>
                          {isUnnamed ? "Unnamed bicycle shop" : shop.name}
                        </div>
                        <div className={css.shopHoverMeta}>Independent shop</div>
                        {nearbyShop ? (
                          <div className={css.shopHoverMeta}>
                            {formatNearbyRef(nearbyShop)} from selected zone
                          </div>
                        ) : null}
                      </div>
                    </Tooltip>
                  </Rectangle>
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
                    pathOptions={{
                      color: "#ffffff",
                      fillColor: COLORS.partner,
                      fillOpacity: 0.96,
                      weight: nearbyShop ? 2.5 : 2,
                    }}
                  >
                    <Tooltip
                      className={css.partnerShopTooltip}
                      direction="top"
                      offset={[0, -8]}
                      opacity={1}
                      sticky
                    >
                      <div className={css.shopHoverCard}>
                        <div className={css.shopHoverName}>{shop.partnerName ?? shop.name}</div>
                        <div className={css.shopHoverMeta}>Betteride partner · OSM matched</div>
                        {nearbyShop ? (
                          <div className={css.shopHoverMeta}>
                            {formatNearbyRef(nearbyShop)} from selected zone
                          </div>
                        ) : null}
                      </div>
                    </Tooltip>
                  </Rectangle>

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
                    pathOptions={{
                      color: COLORS.partner,
                      fillColor: "#ffffff",
                      fillOpacity: 0.96,
                      weight: 2.4,
                    }}
                  >
                    <Tooltip
                      className={css.partnerShopTooltip}
                      direction="top"
                      offset={[0, -8]}
                      opacity={1}
                      sticky
                    >
                      <div className={css.shopHoverCard}>
                        <div className={css.shopHoverName}>{shop.partnerName ?? shop.name}</div>
                        <div className={css.shopHoverMeta}>Betteride partner · manual pin</div>
                        {nearbyShop ? (
                          <div className={css.shopHoverMeta}>
                            {formatNearbyRef(nearbyShop)} from selected zone
                          </div>
                        ) : null}
                      </div>
                    </Tooltip>
                  </Rectangle>

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

      <SelectedZoneBrief
        mode={mode}
        timeSlice={timeSlice}
        onSelectZone={onSelectZone}
        scores={scores}
        selectedZoneId={selectedZoneId}
      />

      <AreaAnalysisBrief
        circle={analysisCircle}
        onClear={onClearAreaCircle}
        onSetRadius={onSetAreaRadius}
        summary={analysisSummary}
      />

      <div className={css.legend}>
        <div className={css.legendSection}>
          <div className={css.legendHeading}>Zones</div>
          <div className={css.legendItem}>
            <span className={css.legendSwatch} style={{ background: accent, opacity: 0.32 }} />
            <span>Opportunity zone</span>
          </div>
          <div className={css.legendItem}>
            <span className={css.legendRing} style={{ borderColor: accent }} />
            <span>Selected reach ring</span>
          </div>
        </div>

        <div className={css.legendSection}>
          <div className={css.legendHeading}>Analysis</div>
          <div className={css.legendItem}>
            <span
              className={css.legendRing}
              style={{ borderColor: COLORS.analysis, background: "rgba(96, 165, 250, 0.18)" }}
            />
            <span>Manual analysis circle</span>
          </div>
          <div className={css.legendItem}>
            <span className={css.legendHandleCircle} />
            <span>Move handle</span>
          </div>
          <div className={css.legendItem}>
            <span className={css.legendHandleSquare} />
            <span>Resize handle</span>
          </div>
        </div>

        <div className={css.legendSection}>
          <div className={css.legendHeading}>Shops</div>
          <div className={css.legendItem}>
            <span
              className={css.legendSwatch}
              style={{ background: COLORS.partner, border: "2px solid #fff", borderRadius: "2px" }}
            />
            <span>Partner · OSM matched</span>
          </div>
          <div className={css.legendItem}>
            <span className={css.legendManual}>
              <span style={{ background: "#fff" }} />
              <span style={{ background: COLORS.partnerManual }} />
            </span>
            <span>Partner · manual pin</span>
          </div>
          <div className={css.legendItem}>
            <span
              className={css.legendSwatch}
              style={{
                background: COLORS.candidateFill,
                border: `1px solid ${COLORS.candidateStroke}`,
                borderRadius: "2px",
              }}
            />
            <span>Independent shop</span>
          </div>
        </div>

        <div className={css.legendSection}>
          <div className={css.legendHeading}>Stations</div>
          <div className={css.legendItem}>
            <span className={css.legendSwatch} style={{ background: COLORS.stationSU }} />
            <span>S+U station</span>
          </div>
          <div className={css.legendItem}>
            <span className={css.legendSwatch} style={{ background: COLORS.stationS }} />
            <span>S-Bahn</span>
          </div>
          <div className={css.legendItem}>
            <span className={css.legendSwatch} style={{ background: COLORS.stationU }} />
            <span>U-Bahn</span>
          </div>
        </div>
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

function getMarkerLatLng(target: unknown) {
  const marker = target as { getLatLng: () => { lat: number; lng: number } };
  return marker.getLatLng();
}

function getStationColor(station: Station) {
  if (station.type === "S+U") return COLORS.stationSU;
  if (station.type === "S") return COLORS.stationS;
  return COLORS.stationU;
}

function formatStationType(type: Station["type"]) {
  if (type === "S+U") return "S-Bahn + U-Bahn";
  if (type === "S") return "S-Bahn";
  return "U-Bahn";
}

function formatConfidenceLabel(confidence: AreaAnalysisSummary["estimateConfidence"] | undefined) {
  if (confidence === "high") return "High";
  if (confidence === "medium") return "Medium";
  return "Low";
}

function formatNearbyRef(nearbyRef: { distanceKm: number; bikeMinutes: number }) {
  return `${round(nearbyRef.distanceKm, 1)} km · ${round(nearbyRef.bikeMinutes, 1)} min`;
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
