import rawLayers from "@/data/raw/berlin-layers.json";
import {
  enrichLocation,
  estimateFallbackCyclistVolume,
} from "@/lib/berlin-enrichment";
import { clampKmRadius, distanceKm, estimateBikeMinutes } from "@/lib/geo";
import {
  corridorWeight,
  distanceKmToPolyline,
  getLayerMultiplier,
  weightedBikeRideCapacity,
  weightedSegmentPresence,
  type BikeRideLocation,
  type LinearSegment,
} from "@/lib/spatial";
import type {
  AppData,
  AreaAnalysisCircle,
  AreaAnalysisSummary,
  AreaEstimateConfidence,
  Counter,
  NearbyCounter,
  NearbyShop,
  NearbyStation,
  TimeSlice,
} from "@/lib/types";

const SMOOTHING_BUFFER_KM = 0.75;
const BACKGROUND_RADIUS_KM = 4;
const BACKGROUND_SIGMA_KM = 1.4;
const NETWORK_REACH_KM = 1.2;
const LOCAL_BLEND_RATE = 0.8;
// dtvw12h = daily traffic volume weekday 12 hours; counter metrics are hourly averages
const FLOW_HOURS_PER_DAY = 12;

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

export interface EstimateTerm {
  value: number;
  coverageCount: number;
}

export interface SparseCyclistVolumeEstimate {
  value: number;
  fallbackEstimate: number;
  localBlendWeight: number;
  localSensorEstimate: EstimateTerm;
  backgroundEstimate: EstimateTerm;
  networkPriorEstimate: EstimateTerm;
  urbanActivityEstimate: EstimateTerm;
}

export interface AreaActionStep {
  title: string;
  detail: string;
}

const layers = rawLayers as unknown as {
  bikeFlowSegments: FlowSegment[];
  bikeInfrastructureSegments: LinearSegment[];
  bikeStreetSegments: LinearSegment[];
  bikeRideLocations: BikeRideLocation[];
};

export function isPointInsideCircle(
  point: { lat: number; lon: number },
  circle: AreaAnalysisCircle,
) {
  if (!circle.center) {
    return false;
  }

  return distanceKm(circle.center, point) <= circle.radiusKm;
}

export function getCounterMetricForTimeSlice(
  counter: Counter,
  timeSlice: TimeSlice,
) {
  switch (timeSlice) {
    case "weekday-peak":
      return counter.peakAvg;
    case "weekday-offpeak":
      return counter.offPeakAvg;
    case "weekend":
      return counter.weekendAvg;
  }
}

