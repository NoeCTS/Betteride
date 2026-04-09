/* ------------------------------------------------------------------ */
/*  Flyer Distribution Optimizer                                        */
/*  Scores zones by marketing-effective cyclist reach:                  */
/*    effectiveContacts/hr = cyclists/hr × interactionQuality × audienceFit */
/* ------------------------------------------------------------------ */

import rawLayers from "@/data/app/berlin-layers.json";
import {
  computeTransitBoost,
  getSpotWeatherMultiplier,
} from "@/lib/flyer-conditions";
import { estimateSparseCyclistVolume } from "@/lib/area-analysis";
import {
  describeDistrictContext,
  enrichLocation,
  estimateFallbackCyclistVolume,
  type AreaEnrichment,
} from "@/lib/berlin-enrichment";
import { clamp, distanceKm, influenceWithinRadius, normalizeToHundred, round } from "@/lib/geo";
import {
  corridorWeight,
  distanceKmToPolyline,
  getLayerMultiplier,
  weightedSegmentPresence,
  type BikeRideLocation,
  type LinearSegment,
} from "@/lib/spatial";
import {
  DAY_MULTIPLIERS,
  DAYS_ORDERED,
  TIME_BLOCK_DEFS,
  formatFlyerTimeShort,
  flyerContextToTimeSlice,
  isWeekend,
} from "@/lib/time-model";
import type {
  AppData,
  FlyerConditions,
  FlyerSpot,
  FlyerTimeContext,
  FlyerTimeWindow,
  FlyerZoneScore,
  NearbyShop,
  Zone,
} from "@/lib/types";

// ---------------------------------------------------------------------------
// Layer data
// ---------------------------------------------------------------------------

interface FlowSegment {
  id: string;
  name: string;
  coordinates: [number, number][];
  dtvw12h: number;
  commuterIntensity: number;
  peakMultiplier: number;
  offPeakMultiplier: number;
  weekendMultiplier: number;
}

const layers = rawLayers as unknown as {
  bikeFlowSegments: FlowSegment[];
  bikeInfrastructureSegments: LinearSegment[];
  bikeStreetSegments: LinearSegment[];
  bikeRideLocations: BikeRideLocation[];
};

// ---------------------------------------------------------------------------
// Interaction quality by spot type (empirically reasonable take-rate estimates)
// B+R is highest because cyclists are stationary, locking their bike
// ---------------------------------------------------------------------------

const INTERACTION_QUALITY: Record<FlyerSpot["type"], number> = {
  "br-stop": 0.42,
  "station-entrance": 0.26,   // average of S+U (0.28) and S/U (0.22)
  "protected-lane": 0.14,
  "bike-street": 0.18,
  "shop-cluster": 0.25,
};

const STATION_INTERACTION: Record<string, number> = {
  "S+U": 0.28,
  "S": 0.22,
  "U": 0.20,
};

// Berlin modal split estimates: % of station users arriving by bike
const STATION_BIKE_SHARE: Record<string, number> = {
  "S+U": 0.22,
  "S": 0.18,
  "U": 0.14,
};

// How many flyers one person can distribute per hour at ~200 prospects/hr capacity
const FLYER_CAPACITY_PER_PERSON = 200;
const FLYER_TAKE_RATE = 0.35;
const SESSION_HOURS = 2;

// ---------------------------------------------------------------------------
// Main scorer
// ---------------------------------------------------------------------------

