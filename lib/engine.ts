/* ------------------------------------------------------------------ */
/*  Scoring engine + intelligence generation                           */
/* ------------------------------------------------------------------ */

import type { AppData, Mode, TimeSlice, Zone, ZoneScore, NearbyCounter } from "@/lib/types";
import { clamp, influenceWithinRadius, normalizeToHundred, round } from "@/lib/geo";

// ---------------------------------------------------------------------------
// Mode-specific opportunity weights
// ---------------------------------------------------------------------------
interface Weights {
  gap: number;
  demand: number;
  supplyInverse: number;
  candidates: number;
  stationAdj: number;
  isolation: number;
}

const MODE_WEIGHTS: Record<Mode, Weights> = {
  "coverage-gap":          { gap: 0.35, demand: 0.30, supplyInverse: 0.20, candidates: 0.00, stationAdj: 0.15, isolation: 0.00 },
  "partner-acquisition":   { gap: 0.20, demand: 0.15, supplyInverse: 0.00, candidates: 0.45, stationAdj: 0.20, isolation: 0.00 },
  "mobile-repair":         { gap: 0.25, demand: 0.25, supplyInverse: 0.00, candidates: 0.00, stationAdj: 0.10, isolation: 0.40 },
  "commuter-reliability":  { gap: 0.20, demand: 0.15, supplyInverse: 0.15, candidates: 0.00, stationAdj: 0.40, isolation: 0.10 },
  // Flyer distribution uses its own scorer (flyer-optimizer.ts); these weights are a fallback only
  "flyer-distribution":    { gap: 0.35, demand: 0.30, supplyInverse: 0.20, candidates: 0.00, stationAdj: 0.15, isolation: 0.00 },
};

// ---------------------------------------------------------------------------
// Score all zones
// ---------------------------------------------------------------------------
export function scoreZones(
  data: AppData,
  mode: Mode,
  timeSlice: TimeSlice,
): ZoneScore[] {
  const weights = MODE_WEIGHTS[mode];

  // Step 1: compute raw demand / supply per zone
  const rawDemands: number[] = [];
  const rawSupplies: number[] = [];
  const rawStationAdj: number[] = [];
  const rawCandidates: number[] = [];
  const rawIsolation: number[] = [];

  for (const zone of data.zones) {
    rawDemands.push(computeDemand(zone, timeSlice));
    rawSupplies.push(computeSupply(zone));
    rawStationAdj.push(computeStationAdjacency(zone));
    rawCandidates.push(zone.candidateCount);
    rawIsolation.push(computeIsolation(zone));
  }

  // Step 2: normalize 0-100
  const normDemand = normalizeToHundred(rawDemands);
  const normSupply = normalizeToHundred(rawSupplies);
  const normStation = normalizeToHundred(rawStationAdj);
  const normCandidates = normalizeToHundred(rawCandidates);
  const normIsolation = normalizeToHundred(rawIsolation);

  // Step 3: compute gap + opportunity per zone
  const scores: ZoneScore[] = data.zones.map((zone, i) => {
    const demand = round(normDemand[i]);
    const supply = round(normSupply[i]);
    const gap = round(clamp((demand - supply + 100) / 2, 0, 100));
    const supplyInverse = round(100 - supply);

    const opportunity = round(clamp(
      weights.gap * gap +
      weights.demand * demand +
      weights.supplyInverse * supplyInverse +
      weights.candidates * normCandidates[i] +
      weights.stationAdj * normStation[i] +
      weights.isolation * normIsolation[i],
      0, 100,
    ));

    const intel = generateIntel(zone, mode, demand, supply, gap, timeSlice);

    return {
      zone,
      demand,
      supply,
      gap,
      opportunity,
      ...intel,
    };
  });

  scores.sort((a, b) => b.opportunity - a.opportunity);
  return scores;
}

// ---------------------------------------------------------------------------
// Demand: counter volume weighted by distance + station weight
// ---------------------------------------------------------------------------
function counterVolume(counter: NearbyCounter, timeSlice: TimeSlice): number {
  const c = counter.item;
  switch (timeSlice) {
    case "weekday-peak": return c.peakAvg;
    case "weekday-offpeak": return c.offPeakAvg;
    case "weekend": return c.weekendAvg;
  }
}

