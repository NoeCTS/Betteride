import { influenceWithinRadius, round } from "@/lib/geo";
import type {
  FlyerConditions,
  FlyerTimeContext,
  TransitDisruptionAdjustment,
  WeatherAdjustment,
} from "@/lib/types";
import type { NearbyStation } from "@/lib/types";

const BERLIN_TIME_ZONE = "Europe/Berlin";

const DAY_INDEX: Record<FlyerTimeContext["day"], number> = {
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
  sunday: 0,
};

const TIME_BLOCK_TARGETS: Record<FlyerTimeContext["timeBlock"], { hour: number; minute: number }> = {
  "morning-peak": { hour: 8, minute: 30 },
  midday: { hour: 12, minute: 0 },
  "afternoon-peak": { hour: 16, minute: 30 },
  evening: { hour: 20, minute: 0 },
};

const WEATHER_CODE_LABELS: Record<number, string> = {
  0: "clear",
  1: "mainly clear",
  2: "partly cloudy",
  3: "overcast",
  45: "fog",
  48: "freezing fog",
  51: "light drizzle",
  53: "drizzle",
  55: "dense drizzle",
  61: "light rain",
  63: "rain",
  65: "heavy rain",
  66: "freezing rain",
  67: "heavy freezing rain",
  71: "light snow",
  73: "snow",
  75: "heavy snow",
  80: "light showers",
  81: "showers",
  82: "violent showers",
  95: "thunderstorm",
  96: "thunderstorm with hail",
  99: "severe thunderstorm",
};

export function resolveFlyerContextDate(ctx: FlyerTimeContext, now = new Date()) {
  const berlinParts = getBerlinParts(now);
  const target = TIME_BLOCK_TARGETS[ctx.timeBlock];
  let dayOffset = (DAY_INDEX[ctx.day] - berlinParts.weekday + 7) % 7;

  if (
    dayOffset === 0 &&
    (berlinParts.hour > target.hour ||
      (berlinParts.hour === target.hour && berlinParts.minute >= target.minute))
  ) {
    dayOffset = 7;
  }

  return zonedDateTimeToUtc({
    year: berlinParts.year,
    month: berlinParts.month,
    day: berlinParts.day + dayOffset,
    hour: target.hour,
    minute: target.minute,
    second: 0,
  }, BERLIN_TIME_ZONE);
}

export function buildFallbackWeather(targetTimeIso: string, reason?: string): WeatherAdjustment {
  return {
    source: "fallback",
    targetTimeIso,
    multiplier: 1,
    summary: reason ?? "Weather unavailable. Using a neutral demand multiplier.",
    temperatureC: null,
    apparentTemperatureC: null,
    precipitationProbability: null,
    precipitationMm: null,
    windSpeedKph: null,
    weatherCode: null,
  };
}

export function buildWeatherAdjustment(
  targetTimeIso: string,
  values: {
    temperatureC: number | null;
    apparentTemperatureC: number | null;
    precipitationProbability: number | null;
    precipitationMm: number | null;
    windSpeedKph: number | null;
    weatherCode: number | null;
  },
  source: WeatherAdjustment["source"] = "open-meteo",
): WeatherAdjustment {
  const {
    temperatureC,
    apparentTemperatureC,
    precipitationProbability,
    precipitationMm,
    windSpeedKph,
    weatherCode,
  } = values;

  let multiplier = 1;
  const temp = apparentTemperatureC ?? temperatureC;
  const precipProb = precipitationProbability ?? 0;
  const precip = precipitationMm ?? 0;
  const wind = windSpeedKph ?? 0;

  if (temp != null) {
    if (temp >= 12 && temp <= 22) multiplier += 0.05;
    else if (temp < 4 || temp > 30) multiplier -= 0.08;
    else if (temp < 8 || temp > 26) multiplier -= 0.04;
  }

  if (precipProb >= 35 || precip >= 0.3) multiplier -= 0.06;
  if (precipProb >= 65 || precip >= 1.2) multiplier -= 0.10;
  if (precipProb >= 80 || precip >= 3) multiplier -= 0.10;

  if (wind >= 25) multiplier -= 0.05;
  if (wind >= 35) multiplier -= 0.06;

  if (weatherCode != null) {
    if ([65, 67, 75, 82, 95, 96, 99].includes(weatherCode)) multiplier -= 0.10;
    else if ([61, 63, 66, 71, 73, 80, 81].includes(weatherCode)) multiplier -= 0.05;
    else if ([0, 1, 2].includes(weatherCode)) multiplier += 0.02;
  }

  multiplier = round(Math.min(1.12, Math.max(0.62, multiplier)), 2);
  const deltaPct = Math.round((multiplier - 1) * 100);
  const weatherLabel = weatherCode != null ? WEATHER_CODE_LABELS[weatherCode] ?? "mixed conditions" : "mixed conditions";
  const tempLabel = temp != null ? `${Math.round(temp)}C` : "temp n/a";
  const rainLabel = precipitationProbability != null
    ? `${Math.round(precipitationProbability)}% rain risk`
    : "rain risk n/a";
  const deltaLabel = deltaPct === 0
    ? "neutral demand"
    : `${deltaPct > 0 ? "+" : ""}${deltaPct}% cyclist demand`;

  return {
    source,
    targetTimeIso,
    multiplier,
    summary: `${weatherLabel}, ${tempLabel}, ${rainLabel} -> ${deltaLabel}`,
    temperatureC,
    apparentTemperatureC,
    precipitationProbability,
    precipitationMm,
    windSpeedKph,
    weatherCode,
  };
}