export function scoreFlyerZones(
  data: AppData,
  ctx: FlyerTimeContext,
  conditions: FlyerConditions | null = null,
): FlyerZoneScore[] {
  // Pre-compute enrichment data for each zone (cached for reuse across terms)
  const zoneEnrichments = data.zones.map((zone) =>
    enrichLocation({ lat: zone.lat, lon: zone.lon }, zone.radius),
  );

  // Step 1: compute raw terms per zone
  const rawCyclist: number[] = [];
  const rawDwell: number[] = [];
  const rawInfra: number[] = [];
  const rawAudience: number[] = [];
  const rawAffinity: number[] = [];
  const rawProspects: number[] = [];

  for (let i = 0; i < data.zones.length; i++) {
    const zone = data.zones[i];
    const ze = zoneEnrichments[i];
    const cyclist = computeCyclistVolumeTerm(zone, ctx, data, ze, conditions);
    rawCyclist.push(cyclist);
    rawDwell.push(computeDwellTerm(zone, ctx));
    rawInfra.push(computeInfraTerm(zone));
    rawAudience.push(computeAudienceFitTerm(zone, ze, ctx));
    rawAffinity.push(computeAffinityTerm(zone));
    rawProspects.push(computeRawProspects(zone, cyclist, ze, ctx));
  }

  // Step 2: normalize each term 0–100
  const normCyclist = normalizeToHundred(rawCyclist);
  const normDwell = normalizeToHundred(rawDwell);
  const normInfra = normalizeToHundred(rawInfra);
  const normAudience = normalizeToHundred(rawAudience);
  const normAffinity = normalizeToHundred(rawAffinity);

  // Step 3: compute FDS and build scores
  const scores: FlyerZoneScore[] = data.zones.map((zone, i) => {
    const cyclistVolumeScore = round(normCyclist[i]);
    const dwellScore = round(normDwell[i]);
    const infraScore = round(normInfra[i]);
    const audienceFitScore = round(normAudience[i]);
    const affinityScore = round(normAffinity[i]);

    const flyerScore = round(clamp(
      0.35 * cyclistVolumeScore +
      0.25 * dwellScore +
      0.20 * infraScore +
      0.10 * audienceFitScore +
      0.10 * affinityScore,
      0, 100,
    ));

    const ze = zoneEnrichments[i];
    const estimatedCyclistsPerHour = Math.max(0, Math.round(rawCyclist[i] * 0.85));
    const prospectsPerHour = Math.max(0, Math.round(rawProspects[i]));
    const allSpots = buildFlyerSpots(zone, ctx, conditions, ze);
    const topSpots = allSpots.slice(0, 3);
    const bestWindows = computeBestWindows(zone, data);
    const transitBoost = computeTransitBoost(zone.nearbyStations, conditions?.stationDisruptions);
    const intel = buildFlyerIntel(
      zone,
      estimatedCyclistsPerHour,
      prospectsPerHour,
      ctx,
      topSpots,
      ze,
      conditions,
    );

    return {
      zone,
      flyerScore,
      estimatedCyclistsPerHour,
      prospectsPerHour,
      cyclistVolumeScore,
      dwellScore,
      infraScore,
      audienceFitScore,
      affinityScore,
      allSpots,
      topSpots,
      bestWindows,
      headline: intel.headline,
      recommendation: intel.recommendation,
      teamAdvice: intel.teamAdvice,
      districtContext: ze.districtContext,
      factorBreakdown: {
        weatherMultiplier: conditions?.weather?.multiplier ?? 1,
        transitDisruptionBoost: transitBoost.boostMultiplier,
        repairDemandScore: ze.repairDemandScore,
        bikeTheftDensity: ze.bikeTheftDensity,
        topTransitDisruption: transitBoost.topDisruption,
      },
    };
  });

  scores.sort((a, b) => b.flyerScore - a.flyerScore);
  return scores;
}

// ---------------------------------------------------------------------------
// Zone-specific time profile
// Different zone compositions respond differently to time-of-day changes:
//   - Station-heavy zones spike during commute peaks, drop on weekends
//   - B+R zones are strongest in the morning (commuters parking bikes)
//   - Shop-cluster zones are steadier throughout the day
//   - Leisure-oriented zones (parks, low commuter intensity) peak on weekends
// ---------------------------------------------------------------------------

interface ZoneTimeProfile {
  /** Commute-peak bonus (morning + afternoon on weekdays) */
  commuterWeight: number;
  /** Morning-specific bonus (B+R, station arrivals) */
  morningWeight: number;
  /** Midday/leisure bonus (weekend + midday) */
  leisureWeight: number;
  /** Evening resilience (shops, nightlife corridors) */
  eveningWeight: number;
}

