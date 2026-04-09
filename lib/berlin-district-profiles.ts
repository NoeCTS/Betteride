export interface DistrictSocioeconomicProfile {
  purchasingPowerIndex: number;
  unemploymentRate: number;
  carFreeHouseholdsShare: number;
  renterHouseholdsShare: number;
}

export interface BerlinDistrictProfile {
  id: string;
  name: string;
  lat: number;
  lon: number;
  population: number;
  areaKm2: number;
  bikeTheftDensity: number; // reported thefts per 1,000 residents, prototype prior
  socioeconomic: DistrictSocioeconomicProfile;
}

// Prototype district priors used to add socioeconomic context and a repair-demand
// proxy. These are intentionally coarse district-level values rather than a
// block-by-block forecast model.
export const BERLIN_DISTRICT_PROFILES: BerlinDistrictProfile[] = [
  {
    id: "mitte",
    name: "Mitte",
    lat: 52.52,
    lon: 13.405,
    population: 384172,
    areaKm2: 39.47,
    bikeTheftDensity: 8.6,
    socioeconomic: {
      purchasingPowerIndex: 104,
      unemploymentRate: 9.5,
      carFreeHouseholdsShare: 0.66,
      renterHouseholdsShare: 0.85,
    },
  },
  {
    id: "friedrichshain-kreuzberg",
    name: "Friedrichshain-Kreuzberg",
    lat: 52.5005,
    lon: 13.433,
    population: 289991,
    areaKm2: 20.16,
    bikeTheftDensity: 10.4,
    socioeconomic: {
      purchasingPowerIndex: 98,
      unemploymentRate: 8.8,
      carFreeHouseholdsShare: 0.72,
      renterHouseholdsShare: 0.88,
    },
  },
  {
    id: "pankow",
    name: "Pankow",
    lat: 52.57,
    lon: 13.413,
    population: 413225,
    areaKm2: 103.01,
    bikeTheftDensity: 5.9,
    socioeconomic: {
      purchasingPowerIndex: 102,
      unemploymentRate: 6.3,
      carFreeHouseholdsShare: 0.56,
      renterHouseholdsShare: 0.74,
    },
  },
  {
    id: "charlottenburg-wilmersdorf",
    name: "Charlottenburg-Wilmersdorf",
    lat: 52.496,
    lon: 13.284,
    population: 342332,
    areaKm2: 64.72,
    bikeTheftDensity: 6.2,
    socioeconomic: {
      purchasingPowerIndex: 111,
      unemploymentRate: 6.8,
      carFreeHouseholdsShare: 0.48,
      renterHouseholdsShare: 0.76,
    },
  },
  {
    id: "spandau",
    name: "Spandau",
    lat: 52.535,
    lon: 13.199,
    population: 245527,
    areaKm2: 91.91,
    bikeTheftDensity: 3.4,
    socioeconomic: {
      purchasingPowerIndex: 89,
      unemploymentRate: 9.4,
      carFreeHouseholdsShare: 0.38,
      renterHouseholdsShare: 0.68,
    },
  },
  {
    id: "steglitz-zehlendorf",
    name: "Steglitz-Zehlendorf",
    lat: 52.434,
    lon: 13.241,
    population: 310071,
    areaKm2: 102.5,
    bikeTheftDensity: 3.1,
    socioeconomic: {
      purchasingPowerIndex: 116,
      unemploymentRate: 5.2,
      carFreeHouseholdsShare: 0.36,
      renterHouseholdsShare: 0.61,
    },
  },
  {
    id: "tempelhof-schoeneberg",
    name: "Tempelhof-Schoneberg",
    lat: 52.466,
    lon: 13.383,
    population: 351644,
    areaKm2: 53.09,
    bikeTheftDensity: 5.1,
    socioeconomic: {
      purchasingPowerIndex: 97,
      unemploymentRate: 7.4,
      carFreeHouseholdsShare: 0.49,
      renterHouseholdsShare: 0.78,
    },
  },
  {
    id: "neukoelln",
    name: "Neukolln",
    lat: 52.441,
    lon: 13.449,
    population: 329917,
    areaKm2: 44.93,
    bikeTheftDensity: 6.7,
    socioeconomic: {
      purchasingPowerIndex: 83,
      unemploymentRate: 10.8,
      carFreeHouseholdsShare: 0.58,
      renterHouseholdsShare: 0.85,
    },
  },
  {
    id: "treptow-koepenick",
    name: "Treptow-Kopenick",
    lat: 52.443,
    lon: 13.574,
    population: 275157,
    areaKm2: 168.42,
    bikeTheftDensity: 2.8,
    socioeconomic: {
      purchasingPowerIndex: 92,
      unemploymentRate: 7.1,
      carFreeHouseholdsShare: 0.31,
      renterHouseholdsShare: 0.62,
    },
  },
  {
    id: "marzahn-hellersdorf",
    name: "Marzahn-Hellersdorf",
    lat: 52.541,
    lon: 13.576,
    population: 269967,
    areaKm2: 61.74,
    bikeTheftDensity: 2.5,
    socioeconomic: {
      purchasingPowerIndex: 84,
      unemploymentRate: 8.5,
      carFreeHouseholdsShare: 0.29,
      renterHouseholdsShare: 0.57,
    },
  },
  {
    id: "lichtenberg",
    name: "Lichtenberg",
    lat: 52.513,
    lon: 13.501,
    population: 296470,
    areaKm2: 52.29,
    bikeTheftDensity: 3.9,
    socioeconomic: {
      purchasingPowerIndex: 88,
      unemploymentRate: 8.0,
      carFreeHouseholdsShare: 0.37,
      renterHouseholdsShare: 0.72,
    },
  },
  {
    id: "reinickendorf",
    name: "Reinickendorf",
    lat: 52.588,
    lon: 13.333,
    population: 265767,
    areaKm2: 89.46,
    bikeTheftDensity: 3.0,
    socioeconomic: {
      purchasingPowerIndex: 91,
      unemploymentRate: 8.2,
      carFreeHouseholdsShare: 0.33,
      renterHouseholdsShare: 0.63,
    },
  },
];

export const BERLIN_DISTRICT_PROFILE_MAP = Object.fromEntries(
  BERLIN_DISTRICT_PROFILES.map((district) => [district.id, district]),
) as Record<string, BerlinDistrictProfile>;