function computeDemand(zone: Zone, timeSlice: TimeSlice): number {
  // Counter volume weighted by proximity (50%)
  let counterSignal = 0;
  for (const nc of zone.nearbyCounters) {
    const influence = influenceWithinRadius(nc.distanceKm, 2.0);
    counterSignal += counterVolume(nc, timeSlice) * influence;
  }

  // Station adjacency as demand proxy (30%)
  let stationSignal = 0;
  for (const ns of zone.nearbyStations) {
    const typeWeight = ns.item.type === "S+U" ? 1.0 : ns.item.type === "S" ? 0.7 : 0.5;
    const influence = influenceWithinRadius(ns.distanceKm, 1.2);
    stationSignal += typeWeight * influence * 100;
  }

  // Shop density as demand proxy (20%)
  const shopSignal = zone.shopCount * 10;

  return counterSignal * 0.5 + stationSignal * 0.3 + shopSignal * 0.2;
}

// ---------------------------------------------------------------------------
// Supply: partner + total shop coverage
// ---------------------------------------------------------------------------
function computeSupply(zone: Zone): number {
  // Partner coverage (45%): partners within zone, weighted by proximity
  let partnerSignal = 0;
  for (const ns of zone.nearbyShops) {
    if (!ns.item.isPartner) continue;
    const influence = influenceWithinRadius(ns.distanceKm, 1.5);
    partnerSignal += influence * 50;
  }

  // Total shop density (35%)
  const densitySignal = zone.shopCount * 5;

  // Coverage redundancy (20%): how many shops within close range
  const closeShops = zone.nearbyShops.filter((s) => s.bikeMinutes <= 10).length;
  const redundancySignal = closeShops * 8;

  return partnerSignal * 0.45 + densitySignal * 0.35 + redundancySignal * 0.2;
}

// ---------------------------------------------------------------------------
// Station adjacency score
// ---------------------------------------------------------------------------
function computeStationAdjacency(zone: Zone): number {
  let score = 0;
  for (const ns of zone.nearbyStations) {
    const typeWeight = ns.item.type === "S+U" ? 3.0 : ns.item.type === "S" ? 2.0 : 1.0;
    const influence = influenceWithinRadius(ns.distanceKm, 1.2);
    score += typeWeight * influence;
  }
  return score;
}

// ---------------------------------------------------------------------------
// Isolation: how far is the nearest partner shop
// ---------------------------------------------------------------------------
function computeIsolation(zone: Zone): number {
  const partnerShops = zone.nearbyShops.filter((s) => s.item.isPartner);
  if (partnerShops.length === 0) return 100; // max isolation
  const nearest = Math.min(...partnerShops.map((s) => s.bikeMinutes));
  return clamp(nearest * 5, 0, 100); // 20 min = score 100
}

