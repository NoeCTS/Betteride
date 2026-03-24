/* ------------------------------------------------------------------ */
/*  Shared spatial/geometric utilities                                  */
/*  Extracted from area-analysis.ts for reuse in flyer-optimizer.ts    */
/* ------------------------------------------------------------------ */

import { distanceKm } from "@/lib/geo";
import type { TimeSlice } from "@/lib/types";

// ---------------------------------------------------------------------------
// Point-to-polyline distance
// ---------------------------------------------------------------------------

export function projectToKm(lon: number, lat: number, refLat: number) {
  const latScale = 111.32;
  const lonScale = 111.32 * Math.cos((refLat * Math.PI) / 180);
  return { x: lon * lonScale, y: lat * latScale };
}

export function distancePointToSegment(
  point: { x: number; y: number },
  start: { x: number; y: number },
  end: { x: number; y: number },
) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;

  if (dx === 0 && dy === 0) {
    return Math.hypot(point.x - start.x, point.y - start.y);
  }

  const projection =
    ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy);
  const clampedProjection = Math.max(0, Math.min(1, projection));

  const closestX = start.x + clampedProjection * dx;
  const closestY = start.y + clampedProjection * dy;

  return Math.hypot(point.x - closestX, point.y - closestY);
}

export function distanceKmToPolyline(
  point: { lat: number; lon: number },
  coordinates: [number, number][],
): number {
  if (coordinates.length === 0) return Number.POSITIVE_INFINITY;

  if (coordinates.length === 1) {
    return distanceKm(point, { lat: coordinates[0][1], lon: coordinates[0][0] });
  }

  const refLat = point.lat;
  const pointProjected = projectToKm(point.lon, point.lat, refLat);
  let bestDistance = Number.POSITIVE_INFINITY;

  for (let i = 0; i < coordinates.length - 1; i++) {
    const start = coordinates[i];
    const end = coordinates[i + 1];
    const startProjected = projectToKm(start[0], start[1], refLat);
    const endProjected = projectToKm(end[0], end[1], refLat);

    const segDist = distancePointToSegment(pointProjected, startProjected, endProjected);
    if (segDist < bestDistance) bestDistance = segDist;
  }

  return bestDistance;
}

// ---------------------------------------------------------------------------
// Corridor-weight helpers
// ---------------------------------------------------------------------------

export function corridorWeight(
  distanceToSegmentKm: number,
  radiusKm: number,
  reachKm: number,
): number {
  if (distanceToSegmentKm <= radiusKm) return 1;
  if (distanceToSegmentKm > radiusKm + reachKm) return 0;
  return 1 - (distanceToSegmentKm - radiusKm) / reachKm;
}

// ---------------------------------------------------------------------------
// Weighted segment presence
// ---------------------------------------------------------------------------

export interface LinearSegment {
  id: string;
  name: string;
  coordinates: [number, number][];
}

export function weightedSegmentPresence(
  center: { lat: number; lon: number },
  radiusKm: number,
  reachKm: number,
  segments: LinearSegment[],
): number {
  let total = 0;
  for (const segment of segments) {
    const dist = distanceKmToPolyline(center, segment.coordinates);
    total += corridorWeight(dist, radiusKm, reachKm);
  }
  return total;
}

// ---------------------------------------------------------------------------
// Weighted Bike+Ride capacity
// ---------------------------------------------------------------------------

export interface BikeRideLocation {
  id: string;
  name: string;
  lat: number;
  lon: number;
  capacity: number;
  peakMultiplier: number;
  offPeakMultiplier: number;
  weekendMultiplier: number;
}

export function getLayerMultiplier(
  layer: {
    peakMultiplier?: number;
    offPeakMultiplier?: number;
    weekendMultiplier?: number;
  },
  timeSlice: TimeSlice,
): number {
  if (timeSlice === "weekday-peak") return layer.peakMultiplier ?? 1;
  if (timeSlice === "weekday-offpeak") return layer.offPeakMultiplier ?? 1;
  return layer.weekendMultiplier ?? 1;
}

export function weightedBikeRideCapacity(
  center: { lat: number; lon: number },
  radiusKm: number,
  timeSlice: TimeSlice,
  brLocations: BikeRideLocation[],
): number {
  let total = 0;
  for (const loc of brLocations) {
    const dist = distanceKm(center, loc);
    const weight = corridorWeight(dist, radiusKm, 0.8);
    if (weight === 0) continue;
    total += (loc.capacity / 80) * getLayerMultiplier(loc, timeSlice) * weight;
  }
  return total;
}