function computeZoneTimeProfile(zone: Zone): ZoneTimeProfile {
  const center = { lat: zone.lat, lon: zone.lon };
  const radiusKm = zone.radius;

  // Station density signal (0-1): more stations → stronger commuter pattern
  const stationSignal = clamp(zone.nearbyStations.length / 4, 0, 1);
  // S+U stations have particularly strong commuter swings
  const majorStationBoost = zone.nearbyStations.some(
    (s) => s.item.type === "S+U" && s.distanceKm <= 0.8,
  ) ? 0.25 : 0;

  // B+R proximity signal (0-1): B+R = heavy morning usage
  let brSignal = 0;
  for (const loc of layers.bikeRideLocations) {
    const dist = distanceKm(center, loc);
    if (dist <= radiusKm + 0.8) {
      brSignal = Math.max(brSignal, 1 - dist / (radiusKm + 0.8));
    }
  }

  // Shop density signal (0-1): shops provide steadier all-day traffic
  const shopSignal = clamp(zone.shopCount / 6, 0, 1);

  // Flow corridor commuter intensity (0-1)
  let avgCommuterIntensity = 0;
  let corridorCount = 0;
  for (const seg of layers.bikeFlowSegments) {
    const dist = distanceKmToPolyline(center, seg.coordinates);
    if (dist <= radiusKm + 0.5) {
      avgCommuterIntensity += seg.commuterIntensity;
      corridorCount++;
    }
  }
  avgCommuterIntensity = corridorCount > 0 ? avgCommuterIntensity / corridorCount : 0.5;

  return {
    commuterWeight: clamp(
      0.3 + 0.4 * stationSignal + 0.2 * avgCommuterIntensity + majorStationBoost,
      0, 1,
    ),
    morningWeight: clamp(
      0.2 + 0.5 * brSignal + 0.25 * stationSignal + 0.1 * avgCommuterIntensity,
      0, 1,
    ),
    leisureWeight: clamp(
      0.3 + 0.3 * (1 - avgCommuterIntensity) + 0.2 * shopSignal - 0.15 * stationSignal,
      0, 1,
    ),
    eveningWeight: clamp(
      0.15 + 0.4 * shopSignal + 0.15 * (1 - brSignal),
      0, 1,
    ),
  };
}

/**
 * Zone-specific time multiplier: modulates the base estimate differently per zone
 * based on its composition. This is the key to making day/time changes produce
 * meaningfully different zone rankings.
 */
function getZoneTimeMultiplier(profile: ZoneTimeProfile, ctx: FlyerTimeContext): number {
  const weekend = isWeekend(ctx.day);

  // Base profile response by time block
  switch (ctx.timeBlock) {
    case "morning-peak": {
      // Commuter + B+R zones spike; leisure zones are quiet
      const boost = weekend
        ? 0.65 + 0.35 * profile.leisureWeight  // weekends: leisure zones recover somewhat
        : 0.80 + 0.45 * profile.commuterWeight + 0.30 * profile.morningWeight;
      return boost;
    }
    case "midday": {
      // Leisure zones peak; commuter zones dip
      const boost = weekend
        ? 0.85 + 0.40 * profile.leisureWeight + 0.15 * profile.eveningWeight
        : 0.55 + 0.35 * profile.leisureWeight + 0.20 * profile.eveningWeight;
      return boost;
    }
    case "afternoon-peak": {
      // Strong commuter return + leisure overlap
      const boost = weekend
        ? 0.75 + 0.30 * profile.leisureWeight
        : 0.75 + 0.40 * profile.commuterWeight + 0.10 * profile.leisureWeight;
      return boost;
    }
    case "evening": {
      // Most zones quiet; shop/nightlife corridors hold better
      const boost = weekend
        ? 0.40 + 0.35 * profile.eveningWeight + 0.15 * profile.leisureWeight
        : 0.35 + 0.40 * profile.eveningWeight;
      return boost;
    }
    default:
      return 1;
  }
}

// ---------------------------------------------------------------------------
// Term 1: Cyclist Volume
// blended sensor + background + network + urban activity estimate,
// adjusted for day × time with zone-specific time profiles
// ---------------------------------------------------------------------------

function computeCyclistVolumeTerm(
  zone: Zone,
  ctx: FlyerTimeContext,
  data: AppData,
  zoneEnrichment?: AreaEnrichment,
  conditions?: FlyerConditions | null,
): number {
  const center = { lat: zone.lat, lon: zone.lon };
  const radiusKm = zone.radius;
  const timeSlice = flyerContextToTimeSlice(ctx);
  const insideStations = zone.nearbyStations.filter((station) => station.distanceKm <= radiusKm);
  const insideShopCount = zone.nearbyShops.filter((shop) => shop.distanceKm <= radiusKm).length;
  const blendedEstimate = estimateSparseCyclistVolume(
    data.counters,
    center,
    radiusKm,
    timeSlice,
    insideStations,
    insideShopCount,
  );

  // If local sensor coverage is weak, blend in enrichment-based fallback
  let baseEstimate = blendedEstimate.value;
  if (zoneEnrichment && blendedEstimate.localSensorEstimate.coverageCount === 0) {
    const fallback = estimateFallbackCyclistVolume(
      center,
      radiusKm,
      timeSlice,
      insideStations,
      zoneEnrichment,
    );
    if (fallback.value > baseEstimate) {
      baseEstimate = Math.round(0.40 * baseEstimate + 0.60 * fallback.value);
    }
  }

  const weatherMultiplier = conditions?.weather?.multiplier ?? 1;
  const transitBoost = computeTransitBoost(zone.nearbyStations, conditions?.stationDisruptions);

  // Zone-specific time profile: different zones respond differently to time changes
  const profile = computeZoneTimeProfile(zone);
  const zoneTimeMult = getZoneTimeMultiplier(profile, ctx);

  return baseEstimate
    * DAY_MULTIPLIERS[ctx.day]
    * zoneTimeMult
    * weatherMultiplier
    * transitBoost.boostMultiplier;
}

