#!/usr/bin/env node

import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const RAW = resolve(ROOT, "data/raw");

const partnerPath = resolve(RAW, "betteride-partners.json");
const shopPath = resolve(RAW, "berlin_bike_repair_shops.csv");

const partnerSeed = JSON.parse(readFileSync(partnerPath, "utf8"));
const shops = parseCsv(readFileSync(shopPath, "utf8")).map((row) => ({
  shopName: (row.shop_name ?? "").trim(),
  lat: Number.parseFloat(row.lat ?? ""),
  lon: Number.parseFloat(row.lon ?? ""),
  osmId: String(row.osm_id ?? "").trim(),
}));

const shopsByOsmId = new Map(shops.filter((shop) => shop.osmId).map((shop) => [shop.osmId, shop]));
const shopsByNormalizedName = new Map();
for (const shop of shops) {
  const key = normalizeName(shop.shopName);
  if (key && !shopsByNormalizedName.has(key)) {
    shopsByNormalizedName.set(key, shop);
  }
}

const enrichedPartners = (partnerSeed.partners ?? []).map((partner) => {
  const requestedOsmId = String(partner.osm_id ?? "").trim();
  const normalizedPartnerName = normalizeName(partner.name);

  let match = requestedOsmId ? shopsByOsmId.get(requestedOsmId) : null;
  let matchType = "osm_id";
  let matchConfidence = "high";

  if (!match && normalizedPartnerName) {
    match = shopsByNormalizedName.get(normalizedPartnerName) ?? null;
    matchType = "normalized_name";
    matchConfidence = match ? "medium" : "low";
  }

  if (!match) {
    return {
      ...partner,
      slug: slugify(partner.name),
      partner_tag: "partner_osm",
      match_type: "unmatched",
      match_confidence: "low",
    };
  }

  return {
    ...partner,
    slug: slugify(partner.name),
    osm_id: match.osmId,
    osm_name: match.shopName || partner.name,
    lat: Number.isFinite(match.lat) ? match.lat : partner.lat ?? null,
    lon: Number.isFinite(match.lon) ? match.lon : partner.lon ?? null,
    partner_tag: "partner_osm",
    match_type: matchType,
    match_confidence: matchConfidence,
  };
});

const enrichedManualPartners = (partnerSeed.additional_partners_not_in_osm ?? []).map((partner) => ({
  ...partner,
  slug: slugify(partner.name),
  partner_tag: "partner_manual",
  match_type: "manual_override",
  match_confidence: "manual",
}));

const output = {
  generated_at: new Date().toISOString(),
  source_file: "data/raw/berlin_bike_repair_shops.csv",
  partners: enrichedPartners,
  additional_partners_not_in_osm: enrichedManualPartners,
};

writeFileSync(partnerPath, `${JSON.stringify(output, null, 2)}\n`);

console.log(
  `Updated ${partnerPath} with ${enrichedPartners.length} OSM-matched partners and ${enrichedManualPartners.length} manual partner pins.`,
);

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) {
    return [];
  }

  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    return headers.reduce((row, header, index) => {
      row[header] = values[index] ?? "";
      return row;
    }, {});
  });
}

function parseCsvLine(line) {
  const cells = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const nextChar = line[index + 1];

    if (char === '"' && inQuotes && nextChar === '"') {
      current += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === "," && !inQuotes) {
      cells.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  cells.push(current);
  return cells;
}

function normalizeName(value) {
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

function slugify(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
