/* ------------------------------------------------------------------ */
/*  Time model for Flyer Distribution mode                              */
/*  Day-of-week + time-block definitions, multipliers, and helpers      */
/* ------------------------------------------------------------------ */

import type { DayOfWeek, FlyerTimeContext, TimeBlock, TimeSlice } from "@/lib/types";

export type { DayOfWeek, TimeBlock, FlyerTimeContext };

// ---------------------------------------------------------------------------
// Day-of-week multipliers
// Calibrated from Berlin Radzähldaten 2012–2024 weekday/weekend split.
// Wednesday = 1.00 reference. Friday peaks due to leisure+work overlap.
// ---------------------------------------------------------------------------

export const DAYS_ORDERED: DayOfWeek[] = [
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
];

export const DAY_LABELS: Record<DayOfWeek, string> = {
  monday: "Mon",
  tuesday: "Tue",
  wednesday: "Wed",
  thursday: "Thu",
  friday: "Fri",
  saturday: "Sat",
  sunday: "Sun",
};

export const DAY_FULL_LABELS: Record<DayOfWeek, string> = {
  monday: "Monday",
  tuesday: "Tuesday",
  wednesday: "Wednesday",
  thursday: "Thursday",
  friday: "Friday",
  saturday: "Saturday",
  sunday: "Sunday",
};

export const DAY_MULTIPLIERS: Record<DayOfWeek, number> = {
  monday: 0.84,     // post-weekend dip, light commuter volumes
  tuesday: 0.93,    // building toward mid-week peak
  wednesday: 1.00,  // reference day
  thursday: 0.98,   // near reference
  friday: 1.10,     // highest weekday; leisure + work overlap
  saturday: 0.88,   // leisure cyclists present but commuters absent
  sunday: 0.69,     // lowest total volume
};

// ---------------------------------------------------------------------------
// Time-block definitions
// ---------------------------------------------------------------------------

export interface TimeBlockDef {
  id: TimeBlock;
  label: string;       // "Morning 7–10am"
  shortLabel: string;  // "Morning"
  weekdayMultiplier: number;
  weekendMultiplier: number;
}

export const TIME_BLOCK_DEFS: TimeBlockDef[] = [
  {
    id: "morning-peak",
    label: "Morning 7–10am",
    shortLabel: "Morning",
    weekdayMultiplier: 1.22,  // strong commuter spike
    weekendMultiplier: 0.62,  // leisure starts late on weekends
  },
  {
    id: "midday",
    label: "Midday 10am–2pm",
    shortLabel: "Midday",
    weekdayMultiplier: 0.68,  // quiet on weekday
    weekendMultiplier: 1.00,  // family/leisure peak on weekend
  },
  {
    id: "afternoon-peak",
    label: "Afternoon 2–7pm",
    shortLabel: "Afternoon",
    weekdayMultiplier: 1.14,  // commuters home + leisure overlap
    weekendMultiplier: 0.98,  // slightly lower than midday on weekend
  },
  {
    id: "evening",
    label: "Evening 7–10pm",
    shortLabel: "Evening",
    weekdayMultiplier: 0.52,  // significant drop
    weekendMultiplier: 0.55,  // similar drop both days
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function isWeekend(day: DayOfWeek): boolean {
  return day === "saturday" || day === "sunday";
}

/** Maps a FlyerTimeContext to the closest existing TimeSlice for data lookup */
export function flyerContextToTimeSlice(ctx: FlyerTimeContext): TimeSlice {
  if (isWeekend(ctx.day)) return "weekend";
  if (ctx.timeBlock === "morning-peak" || ctx.timeBlock === "afternoon-peak") {
    return "weekday-peak";
  }
  return "weekday-offpeak";
}

/** Combined day × time multiplier for cyclist volume estimation */
export function getTimeMultiplier(ctx: FlyerTimeContext): number {
  const dayMult = DAY_MULTIPLIERS[ctx.day];
  const timeDef = TIME_BLOCK_DEFS.find((t) => t.id === ctx.timeBlock)!;
  const timeMult = isWeekend(ctx.day)
    ? timeDef.weekendMultiplier
    : timeDef.weekdayMultiplier;
  return dayMult * timeMult;
}

/**
 * Within-bucket relative multiplier — differentiates time blocks that map
 * to the same TimeSlice (e.g. morning-peak vs afternoon-peak both map to
 * "weekday-peak"). The sparse estimator already picks the right counter
 * bucket, so we only need the relative variation within that bucket.
 *
 * Computed as: timeBlockMultiplier / average(all blocks in same bucket).
 */
export function getWithinBucketMultiplier(ctx: FlyerTimeContext): number {
  const weekend = isWeekend(ctx.day);
  const timeSlice = flyerContextToTimeSlice(ctx);

  // Gather all time blocks that map to the same time slice
  const siblingMultipliers = TIME_BLOCK_DEFS
    .filter((td) => {
      const siblingCtx: FlyerTimeContext = { day: ctx.day, timeBlock: td.id };
      return flyerContextToTimeSlice(siblingCtx) === timeSlice;
    })
    .map((td) => weekend ? td.weekendMultiplier : td.weekdayMultiplier);

  const bucketAvg = siblingMultipliers.reduce((a, b) => a + b, 0) / siblingMultipliers.length;
  const timeDef = TIME_BLOCK_DEFS.find((t) => t.id === ctx.timeBlock)!;
  const myMult = weekend ? timeDef.weekendMultiplier : timeDef.weekdayMultiplier;

  return bucketAvg > 0 ? myMult / bucketAvg : 1;
}

/** Human-readable label like "Friday · Afternoon 2–7pm" */
export function formatFlyerTimeLabel(ctx: FlyerTimeContext): string {
  const dayLabel = DAY_FULL_LABELS[ctx.day];
  const timeDef = TIME_BLOCK_DEFS.find((t) => t.id === ctx.timeBlock)!;
  return `${dayLabel} · ${timeDef.label}`;
}

/** Short label like "Fri · Afternoon" */
export function formatFlyerTimeShort(ctx: FlyerTimeContext): string {
  const dayLabel = DAY_LABELS[ctx.day];
  const timeDef = TIME_BLOCK_DEFS.find((t) => t.id === ctx.timeBlock)!;
  return `${dayLabel} · ${timeDef.shortLabel}`;
}