// ---------------------------------------------------------------------------
// Raw prospects per hour (before normalization — used for absolute numbers)
// ---------------------------------------------------------------------------

function computeRawProspects(zone: Zone, cyclistVolume: number, ze?: AreaEnrichment, ctx?: FlyerTimeContext): number {
  const cyclistsPerHour = cyclistVolume * 0.85;
  const audienceFit = computeRawAudienceFit(zone, ze, ctx);
  const repairDemandMultiplier = ze?.repairDemandMultiplier ?? 1;

  // Weighted average interaction quality from top spots
  const center = { lat: zone.lat, lon: zone.lon };
  let intQuality = 0.14; // default: moving lane

  // Boost if B+R or station is near
  const nearBR = layers.bikeRideLocations.find(
    (br) => distanceKm(center, br) <= zone.radius + 0.8,
  );
  if (nearBR) intQuality = Math.max(intQuality, 0.35);
  else if (zone.nearbyStations.length > 0) {
    const topStation = zone.nearbyStations[0];
    intQuality = Math.max(intQuality, STATION_INTERACTION[topStation.item.type] ?? 0.22);
  }

  return cyclistsPerHour * intQuality * audienceFit * repairDemandMultiplier;
}

// ---------------------------------------------------------------------------
// Term 2: Dwell Opportunity
// B+R locations (0.50) + station entrances (0.35) + infra slowdown (0.15)
// ---------------------------------------------------------------------------

function computeDwellTerm(zone: Zone, ctx: FlyerTimeContext): number {
  const timeSlice = flyerContextToTimeSlice(ctx);
  const dayMult = DAY_MULTIPLIERS[ctx.day];
  const center = { lat: zone.lat, lon: zone.lon };
  const radiusKm = zone.radius;

  // A. Bike+Ride locations
  let brScore = 0;
  for (const loc of layers.bikeRideLocations) {
    const dist = distanceKm(center, loc);
    const weight = corridorWeight(dist, radiusKm, 0.8);
    if (weight === 0) continue;
    brScore += (loc.capacity / 80) * getLayerMultiplier(loc, timeSlice) * dayMult * weight;
  }

  // B. Station entrances
  let stationScore = 0;
  for (const ns of zone.nearbyStations) {
    const typeWeight = ns.item.type === "S+U" ? 1.0 : ns.item.type === "S" ? 0.8 : 0.6;
    const bikeShare = STATION_BIKE_SHARE[ns.item.type] ?? 0.14;
    const influence = influenceWithinRadius(ns.distanceKm, 1.2);
    stationScore += typeWeight * bikeShare * influence * dayMult * 10; // scale to be comparable
  }

  // C. Infrastructure lane slowdowns
  const laneSlowdown =
    weightedSegmentPresence(center, radiusKm, 0.7, layers.bikeInfrastructureSegments) +
    0.7 * weightedSegmentPresence(center, radiusKm, 0.6, layers.bikeStreetSegments);

  return 0.50 * brScore + 0.35 * stationScore + 0.15 * laneSlowdown;
}

// ---------------------------------------------------------------------------
// Term 3: Infrastructure Concentration
// More protected lanes = cyclists funneled into predictable paths
// ---------------------------------------------------------------------------

function computeInfraTerm(zone: Zone): number {
  const center = { lat: zone.lat, lon: zone.lon };
  const radiusKm = zone.radius;
  return (
    weightedSegmentPresence(center, radiusKm, 0.7, layers.bikeInfrastructureSegments) +
    0.6 * weightedSegmentPresence(center, radiusKm, 0.6, layers.bikeStreetSegments)
  );
}

