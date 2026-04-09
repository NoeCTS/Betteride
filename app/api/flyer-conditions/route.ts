import { NextRequest, NextResponse } from "next/server";

import appDataJson from "@/data/app/ground-signal.json";
import {
  buildFallbackWeather,
  buildWeatherAdjustment,
  resolveFlyerContextDate,
} from "@/lib/flyer-conditions";
import { clamp, round } from "@/lib/geo";
import type {
  AppData,
  FlyerConditions,
  FlyerTimeContext,
  TransitDisruptionAdjustment,
} from "@/lib/types";

export const runtime = "nodejs";
export const revalidate = 300;

const appData = appDataJson as unknown as AppData;
const BERLIN_CENTER = { lat: 52.52, lon: 13.405 };
const OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast";
const BVG_BASE_URL = "https://v6.bvg.transport.rest";

const anchorStations = Array.from(
  new Map(
    appData.zones
      .map((zone) => zone.nearbyStations[0]?.item)
      .filter((station): station is AppData["stations"][number] => Boolean(station))
      .map((station) => [station.id, station]),
  ).values(),
);

interface OpenMeteoResponse {
  hourly?: {
    time?: string[];
    temperature_2m?: number[];
    apparent_temperature?: number[];
    precipitation_probability?: number[];
    precipitation?: number[];
    weather_code?: number[];
    wind_speed_10m?: number[];
  };
}

interface DepartureRemark {
  text?: string;
  summary?: string;
  type?: string;
}

interface Departure {
  cancelled?: boolean;
  delay?: number | null;
  remarks?: DepartureRemark[];
}

export async function GET(request: NextRequest) {
  const ctx = parseContext(request.nextUrl.searchParams);
  const targetDate = resolveFlyerContextDate(ctx);
  const targetTimeIso = targetDate.toISOString();

  const [weather, transit] = await Promise.all([
    fetchWeather(targetDate),
    fetchTransitDisruptions(targetDate),
  ]);

  const payload: FlyerConditions = {
    targetTimeIso,
    weather,
    stationDisruptions: transit.stationDisruptions,
    weatherStatus: weather.source === "open-meteo" ? "ready" : "fallback",
    transitStatus: transit.status,
  };

  return NextResponse.json(payload);
}

function parseContext(searchParams: URLSearchParams): FlyerTimeContext {
  const day = searchParams.get("day");
  const timeBlock = searchParams.get("timeBlock");

  const safeDay: FlyerTimeContext["day"] = isValidDay(day) ? day : "friday";
  const safeTimeBlock: FlyerTimeContext["timeBlock"] = isValidTimeBlock(timeBlock)
    ? timeBlock
    : "afternoon-peak";

  return { day: safeDay, timeBlock: safeTimeBlock };
}

async function fetchWeather(targetDate: Date) {
  const targetHour = formatBerlinHour(targetDate);
  const targetTimeIso = targetDate.toISOString();

  try {
    const response = await fetch(
      `${OPEN_METEO_URL}?latitude=${BERLIN_CENTER.lat}&longitude=${BERLIN_CENTER.lon}`
        + "&hourly=temperature_2m,apparent_temperature,precipitation_probability,precipitation,weather_code,wind_speed_10m"
        + "&timezone=Europe%2FBerlin&forecast_days=10",
      {
        next: { revalidate: 300 },
      },
    );

    if (!response.ok) {
      return buildFallbackWeather(targetTimeIso, `Weather API unavailable (${response.status}).`);
    }

    const json = await response.json() as OpenMeteoResponse;
    const hourly = json.hourly;
    const times = hourly?.time ?? [];
    const index = findClosestHourIndex(times, targetHour);

    if (index < 0) {
      return buildFallbackWeather(targetTimeIso, "Weather forecast missing target hour. Using neutral multiplier.");
    }

    return buildWeatherAdjustment(
      targetTimeIso,
      {
        temperatureC: hourly?.temperature_2m?.[index] ?? null,
        apparentTemperatureC: hourly?.apparent_temperature?.[index] ?? null,
        precipitationProbability: hourly?.precipitation_probability?.[index] ?? null,
        precipitationMm: hourly?.precipitation?.[index] ?? null,
        weatherCode: hourly?.weather_code?.[index] ?? null,
        windSpeedKph: hourly?.wind_speed_10m?.[index] ?? null,
      },
      "open-meteo",
    );
  } catch {
    return buildFallbackWeather(targetTimeIso, "Weather fetch failed. Using neutral multiplier.");
  }
}

