import type { FlyerTimeContext, LayerVisibility, MapLayerKey, Mode, TimeSlice } from "@/lib/types";
import { MODE_DEFS } from "@/lib/types";
import { DAYS_ORDERED, DAY_LABELS, TIME_BLOCK_DEFS } from "@/lib/time-model";
import css from "./ground-signal.module.css";

const TIME_SLICES: { id: TimeSlice; label: string }[] = [
  { id: "weekday-peak", label: "Peak" },
  { id: "weekday-offpeak", label: "Off-peak" },
  { id: "weekend", label: "Weekend" },
];

interface ModeBarProps {
  mode: Mode;
  timeSlice: TimeSlice;
  flyerTimeContext: FlyerTimeContext;
  layerVisibility: LayerVisibility;
  analysisEnabled: boolean;
  placementMode: boolean;
  hasAreaCircle: boolean;
  areaRadiusKm: number;
  onModeChange: (m: Mode) => void;
  onTimeSliceChange: (t: TimeSlice) => void;
  onFlyerTimeContextChange: (ctx: FlyerTimeContext) => void;
  onToggleLayer: (layer: MapLayerKey) => void;
  onToggleAnalysis: () => void;
  onClearArea: () => void;
  onSetAreaRadius: (radiusKm: number) => void;
}

const LAYER_TOGGLES: { id: MapLayerKey; label: string }[] = [
  { id: "zones", label: "Zones" },
  { id: "stations", label: "Transport" },
  { id: "partners", label: "Partners" },
  { id: "candidates", label: "Bike shops" },
];
const AREA_RADIUS_PRESETS = [0.5, 1, 1.5, 2];

const WEEKEND_DAYS = new Set(["saturday", "sunday"]);

export default function ModeBar({
  mode,
  timeSlice,
  flyerTimeContext,
  layerVisibility,
  analysisEnabled,
  placementMode,
  hasAreaCircle,
  areaRadiusKm,
  onModeChange,
  onTimeSliceChange,
  onFlyerTimeContextChange,
  onToggleLayer,
  onToggleAnalysis,
  onClearArea,
  onSetAreaRadius,
}: ModeBarProps) {
  const activeMode = MODE_DEFS.find((item) => item.id === mode) ?? MODE_DEFS[0];
  const isFlyerMode = mode === "flyer-distribution";

  return (
    <div className={css.modeBar}>
      <span className={css.brand}>Ground Signal</span>

      <div className={css.modeTabs}>
        {MODE_DEFS.map((m) => (
          <button
            key={m.id}
            className={`${css.modeTab} ${mode === m.id ? css.modeTabActive : ""}`}
            style={
              mode === m.id
                ? { background: m.accent, borderColor: m.accent }
                : undefined
            }
            onClick={() => onModeChange(m.id)}
          >
            {m.label}
          </button>
        ))}
      </div>

      {/* Standard time slice buttons — hidden in flyer mode */}
      {!isFlyerMode && (
        <div className={css.timeTabs}>
          {TIME_SLICES.map((t) => (
            <button
              key={t.id}
              className={`${css.timeTab} ${timeSlice === t.id ? css.timeTabActive : ""}`}
              onClick={() => onTimeSliceChange(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {/* Flyer mode: day-of-week + time-block pickers */}
      {isFlyerMode && (
        <>
          <div className={css.timeTabs}>
            {DAYS_ORDERED.map((day) => {
              const isWeekendDay = WEEKEND_DAYS.has(day);
              const isActive = flyerTimeContext.day === day;
              return (
                <button
                  key={day}
                  className={`${css.timeTab} ${isActive ? css.timeTabActive : ""}`}
                  style={
                    isActive
                      ? { background: activeMode.accent, borderColor: activeMode.accent }
                      : isWeekendDay
                        ? { opacity: 0.75 }
                        : undefined
                  }
                  onClick={() => onFlyerTimeContextChange({ ...flyerTimeContext, day })}
                  type="button"
                >
                  {DAY_LABELS[day]}
                </button>
              );
            })}
          </div>

          <div className={css.timeTabs}>
            {TIME_BLOCK_DEFS.map((tb) => {
              const isActive = flyerTimeContext.timeBlock === tb.id;
              return (
                <button
                  key={tb.id}
                  className={`${css.timeTab} ${isActive ? css.timeTabActive : ""}`}
                  style={
                    isActive
                      ? { background: activeMode.accent, borderColor: activeMode.accent }
                      : undefined
                  }
                  onClick={() => onFlyerTimeContextChange({ ...flyerTimeContext, timeBlock: tb.id })}
                  type="button"
                >
                  {tb.shortLabel}
                </button>
              );
            })}
          </div>
        </>
      )}

      <div className={css.layerToggles}>
        {LAYER_TOGGLES.map((layer) => (
          <button
            key={layer.id}
            className={`${css.layerToggle} ${layerVisibility[layer.id] ? css.layerToggleActive : ""}`}
            onClick={() => onToggleLayer(layer.id)}
            type="button"
          >
            {layer.label}
          </button>
        ))}
      </div>

      {!isFlyerMode && (
        <div className={css.areaControls}>
          <button
            className={`${css.areaControlButton} ${
              analysisEnabled ? css.areaControlButtonActive : ""
            }`}
            onClick={onToggleAnalysis}
            type="button"
          >
            {placementMode
              ? "Click map to place"
              : hasAreaCircle
                ? "Place new area"
                : "Analyze Area"}
          </button>

          {hasAreaCircle ? (
            <button
              className={css.areaControlGhost}
              onClick={onClearArea}
              type="button"
            >
              Clear Area
            </button>
          ) : null}
        </div>
      )}

      {!isFlyerMode && hasAreaCircle ? (
        <div className={css.areaRadiusChips}>
          {AREA_RADIUS_PRESETS.map((radiusKm) => (
            <button
              key={radiusKm}
              className={`${css.areaRadiusChip} ${
                Math.abs(areaRadiusKm - radiusKm) < 0.001 ? css.areaRadiusChipActive : ""
              }`}
              onClick={() => onSetAreaRadius(radiusKm)}
              type="button"
            >
              {radiusKm < 1 ? `${Math.round(radiusKm * 1000)} m` : `${radiusKm} km`}
            </button>
          ))}
        </div>
      ) : null}

      <div className={css.modeDescription}>
        <strong>{activeMode.label}:</strong> {activeMode.description}
      </div>
    </div>
  );
}