// ---------------------------------------------------------------------------
// Term 4: Audience Fit
// Commuter routes = daily cyclists with high repair need
// Now time-aware: commuter audience is strongest during peak hours,
// leisure audience is strongest on weekends and midday
// ---------------------------------------------------------------------------

function computeAudienceFitTerm(zone: Zone, ze: AreaEnrichment | undefined, ctx: FlyerTimeContext): number {
  return computeRawAudienceFit(zone, ze, ctx) * 100;
}

function computeRawAudienceFit(zone: Zone, ze?: AreaEnrichment, ctx?: FlyerTimeContext): number {
  const center = { lat: zone.lat, lon: zone.lon };
  const radiusKm = zone.radius;

  // Average commuter intensity from nearby flow corridors
  let weightedIntensity = 0;
  let totalWeight = 0;
  for (const seg of layers.bikeFlowSegments) {
    const dist = distanceKmToPolyline(center, seg.coordinates);
    const weight = corridorWeight(dist, radiusKm, 1.5);
    if (weight === 0) continue;
    weightedIntensity += seg.commuterIntensity * weight;
    totalWeight += weight;
  }
  const avgCommuter = totalWeight > 0 ? weightedIntensity / totalWeight : 0.5;

  // Time-aware audience composition: commuters dominate during peaks,
  // leisure cyclists are more present on weekends and midday
  let effectiveCommuterShare = avgCommuter;
  if (ctx) {
    const weekend = isWeekend(ctx.day);
    if (weekend) {
      // Weekends: commuter share drops, leisure rises
      effectiveCommuterShare *= 0.45;
    } else {
      switch (ctx.timeBlock) {
        case "morning-peak":
          effectiveCommuterShare *= 1.30; // overwhelmingly commuters
          break;
        case "afternoon-peak":
          effectiveCommuterShare *= 1.15; // commuters + some leisure
          break;
        case "midday":
          effectiveCommuterShare *= 0.55; // mostly leisure/errands
          break;
        case "evening":
          effectiveCommuterShare *= 0.40; // recreational cyclists
          break;
      }
    }
    effectiveCommuterShare = clamp(effectiveCommuterShare, 0, 1);
  }

  // audienceFit: commuters = 0.95, leisure = 0.60
  const fitMultiplier = 0.60 + 0.35 * effectiveCommuterShare;
  // repair-shop culture boost
  const shopBoost = Math.min(0.15, zone.shopCount * 0.015);

  // Enrichment-based receptivity boost: audience segment determines receptivity
  const receptivityMult = ze?.audienceProfile.receptivityMultiplier ?? 1.0;
  const repairNeedBoost = ze
    ? 0.9 + Math.max(0, ze.repairDemandScore - 50) / 250
    : 1;

  return clamp((fitMultiplier + shopBoost) * receptivityMult * repairNeedBoost, 0, 1);
}

// ---------------------------------------------------------------------------
// Term 5: BetterRide Affinity
// Partner shop density — cyclists near existing partners know the brand
// ---------------------------------------------------------------------------

function computeAffinityTerm(zone: Zone): number {
  let score = 0;
  for (const ns of zone.nearbyShops) {
    if (!ns.item.isPartner) continue;
    score += influenceWithinRadius(ns.distanceKm, 1.5) * 50;
  }
  return score;
}

// ---------------------------------------------------------------------------
// Spot-level recommendations
// ---------------------------------------------------------------------------