export function summarizeAreaCircle(
  data: AppData,
  circle: AreaAnalysisCircle,
  timeSlice: TimeSlice,
): AreaAnalysisSummary | null {
  if (!circle.enabled || !circle.center) {
    return null;
  }

  const center = circle.center;
  const radiusKm = clampKmRadius(circle.radiusKm);

  const insideShops = data.shops
    .map((shop) => buildNearbyRef(center, shop))
    .filter((shop): shop is NearbyShop => shop.distanceKm <= radiusKm)
    .sort(compareByDistance);

  const insidePartners = insideShops.filter((shop) => shop.item.isPartner);
  const insideCandidates = insideShops.filter((shop) => !shop.item.isPartner);

  const insideStations = data.stations
    .map((station) => buildNearbyRef(center, station))
    .filter((station): station is NearbyStation => station.distanceKm <= radiusKm)
    .sort(compareByDistance);

  const insideCounters = data.counters
    .map((counter) => buildNearbyRef(center, counter))
    .filter((counter): counter is NearbyCounter => counter.distanceKm <= radiusKm)
    .sort((left, right) => {
      const metricDelta =
        getCounterMetricForTimeSlice(right.item, timeSlice) -
        getCounterMetricForTimeSlice(left.item, timeSlice);
      return metricDelta || left.distanceKm - right.distanceKm;
    });

  const observedCounterVolume = insideCounters.reduce(
    (sum, counter) => sum + getCounterMetricForTimeSlice(counter.item, timeSlice),
    0,
  );

  const blendedEstimate = estimateSparseCyclistVolume(
    data.counters,
    center,
    radiusKm,
    timeSlice,
    insideStations,
    insideShops.length,
  );

  // Enrich with POI, population, and audience data
  const areaEnrichment = enrichLocation(center, radiusKm);
  const fallback = estimateFallbackCyclistVolume(
    center,
    radiusKm,
    timeSlice,
    insideStations,
    areaEnrichment,
  );

  // If sparse estimator has low local coverage, blend in the enrichment-based fallback.
  // This handles areas with zero or very few bike counters.
  const localCoverage = blendedEstimate.localSensorEstimate.coverageCount;
  let finalEstimate = blendedEstimate.value;
  if (localCoverage === 0 && blendedEstimate.value < fallback.value) {
    // No local sensors at all → take the higher of sparse fallback vs enrichment
    finalEstimate = Math.round(
      0.40 * blendedEstimate.value + 0.60 * fallback.value,
    );
  } else if (localCoverage === 1 && blendedEstimate.backgroundEstimate.coverageCount < 3) {
    // Weak coverage → mild enrichment blend
    finalEstimate = Math.round(
      0.70 * blendedEstimate.value + 0.30 * fallback.value,
    );
  }

  const baseConfidence = getEstimateConfidence(
    blendedEstimate.localSensorEstimate.coverageCount,
    blendedEstimate.backgroundEstimate.coverageCount,
    blendedEstimate.networkPriorEstimate.coverageCount,
    blendedEstimate.urbanActivityEstimate.coverageCount,
  );
  // Enrichment can upgrade low confidence to medium if it has useful signals
  const enrichmentUpgrade =
    baseConfidence === "low" && fallback.confidence === "medium"
      ? "medium" as const
      : baseConfidence;

  return {
    estimatedCyclistsThroughArea: finalEstimate,
    observedCounterVolume,
    localSensorEstimate: blendedEstimate.localSensorEstimate.value,
    backgroundEstimate: blendedEstimate.backgroundEstimate.value,
    networkPriorEstimate: blendedEstimate.networkPriorEstimate.value,
    urbanActivityEstimate: blendedEstimate.urbanActivityEstimate.value,
    enrichmentEstimate: fallback.value,
    estimateConfidence: enrichmentUpgrade,
    shopCount: insideShops.length,
    partnerCount: insidePartners.length,
    candidateCount: insideCandidates.length,
    stationCount: insideStations.length,
    counterCount: insideCounters.length,
    universityCount: areaEnrichment.nearbyUniversities.length,
    bikeSharingCount: areaEnrichment.nearbyBikeSharing.length,
    officeAreaCount: areaEnrichment.nearbyOfficeAreas.length,
    insideShops,
    insidePartners,
    insideCandidates,
    insideStations,
    insideCounters,
    audienceSegment: areaEnrichment.audienceProfile.primary,
    audienceDetail: areaEnrichment.audienceProfile.detail,
    flyerTone: areaEnrichment.audienceProfile.flyerTone,
    districtContext: areaEnrichment.districtContext,
  };
}

