/* ------------------------------------------------------------------ */
/*  Berlin Enrichment Module                                           */
/*  Provides POI lookups, population density estimation, audience      */
/*  segmentation, and a fallback cyclist volume estimator for zones    */
/*  with zero or sparse bike counter data.                             */
/* ------------------------------------------------------------------ */

import rawEnrichment from "@/data/raw/berlin-enrichment.json";
import {
  BERLIN_DISTRICT_PROFILE_MAP,
} from "@/lib/berlin-district-profiles";
import { clamp, distanceKm, influenceWithinRadius, round } from "@/lib/geo";
import type {
  DistrictContext,
  DistrictSocioeconomic,
  NearbyStation,
  TimeSlice,
} from "@/lib/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface University {
  id: string;
  name: string;
  lat: number;
  lon: number;
  enrollment: number;
  type: string;
}

export interface BikeSharingStation {
  id: string;
  name: string;
  operator: string;
  lat: number;
  lon: number;
  capacity: number;
}

export interface OfficeArea {
  id: string;
  name: string;
  lat: number;
  lon: number;
  type: string;
  employeeEstimate: number;
}

export interface District {
  id: string;
  name: string;
  lat: number;
  lon: number;
  population: number;
  areaKm2: number;
  bikeTheftDensity: number;
  socioeconomic: DistrictSocioeconomic;
}

export type AudienceSegment = "student" | "commuter" | "office-worker" | "leisure" | "residential";

export interface AudienceProfile {
  primary: AudienceSegment;
  secondary: AudienceSegment | null;
  confidence: number;
  flyerTone: string;
  receptivityMultiplier: number;
  detail: string;
}

export interface AreaEnrichment {
  nearbyUniversities: { item: University; distanceKm: number }[];
  nearbyBikeSharing: { item: BikeSharingStation; distanceKm: number }[];
  nearbyOfficeAreas: { item: OfficeArea; distanceKm: number }[];
  populationDensity: number;       // people per km²
  cyclingModalShare: number;       // 0–1 fraction
  district: District | null;
  districtContext: DistrictContext;
  audienceProfile: AudienceProfile;
  bikeSharingCapacity: number;     // total dock capacity in radius
  universityEnrollment: number;    // total nearby student enrollment
  officeEmployees: number;         // total nearby employees
  bikeTheftDensity: number;        // thefts per 1k residents
  repairDemandScore: number;       // 0-100 repair demand proxy
  repairDemandMultiplier: number;  // multiplier derived from district priors
  socioeconomic: DistrictSocioeconomic | null;
}

export interface FallbackCyclistEstimate {
  value: number;
  method: "enrichment-proxy";
  populationTerm: number;
  transitTerm: number;
  bikeSharingTerm: number;
  universityTerm: number;
  officeTerm: number;
  confidence: "low" | "medium";
}

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------

const enrichment = rawEnrichment as {
  universities: University[];
  bikeSharing: BikeSharingStation[];
  officeAreas: OfficeArea[];
  districts: Array<Omit<District, "bikeTheftDensity" | "socioeconomic">>;
  cyclingModalShare: Record<string, number>;
  audienceSegments: Record<string, {
    description: string;
    flyerTone: string;
    peakTimes: string[];
    receptivityMultiplier: number;
  }>;
};

const districts: District[] = enrichment.districts.map((district) => {
  const profile = BERLIN_DISTRICT_PROFILE_MAP[district.id];
  return {
    ...district,
    bikeTheftDensity: profile?.bikeTheftDensity ?? 4.5,
    socioeconomic: profile?.socioeconomic ?? getFallbackSocioeconomicProfile(),
  };
});

// ---------------------------------------------------------------------------
// Core: enrich a location
// ---------------------------------------------------------------------------