function buildFlyerSpots(
  zone: Zone,
  ctx: FlyerTimeContext,
  conditions?: FlyerConditions | null,
  ze?: AreaEnrichment,
): FlyerSpot[] {
  const spots: FlyerSpot[] = [];
  const center = { lat: zone.lat, lon: zone.lon };
  const radiusKm = zone.radius;
  const timeSlice = flyerContextToTimeSlice(ctx);
  const dayMult = DAY_MULTIPLIERS[ctx.day];
  const timeDef = TIME_BLOCK_DEFS.find((t) => t.id === ctx.timeBlock)!;
  const timeMult = isWeekend(ctx.day) ? timeDef.weekendMultiplier : timeDef.weekdayMultiplier;
  const audienceFit = computeRawAudienceFit(zone, ze, ctx);
  const weatherMultiplier = conditions?.weather?.multiplier ?? 1;
  const zoneTransitBoost = computeTransitBoost(zone.nearbyStations, conditions?.stationDisruptions);

  // 1. Station entrances
  for (const ns of zone.nearbyStations.slice(0, 3)) {
    if (ns.distanceKm > 1.2) continue;
    const bikeShare = STATION_BIKE_SHARE[ns.item.type] ?? 0.14;
    const stationDemand = ns.item.type === "S+U" ? 350 : ns.item.type === "S" ? 220 : 150;
    const stationTransitBoost = conditions?.stationDisruptions?.[ns.item.id]?.boostMultiplier
      ?? zoneTransitBoost.boostMultiplier;
    const spotWeatherMultiplier = getSpotWeatherMultiplier("station-entrance", conditions?.weather);
    const cyclistsPerHour = Math.round(
      stationDemand * bikeShare * dayMult * timeMult * weatherMultiplier * stationTransitBoost * spotWeatherMultiplier,
    );
    const iq = STATION_INTERACTION[ns.item.type] ?? 0.22;
    const effectiveContacts = round(cyclistsPerHour * iq, 0);
    const prospects = round(effectiveContacts * audienceFit, 0);

    spots.push({
      name: ns.item.name,
      type: "station-entrance",
      lat: ns.item.lat,
      lon: ns.item.lon,
      estimatedCyclistsPerHour: cyclistsPerHour,
      interactionQuality: iq,
      effectiveContactsPerHour: effectiveContacts,
      audienceFit: round(audienceFit, 2),
      prospectsPerHour: prospects,
      positioningHint: `Stand at the main exit, facing the bike rack. Cyclists arriving and departing will pass within arm's reach.`,
    });
  }

  // 2. Bike+Ride locations
  for (const loc of layers.bikeRideLocations) {
    const dist = distanceKm(center, loc);
    if (dist > radiusKm + 0.8) continue;
    const timeMultiplier = getLayerMultiplier(loc, timeSlice);
    const spotWeatherMultiplier = getSpotWeatherMultiplier("br-stop", conditions?.weather);
    const cyclistsPerHour = Math.round(
      (loc.capacity / 80)
      * timeMultiplier
      * dayMult
      * 200
      * weatherMultiplier
      * zoneTransitBoost.boostMultiplier
      * spotWeatherMultiplier,
    ); // capacity × occupancy × base flow
    const iq = INTERACTION_QUALITY["br-stop"];
    const effectiveContacts = round(cyclistsPerHour * iq, 0);
    const prospects = round(effectiveContacts * audienceFit, 0);

    spots.push({
      name: `B+R: ${loc.name}`,
      type: "br-stop",
      lat: loc.lat,
      lon: loc.lon,
      estimatedCyclistsPerHour: cyclistsPerHour,
      interactionQuality: iq,
      effectiveContactsPerHour: effectiveContacts,
      audienceFit: round(audienceFit, 2),
      prospectsPerHour: prospects,
      positioningHint: `Position at the rack entrance. Cyclists locking/unlocking bikes are stationary for 30–60 seconds — highest take rate of any spot type.`,
    });
  }

  // 3. Protected bike lane corridors (nearest segment start point)
  for (const seg of layers.bikeInfrastructureSegments) {
    const dist = distanceKmToPolyline(center, seg.coordinates);
    if (dist > radiusKm + 0.3) continue;
    if (seg.coordinates.length === 0) continue;

    // Use midpoint of segment as spot location
    const midIdx = Math.floor(seg.coordinates.length / 2);
    const [lon, lat] = seg.coordinates[midIdx];
    const spotWeatherMultiplier = getSpotWeatherMultiplier("protected-lane", conditions?.weather);
    const cyclistsPerHour = Math.round(400 * dayMult * timeMult * weatherMultiplier * spotWeatherMultiplier); // baseline corridor flow
    const iq = INTERACTION_QUALITY["protected-lane"];
    const effectiveContacts = round(cyclistsPerHour * iq, 0);
    const prospects = round(effectiveContacts * audienceFit, 0);

    spots.push({
      name: `Bike lane: ${seg.name}`,
      type: "protected-lane",
      lat,
      lon,
      estimatedCyclistsPerHour: cyclistsPerHour,
      interactionQuality: iq,
      effectiveContactsPerHour: effectiveContacts,
      audienceFit: round(audienceFit, 2),
      prospectsPerHour: prospects,
      positioningHint: `Stand perpendicular to the flow at a natural narrowing or junction point. Make eye contact early — cyclists have only 2–3 seconds at 15 kph.`,
    });

    if (spots.filter((s) => s.type === "protected-lane").length >= 2) break;
  }

  // 4. Shop clusters — areas with ≥3 shops within 300m
  const shopClusters = findShopClusters(zone.nearbyShops, 0.3, 3);
  for (const cluster of shopClusters.slice(0, 1)) {
    const spotWeatherMultiplier = getSpotWeatherMultiplier("shop-cluster", conditions?.weather);
    const cyclistsPerHour = Math.round(cluster.count * 80 * dayMult * timeMult * weatherMultiplier * spotWeatherMultiplier);
    const iq = INTERACTION_QUALITY["shop-cluster"];
    const effectiveContacts = round(cyclistsPerHour * iq, 0);
    // Shops = repair mindset → boost audience fit
    const clusterAudienceFit = clamp(audienceFit + 0.15, 0, 1);
    const prospects = round(effectiveContacts * clusterAudienceFit, 0);

    spots.push({
      name: `Shop cluster near ${cluster.anchor}`,
      type: "shop-cluster",
      lat: cluster.lat,
      lon: cluster.lon,
      estimatedCyclistsPerHour: cyclistsPerHour,
      interactionQuality: iq,
      effectiveContactsPerHour: effectiveContacts,
      audienceFit: round(clusterAudienceFit, 2),
      prospectsPerHour: prospects,
      positioningHint: `Position between the shops. Cyclists browsing or locking up nearby are already in a bike-mindset — receptivity is 70% higher than average.`,
    });
  }

  // Sort by prospectsPerHour descending; UI can slice if it only wants the top few.
  spots.sort((a, b) => b.prospectsPerHour - a.prospectsPerHour);
  return spots;
}

