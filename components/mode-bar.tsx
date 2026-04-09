import Image from "next/image";
import type {
  FlyerPlannerInput,
  FlyerTimeContext,
  Mode,
  TimeSlice,
} from "@/lib/types";
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
  flyerPlannerInput: FlyerPlannerInput;
  onModeChange: (m: Mode) => void;
  onTimeSliceChange: (t: TimeSlice) => void;
  onFlyerTimeContextChange: (ctx: FlyerTimeContext) => void;
  onFlyerPlannerInputChange: (input: FlyerPlannerInput) => void;
}

const TEAM_SIZE_PRESETS = [1, 2, 3, 4, 5, 6];
const SESSION_HOUR_PRESETS = [1, 2, 3];

export default function ModeBar({
  mode,
  timeSlice,
  flyerTimeContext,
  flyerPlannerInput,
  onModeChange,
  onTimeSliceChange,
  onFlyerTimeContextChange,
  onFlyerPlannerInputChange,
}: ModeBarProps) {
  const isFlyerMode = mode === "flyer-distribution";

  return (
    <div className={css.modeBar}>
      <div className={css.brandBlock}>
        <Image
          alt="Betteride logo"
          className={css.brandLogo}
          height={28}
          src="/betteride-circle-logo.svg"
          width={28}
        />
        <span className={css.brand}>Betteride</span>
      </div>

      <div className={css.toolbarDivider} />

      <div className={css.modeTabs}>
        {MODE_DEFS.map((m) => (
          <button
            key={m.id}
            className={`${css.modeTab} ${mode === m.id ? css.modeTabActive : ""}`}
            onClick={() => onModeChange(m.id)}
            style={mode === m.id ? { background: m.accent, borderColor: m.accent } : undefined}
            title={m.label}
            type="button"
          >
            {m.short}
          </button>
        ))}
      </div>

      <div className={css.toolbarDivider} />

      {!isFlyerMode ? (
        <label className={css.toolbarSection}>
          <span className={css.toolbarLabel}>Window</span>
          <select
            className={css.toolbarSelect}
            onChange={(event) => onTimeSliceChange(event.target.value as TimeSlice)}
            value={timeSlice}
          >
            {TIME_SLICES.map((slice) => (
              <option key={slice.id} value={slice.id}>
                {slice.label}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <>
          <label className={css.toolbarSection}>
            <span className={css.toolbarLabel}>Day</span>
            <select
              className={css.toolbarSelect}
              onChange={(event) =>
                onFlyerTimeContextChange({
                  ...flyerTimeContext,
                  day: event.target.value as FlyerTimeContext["day"],
                })}
              value={flyerTimeContext.day}
            >
              {DAYS_ORDERED.map((day) => (
                <option key={day} value={day}>
                  {DAY_LABELS[day]}
                </option>
              ))}
            </select>
          </label>

          <label className={css.toolbarSection}>
            <span className={css.toolbarLabel}>Block</span>
            <select
              className={css.toolbarSelect}
              onChange={(event) =>
                onFlyerTimeContextChange({
                  ...flyerTimeContext,
                  timeBlock: event.target.value as FlyerTimeContext["timeBlock"],
                })}
              value={flyerTimeContext.timeBlock}
            >
              {TIME_BLOCK_DEFS.map((timeBlock) => (
                <option key={timeBlock.id} value={timeBlock.id}>
                  {timeBlock.shortLabel}
                </option>
              ))}
            </select>
          </label>

          <label className={css.toolbarSection}>
            <span className={css.toolbarLabel}>Team</span>
            <select
              className={css.toolbarSelect}
              onChange={(event) =>
                onFlyerPlannerInputChange({
                  ...flyerPlannerInput,
                  teamSize: Number(event.target.value),
                })}
              value={String(flyerPlannerInput.teamSize)}
            >
              {TEAM_SIZE_PRESETS.map((teamSize) => (
                <option key={teamSize} value={teamSize}>
                  {teamSize} rep{teamSize === 1 ? "" : "s"}
                </option>
              ))}
            </select>
          </label>

          <label className={css.toolbarSection}>
            <span className={css.toolbarLabel}>Length</span>
            <select
              className={css.toolbarSelect}
              onChange={(event) =>
                onFlyerPlannerInputChange({
                  ...flyerPlannerInput,
                  sessionHours: Number(event.target.value),
                })}
              value={String(flyerPlannerInput.sessionHours)}
            >
              {SESSION_HOUR_PRESETS.map((sessionHours) => (
                <option key={sessionHours} value={sessionHours}>
                  {sessionHours}h
                </option>
              ))}
            </select>
          </label>
        </>
      )}
    </div>
  );
}