export function enrichLocation(
  center: { lat: number; lon: number },
  radiusKm: number,
): AreaEnrichment {
  const searchRadius = Math.max(radiusKm, 1.5); // minimum 1.5km search for context

  // Find nearby universities
  const nearbyUniversities = enrichment.universities
    .map((u) => ({ item: u, distanceKm: distanceKm(center, u) }))
    .filter((u) => u.distanceKm <= searchRadius)
    .sort((a, b) => a.distanceKm - b.distanceKm);

  // Find nearby bike sharing stations
  const nearbyBikeSharing = enrichment.bikeSharing
    .map((bs) => ({ item: bs, distanceKm: distanceKm(center, bs) }))
    .filter((bs) => bs.distanceKm <= searchRadius)
    .sort((a, b) => a.distanceKm - b.distanceKm);

  // Find nearby office areas
  const nearbyOfficeAreas = enrichment.officeAreas
    .map((o) => ({ item: o, distanceKm: distanceKm(center, o) }))
    .filter((o) => o.distanceKm <= searchRadius)
    .sort((a, b) => a.distanceKm - b.distanceKm);

  // Find closest district for population & modal share
  const district = findClosestDistrict(center);
  const populationDensity = district ? district.population / district.areaKm2 : 4000;
  const cyclingModalShare = district
    ? enrichment.cyclingModalShare[district.id] ?? 0.15
    : 0.15;
  const districtContext = buildDistrictContext(district, populationDensity, cyclingModalShare);
  const repairDemandScore = computeRepairDemandScore(districtContext);

  // Aggregate numbers
  const bikeSharingCapacity = nearbyBikeSharing.reduce(
    (sum, bs) => sum + (bs.item.capacity ?? 0) * influenceWithinRadius(bs.distanceKm, searchRadius),
    0,
  );
  const universityEnrollment = nearbyUniversities.reduce(
    (sum, u) => sum + u.item.enrollment * influenceWithinRadius(u.distanceKm, searchRadius),
    0,
  );
  const officeEmployees = nearbyOfficeAreas.reduce(
    (sum, o) => sum + o.item.employeeEstimate * influenceWithinRadius(o.distanceKm, searchRadius),
    0,
  );

  // Compute audience profile
  const audienceProfile = computeAudienceProfile(
    nearbyUniversities,
    nearbyOfficeAreas,
    nearbyBikeSharing,
    populationDensity,
    cyclingModalShare,
  );

  return {
    nearbyUniversities,
    nearbyBikeSharing,
    nearbyOfficeAreas,
    populationDensity,
    cyclingModalShare,
    district,
    districtContext,
    audienceProfile,
    bikeSharingCapacity,
    universityEnrollment,
    officeEmployees,
    bikeTheftDensity: districtContext.bikeTheftDensity ?? 0,
    repairDemandScore,
    repairDemandMultiplier: getRepairDemandMultiplier(repairDemandScore),
    socioeconomic: districtContext.socioeconomic,
  };
}

// ---------------------------------------------------------------------------
// Fallback cyclist volume estimator — for zones with zero counter data
// Uses population density, transit, bike sharing, universities, offices
// as proxy signals to estimate likely cyclist volume.
// ---------------------------------------------------------------------------

export function estimateFallbackCyclistVolume(
  center: { lat: number; lon: number },
  radiusKm: number,
  timeSlice: TimeSlice,
  insideStations: NearbyStation[],
  enrichmentData: AreaEnrichment,
): FallbackCyclistEstimate {
  const TIME_MULTIPLIER: Record<TimeSlice, number> = {
    "weekday-peak": 1.25,
    "weekday-offpeak": 0.85,
    "weekend": 0.75,
  };
  const timeMult = TIME_MULTIPLIER[timeSlice];
  const areaScale = 0.25 + 0.75 * radiusKm;

  // Term 1: Population-based estimate
  // Population density × cycling modal share × average trips per day × capture rate
  // Average cycling trips/day for a cyclist: ~2.2 (SrV 2018)
  // Hourly fraction of daily cycling trips: ~8% peak, ~5% offpeak
  const HOURLY_FRACTION: Record<TimeSlice, number> = {
    "weekday-peak": 0.08,
    "weekday-offpeak": 0.05,
    "weekend": 0.06,
  };
  const populationInArea = enrichmentData.populationDensity * Math.PI * radiusKm * radiusKm;
  const dailyCyclists = populationInArea * enrichmentData.cyclingModalShare * 2.2;
  const populationTerm = dailyCyclists * HOURLY_FRACTION[timeSlice];

  // Term 2: Transit proximity (stations generate cyclist flows)
  const STATION_CYCLIST_BASE: Record<string, number> = { "S+U": 280, S: 180, U: 120 };
  let transitTerm = 0;
  for (const station of insideStations) {
    const base = STATION_CYCLIST_BASE[station.item.type] ?? 120;
    const proximity = influenceWithinRadius(station.distanceKm, Math.max(radiusKm, 0.5));
    transitTerm += base * proximity * timeMult;
  }

  // Term 3: Bike sharing density (indicates cycling infrastructure demand)
  // Each bike sharing dock generates ~3-5 trips/day → ~0.3 cyclists/hr passing nearby
  const bikeSharingTerm = enrichmentData.bikeSharingCapacity * 0.3 * timeMult * areaScale;

  // Term 4: University proximity (students cycle heavily)
  // ~15% of enrolled students cycle on any given day, ~2 trips/day
  const dailyStudentCyclists = enrichmentData.universityEnrollment * 0.15 * 2;
  const universityTerm = dailyStudentCyclists * HOURLY_FRACTION[timeSlice];

  // Term 5: Office area proximity (commuter cyclists)
  // ~8% of office workers cycle to work
  const dailyOfficeCyclists = enrichmentData.officeEmployees * 0.08 * 2;
  const officeTerm = dailyOfficeCyclists * HOURLY_FRACTION[timeSlice];

  // Blend: population is the base, other terms add signal
  const value = Math.round(
    0.35 * populationTerm +
    0.25 * transitTerm +
    0.15 * bikeSharingTerm +
    0.15 * universityTerm +
    0.10 * officeTerm,
  );

  // Confidence: medium if we have at least some transit + population, low otherwise
  const hasSignals = insideStations.length > 0 ||
    enrichmentData.bikeSharingCapacity > 0 ||
    enrichmentData.universityEnrollment > 0;
  const confidence = hasSignals ? "medium" as const : "low" as const;

  return {
    value: Math.max(0, value),
    method: "enrichment-proxy",
    populationTerm: Math.round(populationTerm),
    transitTerm: Math.round(transitTerm),
    bikeSharingTerm: Math.round(bikeSharingTerm),
    universityTerm: Math.round(universityTerm),
    officeTerm: Math.round(officeTerm),
    confidence,
  };
}

