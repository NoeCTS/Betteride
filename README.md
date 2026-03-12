# BETTERIDE GROUND SIGNAL

BETTERIDE GROUND SIGNAL is a map-first prototype for Betteride, a Berlin bicycle repair marketplace. The product answers a narrow operations question:

Where is repair demand strongest, where is supply weak, and what should Betteride do next by zone?

This prototype is intentionally not a consumer cycling map. It is an internal repair-demand coverage engine for marketplace growth and operations.

## What the prototype does

- Ranks Berlin service zones by opportunity.
- Scores each zone across demand, supply, and demand-minus-supply gap.
- Switches between four strategic modes:
  - Coverage Gap
  - Partner Acquisition
  - Mobile Repair Ops
  - Commuter Reliability
- Shows operational layers on a live Leaflet map:
  - bike counters
  - bike-flow corridors
  - bike infrastructure
  - bike streets
  - transit nodes
  - Bike and Ride
  - Betteride partner shops
  - non-partner repair shops
  - public repair stations
- Generates zone-specific recommendations and KPIs.

## Stack

- Next.js App Router
- React
- TypeScript
- Leaflet with `react-leaflet`
- Local JSON seed datasets plus a raw-data ingestion script and normalization step

## Run it

```bash
npm install
npm run data:refresh
npm run seed:normalize
npm run dev
```

Useful checks:

```bash
npm run lint
npm run build
```

## Project structure

```text
app/
  layout.tsx
  page.tsx
components/
  controls-panel.tsx
  dashboard-shell.tsx
  header.tsx
  insights-panel.tsx
  map-canvas.tsx
  zone-detail.tsx
data/
  raw/
    berlin-layers.json
    berlin-service-zones.json
    berlin_bike_counters_hourly.csv
    berlin_bike_counters_locations.geojson
    berlin_bike_counters_raw.xlsx
    berlin_bike_repair_shops.csv
    berlin_bike_repair_shops.geojson
    berlin_bike_shops_google_places.csv
    berlin_bike_shops_yelp.csv
    berlin_osm_bicycle_shops_source.gpkg
    berlin_station_footfall.csv
    source-catalog.json
    vbb_gtfs.zip
    vbb_station_access_points.csv
    vbb_station_access_points.geojson
    vbb_station_access_source.zip
    vbb_stops.csv
    vbb_stops.geojson
  normalized/
    ground-signal-summary.json
    raw-market-data-summary.json
lib/
  data.ts
  dashboard-model.ts
  geo.ts
  recommendations.ts
  scoring.ts
  types.ts
scripts/
  refresh-berlin-market-data.py
  normalize-seed-data.mjs
```

## Raw data refresh

`npm run data:refresh` stages the verified Berlin and VBB source files under `data/raw/` and converts them into repo-ready targets:

- Berlin bike counters workbook, hourly CSV, and counter-location GeoJSON
- Geofabrik Berlin GPKG plus filtered bicycle-shop CSV and GeoJSON
- VBB station-access ZIP plus access-point CSV and GeoJSON
- VBB GTFS ZIP plus stops CSV and GeoJSON
- Header-only placeholders for Google Places, Yelp, and station footfall

The dashboard still renders the lightweight `berlin-layers.json` seed bundle. The heavier raw files are now surfaced through the source-quality panel and are available for future scoring-engine upgrades.

## Data model

### Geographic unit

The prototype uses custom Berlin service zones designed as rough 10 to 15 minute bike catchments. This is deliberate:

- it avoids ranking only broad districts
- it keeps the prototype operational rather than administrative
- it is compatible with future upgrades to 500 m hexes or official LOR polygons

### Layer quality

The live map seed is mixed-quality by design and explicitly labeled. Official raw files are now also staged under `data/raw/` for later scoring and enrichment work:

- Official raw files staged locally:
  - [Berlin bike counters](https://daten.berlin.de/datensaetze/radzahldaten-in-berlin)
  - [Geofabrik Berlin OpenStreetMap extract](https://download.geofabrik.de/europe/germany/berlin.html)
  - [VBB station access coordinates](https://daten.berlin.de/datensaetze/https-vbb-live-exozet-com-media-download-2035)
  - [VBB digital-services datasets](https://unternehmen.vbb.de/en/digital-services/datasets/)
- Official but simplified or proxied:
  - [Park and Ride and Bike and Ride facilities](https://daten.berlin.de/datensaetze/park-and-ride-anlagen)
  - [Berlin traffic volume references](https://www.berlin.de/sen/uvk/mobilitaet-und-verkehr/verkehrsdaten/zahlen-und-fakten/verkehrsmengen/)
- Prototype or mocked:
  - Betteride partner footprint, capacity, and same-day share
  - independent repair candidate list sampled from [OpenStreetMap](https://www.openstreetmap.org)

### Important assumptions

- Many geometries are simplified for prototype clarity.
- Partner capacity and same-day availability are mocked placeholders.
- Transit footfall and Bike and Ride capacity are used as relative commuter-demand proxies.
- Bike reach is modeled as estimated cycling time, not walking time.

## Scoring

Each zone gets three core outputs:

### Demand score

Weighted blend of:

- nearby bike counter volume
- nearby bike-flow corridor intensity
- station adjacency
- Bike and Ride adjacency
- bike infrastructure coverage
- weekday commuter intensity

### Supply score

Weighted blend of:

- Betteride partner capacity
- reachable partner capacity within 15 minutes by bike
- non-partner repair shop density
- public repair station fallback
- service redundancy

### Opportunity score

Base gap signal is driven by `demand score - supply score`, normalized to a 0 to 100 gap-pressure scale.

Each mode then reweights that base gap:

- Coverage Gap emphasizes strong demand plus low current supply.
- Partner Acquisition adds heavier weight to non-partner shop presence.
- Mobile Repair Ops adds pickup suitability, route clustering, and fast-repair deficit.
- Commuter Reliability adds weekday commuter intensity, station pull, and fast repair reach.

## What Betteride should do with the output

- Use Coverage Gap to decide where the marketplace is missing repair capacity today.
- Use Partner Acquisition to decide which corridors deserve immediate B2B outreach.
- Use Mobile Repair Ops to test pickup, van, or scheduled repair pop-up service where fixed partner reach is weak.
- Use Commuter Reliability to concentrate weekday messaging, fast-slot guarantees, and partner SLAs around station-led demand.

The prototype is most useful as a prioritization layer, not as a final forecast. It should tell Betteride where to look first, which zones to validate with CRM and bookings data, and which operational experiments to run next.

## Next upgrades

- Replace mocked Betteride capacity with CRM and booking-slot data.
- Replace simplified line geometry with direct WFS ingestion.
- Add real 10 to 15 minute cycling isochrones or routed service areas.
- Add historical jobs, CAC, missed-demand, and repeat-booking data by zone.
- Move from seed zones to 500 m hexes or official Berlin planning areas.
