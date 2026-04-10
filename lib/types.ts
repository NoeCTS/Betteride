/* ------------------------------------------------------------------ */
/*  Betteride Ground Signal — Type definitions                        */
/* ------------------------------------------------------------------ */

// Strategy modes
export type Mode =
  | "coverage-gap"
  | "mobile-repair"
  | "commuter-reliability"
  | "flyer-distribution";

export type TimeSlice = "weekday-peak" | "weekday-offpeak" | "weekend";

// ---------------------------------------------------------------------------
// Flyer Distribution — time context types (defined here to avoid circular deps
// with time-model.ts which imports TimeSlice from this file)
// ---------------------------------------------------------------------------
export type DayOfWeek =
  | "monday" | "tuesday" | "wednesday" | "thursday"
  | "friday" | "saturday" | "sunday";

export type TimeBlock =
  | "morning-peak"
  | "midday"
  | "afternoon-peak"
  | "evening";

export interface FlyerTimeContext {
  day: DayOfWeek;
  timeBlock: TimeBlock;
}

export interface FlyerPlannerInput {
  teamSize: number;
  sessionHours: number;
}

export interface FlyerSpot {
  name: string;
  type: "br-stop" | "station-entrance" | "protected-lane" | "bike-street" | "shop-cluster";
  lat: number;
  lon: number;
  estimatedCyclistsPerHour: number;
  interactionQuality: number;
  effectiveContactsPerHour: number;
  audienceFit: number;
  prospectsPerHour: number;
  positioningHint: string;
}

export interface FlyerTimeWindow {
  day: DayOfWeek;
  timeBlock: TimeBlock;
  label: string;
  flyerScore: number;
  prospectsPerHour: number;
  cyclistsPerHour: number;
}

export interface DistrictSocioeconomic {
  purchasingPowerIndex: number;
  unemploymentRate: number;
  carFreeHouseholdsShare: number;
  renterHouseholdsShare: number;
}

export interface DistrictContext {
  districtId: string | null;
  districtName: string | null;
  populationDensity: number | null;
  cyclingModalShare: number | null;
  bikeTheftDensity: number | null;
  repairDemandScore: number | null;
  socioeconomic: DistrictSocioeconomic | null;
}

export interface WeatherAdjustment {
  source: "open-meteo" | "fallback";
  targetTimeIso: string;
  multiplier: number;
  summary: string;
  temperatureC: number | null;
  apparentTemperatureC: number | null;
  precipitationProbability: number | null;
  precipitationMm: number | null;
  windSpeedKph: number | null;
  weatherCode: number | null;
}

export interface TransitDisruptionAdjustment {
  stationId: string;
  stationName: string;
  score: number;
  boostMultiplier: number;
  delayedDepartures: number;
  cancelledDepartures: number;
  averageDelayMinutes: number;
  remarkCount: number;
  summary: string;
}

export interface FlyerConditions {
  targetTimeIso: string;
  weather: WeatherAdjustment | null;
  stationDisruptions: Record<string, TransitDisruptionAdjustment>;
  weatherStatus: "ready" | "fallback";
  transitStatus: "ready" | "partial" | "fallback";
}

export interface FlyerFactorBreakdown {
  weatherMultiplier: number;
  transitDisruptionBoost: number;
  repairDemandScore: number;
  bikeTheftDensity: number;
  topTransitDisruption: TransitDisruptionAdjustment | null;
}

export interface FlyerZoneScore {
  zone: Zone;
  flyerScore: number;
  estimatedCyclistsPerHour: number;
  prospectsPerHour: number;
  cyclistVolumeScore: number;
  dwellScore: number;
  infraScore: number;
  audienceFitScore: number;
  affinityScore: number;
  allSpots: FlyerSpot[];
  topSpots: FlyerSpot[];
  bestWindows: FlyerTimeWindow[];
  headline: string;
  recommendation: string;
  teamAdvice: string;
  districtContext: DistrictContext;
  factorBreakdown: FlyerFactorBreakdown;
}

export interface FlyerPlanAssignment {
  personIndex: number;
  status: "assigned" | "holdback";
  zoneId: string | null;
  zoneName: string | null;
  spot: FlyerSpot | null;
  expectedProspects: number;
  expectedProspectsPerHour: number;
  expectedFlyers: number;
  assignmentScore: number;
  stackFactor: number;
  zoneRepeatPenalty: number;
  spacingPenalty: number;
  rationale: string;
}

export interface FlyerPlan {
  input: FlyerPlannerInput;
  assignedCount: number;
  holdbackCount: number;
  totalExpectedProspects: number;
  totalExpectedFlyers: number;
  uniqueZoneCount: number;
  uniqueSpotCount: number;
  summary: string;
  assignments: FlyerPlanAssignment[];
}

export type ShopTag = "candidate" | "partner_osm" | "partner_manual";
export type MapLayerKey = "zones" | "stations" | "partners" | "candidates";
export type LayerVisibility = Record<MapLayerKey, boolean>;