// ---------------------------------------------------------------------------
// Audience segmentation
// ---------------------------------------------------------------------------

function computeAudienceProfile(
  universities: { item: University; distanceKm: number }[],
  offices: { item: OfficeArea; distanceKm: number }[],
  bikeSharing: { item: BikeSharingStation; distanceKm: number }[],
  populationDensity: number,
  cyclingModalShare: number,
): AudienceProfile {
  // Score each segment based on nearby POIs
  const studentScore = universities.reduce(
    (sum, u) => sum + (u.item.enrollment / 5000) * Math.max(0, 1 - u.distanceKm / 2),
    0,
  );

  const officeScore = offices.reduce(
    (sum, o) => sum + (o.item.employeeEstimate / 5000) * Math.max(0, 1 - o.distanceKm / 2),
    0,
  );

  // Commuter score = high if near transit AND high cycling modal share
  const commuterScore = cyclingModalShare > 0.15
    ? bikeSharing.length * 0.3 + (populationDensity > 10000 ? 1.5 : 0.5)
    : 0.2;

  // Leisure score = inversely related to density, boosted by low modal share areas with parks
  const leisureScore = populationDensity < 5000 ? 1.5 : 0.3;

  // Residential score = high density, moderate cycling
  const residentialScore = populationDensity > 8000 ? 1.2 : 0.5;

  const scores: [AudienceSegment, number][] = [
    ["student", studentScore],
    ["commuter", commuterScore],
    ["office-worker", officeScore],
    ["leisure", leisureScore],
    ["residential", residentialScore],
  ];
  scores.sort((a, b) => b[1] - a[1]);

  const primary = scores[0][0];
  const secondary = scores[1][1] > 0.5 ? scores[1][0] : null;
  const segmentDef = enrichment.audienceSegments[primary];
  const totalScore = scores.reduce((sum, s) => sum + s[1], 0);
  const confidence = totalScore > 0 ? scores[0][1] / totalScore : 0.2;

  return {
    primary,
    secondary,
    confidence: Math.min(1, confidence),
    flyerTone: segmentDef?.flyerTone ?? "Bike repair, fast and nearby",
    receptivityMultiplier: segmentDef?.receptivityMultiplier ?? 1.0,
    detail: buildAudienceDetail(primary, secondary, universities, offices),
  };
}

function buildAudienceDetail(
  primary: AudienceSegment,
  secondary: AudienceSegment | null,
  universities: { item: University; distanceKm: number }[],
  offices: { item: OfficeArea; distanceKm: number }[],
): string {
  const parts: string[] = [];

  if (primary === "student" && universities.length > 0) {
    const closest = universities[0];
    parts.push(`Near ${closest.item.name} (~${Math.round(closest.distanceKm * 1000)}m)`);
    const totalEnrollment = universities.reduce((s, u) => s + u.item.enrollment, 0);
    parts.push(`${(totalEnrollment / 1000).toFixed(0)}k students in range`);
  } else if (primary === "office-worker" && offices.length > 0) {
    const closest = offices[0];
    parts.push(`Near ${closest.item.name}`);
    const totalEmployees = offices.reduce((s, o) => s + o.item.employeeEstimate, 0);
    parts.push(`~${(totalEmployees / 1000).toFixed(0)}k office workers nearby`);
  } else if (primary === "commuter") {
    parts.push("High-transit cycling corridor");
  } else if (primary === "leisure") {
    parts.push("Recreational cycling area — weekend-heavy");
  } else {
    parts.push("Dense residential neighborhood");
  }

  if (secondary && secondary !== primary) {
    const SEGMENT_LABELS: Record<AudienceSegment, string> = {
      student: "students",
      commuter: "commuters",
      "office-worker": "office workers",
      leisure: "leisure riders",
      residential: "residents",
    };
    parts.push(`also: ${SEGMENT_LABELS[secondary]}`);
  }

  return parts.join(" · ");
}

