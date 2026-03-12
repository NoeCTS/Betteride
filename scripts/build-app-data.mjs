#!/usr/bin/env node
/**
 * build-app-data.mjs
 * Processes raw Berlin data into a single ground-signal.json for the app.
 *
 * Input:  data/raw/berlin_bike_counters_locations.geojson
 *         data/raw/berlin_bike_counters_hourly.csv
 *         data/raw/vbb_stops.csv
 *         data/raw/berlin_bike_repair_shops.csv
 *         data/raw/betteride-partners.json
 * Output: data/app/ground-signal.json
 */

import { readFileSync, createReadStream, writeFileSync, mkdirSync } from "fs";
import { createInterface } from "readline";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const RAW = resolve(ROOT, "data/raw");
const OUT = resolve(ROOT, "data/app");

// ---------------------------------------------------------------------------
// Geo helpers
// ---------------------------------------------------------------------------
const R = 6371; // earth radius km
function haversine(lat1, lon1, lat2, lon2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function bikeMinutes(km) {
  return (km * 1.18 * 60) / 15;
}

// ---------------------------------------------------------------------------
// 1. Load bike counter locations
// ---------------------------------------------------------------------------
console.log("Loading bike counter locations...");
const counterGeo = JSON.parse(
  readFileSync(resolve(RAW, "berlin_bike_counters_locations.geojson"), "utf8")
);
const counterLocations = new Map();
for (const f of counterGeo.features) {
  const p = f.properties;
  counterLocations.set(p.counter_id, {
    id: p.counter_id,
    name: p.name,
    lat: p.lat,
    lon: p.lon,
  });
}
console.log(`  ${counterLocations.size} counter locations loaded`);

// ---------------------------------------------------------------------------
// 2. Process hourly CSV → daily averages per counter
// ---------------------------------------------------------------------------
console.log("Processing hourly counter data (2023-2024 only)...");

// Parse header to build column → counterId mapping
const headerLine = readFileSync(
  resolve(RAW, "berlin_bike_counters_hourly.csv"),
  "utf8"
).split("\n")[0];

// We only need the header line, rest will be streamed
const headerCols = headerLine.split(",");
// Column 0 = timestamp, columns 1+ are counters
const colToCounter = new Map(); // colIndex → counterId
for (let i = 1; i < headerCols.length; i++) {
  const raw = headerCols[i].trim();
  // Strip install date suffix: "02-MI-JAN-N 01.04.2015" → "02-MI-JAN-N"
  const counterId = raw.replace(/\s+\d{2}\.\d{2}\.\d{4}$/, "").trim();
  if (counterId) {
    colToCounter.set(i, counterId);
  }
}
console.log(`  ${colToCounter.size} CSV columns mapped to counter IDs`);

// Accumulators per counter
// For each counter: { peakSum, peakCount, offPeakSum, offPeakCount, weekendSum, weekendCount, totalSum, totalCount, dailyTotals: Map<dateStr, number> }
const counterStats = new Map();
for (const [, cid] of colToCounter) {
  if (!counterStats.has(cid)) {
    counterStats.set(cid, {
      peakSum: 0, peakCount: 0,
      offPeakSum: 0, offPeakCount: 0,
      weekendSum: 0, weekendCount: 0,
      dailyTotals: new Map(),
    });
  }
}

// Stream CSV
const rl = createInterface({
  input: createReadStream(resolve(RAW, "berlin_bike_counters_hourly.csv")),
  crlfDelay: Infinity,
});

let lineNum = 0;
let rowsProcessed = 0;

for await (const line of rl) {
  lineNum++;
  if (lineNum === 1) continue; // skip header

  const parts = line.split(",");
  const ts = parts[0];
  if (!ts) continue;

  // Filter to 2023-2024 only
  const year = parseInt(ts.substring(0, 4), 10);
  if (year < 2023) continue;

  const date = new Date(ts);
  const hour = date.getUTCHours();
  const dow = date.getUTCDay(); // 0=Sun, 6=Sat
  const isWeekend = dow === 0 || dow === 6;
  const isWeekday = !isWeekend;
  const isPeak = isWeekday && ((hour >= 7 && hour < 9) || (hour >= 16 && hour < 19));
  const isOffPeak = isWeekday && !isPeak;
  const dateStr = ts.substring(0, 10);

  rowsProcessed++;

  // For each column with data, accumulate
  for (const [colIdx, cid] of colToCounter) {
    const val = parts[colIdx];
    if (val === undefined || val === "") continue;
    const num = parseInt(val, 10);
    if (isNaN(num) || num < 0) continue;

    const s = counterStats.get(cid);
    if (!s) continue;

    // Accumulate for time-of-day averages
    if (isPeak) { s.peakSum += num; s.peakCount++; }
    else if (isOffPeak) { s.offPeakSum += num; s.offPeakCount++; }
    else if (isWeekend) { s.weekendSum += num; s.weekendCount++; }

    // Accumulate daily totals
    const prev = s.dailyTotals.get(dateStr) || 0;
    s.dailyTotals.set(dateStr, prev + num);
  }
}

console.log(`  ${rowsProcessed} rows processed (2023-2024)`);

// Build final counter objects
const counters = [];
for (const [cid, loc] of counterLocations) {
  const s = counterStats.get(cid);
  if (!s || s.dailyTotals.size === 0) {
    // Counter exists in locations but no hourly data — skip
    continue;
  }
  let dailySum = 0;
  for (const v of s.dailyTotals.values()) dailySum += v;
  const avgDaily = Math.round(dailySum / s.dailyTotals.size);
  const peakAvg = s.peakCount > 0 ? Math.round(s.peakSum / s.peakCount) : 0;
  const offPeakAvg = s.offPeakCount > 0 ? Math.round(s.offPeakSum / s.offPeakCount) : 0;
  const weekendAvg = s.weekendCount > 0 ? Math.round(s.weekendSum / s.weekendCount) : 0;

  counters.push({ id: cid, name: loc.name, lat: loc.lat, lon: loc.lon, avgDaily, peakAvg, offPeakAvg, weekendAvg });
}
console.log(`  ${counters.length} counters with 2023-2024 data`);

// ---------------------------------------------------------------------------
// 3. Filter VBB stops → Berlin S/U parent stations
// ---------------------------------------------------------------------------
console.log("Filtering VBB stops to Berlin S/U stations...");
const stopsRaw = readFileSync(resolve(RAW, "vbb_stops.csv"), "utf8");
const stopLines = stopsRaw.split("\n");

const stations = [];
const stationNameSet = new Set();

for (let i = 1; i < stopLines.length; i++) {
  const line = stopLines[i];
  if (!line.trim()) continue;

  // Parse CSV with quotes
  const cols = parseCSVLine(line);
  const stopId = cols[0] || "";
  const stopName = cols[2] || "";
  const locationType = cols[6] || "";
  const lat = parseFloat(cols[4] || "0");
  const lon = parseFloat(cols[5] || "0");

  // Filter: Berlin parent stations that are S/U-Bahn
  if (locationType !== "1") continue;
  if (!stopId.startsWith("de:11")) continue;
  if (!stopName.startsWith("S ") && !stopName.startsWith("U ") && !stopName.startsWith("S+U ")) continue;
  if (lat < 52.3 || lat > 52.7 || lon < 13.0 || lon > 13.8) continue;

  // Deduplicate by name (some stations appear twice)
  const cleanName = stopName.replace(" (Berlin)", "").replace(" Bhf", "").trim();
  if (stationNameSet.has(cleanName)) continue;
  stationNameSet.add(cleanName);

  let type = "S";
  if (stopName.startsWith("S+U")) type = "S+U";
  else if (stopName.startsWith("U")) type = "U";

  stations.push({ id: stopId, name: cleanName, lat, lon, type });
}
console.log(`  ${stations.length} Berlin S/U stations`);

// ---------------------------------------------------------------------------
// 4. Load repair shops
// ---------------------------------------------------------------------------
console.log("Loading repair shops...");
const shopsRaw = readFileSync(resolve(RAW, "berlin_bike_repair_shops.csv"), "utf8");
const shopLines = shopsRaw.split("\n");

let partnersJson;
try {
  partnersJson = JSON.parse(readFileSync(resolve(RAW, "betteride-partners.json"), "utf8"));
} catch {
  partnersJson = { partners: [] };
}
const partnerByOsmId = new Map(
  (partnersJson.partners ?? [])
    .filter((partner) => partner.osm_id)
    .map((partner) => [String(partner.osm_id), partner]),
);
const partnerByNormalizedName = new Map(
  (partnersJson.partners ?? [])
    .filter((partner) => partner.name)
    .map((partner) => [normalizePartnerKey(partner.name), partner]),
);

const shops = [];
for (let i = 1; i < shopLines.length; i++) {
  const line = shopLines[i];
  if (!line.trim()) continue;
  const cols = parseCSVLine(line);
  const name = cols[0] || "";
  const lat = parseFloat(cols[1]);
  const lon = parseFloat(cols[2]);
  const osmId = (cols[8] || "").trim();

  if (isNaN(lat) || isNaN(lon)) continue;
  if (lat < 52.3 || lat > 52.7 || lon < 13.0 || lon > 13.8) continue;

  const matchedPartner =
    partnerByOsmId.get(osmId) ||
    (name ? partnerByNormalizedName.get(normalizePartnerKey(name)) : null);
  const isPartner = Boolean(matchedPartner);

  shops.push({
    name: name || "Unnamed shop",
    lat,
    lon,
    osmId,
    isPartner,
    shopTag: matchedPartner ? matchedPartner.partner_tag ?? "partner_osm" : "candidate",
    partnerName: matchedPartner?.name ?? null,
    partnerMatchType: matchedPartner?.match_type ?? null,
  });
}

// Inject additional partners not found in OSM
if (partnersJson.additional_partners_not_in_osm) {
  for (const ap of partnersJson.additional_partners_not_in_osm) {
    const duplicatePartner = shops.some((shop) => {
      if (!shop.isPartner) return false;
      if (normalizePartnerKey(shop.name) === normalizePartnerKey(ap.name)) return true;
      return haversine(shop.lat, shop.lon, ap.lat, ap.lon) < 0.12;
    });

    if (duplicatePartner) {
      continue;
    }

    shops.push({
      name: ap.name,
      lat: ap.lat,
      lon: ap.lon,
      osmId: `betteride-${ap.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      isPartner: true,
      shopTag: ap.partner_tag ?? "partner_manual",
      partnerName: ap.name,
      partnerMatchType: ap.match_type ?? "manual_override",
    });
  }
}
console.log(`  ${shops.length} shops loaded (${shops.filter((s) => s.isPartner).length} partners)`);

// ---------------------------------------------------------------------------
// 5. Generate zones
// ---------------------------------------------------------------------------
console.log("Generating zones...");

// 5a. Group counters into unique locations (merge within 100m)
const counterGroups = [];
const usedCounters = new Set();
for (const c of counters) {
  if (usedCounters.has(c.id)) continue;
  const group = [c];
  usedCounters.add(c.id);
  for (const c2 of counters) {
    if (usedCounters.has(c2.id)) continue;
    if (haversine(c.lat, c.lon, c2.lat, c2.lon) < 0.1) {
      group.push(c2);
      usedCounters.add(c2.id);
    }
  }
  // Centroid of group
  const lat = group.reduce((s, g) => s + g.lat, 0) / group.length;
  const lon = group.reduce((s, g) => s + g.lon, 0) / group.length;
  // Sum daily averages for the group
  const avgDaily = group.reduce((s, g) => s + g.avgDaily, 0);
  counterGroups.push({ lat, lon, avgDaily, counterIds: group.map((g) => g.id) });
}
console.log(`  ${counterGroups.length} unique counter locations`);

// 5b. For each counter group, find nearest S/U station → zone name
const counterZones = counterGroups.map((cg) => {
  let nearest = null;
  let nearestDist = Infinity;
  for (const st of stations) {
    const d = haversine(cg.lat, cg.lon, st.lat, st.lon);
    if (d < nearestDist) {
      nearestDist = d;
      nearest = st;
    }
  }
  return {
    lat: cg.lat,
    lon: cg.lon,
    name: nearest ? nearest.name : `Counter zone`,
    stationType: nearest ? nearest.type : null,
    source: "counter",
    avgDaily: cg.avgDaily,
  };
});

// 5c. Add S+U stations not already near a counter zone
const stationZones = [];
for (const st of stations) {
  if (st.type !== "S+U") continue; // only major hubs
  // Check if any counter zone is within 800m
  const nearCounter = counterZones.some(
    (cz) => haversine(cz.lat, cz.lon, st.lat, st.lon) < 0.8
  );
  if (nearCounter) continue;

  // Check if 3+ shops within 1.5km
  const nearbyShopCount = shops.filter(
    (s) => haversine(s.lat, s.lon, st.lat, st.lon) < 1.5
  ).length;
  if (nearbyShopCount < 3) continue;

  stationZones.push({
    lat: st.lat,
    lon: st.lon,
    name: st.name,
    stationType: st.type,
    source: "station",
    avgDaily: 0,
  });
}
console.log(`  ${stationZones.length} additional station-anchored zones`);

// 5d. Merge all zone candidates, deduplicate within 500m
let allZoneCandidates = [...counterZones, ...stationZones];
const mergedZones = [];
const usedZones = new Set();

// Sort by avgDaily descending so higher-demand zones win naming
allZoneCandidates.sort((a, b) => b.avgDaily - a.avgDaily);

for (let i = 0; i < allZoneCandidates.length; i++) {
  if (usedZones.has(i)) continue;
  const z = allZoneCandidates[i];
  usedZones.add(i);

  // Absorb nearby candidates
  for (let j = i + 1; j < allZoneCandidates.length; j++) {
    if (usedZones.has(j)) continue;
    if (haversine(z.lat, z.lon, allZoneCandidates[j].lat, allZoneCandidates[j].lon) < 0.5) {
      usedZones.add(j);
    }
  }
  mergedZones.push(z);
}

// Deduplicate zone names
const nameCount = new Map();
for (const z of mergedZones) {
  nameCount.set(z.name, (nameCount.get(z.name) || 0) + 1);
}
const nameIndex = new Map();
for (const z of mergedZones) {
  if (nameCount.get(z.name) > 1) {
    const idx = (nameIndex.get(z.name) || 0) + 1;
    nameIndex.set(z.name, idx);
    z.name = `${z.name} ${idx === 1 ? "Nord" : idx === 2 ? "Süd" : idx === 3 ? "Ost" : "West"}`;
  }
}

console.log(`  ${mergedZones.length} final zones after merge`);

// ---------------------------------------------------------------------------
// 6. Precompute proximity for each zone
// ---------------------------------------------------------------------------
console.log("Computing zone proximities...");
const COUNTER_RADIUS = 2.0; // km
const SHOP_RADIUS = 1.5;
const STATION_RADIUS = 1.2;

const zones = mergedZones.map((z) => {
  const id = z.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  const nearbyCounters = counters
    .map((c) => {
      const d = haversine(z.lat, z.lon, c.lat, c.lon);
      return d <= COUNTER_RADIUS ? { item: c, distanceKm: Math.round(d * 100) / 100, bikeMinutes: Math.round(bikeMinutes(d) * 10) / 10 } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.distanceKm - b.distanceKm);

  const nearbyShops = shops
    .map((s) => {
      const d = haversine(z.lat, z.lon, s.lat, s.lon);
      return d <= SHOP_RADIUS ? { item: s, distanceKm: Math.round(d * 100) / 100, bikeMinutes: Math.round(bikeMinutes(d) * 10) / 10 } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.distanceKm - b.distanceKm);

  const nearbyStations = stations
    .map((st) => {
      const d = haversine(z.lat, z.lon, st.lat, st.lon);
      return d <= STATION_RADIUS ? { item: st, distanceKm: Math.round(d * 100) / 100, bikeMinutes: Math.round(bikeMinutes(d) * 10) / 10 } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.distanceKm - b.distanceKm);

  return {
    id,
    name: z.name,
    lat: z.lat,
    lon: z.lon,
    radius: 1.5,
    nearbyCounters,
    nearbyShops,
    nearbyStations,
    shopCount: nearbyShops.length,
    partnerCount: nearbyShops.filter((s) => s.item.isPartner).length,
    candidateCount: nearbyShops.filter((s) => !s.item.isPartner).length,
  };
});

// ---------------------------------------------------------------------------
// 7. Output
// ---------------------------------------------------------------------------
mkdirSync(OUT, { recursive: true });
const output = {
  zones,
  counters,
  stations,
  shops,
  generated: new Date().toISOString(),
};

const outPath = resolve(OUT, "ground-signal.json");
writeFileSync(outPath, JSON.stringify(output, null, 2));

const sizeKB = Math.round(readFileSync(outPath).length / 1024);
console.log(`\nDone! Wrote ${outPath}`);
console.log(`  ${zones.length} zones, ${counters.length} counters, ${stations.length} stations, ${shops.length} shops`);
console.log(`  File size: ${sizeKB} KB`);

// ---------------------------------------------------------------------------
// CSV parser (handles quoted fields)
// ---------------------------------------------------------------------------
function parseCSVLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

function normalizePartnerKey(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(berlin|bike|bikes|fahrrad|service|center|centre|laden|rad|radsport)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