export function buildAreaActionSteps(
  summary: AreaAnalysisSummary,
): AreaActionStep[] {
  const actions: AreaActionStep[] = [];

  if (summary.estimateConfidence === "low") {
    actions.push({
      title: "Validate the weak-sensor area",
      detail:
        "This estimate is mostly inferred from surrounding counters and corridor priors. Sanity-check it with bookings, spot counts, or short-term field observation.",
    });
  }

  if (summary.partnerCount === 0 && summary.candidateCount >= 2) {
    actions.push({
      title: "Recruitment move",
      detail:
        "High-potential supply gap. Start outreach to the closest independent shops in this circle.",
    });
  }

  if (summary.partnerCount === 0 && summary.candidateCount < 2) {
    actions.push({
      title: "Mobile repair move",
      detail:
        "Coverage gap with weak existing supply. Test mobile repair or a temporary partner activation here.",
    });
  }

  if (
    summary.partnerCount > 0 &&
    summary.estimatedCyclistsThroughArea / Math.max(1, summary.partnerCount) > 1500
  ) {
    actions.push({
      title: "Capacity move",
      detail:
        "Demand per partner is high. Expand same-day capacity or add another partner in this area.",
    });
  }

  if (
    summary.stationCount >= 2 &&
    summary.estimatedCyclistsThroughArea > 2500
  ) {
    actions.push({
      title: "Commuter move",
      detail:
        "This circle behaves like a commuter corridor. Prioritize same-day repair and pickup convenience.",
    });
  }

  // Enrichment-based action steps
  if (summary.audienceSegment === "student" && summary.universityCount > 0) {
    actions.push({
      title: "Campus flyer push",
      detail:
        "This area is near a university campus. Target bike racks at lecture buildings during morning arrivals and lunch breaks for highest take rate.",
    });
  }

  if (summary.audienceSegment === "office-worker" && summary.officeAreaCount > 0) {
    actions.push({
      title: "Office commuter activation",
      detail:
        "Business district with office commuters cycling in. Position at building entrances during morning peak (8–10am) and evening departure (5–7pm).",
    });
  }

  if (summary.bikeSharingCount > 0 && summary.counterCount === 0) {
    actions.push({
      title: "Bike sharing proxy signal",
      detail:
        "No bike counters here, but bike sharing stations indicate cycling activity. Use dock availability patterns to validate estimated volume.",
    });
  }

  if ((summary.districtContext?.repairDemandScore ?? 0) >= 70) {
    actions.push({
      title: "High repair-demand district",
      detail:
        "District priors point to above-average repair propensity here. Lean into fast-fix, theft recovery, and same-week turnaround messaging.",
    });
  }

  if (actions.length === 0) {
    actions.push({
      title: "Baseline move",
      detail:
        "Coverage is relatively balanced here. Monitor demand changes and keep this area as a secondary expansion target.",
    });
  }

  return actions;
}

export function estimateSparseCyclistVolume(
  counters: Counter[],
  center: { lat: number; lon: number },
  radiusKm: number,
  timeSlice: TimeSlice,
  insideStations: NearbyStation[],
  shopCount: number,
): SparseCyclistVolumeEstimate {
  const localSensorEstimate = estimateLocalSensorTerm(
    counters,
    center,
    radiusKm,
    timeSlice,
  );
  const backgroundEstimate = estimateCounterBackgroundTerm(
    counters,
    center,
    radiusKm,
    timeSlice,
    insideStations.length,
    shopCount,
  );
  const networkPriorEstimate = estimateNetworkPriorTerm(
    counters,
    center,
    radiusKm,
    timeSlice,
  );
  const urbanActivityEstimate = estimateUrbanActivityBaseline(
    center,
    radiusKm,
    insideStations,
    shopCount,
    timeSlice,
  );

  const fallbackEstimate = Math.round(
    backgroundEstimate.value * 0.40 +
      networkPriorEstimate.value * 0.25 +
      urbanActivityEstimate.value * 0.35,
  );
  const localBlendWeight = 1 - Math.exp(-LOCAL_BLEND_RATE * localSensorEstimate.coverageCount);

  return {
    value: Math.round(
      localBlendWeight * localSensorEstimate.value +
        (1 - localBlendWeight) * fallbackEstimate,
    ),
    fallbackEstimate,
    localBlendWeight,
    localSensorEstimate,
    backgroundEstimate,
    networkPriorEstimate,
    urbanActivityEstimate,
  };
}

