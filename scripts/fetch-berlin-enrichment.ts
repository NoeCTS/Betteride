/**
 * Fetches Berlin enrichment data from Overpass API (OpenStreetMap) and
 * local knowledge, then writes data/raw/berlin-enrichment.json.
 *
 * Run: npx tsx scripts/fetch-berlin-enrichment.ts
 */

import { BERLIN_DISTRICT_PROFILES } from "../lib/berlin-district-profiles";

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";

interface OverpassElement {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

async function overpassQuery(query: string, retries = 3): Promise<OverpassElement[]> {
  for (let attempt = 0; attempt < retries; attempt++) {
    const res = await fetch(OVERPASS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `data=${encodeURIComponent(query)}`,
    });
    if (res.status === 429) {
      const wait = (attempt + 1) * 10000;
      console.log(`  Rate limited, waiting ${wait / 1000}s...`);
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    if (!res.ok) throw new Error(`Overpass error ${res.status}: ${await res.text()}`);
    const json = await res.json();
    return json.elements ?? [];
  }
  throw new Error("Overpass: max retries exceeded");
}

function extractCoords(el: OverpassElement): { lat: number; lon: number } | null {
  if (el.lat != null && el.lon != null) return { lat: el.lat, lon: el.lon };
  if (el.center) return el.center;
  return null;
}

// ----- Universities -----
async function fetchUniversities() {
  console.log("Fetching universities...");
  const elements = await overpassQuery(`
    [out:json][timeout:30];
    area["name"="Berlin"]["admin_level"="4"]->.berlin;
    (
      nwr["amenity"="university"](area.berlin);
      nwr["amenity"="college"](area.berlin);
    );
    out center;
  `);
  return elements
    .map((el) => {
      const coords = extractCoords(el);
      if (!coords) return null;
      return {
        id: `uni-${el.id}`,
        name: el.tags?.name ?? el.tags?.["name:en"] ?? "Unknown university",
        lat: coords.lat,
        lon: coords.lon,
        type: el.tags?.amenity ?? "university",
      };
    })
    .filter(Boolean);
}

// ----- Bike sharing stations -----
async function fetchBikeSharing() {
  console.log("Fetching bike sharing stations...");
  const elements = await overpassQuery(`
    [out:json][timeout:30];
    area["name"="Berlin"]["admin_level"="4"]->.berlin;
    (
      nwr["amenity"="bicycle_rental"](area.berlin);
    );
    out center;
  `);
  return elements
    .map((el) => {
      const coords = extractCoords(el);
      if (!coords) return null;
      return {
        id: `bikeshare-${el.id}`,
        name: el.tags?.name ?? el.tags?.operator ?? "Bike sharing station",
        operator: el.tags?.operator ?? el.tags?.network ?? "unknown",
        lat: coords.lat,
        lon: coords.lon,
        capacity: parseInt(el.tags?.capacity ?? "0", 10) || null,
      };
    })
    .filter(Boolean);
}

// ----- Parks and green areas with cycling -----
async function fetchParks() {
  console.log("Fetching major parks...");
  const elements = await overpassQuery(`
    [out:json][timeout:30];
    area["name"="Berlin"]["admin_level"="4"]->.berlin;
    (
      way["leisure"="park"]["name"](area.berlin);
      relation["leisure"="park"]["name"](area.berlin);
    );
    out center;
  `);
  // Only keep parks large enough to be relevant (filter small unnamed ones)
  return elements
    .map((el) => {
      const coords = extractCoords(el);
      if (!coords) return null;
      return {
        id: `park-${el.id}`,
        name: el.tags?.name ?? "Park",
        lat: coords.lat,
        lon: coords.lon,
      };
    })
    .filter(Boolean);
}

// ----- Coworking / major office areas -----
async function fetchOfficeAreas() {
  console.log("Fetching coworking spaces and office hubs...");
  const elements = await overpassQuery(`
    [out:json][timeout:30];
    area["name"="Berlin"]["admin_level"="4"]->.berlin;
    (
      nwr["amenity"="coworking_space"](area.berlin);
      nwr["office"="coworking"](area.berlin);
    );
    out center;
  `);
  return elements
    .map((el) => {
      const coords = extractCoords(el);
      if (!coords) return null;
      return {
        id: `office-${el.id}`,
        name: el.tags?.name ?? "Coworking space",
        lat: coords.lat,
        lon: coords.lon,
        type: "coworking",
      };
    })
    .filter(Boolean);
}

// ----- Schools (large secondary schools / vocational) -----
async function fetchSchools() {
  console.log("Fetching schools...");
  const elements = await overpassQuery(`
    [out:json][timeout:30];
    area["name"="Berlin"]["admin_level"="4"]->.berlin;
    (
      nwr["amenity"="school"]["isced:level"~"2|3"](area.berlin);
      nwr["amenity"="school"]["school:type"~"Gymnasium|Oberschule|Gesamtschule|Berufsschule"](area.berlin);
    );
    out center;
  `);
  return elements
    .map((el) => {
      const coords = extractCoords(el);
      if (!coords) return null;
      return {
        id: `school-${el.id}`,
        name: el.tags?.name ?? "School",
        lat: coords.lat,
        lon: coords.lon,
      };
    })
    .filter(Boolean);
}

// ----- Berlin district population data (Statistik Berlin-Brandenburg 2023) -----
function getBerlinDistricts() {
  return BERLIN_DISTRICT_PROFILES;
}

// ----- Berlin cycling modal share by district (SrV 2018 / Mobilität in Städten) -----
// Percentage of all trips made by bicycle per district
function getCyclingModalShare() {
  return {
    "mitte": 0.18,
    "friedrichshain-kreuzberg": 0.25,
    "pankow": 0.22,
    "charlottenburg-wilmersdorf": 0.15,
    "spandau": 0.08,
    "steglitz-zehlendorf": 0.13,
    "tempelhof-schoeneberg": 0.14,
    "neukoelln": 0.16,
    "treptow-koepenick": 0.12,
    "marzahn-hellersdorf": 0.07,
    "lichtenberg": 0.10,
    "reinickendorf": 0.09,
  };
}

// ----- Main -----
async function main() {
  console.log("=== Berlin Enrichment Data Fetcher ===\n");

  const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

  const universities = await fetchUniversities();
  await delay(5000);
  const bikeSharing = await fetchBikeSharing();
  await delay(5000);
  const parks = await fetchParks();
  await delay(5000);
  const officeAreas = await fetchOfficeAreas();
  await delay(5000);
  const schools = await fetchSchools();

  const districts = getBerlinDistricts();
  const cyclingModalShare = getCyclingModalShare();

  const enrichment = {
    generated: new Date().toISOString(),
    source: "OpenStreetMap + Statistik Berlin-Brandenburg + district socioeconomic/theft priors",
    universities,
    bikeSharing,
    parks,
    officeAreas,
    schools,
    districts,
    cyclingModalShare,
  };

  console.log(`\nResults:`);
  console.log(`  Universities/colleges: ${universities.length}`);
  console.log(`  Bike sharing stations: ${bikeSharing.length}`);
  console.log(`  Parks: ${parks.length}`);
  console.log(`  Coworking/office hubs: ${officeAreas.length}`);
  console.log(`  Schools: ${schools.length}`);
  console.log(`  Districts: ${districts.length}`);

  const fs = await import("fs");
  const path = await import("path");
  const outPath = path.join(__dirname, "..", "data", "raw", "berlin-enrichment.json");
  fs.writeFileSync(outPath, JSON.stringify(enrichment, null, 2));
  console.log(`\nWritten to ${outPath}`);
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
