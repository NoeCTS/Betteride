"use client";

import { useState, useMemo } from "react";
import dynamic from "next/dynamic";
import type {
  AreaAnalysisCircle,
  AppData,
  FlyerTimeContext,
  FlyerZoneScore,
  LayerVisibility,
  MapLayerKey,
  Mode,
  TimeSlice,
} from "@/lib/types";
import { clampKmRadius } from "@/lib/geo";
import { summarizeAreaCircle } from "@/lib/area-analysis";
import { scoreZones } from "@/lib/engine";
import { scoreFlyerZones } from "@/lib/flyer-optimizer";
import ModeBar from "./mode-bar";
import IntelPanel from "./intel-panel";
import css from "./ground-signal.module.css";

import appDataJson from "@/data/app/ground-signal.json";

const SignalMap = dynamic(() => import("@/components/signal-map"), {
  ssr: false,
  loading: () => (
    <div className={css.mapWrap} style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
      <span style={{ color: "var(--muted)", fontSize: 13 }}>Loading map...</span>
    </div>
  ),
});

const appData = appDataJson as unknown as AppData;

const DEFAULT_LAYER_VISIBILITY: LayerVisibility = {
  zones: true,
  stations: true,
  partners: true,
  candidates: true,
};
const DEFAULT_AREA_RADIUS_KM = 1;
const EMPTY_AREA_CIRCLE: AreaAnalysisCircle = {
  enabled: false,
  center: null,
  radiusKm: DEFAULT_AREA_RADIUS_KM,
};

export default function GroundSignal() {
  const [mode, setMode] = useState<Mode>("coverage-gap");
  const [timeSlice, setTimeSlice] = useState<TimeSlice>("weekday-peak");
  const [flyerTimeContext, setFlyerTimeContext] = useState<FlyerTimeContext>({
    day: "friday",
    timeBlock: "afternoon-peak",
  });
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null);
  const [layerVisibility, setLayerVisibility] =
    useState<LayerVisibility>(DEFAULT_LAYER_VISIBILITY);
  const [analysisEnabled, setAnalysisEnabled] = useState(false);
  const [placementMode, setPlacementMode] = useState(false);
  const [analysisCircle, setAnalysisCircle] =
    useState<AreaAnalysisCircle>(EMPTY_AREA_CIRCLE);

  const scores = useMemo(
    () => scoreZones(appData, mode, timeSlice),
    [mode, timeSlice],
  );
  const flyerScores = useMemo(
    () => mode === "flyer-distribution" ? scoreFlyerZones(appData, flyerTimeContext) : [],
    [mode, flyerTimeContext],
  );
  const analysisSummary = useMemo(
    () => summarizeAreaCircle(appData, analysisCircle, timeSlice),
    [analysisCircle, timeSlice],
  );

  function handleToggleLayer(layer: MapLayerKey) {
    setLayerVisibility((current) => ({
      ...current,
      [layer]: !current[layer],
    }));
  }

  function handleToggleAnalysis() {
    if (!analysisEnabled) {
      setAnalysisEnabled(true);
      setPlacementMode(true);
      setAnalysisCircle((current) => ({ ...current, enabled: true }));
      return;
    }

    if (!analysisCircle.center) {
      setAnalysisEnabled(false);
      setPlacementMode(false);
      setAnalysisCircle(EMPTY_AREA_CIRCLE);
      return;
    }

    setPlacementMode((current) => !current);
  }

  function handleCreateAreaCircle(center: { lat: number; lon: number }) {
    setAnalysisEnabled(true);
    setPlacementMode(false);
    setAnalysisCircle((current) => ({
      enabled: true,
      center,
      radiusKm: current.radiusKm || DEFAULT_AREA_RADIUS_KM,
    }));
  }

  function handleMoveAreaCircle(center: { lat: number; lon: number }) {
    setAnalysisCircle((current) => ({
      ...current,
      enabled: true,
      center,
    }));
  }

  function handleResizeAreaCircle(radiusKm: number) {
    setAnalysisCircle((current) => ({
      ...current,
      enabled: true,
      radiusKm: clampKmRadius(radiusKm),
    }));
  }

  function handleSetAreaRadius(radiusKm: number) {
    setAnalysisEnabled(true);
    setAnalysisCircle((current) => ({
      ...current,
      enabled: true,
      radiusKm: clampKmRadius(radiusKm),
    }));

    if (!analysisCircle.center) {
      setPlacementMode(true);
    }
  }

  function handleClearArea() {
    setAnalysisEnabled(false);
    setPlacementMode(false);
    setAnalysisCircle(EMPTY_AREA_CIRCLE);
  }

  // Auto-select top zone if nothing selected
  const isFlyerMode = mode === "flyer-distribution";
  const activeScoreList = isFlyerMode ? flyerScores : scores;
  const effectiveSelectedId =
    selectedZoneId && activeScoreList.some((s) => s.zone.id === selectedZoneId)
      ? selectedZoneId
      : activeScoreList[0]?.zone.id ?? null;

  return (
    <div className={css.shell}>
      <ModeBar
        mode={mode}
        timeSlice={timeSlice}
        flyerTimeContext={flyerTimeContext}
        layerVisibility={layerVisibility}
        analysisEnabled={analysisEnabled}
        placementMode={placementMode}
        areaRadiusKm={analysisCircle.radiusKm}
        hasAreaCircle={Boolean(analysisCircle.center)}
        onModeChange={setMode}
        onTimeSliceChange={setTimeSlice}
        onFlyerTimeContextChange={setFlyerTimeContext}
        onToggleLayer={handleToggleLayer}
        onToggleAnalysis={handleToggleAnalysis}
        onClearArea={handleClearArea}
        onSetAreaRadius={handleSetAreaRadius}
      />
      <div className={css.main}>
        <SignalMap
          mode={mode}
          timeSlice={timeSlice}
          scores={scores}
          flyerScores={flyerScores}
          data={appData}
          layerVisibility={layerVisibility}
          analysisCircle={analysisCircle}
          analysisSummary={analysisSummary}
          placementMode={placementMode}
          selectedZoneId={effectiveSelectedId}
          onSelectZone={setSelectedZoneId}
          onCreateAreaCircle={handleCreateAreaCircle}
          onMoveAreaCircle={handleMoveAreaCircle}
          onResizeAreaCircle={handleResizeAreaCircle}
          onClearAreaCircle={handleClearArea}
          onSetAreaRadius={handleSetAreaRadius}
        />
        <IntelPanel
          mode={mode}
          scores={scores}
          flyerScores={flyerScores}
          flyerTimeContext={flyerTimeContext}
          timeSlice={timeSlice}
          analysisEnabled={analysisEnabled}
          placementMode={placementMode}
          analysisCircle={analysisCircle}
          analysisSummary={analysisSummary}
          selectedZoneId={effectiveSelectedId}
          onSelectZone={setSelectedZoneId}
          onClearArea={handleClearArea}
        />
      </div>
    </div>
  );
}