async function fetchTransitDisruptions(targetDate: Date): Promise<{
  stationDisruptions: Record<string, TransitDisruptionAdjustment>;
  status: FlyerConditions["transitStatus"];
}> {
  const results = await Promise.allSettled(
    anchorStations.map(async (station) => {
      const response = await fetch(
        `${BVG_BASE_URL}/stops/${station.id}/departures?when=${encodeURIComponent(targetDate.toISOString())}`
          + "&duration=90&results=12&remarks=true&language=en",
        {
          next: { revalidate: 300 },
        },
      );

      if (!response.ok) {
        throw new Error(`BVG status ${response.status}`);
      }

      const json = await response.json() as Departure[] | { departures?: Departure[] };
      const departures = Array.isArray(json) ? json : json.departures ?? [];
      return [station.id, summarizeDisruptions(station.id, station.name, departures)] as const;
    }),
  );

  const stationDisruptions: Record<string, TransitDisruptionAdjustment> = {};
  let successCount = 0;

  for (const result of results) {
    if (result.status !== "fulfilled") {
      continue;
    }

    const [stationId, summary] = result.value;
    stationDisruptions[stationId] = summary;
    successCount += 1;
  }

  if (successCount === 0) {
    return { stationDisruptions, status: "fallback" };
  }

  return {
    stationDisruptions,
    status: successCount === anchorStations.length ? "ready" : "partial",
  };
}

function summarizeDisruptions(
  stationId: string,
  stationName: string,
  departures: Departure[],
): TransitDisruptionAdjustment {
  if (departures.length === 0) {
    return {
      stationId,
      stationName,
      score: 0,
      boostMultiplier: 1,
      delayedDepartures: 0,
      cancelledDepartures: 0,
      averageDelayMinutes: 0,
      remarkCount: 0,
      summary: "No departures returned for this window.",
    };
  }

  const delayedDepartures = departures.filter((departure) => (departure.delay ?? 0) > 0).length;
  const cancelledDepartures = departures.filter((departure) => departure.cancelled).length;
  const totalDelayMinutes = departures.reduce((sum, departure) => sum + normalizeDelayMinutes(departure.delay), 0);
  const averageDelayMinutes = totalDelayMinutes / departures.length;
  const remarkCount = departures.reduce((sum, departure) => sum + (departure.remarks?.length ?? 0), 0);

  const delayPressure = clamp(averageDelayMinutes / 10, 0, 1);
  const cancellationPressure = clamp(cancelledDepartures / Math.max(1, departures.length), 0, 1);
  const remarkPressure = clamp(remarkCount / Math.max(1, departures.length * 2), 0, 1);

  const score = round(clamp(
    (0.45 * delayPressure + 0.35 * cancellationPressure + 0.20 * remarkPressure) * 100,
    0,
    100,
  ), 0);
  const boostMultiplier = round(clamp(1 + score / 280, 1, 1.35), 2);

  const parts: string[] = [];
  if (cancelledDepartures > 0) parts.push(`${cancelledDepartures} cancelled`);
  if (delayedDepartures > 0) parts.push(`${delayedDepartures} delayed`);
  if (averageDelayMinutes >= 1) parts.push(`avg +${Math.round(averageDelayMinutes)}m`);
  if (remarkCount > 0) parts.push(`${remarkCount} warnings`);

  return {
    stationId,
    stationName,
    score,
    boostMultiplier,
    delayedDepartures,
    cancelledDepartures,
    averageDelayMinutes: round(averageDelayMinutes, 1),
    remarkCount,
    summary: parts.length > 0 ? parts.join(" · ") : "No notable disruption signal in this window.",
  };
}

function findClosestHourIndex(times: string[], targetHour: string) {
  const exact = times.indexOf(targetHour);
  if (exact >= 0) return exact;

  const targetMs = Date.parse(`${targetHour}:00+02:00`);
  let closestIndex = -1;
  let smallestDelta = Number.POSITIVE_INFINITY;

  times.forEach((time, index) => {
    const delta = Math.abs(Date.parse(`${time}:00+02:00`) - targetMs);
    if (delta < smallestDelta) {
      smallestDelta = delta;
      closestIndex = index;
    }
  });

  return closestIndex;
}

function formatBerlinHour(date: Date) {
  const formatter = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });

  return formatter.format(date).replace(" ", "T").slice(0, 13) + ":00";
}

function normalizeDelayMinutes(delay: number | null | undefined) {
  if (delay == null || delay <= 0) return 0;
  return delay > 120 ? delay / 60 : delay;
}

function isValidDay(value: string | null): value is FlyerTimeContext["day"] {
  return value === "monday"
    || value === "tuesday"
    || value === "wednesday"
    || value === "thursday"
    || value === "friday"
    || value === "saturday"
    || value === "sunday";
}

function isValidTimeBlock(value: string | null): value is FlyerTimeContext["timeBlock"] {
  return value === "morning-peak"
    || value === "midday"
    || value === "afternoon-peak"
    || value === "evening";
}
