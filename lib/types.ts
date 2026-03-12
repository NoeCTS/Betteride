/* ------------------------------------------------------------------ */
/*  Betteride Ground Signal — Type definitions                        */
/* ------------------------------------------------------------------ */

// Strategy modes
export type Mode =
  | "coverage-gap"
  | "partner-acquisition"
  | "mobile-repair"
  | "commuter-reliability";

export type TimeSlice = "weekday-peak" | "weekday-offpeak" | "weekend";
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
  estimateConfidence: AreaEstimateConfidence;
  shopCount: number;
  partnerCount: number;
  candidateCount: number;
  stationCount: number;
  counterCount: number;
  insideShops: NearbyShop[];
  insidePartners: NearbyShop[];
  insideCandidates: NearbyShop[];
  insideStations: NearbyStation[];
  insideCounters: NearbyCounter[];
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
    accent: "#dd7846",
    description: "Highlights zones with strong cycling demand and weak Betteride repair coverage.",
  },
  {
    id: "partner-acquisition",
    label: "Partner Acquisition",
    short: "Partners",
    accent: "#2d8c74",
    description: "Ranks areas where independent bike shops are the best onboarding targets.",
  },
  {
    id: "mobile-repair",
    label: "Mobile Repair",
    short: "Mobile",
    accent: "#d18a2f",
    description: "Finds places where pickup, van repair, or pop-up service beats fixed shop coverage.",
  },
  {
    id: "commuter-reliability",
    label: "Commuter Reliability",
    short: "Commuter",
    accent: "#4d7ecf",
    description: "Focuses on station-led commuter corridors that need dependable same-day repair.",
  },
];

export function getModeAccent(mode: Mode): string {
  return MODE_DEFS.find((m) => m.id === mode)?.accent ?? "#dd7846";
}