export function estimateLocalSensorTerm(
  counters: Counter[],
  center: { lat: number; lon: number },
  radiusKm: number,
  timeSlice: TimeSlice,
): EstimateTerm {
  let raw = 0;
  let coverageCount = 0;

  for (const counter of counters) {
    const distanceToCounter = distanceKm(center, counter);

    if (distanceToCounter > radiusKm + SMOOTHING_BUFFER_KM) {
      continue;
    }

    coverageCount += 1;

    let weight = 1;
    if (distanceToCounter > radiusKm) {
      weight = 1 - (distanceToCounter - radiusKm) / SMOOTHING_BUFFER_KM;
    }

    raw += getCounterMetricForTimeSlice(counter, timeSlice) * Math.max(0, weight);
  }

  // Overlap correction: nearby counters partially share the same cyclist flow.
  // Use a softer log-based correction instead of a flat 1/(1+k*n) penalty.
  // With 1 counter: factor=1.0, 2: 0.87, 3: 0.79, 5: 0.68, 10: 0.57
  // This avoids over-penalizing areas with rich sensor coverage.
  const overlapCorrection = coverageCount > 1
    ? 1 / (1 + 0.18 * Math.log(coverageCount))
    : 1;

  // Scale by circle diameter: a larger circle captures more total cyclist throughput.
  // Baseline calibrated at 1km radius (radiusScale=1.0).
  const radiusScale = Math.max(0.5, radiusKm);

  return {
    value: Math.round(raw * overlapCorrection * radiusScale),
    coverageCount,
  };
}

export function estimateCounterBackgroundTerm(
  counters: Counter[],
  center: { lat: number; lon: number },
  radiusKm: number,
  timeSlice: TimeSlice,
  stationCount: number,
  shopCount: number,
): EstimateTerm {
  let weightedSum = 0;
  let totalWeight = 0;
  let coverageCount = 0;

  for (const counter of counters) {
    const distanceToCounter = distanceKm(center, counter);
    if (distanceToCounter > BACKGROUND_RADIUS_KM) {
      continue;
    }

    const weight = Math.exp(-0.5 * (distanceToCounter / BACKGROUND_SIGMA_KM) ** 2);
    weightedSum += getCounterMetricForTimeSlice(counter, timeSlice) * weight;
    totalWeight += weight;
    coverageCount += 1;
  }

  if (coverageCount === 0 || totalWeight === 0) {
    return {
      value: 0,
      coverageCount: 0,
    };
  }

  const neighborMean = weightedSum / totalWeight;
  // Linear area scaling: throughput is proportional to the diameter of the capture zone.
  // Calibrated so 1km radius gives scale=1.0, 0.25km gives ~0.5, 3km gives ~2.0.
  const areaScale = 0.25 + 0.75 * radiusKm;
  const activityBoost =
    1 + 0.05 * Math.min(stationCount, 4) + 0.02 * Math.min(shopCount, 10);

  return {
    value: Math.round(neighborMean * areaScale * activityBoost),
    coverageCount,
  };
}