// ---------------------------------------------------------------------------
// Intelligence generation
// ---------------------------------------------------------------------------
function generateIntel(
  zone: Zone,
  mode: Mode,
  demand: number,
  supply: number,
  gap: number,
  timeSlice: TimeSlice,
): { headline: string; signals: string[]; action: string; kpis: string[] } {
  const topStation = zone.nearbyStations[0]?.item.name ?? "this area";
  const dailyVolume = zone.nearbyCounters.reduce(
    (sum, nc) => sum + nc.item.avgDaily, 0
  );
  const partnerCount = zone.partnerCount;
  const candidateCount = zone.candidateCount;
  const nearestPartnerMin = zone.nearbyShops.find((s) => s.item.isPartner)?.bikeMinutes;
  const timeLabel = timeSlice === "weekday-peak" ? "peak hours" : timeSlice === "weekend" ? "weekends" : "off-peak hours";

  switch (mode) {
    case "coverage-gap":
      return {
        headline: partnerCount === 0
          ? `High cycling demand near ${topStation} with zero partner coverage`
          : `Strong demand near ${topStation}, only ${partnerCount} partner${partnerCount > 1 ? "s" : ""} within reach`,
        signals: [
          `${dailyVolume.toLocaleString()} cyclists/day pass through nearby counters`,
          `${zone.shopCount} repair shops exist but ${partnerCount === 0 ? "none are" : `only ${partnerCount} ${partnerCount === 1 ? "is" : "are"}`} Betteride partners`,
          `${zone.nearbyStations.length} S/U stations within cycling distance create commuter demand`,
        ],
        action: candidateCount > 3
          ? `Recruit ${Math.min(candidateCount, 5)} candidate shops near ${topStation} to close the coverage gap, prioritizing those closest to station exits`
          : `Launch mobile repair service targeting ${topStation} during ${timeLabel} — no nearby partner capacity to absorb demand`,
        kpis: ["Repair requests per zone", "Booking conversion rate", "Time to first available slot", "Missed demand (searches with no booking)"],
      };

    case "partner-acquisition":
      return {
        headline: `${candidateCount} independent shops near ${topStation} — strong onboarding opportunity`,
        signals: [
          `${candidateCount} non-partner repair shops within 1.5 km cycling radius`,
          `${dailyVolume.toLocaleString()} daily cyclists generate steady repair demand`,
          demand > 60
            ? `Demand score is ${round(demand, 0)}/100 — well above average for Berlin`
            : `Moderate demand (${round(demand, 0)}/100) — focus on highest-volume candidates`,
        ],
        action: `Onboard top ${Math.min(3, candidateCount)} candidates nearest to ${topStation}. Prioritize shops with street visibility and existing online presence.`,
        kpis: ["Partner sign-up rate", "Incremental bookings per new partner", "Coverage radius change", "Partner retention at 90 days"],
      };

    case "mobile-repair":
      return {
        headline: nearestPartnerMin
          ? `Nearest partner is ${round(nearestPartnerMin, 0)} min away — mobile repair opportunity`
          : `No partner shops reachable — strong case for mobile repair unit`,
        signals: [
          nearestPartnerMin
            ? `Closest Betteride partner is ${round(nearestPartnerMin, 0)} bike-minutes away`
            : `Zero partner shops within the zone radius`,
          `${dailyVolume.toLocaleString()} daily cyclists with limited fast-repair access`,
          `${zone.nearbyStations.length} transit stations could serve as pickup/drop-off points`,
        ],
        action: `Test pickup-and-return repair from ${topStation} during ${timeLabel}. Station bike parking areas are natural handoff points.`,
        kpis: ["Pickup requests per day", "Repair completion rate", "Avg turnaround time", "Customer satisfaction score", "Cost per repair vs shop average"],
      };

    case "commuter-reliability":
      return {
        headline: `${topStation} corridor: ${zone.nearbyStations.length} stations, commuters need dependable same-day repair`,
        signals: [
          `${zone.nearbyStations.length} S/U stations within cycling distance — high commuter density`,
          `${dailyVolume.toLocaleString()} daily cyclists, concentrated during ${timeLabel}`,
          partnerCount > 0
            ? `${partnerCount} partner${partnerCount > 1 ? "s" : ""} serve this area but peak capacity may be insufficient`
            : `No Betteride partners — commuters have zero same-day booking option`,
        ],
        action: partnerCount > 0
          ? `Ensure same-day repair capacity near ${topStation} during peak hours. Consider guaranteed turnaround SLA for commuter bookings.`
          : `Priority: establish at least one partner or mobile unit near ${topStation} for weekday commuter coverage.`,
        kpis: ["Peak-hour booking fill rate", "Same-day completion %", "Commuter repeat booking rate", "Avg time from booking to repair start"],
      };

    case "flyer-distribution":
      return {
        headline: `Use Flyer Distribution mode for zone-specific marketing recommendations`,
        signals: [`${dailyVolume.toLocaleString()} daily cyclists nearby`, `${zone.shopCount} repair shops in zone`],
        action: `Switch to Flyer Distribution mode to get day-by-day, spot-level flyer recommendations for this zone.`,
        kpis: ["Flyers distributed per session", "QR scan / redemption rate"],
      };
  }
}
