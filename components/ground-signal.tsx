"use client";

import { startTransition, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import type {
  AreaAnalysisCircle,
  AppData,
  FlyerConditions,
  FlyerPlan,
  FlyerPlannerInput,
  FlyerTimeContext,
  LayerVisibility,
  MapLayerKey,
  Mode,
  TimeSlice,
} from "@/lib/types";
import { clampKmRadius } from "@/lib/geo";
import { summarizeAreaCircle } from "@/lib/area-analysis";
import { scoreZones } from "@/lib/engine";
import { planFlyerAssignments } from "@/lib/flyer-planner";
import { scoreFlyerZones } from "@/lib/flyer-optimizer";
import { flyerContextToTimeSlice } from "@/lib/time-model";
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
  candidates: false,
};
const DEFAULT_FLYER_LAYER_VISIBILITY: LayerVisibility = {
  zones: true,
  stations: false,
  partners: false,
  candidates: false,
};
const DEFAULT_AREA_RADIUS_KM = 1;
const DEFAULT_FLYER_PLANNER_INPUT: FlyerPlannerInput = {
  teamSize: 5,
  sessionHours: 2,
};
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
  const [detailsPanelOpen, setDetailsPanelOpen] = useState(false);
  const [mapFullscreen, setMapFullscreen] = useState(false);
  const [flyerPlannerInput, setFlyerPlannerInput] = useState<FlyerPlannerInput>(
    DEFAULT_FLYER_PLANNER_INPUT,
  );
  const [analysisCircle, setAnalysisCircle] =
    useState<AreaAnalysisCircle>(EMPTY_AREA_CIRCLE);
  const [flyerConditions, setFlyerConditions] = useState<FlyerConditions | null>(null);
  const [flyerConditionsStatus, setFlyerConditionsStatus] =
    useState<"idle" | "loading" | "ready" | "error">("idle");

  const scores = useMemo(
    () => scoreZones(appData, mode, timeSlice),
    [mode, timeSlice],
  );
  const flyerScores = useMemo(
    () => mode === "flyer-distribution" ? scoreFlyerZones(appData, flyerTimeContext, flyerConditions) : [],
    [mode, flyerConditions, flyerTimeContext],
  );
  const flyerPlan = useMemo<FlyerPlan | null>(
    () => mode === "flyer-distribution"
      ? planFlyerAssignments(flyerScores, flyerTimeContext, flyerPlannerInput)
      : null,
    [flyerPlannerInput, flyerScores, flyerTimeContext, mode],
  );
  const analysisTimeSlice = mode === "flyer-distribution"
    ? flyerContextToTimeSlice(flyerTimeContext)
    : timeSlice;
  const analysisSummary = useMemo(
    () => summarizeAreaCircle(appData, analysisCircle, analysisTimeSlice),
    [analysisCircle, analysisTimeSlice],
  );

  useEffect(() => {
    if (mode !== "flyer-distribution") {
      return;
    }

    const controller = new AbortController();

    fetch(`/api/flyer-conditions?day=${flyerTimeContext.day}&timeBlock=${flyerTimeContext.timeBlock}`, {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Failed to load flyer conditions (${response.status})`);
        }

        const payload = await response.json() as FlyerConditions;
        startTransition(() => {
          setFlyerConditions(payload);
        });
        setFlyerConditionsStatus("ready");
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          return;
        }

        console.error(error);
        setFlyerConditions(null);
        setFlyerConditionsStatus("error");
      });

    return () => controller.abort();
  }, [flyerTimeContext.day, flyerTimeContext.timeBlock, mode]);

  function handleToggleLayer(key: MapLayerKey) {
    setLayerVisibility((current) => ({ ...current, [key]: !current[key] }));
  }

  function handleModeChange(nextMode: Mode) {
    setMode(nextMode);
    setSelectedZoneId(null);

    if (nextMode === "flyer-distribution") {
      setFlyerConditions(null);
      setFlyerConditionsStatus("loading");
      setDetailsPanelOpen(true);
      setLayerVisibility(DEFAULT_FLYER_LAYER_VISIBILITY);
      return;
    }

    setLayerVisibility(DEFAULT_LAYER_VISIBILITY);
  }

  function handleFlyerTimeContextChange(nextContext: FlyerTimeContext) {
    setFlyerTimeContext(nextContext);
    setFlyerConditions(null);
    setFlyerConditionsStatus("loading");
  }

  function handleSelectZone(nextZoneId: string) {
    setSelectedZoneId(nextZoneId);
    setDetailsPanelOpen(true);
  }

  function handleFlyerPlannerInputChange(nextInput: FlyerPlannerInput) {
    setFlyerPlannerInput(nextInput);
    setDetailsPanelOpen(true);
  }

  function handleToggleMapFullscreen() {
    if (!mapFullscreen) {
      setDetailsPanelOpen(false);
    }

    setMapFullscreen((current) => !current);
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

  const intelPanel = detailsPanelOpen ? (
    <IntelPanel
      mode={mode}
      scores={scores}
      flyerScores={flyerScores}
      flyerTimeContext={flyerTimeContext}
      flyerConditions={flyerConditions}
      flyerConditionsStatus={flyerConditionsStatus}
      flyerPlan={flyerPlan}
      flyerPlannerInput={flyerPlannerInput}
      timeSlice={timeSlice}
      analysisEnabled={analysisEnabled}
      placementMode={placementMode}
      analysisCircle={analysisCircle}
      analysisSummary={analysisSummary}
      selectedZoneId={effectiveSelectedId}
      onClosePanel={() => setDetailsPanelOpen(false)}
      onSelectZone={handleSelectZone}
      onClearArea={handleClearArea}
    />
  ) : null;

  return (
    <div className={`${css.shell} ${mapFullscreen ? css.shellMapFullscreen : ""}`}>
      {!mapFullscreen ? (
        <ModeBar
          mode={mode}
          timeSlice={timeSlice}
          flyerTimeContext={flyerTimeContext}
          flyerPlannerInput={flyerPlannerInput}
          onModeChange={handleModeChange}
          onTimeSliceChange={setTimeSlice}
          onFlyerTimeContextChange={handleFlyerTimeContextChange}
          onFlyerPlannerInputChange={handleFlyerPlannerInputChange}
          layerVisibility={layerVisibility}
          onToggleLayer={handleToggleLayer}
        />
      ) : null}
      <div
        className={`${css.main} ${detailsPanelOpen && !mapFullscreen ? "" : css.mainExpanded} ${
          mapFullscreen ? css.mainMapFullscreen : ""
        }`}
      >
        <SignalMap
          mode={mode}
          scores={scores}
          flyerScores={flyerScores}
          flyerPlan={flyerPlan}
          data={appData}
          layerVisibility={layerVisibility}
          analysisCircle={analysisCircle}
          analysisSummary={analysisSummary}
          placementMode={placementMode}
          detailsPanelOpen={detailsPanelOpen}
          mapFullscreen={mapFullscreen}
          autoCenterZone={selectedZoneId !== null}
          selectedZoneId={selectedZoneId}
          onSelectZone={handleSelectZone}
          onToggleDetailsPanel={() => setDetailsPanelOpen((current) => !current)}
          onToggleMapFullscreen={handleToggleMapFullscreen}
          onCreateAreaCircle={handleCreateAreaCircle}
          onMoveAreaCircle={handleMoveAreaCircle}
          onResizeAreaCircle={handleResizeAreaCircle}
          onClearAreaCircle={handleClearArea}
          onSetAreaRadius={handleSetAreaRadius}
        />
        {!mapFullscreen ? intelPanel : null}
      </div>
      {mapFullscreen && intelPanel ? <div className={css.fullscreenPanel}>{intelPanel}</div> : null}
    </div>
  );
}