interface ShopCluster {
  lat: number;
  lon: number;
  count: number;
  anchor: string;
}

function findShopClusters(
  shops: NearbyShop[],
  radiusKm: number,
  minCount: number,
): ShopCluster[] {
  const clusters: ShopCluster[] = [];

  for (const anchor of shops) {
    const nearby = shops.filter(
      (s) => s !== anchor && distanceKm(anchor.item, s.item) <= radiusKm,
    );
    if (nearby.length + 1 >= minCount) {
      clusters.push({
        lat: anchor.item.lat,
        lon: anchor.item.lon,
        count: nearby.length + 1,
        anchor: anchor.item.name,
      });
    }
  }

  // Deduplicate overlapping clusters
  const unique: ShopCluster[] = [];
  for (const cluster of clusters) {
    const isDuplicate = unique.some(
      (u) => distanceKm({ lat: u.lat, lon: u.lon }, { lat: cluster.lat, lon: cluster.lon }) < radiusKm,
    );
    if (!isDuplicate) unique.push(cluster);
  }

  return unique.sort((a, b) => b.count - a.count);
}

// ---------------------------------------------------------------------------
// Best time windows — compute FDS across all 28 day × timeBlock combos
// ---------------------------------------------------------------------------

function computeBestWindows(zone: Zone, data: AppData): FlyerTimeWindow[] {
  const windows: FlyerTimeWindow[] = [];

  for (const day of DAYS_ORDERED) {
    for (const timeDef of TIME_BLOCK_DEFS) {
      const ctx: FlyerTimeContext = { day, timeBlock: timeDef.id };

      const cyclistRaw = computeCyclistVolumeTerm(zone, ctx, data);
      const dwellRaw = computeDwellTerm(zone, ctx);
      const infraRaw = computeInfraTerm(zone);
      const audienceRaw = computeAudienceFitTerm(zone, undefined, ctx);
      const affinityRaw = computeAffinityTerm(zone);
      const prospectsRaw = computeRawProspects(zone, cyclistRaw, undefined, ctx);

      // Use raw values directly for relative ranking (no cross-zone normalization needed here)
      const rawScore =
        0.35 * cyclistRaw +
        0.25 * dwellRaw +
        0.20 * infraRaw +
        0.10 * audienceRaw +
        0.10 * affinityRaw;

      windows.push({
        day,
        timeBlock: timeDef.id,
        label: formatFlyerTimeShort(ctx),
        flyerScore: round(rawScore),
        prospectsPerHour: Math.max(0, Math.round(prospectsRaw)),
        cyclistsPerHour: Math.max(0, Math.round(cyclistRaw * 0.85)),
      });
    }
  }

  // Normalize flyerScore to 0-100 within this zone's own window set
  const maxScore = Math.max(...windows.map((w) => w.flyerScore), 1);
  for (const w of windows) {
    w.flyerScore = round(clamp((w.flyerScore / maxScore) * 100, 0, 100));
  }

  windows.sort((a, b) => b.flyerScore - a.flyerScore);
  return windows.slice(0, 3);
}