export function estimateNetworkPriorTerm(
  counters: Counter[],
  center: { lat: number; lon: number },
  radiusKm: number,
  timeSlice: TimeSlice,
): EstimateTerm {
  const meanCounterMetric = average(
    counters.map((counter) => getCounterMetricForTimeSlice(counter, timeSlice)),
  );
  // Convert dtvw12h (daily 12-hour total) to hourly average before comparing to counter metrics
  const meanFlowHourly = average(
    layers.bikeFlowSegments.map(
      (segment) =>
        (segment.dtvw12h / FLOW_HOURS_PER_DAY) * getLayerMultiplier(segment, timeSlice),
    ),
  );
  const flowScale = meanFlowHourly > 0 ? meanCounterMetric / meanFlowHourly : 0;

  let weightedFlow = 0;
  let totalFlowWeight = 0;
  let flowCoverageCount = 0;

  for (const segment of layers.bikeFlowSegments) {
    const distanceToSegment = distanceKmToPolyline(center, segment.coordinates);
    const weight = corridorWeight(distanceToSegment, radiusKm, NETWORK_REACH_KM);
    if (weight === 0) {
      continue;
    }

    const segmentValue =
      (segment.dtvw12h / FLOW_HOURS_PER_DAY) *
      getLayerMultiplier(segment, timeSlice) *
      flowScale *
      (0.85 + 0.3 * segment.commuterIntensity);

    weightedFlow += segmentValue * weight;
    totalFlowWeight += weight;
    flowCoverageCount += 1;
  }

  const flowPrior = totalFlowWeight > 0 ? weightedFlow / totalFlowWeight : 0;

  const infrastructureWeight = weightedSegmentPresence(
    center,
    radiusKm,
    0.7,
    layers.bikeInfrastructureSegments,
  );
  const bikeStreetWeight = weightedSegmentPresence(
    center,
    radiusKm,
    0.6,
    layers.bikeStreetSegments,
  );
  const bikeRideWeight = weightedBikeRideCapacity(center, radiusKm, timeSlice, layers.bikeRideLocations);

  const networkBoost =
    1 +
    0.08 * Math.min(infrastructureWeight, 4) +
    0.05 * Math.min(bikeStreetWeight, 3) +
    0.02 * Math.min(bikeRideWeight, 8);

  return {
    value: Math.round(flowPrior * networkBoost),
    coverageCount:
      flowCoverageCount +
      (infrastructureWeight > 0 ? 1 : 0) +
      (bikeStreetWeight > 0 ? 1 : 0) +
      (bikeRideWeight > 0 ? 1 : 0),
  };
}

export function estimateUrbanActivityBaseline(
  center: { lat: number; lon: number },
  radiusKm: number,
  insideStations: NearbyStation[],
  shopCount: number,
  timeSlice: TimeSlice,
): EstimateTerm {
  const TIME_SLICE_MULTIPLIER: Record<TimeSlice, number> = {
    "weekday-peak": 1.25,
    "weekday-offpeak": 0.85,
    "weekend": 0.75,
  };
  const STATION_BASE_DEMAND: Record<string, number> = {
    "S+U": 350,
    S: 220,
    U: 150,
  };
  const SHOP_DEMAND_PROXY = 40;

  let stationDemand = 0;
  for (const station of insideStations) {
    const baseDemand = STATION_BASE_DEMAND[station.item.type] ?? 150;
    const proximityWeight = 1 - station.distanceKm / Math.max(radiusKm, 0.25);
    stationDemand += baseDemand * Math.max(0, proximityWeight);
  }

  const shopDemand = shopCount * SHOP_DEMAND_PROXY;
  const timeMultiplier = TIME_SLICE_MULTIPLIER[timeSlice];
  const areaScale = 0.25 + 0.75 * radiusKm;
  const raw = (stationDemand + shopDemand) * timeMultiplier * areaScale;
  const coverageCount = insideStations.length + Math.min(shopCount, 6);

  return {
    value: Math.round(raw),
    coverageCount,
  };
}

function getEstimateConfidence(
  localCoverageCount: number,
  backgroundCoverageCount: number,
  networkCoverageCount: number,
  urbanCoverageCount: number,
): AreaEstimateConfidence {
  if (localCoverageCount >= 2) {
    return "high";
  }

  if (
    localCoverageCount >= 1 ||
    backgroundCoverageCount >= 4 ||
    networkCoverageCount >= 3 ||
    urbanCoverageCount >= 5
  ) {
    return "medium";
  }

  return "low";
}

function buildNearbyRef<T extends { lat: number; lon: number }>(
  center: { lat: number; lon: number },
  item: T,
) {
  const itemDistanceKm = distanceKm(center, item);

  return {
    item,
    distanceKm: itemDistanceKm,
    bikeMinutes: estimateBikeMinutes(itemDistanceKm),
  };
}

function average(values: number[]) {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function compareByDistance<
  T extends { distanceKm: number; item: { name?: string; id?: string } },
>(left: T, right: T) {
  return left.distanceKm - right.distanceKm;
}