export function computeTransitBoost(
  nearbyStations: NearbyStation[],
  stationDisruptions: FlyerConditions["stationDisruptions"] | undefined,
): { boostMultiplier: number; topDisruption: TransitDisruptionAdjustment | null } {
  if (!stationDisruptions) {
    return { boostMultiplier: 1, topDisruption: null };
  }

  let weightedBoost = 0;
  let totalWeight = 0;
  let topDisruption: TransitDisruptionAdjustment | null = null;

  for (const station of nearbyStations.slice(0, 4)) {
    const disruption = stationDisruptions[station.item.id];
    if (!disruption) continue;

    const weight = Math.max(0.1, influenceWithinRadius(station.distanceKm, 1.4));
    weightedBoost += disruption.boostMultiplier * weight;
    totalWeight += weight;

    if (!topDisruption || disruption.score > topDisruption.score) {
      topDisruption = disruption;
    }
  }

  return {
    boostMultiplier: totalWeight > 0 ? round(weightedBoost / totalWeight, 2) : 1,
    topDisruption,
  };
}

export function getSpotWeatherMultiplier(
  type: "br-stop" | "station-entrance" | "protected-lane" | "bike-street" | "shop-cluster",
  weather: WeatherAdjustment | null | undefined,
) {
  if (!weather) return 1;

  const weatherPressure = 1 - weather.multiplier;
  if (weatherPressure > 0) {
    if (type === "br-stop") return round(1 + weatherPressure * 0.35, 2);
    if (type === "station-entrance") return round(1 + weatherPressure * 0.2, 2);
    if (type === "shop-cluster") return round(1 + weatherPressure * 0.08, 2);
    if (type === "bike-street") return round(1 - weatherPressure * 0.25, 2);
    return round(1 - weatherPressure * 0.35, 2);
  }

  const pleasantBoost = weather.multiplier - 1;
  if (type === "protected-lane") return round(1 + pleasantBoost * 0.4, 2);
  if (type === "bike-street") return round(1 + pleasantBoost * 0.3, 2);
  return 1;
}

function getBerlinParts(date: Date) {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: BERLIN_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  });

  const parts = formatter.formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const weekdayName = map.weekday?.toLowerCase();

  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
    weekday: weekdayName === "mon"
      ? 1
      : weekdayName === "tue"
        ? 2
        : weekdayName === "wed"
          ? 3
          : weekdayName === "thu"
            ? 4
            : weekdayName === "fri"
              ? 5
              : weekdayName === "sat"
                ? 6
                : 0,
  };
}

function zonedDateTimeToUtc(
  parts: { year: number; month: number; day: number; hour: number; minute: number; second: number },
  timeZone: string,
) {
  const utcGuess = new Date(Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  ));
  const offset = getTimeZoneOffsetMs(timeZone, utcGuess);
  return new Date(utcGuess.getTime() - offset);
}

function getTimeZoneOffsetMs(timeZone: string, date: Date) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });

  const parts = formatter.formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  const asUtc = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour),
    Number(map.minute),
    Number(map.second),
  );

  return asUtc - date.getTime();
}