// ---------------------------------------------------------------------------
// District context helpers
// ---------------------------------------------------------------------------

function getFallbackSocioeconomicProfile(): DistrictSocioeconomic {
  return {
    purchasingPowerIndex: 95,
    unemploymentRate: 8.0,
    carFreeHouseholdsShare: 0.45,
    renterHouseholdsShare: 0.72,
  };
}

export function buildDistrictContext(
  district: District | null,
  populationDensity: number | null,
  cyclingModalShare: number | null,
): DistrictContext {
  return {
    districtId: district?.id ?? null,
    districtName: district?.name ?? null,
    populationDensity,
    cyclingModalShare,
    bikeTheftDensity: district?.bikeTheftDensity ?? null,
    repairDemandScore: district
      ? computeRepairDemandScore({
          populationDensity,
          cyclingModalShare,
          bikeTheftDensity: district.bikeTheftDensity,
          socioeconomic: district.socioeconomic,
        })
      : null,
    socioeconomic: district?.socioeconomic ?? null,
  };
}

export function computeRepairDemandScore(
  districtContext: Pick<
    DistrictContext,
    "bikeTheftDensity" | "cyclingModalShare" | "populationDensity" | "socioeconomic"
  >,
): number {
  const socioeconomic = districtContext.socioeconomic;
  if (!socioeconomic) {
    return 50;
  }

  const theftScore = clamp(((districtContext.bikeTheftDensity ?? 4.5) - 2) / 8.5, 0, 1) * 100;
  const cyclingScore = clamp(((districtContext.cyclingModalShare ?? 0.15) - 0.07) / 0.18, 0, 1) * 100;
  const densityScore = clamp(((districtContext.populationDensity ?? 5000) - 2500) / 12000, 0, 1) * 100;
  const carFreeScore = clamp((socioeconomic.carFreeHouseholdsShare - 0.25) / 0.5, 0, 1) * 100;
  const purchasingPowerScore = clamp((socioeconomic.purchasingPowerIndex - 80) / 40, 0, 1) * 100;
  const unemploymentScore = clamp(1 - (socioeconomic.unemploymentRate - 4) / 9, 0, 1) * 100;

  return round(clamp(
    0.28 * theftScore +
      0.22 * cyclingScore +
      0.18 * carFreeScore +
      0.16 * purchasingPowerScore +
      0.10 * unemploymentScore +
      0.06 * densityScore,
    0,
    100,
  ), 0);
}

export function getRepairDemandMultiplier(repairDemandScore: number): number {
  return round(clamp(0.82 + repairDemandScore / 200, 0.82, 1.32), 2);
}

export function describeDistrictContext(districtContext: DistrictContext): string {
  if (!districtContext.districtName || !districtContext.socioeconomic) {
    return "District context unavailable";
  }

  const tags: string[] = [];
  if ((districtContext.bikeTheftDensity ?? 0) >= 6) tags.push("high theft");
  if ((districtContext.cyclingModalShare ?? 0) >= 0.18) tags.push("bike-heavy");
  if (districtContext.socioeconomic.carFreeHouseholdsShare >= 0.5) tags.push("car-light households");
  if (districtContext.socioeconomic.purchasingPowerIndex >= 105) tags.push("solid purchasing power");
  if (districtContext.socioeconomic.unemploymentRate >= 9.5) tags.push("price-sensitive");

  return tags.length > 0 ? tags.join(" · ") : "balanced district profile";
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findClosestDistrict(
  center: { lat: number; lon: number },
): District | null {
  let closest: District | null = null;
  let closestDist = Infinity;

  for (const district of districts) {
    const dist = distanceKm(center, district);
    if (dist < closestDist) {
      closest = district;
      closestDist = dist;
    }
  }

  return closest;
}

/** Labels for UI display */
export const AUDIENCE_SEGMENT_LABELS: Record<AudienceSegment, string> = {
  student: "Students",
  commuter: "Commuters",
  "office-worker": "Office Workers",
  leisure: "Leisure Riders",
  residential: "Residents",
};

export const AUDIENCE_SEGMENT_ICONS: Record<AudienceSegment, string> = {
  student: "🎓",
  commuter: "🚉",
  "office-worker": "💼",
  leisure: "🌳",
  residential: "🏘️",
};