// ---------------------------------------------------------------------------
// Data entities (match ground-signal.json output)
// ---------------------------------------------------------------------------
export interface Counter {
  id: string;
  name: string;
  lat: number;
  lon: number;
  avgDaily: number;
  peakAvg: number;
  offPeakAvg: number;
  weekendAvg: number;
}

export interface Shop {
  name: string;
  lat: number;
  lon: number;
  osmId: string;
  isPartner: boolean;
  shopTag: ShopTag;
  partnerName: string | null;
  partnerMatchType: string | null;
}

export interface Station {
  id: string;
  name: string;
  lat: number;
  lon: number;
  type: "S" | "U" | "S+U";
}

// Proximity reference — a nearby item with distance
export interface NearbyRef {
  item: Counter | Shop | Station;
  distanceKm: number;
  bikeMinutes: number;
}

// Typed variants for zone data
export interface NearbyCounter {
  item: Counter;
  distanceKm: number;
  bikeMinutes: number;
}
export interface NearbyShop {
  item: Shop;
  distanceKm: number;
  bikeMinutes: number;
}
export interface NearbyStation {
  item: Station;
  distanceKm: number;
  bikeMinutes: number;
}

export interface AreaAnalysisCircle {
  enabled: boolean;
  center: { lat: number; lon: number } | null;
  radiusKm: number;
}

export type AreaEstimateConfidence = "low" | "medium" | "high";

export interface AreaAnalysisSummary {
  estimatedCyclistsThroughArea: number;
  observedCounterVolume: number;
  localSensorEstimate: number;
  backgroundEstimate: number;
  networkPriorEstimate: number;
  urbanActivityEstimate: number;
  enrichmentEstimate: number;
  estimateConfidence: AreaEstimateConfidence;
  shopCount: number;
  partnerCount: number;
  candidateCount: number;
  stationCount: number;
  counterCount: number;
  universityCount: number;
  bikeSharingCount: number;
  officeAreaCount: number;
  insideShops: NearbyShop[];
  insidePartners: NearbyShop[];
  insideCandidates: NearbyShop[];
  insideStations: NearbyStation[];
  insideCounters: NearbyCounter[];
  audienceSegment: string | null;
  audienceDetail: string | null;
  flyerTone: string | null;
  districtContext: DistrictContext | null;
}

// ---------------------------------------------------------------------------
// Zone — precomputed by build script, scored at runtime
// ---------------------------------------------------------------------------
export interface Zone {
  id: string;
  name: string;
  lat: number;
  lon: number;
  radius: number;
  nearbyCounters: NearbyCounter[];
  nearbyShops: NearbyShop[];
  nearbyStations: NearbyStation[];
  shopCount: number;
  partnerCount: number;
  candidateCount: number;
}

// ---------------------------------------------------------------------------
// Scored output — zone + computed scores + intelligence
// ---------------------------------------------------------------------------
export interface ZoneScore {
  zone: Zone;
  demand: number;
  supply: number;
  gap: number;
  opportunity: number;
  repairDemandProxy: number;
  districtContext: DistrictContext;
  // Intelligence card content
  headline: string;
  signals: string[];
  action: string;
  kpis: string[];
}

// ---------------------------------------------------------------------------
// App data bundle (loaded from ground-signal.json)
// ---------------------------------------------------------------------------
export interface AppData {
  zones: Zone[];
  counters: Counter[];
  stations: Station[];
  shops: Shop[];
  generated: string;
}

// ---------------------------------------------------------------------------
// Mode definitions
// ---------------------------------------------------------------------------
export interface ModeDefinition {
  id: Mode;
  label: string;
  short: string;
  accent: string;
  description: string;
}

export const MODE_DEFS: ModeDefinition[] = [
  {
    id: "coverage-gap",
    label: "Coverage Gap",
    short: "Gap",
    accent: "#6c3cc1",
    description: "Highlights zones with strong cycling demand and weak Betteride repair coverage.",
  },
{
    id: "mobile-repair",
    label: "Mobile Repair",
    short: "Mobile",
    accent: "#b7791f",
    description: "Finds places where pickup, van repair, or pop-up service beats fixed shop coverage.",
  },
  {
    id: "commuter-reliability",
    label: "Commuter Reliability",
    short: "Commuter",
    accent: "#a14efd",
    description: "Focuses on station-led commuter corridors that need dependable same-day repair.",
  },
  {
    id: "flyer-distribution",
    label: "Flyer Distribution",
    short: "Flyers",
    accent: "#8b5cf6",
    description: "Finds the best zones, times, and exact spots to hand out flyers to the most receptive cyclists.",
  },
];

export function getModeAccent(mode: Mode): string {
  return MODE_DEFS.find((m) => m.id === mode)?.accent ?? "#6c3cc1";
}
