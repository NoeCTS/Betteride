"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

import type { Mode, TimeSlice, ZoneScore } from "@/lib/types";
import { round } from "@/lib/geo";
import { buildZoneInsights } from "@/lib/zone-insights";
import css from "./ground-signal.module.css";

interface SelectedZoneBriefProps {
  mode: Mode;
  timeSlice: TimeSlice;
  scores: ZoneScore[];
  selectedZoneId: string | null;
  onSelectZone: (id: string) => void;
}

export default function SelectedZoneBrief({
  mode,
  timeSlice,
  scores,
  selectedZoneId,
  onSelectZone,
}: SelectedZoneBriefProps) {
  const selected = scores.find((score) => score.zone.id === selectedZoneId) ?? scores[0] ?? null;
  const [position, setPosition] = useState({ x: 20, y: 20 });
  const dragStateRef = useRef<{
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);

  const insights = useMemo(
    () => (selected ? buildZoneInsights(selected, mode, timeSlice) : null),
    [mode, selected, timeSlice],
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

  if (!selected || !insights) {
    return null;
  }

  const zone = selected.zone;
  const topStation = insights.nearbyStations[0]?.item.name ?? "No nearby station";
  const topCounter = insights.nearbyCounters[0]?.item.name ?? "No nearby counter";
  const topCandidate = insights.recruitTargets[0]?.item.name ?? "No recruit target yet";

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    dragStateRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      originX: position.x,
      originY: position.y,
    };
  }

  return (
    <div
      className={css.zoneBrief}
      style={{ left: position.x, top: position.y }}
    >
      <div className={css.zoneBriefHeader} onPointerDown={handlePointerDown}>
        <div>
          <div className={css.zoneBriefEyebrow}>Selected zone</div>
          <div className={css.zoneBriefTitle}>{zone.name}</div>
        </div>
        <button
          className={css.zoneBriefReset}
          onClick={() => setPosition({ x: 20, y: 20 })}
          type="button"
        >
          Reset
        </button>
      </div>

      <select
        className={css.zoneBriefSelect}
        onChange={(event) => onSelectZone(event.target.value)}
        value={zone.id}
      >
        {scores.map((score, index) => (
          <option key={score.zone.id} value={score.zone.id}>
            {index + 1}. {score.zone.name}
          </option>
        ))}
      </select>

      <div className={css.zoneBriefStats}>
        <div className={css.zoneBriefStat}>
          <strong>{insights.dailyCyclists.toLocaleString()}</strong>
          <span>cyclists/day</span>
        </div>
        <div className={css.zoneBriefStat}>
          <strong>{zone.shopCount}</strong>
          <span>bike shops</span>
        </div>
        <div className={css.zoneBriefStat}>
          <strong>{zone.partnerCount}</strong>
          <span>partners</span>
        </div>
        <div className={css.zoneBriefStat}>
          <strong>{zone.candidateCount}</strong>
          <span>recruit targets</span>
        </div>
      </div>

      <div className={css.zoneBriefList}>
        <div className={css.zoneBriefRow}>
          <strong>Top station</strong>
          <span>{topStation}</span>
        </div>
        <div className={css.zoneBriefRow}>
          <strong>Lead counter</strong>
          <span>{topCounter}</span>
        </div>
        <div className={css.zoneBriefRow}>
          <strong>Best recruit target</strong>
          <span>{topCandidate}</span>
        </div>
        <div className={css.zoneBriefRow}>
          <strong>Nearest partner</strong>
          <span>
            {insights.nearestPartnerMinutes != null
              ? `${round(insights.nearestPartnerMinutes, 0)} min`
              : "None in reach"}
          </span>
        </div>
      </div>

      <ol className={css.zoneBriefActions}>
        {insights.actionSteps.slice(0, 3).map((action) => (
          <li key={action.title}>
            <strong>{action.title}</strong>
            <span>{action.detail}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
