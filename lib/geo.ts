/* ------------------------------------------------------------------ */
/*  Geographic utility functions                                       */
/* ------------------------------------------------------------------ */

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function round(value: number, precision = 1) {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

export function distanceKm(
  from: { lat: number; lon: number },
  to: { lat: number; lon: number },
) {
  const earthRadiusKm = 6371;
  const deltaLat = degreesToRadians(to.lat - from.lat);
  const deltaLon = degreesToRadians(to.lon - from.lon);
  const fromLat = degreesToRadians(from.lat);
  const toLat = degreesToRadians(to.lat);

  const a =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.sin(deltaLon / 2) *
      Math.sin(deltaLon / 2) *
      Math.cos(fromLat) *
      Math.cos(toLat);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return earthRadiusKm * c;
}

export function estimateBikeMinutes(distanceInKm: number) {
  const detourFactor = 1.18;
  const speedKph = 15;
  return (distanceInKm * detourFactor * 60) / speedKph;
}

export function influenceWithinRadius(distanceInKm: number, radiusInKm: number) {
  if (distanceInKm >= radiusInKm) {
    return 0;
  }
  return 1 - distanceInKm / radiusInKm;
}

export function normalizeToHundred(values: number[]) {
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);

  if (maximum === minimum) {
    return values.map(() => 50);
  }

  return values.map((value) => ((value - minimum) / (maximum - minimum)) * 100);
}

export function clampKmRadius(radiusKm: number) {
  return clamp(radiusKm, 0.25, 3);
}

export function offsetPointEast(
  point: { lat: number; lon: number },
  distanceInKm: number,
) {
  const latRadians = degreesToRadians(point.lat);
  const kmPerDegreeLon = 111.32 * Math.cos(latRadians);

  return {
    lat: point.lat,
    lon: point.lon + distanceInKm / Math.max(0.000001, kmPerDegreeLon),
  };
}

function degreesToRadians(value: number) {
  return (value * Math.PI) / 180;
}
