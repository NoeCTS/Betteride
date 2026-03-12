"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

import type { AreaAnalysisCircle, AreaAnalysisSummary } from "@/lib/types";
import { buildAreaActionSteps } from "@/lib/area-analysis";
import { round } from "@/lib/geo";
import css from "./ground-signal.module.css";

interface AreaAnalysisBriefProps {
  circle: AreaAnalysisCircle;
  summary: AreaAnalysisSummary | null;
  onClear: () => void;
  onSetRadius: (radiusKm: number) => void;
}

const RADIUS_PRESETS = [0.5, 1, 1.5, 2];

export default function AreaAnalysisBrief({
  circle,
  summary,
  onClear,
  onSetRadius,
}: AreaAnalysisBriefProps) {
  const [position, setPosition] = useState(getDefaultPosition);
  const dragStateRef = useRef<{
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);

  const actions = useMemo(
    () => (summary ? buildAreaActionSteps(summary) : []),
    [summary],
  );

  useEffect(() => {
    function handlePointerMove(event: PointerEvent) {
      if (!dragStateRef.current) {
        return;
      }

      const nextX = dragStateRef.current.originX + event.clientX - dragStateRef.current.startX;
      const nextY = dragStateRef.current.originY + event.clientY - dragStateRef.current.startY;

      setPosition({
        x: Math.max(12, nextX),
        y: Math.max(12, nextY),
      });
    }

    function handlePointerUp() {
      dragStateRef.current = null;
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, []);

  if (!circle.enabled || !circle.center || !summary) {
    return null;
  }

  const topStation = summary.insideStations[0]?.item.name ?? "No station in circle";
  const topCandidate = summary.insideCandidates[0]?.item.name ?? "No recruit target in circle";

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    dragStateRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      originX: position.x,
      originY: position.y,
    };
  }

  return (
    <div className={css.areaBrief} style={{ left: position.x, top: position.y }}>
      <div className={css.areaBriefHeader} onPointerDown={handlePointerDown}>
        <div className={css.areaBriefHeaderTop}>
          <div className={css.areaBriefEyebrow}>Manual area analysis</div>
          <div className={css.areaBriefTitle}>{round(circle.radiusKm, 2)} km radius</div>
          <span
            className={`${css.confidenceBadge} ${css[`confidenceBadge${capitalize(summary.estimateConfidence)}`]}`}
          >
            {formatConfidenceLabel(summary.estimateConfidence)} confidence
          </span>
        </div>
        <div className={css.areaBriefHeaderActions}>
          <button
            className={css.zoneBriefReset}
            onClick={() => setPosition(getDefaultPosition())}
            type="button"
          >
            Reset
          </button>
          <button className={css.areaBriefClear} onClick={onClear} type="button">
            Clear
          </button>
        </div>
      </div>

      <div className={css.areaBriefStats}>
        <div className={css.zoneBriefStat}>
          <strong>{summary.estimatedCyclistsThroughArea.toLocaleString()}</strong>
          <span>estimated cyclists</span>
        </div>
        <div className={css.zoneBriefStat}>
          <strong>{summary.shopCount}</strong>
          <span>bike shops</span>
        </div>
        <div className={css.zoneBriefStat}>
          <strong>{summary.partnerCount}</strong>
          <span>partners</span>
        </div>
        <div className={css.zoneBriefStat}>
          <strong>{summary.stationCount}</strong>
          <span>stations</span>
        </div>
      </div>

      <div className={css.areaBriefPresets}>
        {RADIUS_PRESETS.map((radiusKm) => (
          <button
            key={radiusKm}
            className={`${css.areaRadiusChip} ${
              Math.abs(circle.radiusKm - radiusKm) < 0.001 ? css.areaRadiusChipActive : ""
            }`}
            onClick={() => onSetRadius(radiusKm)}
            type="button"
          >
            {radiusKm < 1 ? `${Math.round(radiusKm * 1000)} m` : `${radiusKm} km`}
          </button>
        ))}
      </div>

      <div className={css.zoneBriefList}>
        <div className={css.zoneBriefRow}>
          <strong>Observed counter volume</strong>
          <span>{summary.observedCounterVolume.toLocaleString()} in selected time slice</span>
        </div>
        <div className={css.zoneBriefRow}>
          <strong>Local sensor estimate</strong>
          <span>{summary.localSensorEstimate.toLocaleString()} from counters near the circle</span>
        </div>
        <div className={css.zoneBriefRow}>
          <strong>Background estimate</strong>
          <span>{summary.backgroundEstimate.toLocaleString()} from surrounding counters</span>
        </div>
        <div className={css.zoneBriefRow}>
          <strong>Network prior</strong>
          <span>{summary.networkPriorEstimate.toLocaleString()} from corridor and bike-network layers</span>
        </div>
        <div className={css.zoneBriefRow}>
          <strong>Top station</strong>
          <span>{topStation}</span>
        </div>
        <div className={css.zoneBriefRow}>
          <strong>Best recruit target</strong>
          <span>{topCandidate}</span>
        </div>
      </div>

      <ol className={css.zoneBriefActions}>
        {actions.slice(0, 3).map((action) => (
          <li key={action.title}>
            <strong>{action.title}</strong>
            <span>{action.detail}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function getDefaultPosition() {
  if (typeof window !== "undefined") {
    if (window.innerWidth >= 1280) {
      return { x: 356, y: 20 };
    }

    return { x: Math.max(20, window.innerWidth - 312), y: 20 };
  }

  return { x: 20, y: 20 };
}

function formatConfidenceLabel(confidence: AreaAnalysisSummary["estimateConfidence"]) {
  if (confidence === "high") return "High";
  if (confidence === "medium") return "Medium";
  return "Low";
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
