import type {
  Mode,
  NearbyCounter,
  NearbyShop,
  NearbyStation,
  TimeSlice,
  ZoneScore,
} from "@/lib/types";
import { getCounterMetricForTimeSlice } from "@/lib/area-analysis";

export interface ActionStep {
  title: string;
  detail: string;
}

export interface ZoneInsightBundle {
  dailyCyclists: number;
  nearestPartnerMinutes: number | null;
  recruitTargets: NearbyShop[];
  currentPartners: NearbyShop[];
  nearbyStations: NearbyStation[];
  nearbyCounters: NearbyCounter[];
  actionSteps: ActionStep[];
}

export function buildZoneInsights(
  score: ZoneScore,
  mode: Mode,
  timeSlice?: TimeSlice,
): ZoneInsightBundle {
  const zone = score.zone;
  const dailyCyclists = zone.nearbyCounters.reduce(
    (sum, counter) =>
      sum + (timeSlice ? getCounterMetricForTimeSlice(counter.item, timeSlice) : counter.item.avgDaily),
    0,
  );
  const recruitTargets = zone.nearbyShops
    .filter((shop) => !shop.item.isPartner)
    .slice(0, 5);
  const currentPartners = zone.nearbyShops
    .filter((shop) => shop.item.isPartner)
    .slice(0, 4);
  const nearbyStations = zone.nearbyStations.slice(0, 4);
  const nearbyCounters = [...zone.nearbyCounters]
    .sort((left, right) => right.item.avgDaily - left.item.avgDaily)
    .slice(0, 4);
  const nearestPartnerMinutes = currentPartners[0]?.bikeMinutes ?? null;

  return {
    dailyCyclists,
    nearestPartnerMinutes,
    recruitTargets,
    currentPartners,
    nearbyStations,
    nearbyCounters,
    actionSteps: buildActionSteps(score, mode, dailyCyclists, nearestPartnerMinutes),
  };
}

function buildActionSteps(
  score: ZoneScore,
  mode: Mode,
  dailyCyclists: number,
  nearestPartnerMinutes: number | null,
): ActionStep[] {
  const zone = score.zone;
  const anchorStation = zone.nearbyStations[0]?.item.name ?? zone.name;
  const topCandidate = zone.nearbyShops.find((shop) => !shop.item.isPartner)?.item.name;
  const topCounter = [...zone.nearbyCounters].sort(
    (left, right) => right.item.avgDaily - left.item.avgDaily,
  )[0];

  const genericActions: ActionStep[] = [
    {
      title: "Validate zone demand",
      detail: `${dailyCyclists.toLocaleString()} cyclists/day are flowing through nearby counters, led by ${topCounter?.item.name ?? "local counter coverage"}.`,
    },
    {
      title: "Audit supply coverage",
      detail:
        nearestPartnerMinutes != null
          ? `The nearest current partner is ${nearestPartnerMinutes.toFixed(1)} bike-minutes away.`
          : "No current Betteride partner is within the zone reach radius.",
    },
  ];

  switch (mode) {
    case "coverage-gap":
      return [
        {
          title: "Close the gap first",
          detail: topCandidate
            ? `Prioritize outreach to ${topCandidate} and the closest non-partner shops around ${anchorStation}.`
            : `No obvious recruit targets are nearby, so ${anchorStation} is a candidate for mobile or pop-up repair coverage.`,
        },
        ...genericActions,
        {
          title: "Track the operational outcome",
          detail: "Watch missed-demand, time-to-first-slot, and same-day completion once coverage changes.",
        },
      ];

    case "mobile-repair":
      return [
        {
          title: "Set a mobile handoff point",
          detail: `Use ${anchorStation} as the default pickup/drop-off anchor during the selected time slice.`,
        },
        ...genericActions,
        {
          title: "Stress-test mobile economics",
          detail: "Compare turnaround time, van utilization, and repair margin against nearby fixed-shop capacity.",
        },
      ];

    case "commuter-reliability":
      return [
        {
          title: "Protect commuter reliability",
          detail: `Treat ${anchorStation} as the commuter anchor and reserve same-day repair capacity around it.`,
        },
        ...genericActions,
        {
          title: "Watch peak-hour performance",
          detail: "Track fill rate, same-day completion, and commuter repeat bookings during peak windows.",
        },
      ];

    case "flyer-distribution":
      return [
        {
          title: "Switch to Flyer Distribution mode",
          detail: "Use the Flyer Distribution tab to get day-by-day, spot-level recommendations for this zone.",
        },
        ...genericActions,
      ];
  }
}
