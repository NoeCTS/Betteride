import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const rawLayers = JSON.parse(
  await readFile(path.join(root, "data/raw/berlin-layers.json"), "utf8"),
);
const rawZones = JSON.parse(
  await readFile(path.join(root, "data/raw/berlin-service-zones.json"), "utf8"),
);
const sourceCatalog = JSON.parse(
  await readFile(path.join(root, "data/raw/source-catalog.json"), "utf8"),
);

const bounds = extractBounds(rawLayers, rawZones);
const output = {
  generatedAt: new Date().toISOString(),
  zoneCount: rawZones.features.length,
  layerCounts: {
    bikeCounters: rawLayers.bikeCounters.length,
    bikeFlowSegments: rawLayers.bikeFlowSegments.length,
    bikeInfrastructureSegments: rawLayers.bikeInfrastructureSegments.length,
    bikeStreetSegments: rawLayers.bikeStreetSegments.length,
    transitStations: rawLayers.transitStations.length,
    bikeRideLocations: rawLayers.bikeRideLocations.length,
    partnerShops: rawLayers.partnerShops.length,
    nonPartnerShops: rawLayers.nonPartnerShops.length,
    publicRepairStations: rawLayers.publicRepairStations.length,
  },
  sourceIds: sourceCatalog.map((source) => source.id),
  bounds,
  notes: [
    "This summary is derived from the local prototype seed layers.",
    "Zone polygons are custom service catchments; they are not official LOR units.",
    "Partner capacity fields remain mocked placeholders and should be replaced by Betteride ops data.",
  ],
};

await writeFile(
  path.join(root, "data/normalized/ground-signal-summary.json"),
  `${JSON.stringify(output, null, 2)}\n`,
  "utf8",
);

console.log(
  `Normalized ${output.zoneCount} zones and ${Object.values(output.layerCounts).reduce(
    (sum, count) => sum + count,
    0,
  )} layer features into data/normalized/ground-signal-summary.json`,
);

function extractBounds(layers, zones) {
  const coordinates = [];

  zones.features.forEach((feature) => {
    feature.geometry.coordinates[0].forEach(([lon, lat]) => {
      coordinates.push({ lon, lat });
    });
  });

  [
    ...layers.bikeCounters,
    ...layers.transitStations,
    ...layers.bikeRideLocations,
    ...layers.partnerShops,
    ...layers.nonPartnerShops,
    ...layers.publicRepairStations,
  ].forEach((item) => {
    coordinates.push({ lon: item.lon, lat: item.lat });
  });

  [
    ...layers.bikeFlowSegments,
    ...layers.bikeInfrastructureSegments,
    ...layers.bikeStreetSegments,
  ].forEach((segment) => {
    segment.coordinates.forEach(([lon, lat]) => {
      coordinates.push({ lon, lat });
    });
  });

  return coordinates.reduce(
    (accumulator, point) => {
      return {
        minLon: Math.min(accumulator.minLon, point.lon),
        minLat: Math.min(accumulator.minLat, point.lat),
        maxLon: Math.max(accumulator.maxLon, point.lon),
        maxLat: Math.max(accumulator.maxLat, point.lat),
      };
    },
    {
      minLon: Number.POSITIVE_INFINITY,
      minLat: Number.POSITIVE_INFINITY,
      maxLon: Number.NEGATIVE_INFINITY,
      maxLat: Number.NEGATIVE_INFINITY,
    },
  );
}