// ---------------------------------------------------------------------------
// Intel text generation
// ---------------------------------------------------------------------------

function buildFlyerIntel(
  zone: Zone,
  cyclistsPerHour: number,
  prospectsPerHour: number,
  ctx: FlyerTimeContext,
  topSpots: FlyerSpot[],
  ze?: AreaEnrichment,
  conditions?: FlyerConditions | null,
): { headline: string; recommendation: string; teamAdvice: string } {
  const timeDef = TIME_BLOCK_DEFS.find((t) => t.id === ctx.timeBlock)!;
  const timeLabel = timeDef.label.toLowerCase();
  const topSpot = topSpots[0];
  const topSpotName = topSpot?.name ?? zone.nearbyStations[0]?.item.name ?? zone.name;
  const transitBoost = computeTransitBoost(zone.nearbyStations, conditions?.stationDisruptions);

  const teamSize = Math.max(1, Math.ceil(prospectsPerHour / FLYER_CAPACITY_PER_PERSON));
  const flyersPerHour = Math.round(prospectsPerHour * FLYER_TAKE_RATE);
  const totalFlyers = Math.round(flyersPerHour * SESSION_HOURS * 1.2);

  const weatherLabel = conditions?.weather
    ? ` · weather ${Math.round((conditions.weather.multiplier - 1) * 100)}%`
    : "";
  const transitLabel = transitBoost.topDisruption && transitBoost.boostMultiplier > 1.01
    ? ` · transit +${Math.round((transitBoost.boostMultiplier - 1) * 100)}%`
    : "";
  const headline = `~${prospectsPerHour.toLocaleString()} prospects/hr · ${timeDef.shortLabel}${weatherLabel}${transitLabel}`;

  const topSpotType = topSpot?.type ?? "station-entrance";
  const spotAdvice =
    topSpotType === "br-stop"
      ? `Best spot is the B+R at ${topSpotName} — cyclists are stationary and receptive.`
      : topSpotType === "station-entrance"
        ? `Best spot is the ${topSpotName} station entrance, facing the bike rack.`
        : topSpotType === "protected-lane"
          ? `Best spot is the protected lane on ${topSpotName} — high cyclist concentration.`
          : `Best spot is the shop cluster near ${topSpotName} — cyclists already in bike mode.`;

  // Add audience-aware context from enrichment
  const audienceHint = ze?.audienceProfile
    ? ` This is a ${ze.audienceProfile.primary} area${ze.audienceProfile.secondary ? ` (also ${ze.audienceProfile.secondary}s)` : ""}. Suggested tone: "${ze.audienceProfile.flyerTone}".`
    : "";
  const districtHint = ze?.districtContext.districtName
    ? ` District signal: ${ze.districtContext.districtName} scores ${ze.repairDemandScore}/100 on repair demand (${describeDistrictContext(ze.districtContext)}).`
    : "";
  const weatherHint = conditions?.weather
    ? ` Weather outlook: ${conditions.weather.summary}.`
    : "";
  const disruptionHint = transitBoost.topDisruption && transitBoost.topDisruption.score > 0
    ? ` Transit stress near ${transitBoost.topDisruption.stationName}: ${transitBoost.topDisruption.summary}.`
    : "";

  const recommendation = `Go to ${zone.name} on ${ctx.day.charAt(0).toUpperCase() + ctx.day.slice(1)} ${timeLabel}. `
    + `Expect ~${cyclistsPerHour.toLocaleString()} cyclists/hr through the zone. `
    + spotAdvice
    + (topSpot ? ` ${topSpot.positioningHint}` : "")
    + audienceHint
    + districtHint
    + weatherHint
    + disruptionHint;

  const teamAdvice =
    teamSize === 1
      ? `1 person is enough — bring ~${totalFlyers} flyers for a ${SESSION_HOURS}hr session.`
      : teamSize === 2
        ? `2 people recommended — bring ~${totalFlyers} flyers split between you for ${SESSION_HOURS} hrs.`
        : `${teamSize} people recommended — split across top spots. Bring ~${totalFlyers} flyers total.`;

  return { headline, recommendation, teamAdvice };
}
