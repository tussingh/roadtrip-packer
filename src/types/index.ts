/**
 * Core data model. Every persisted record carries `updatedAt` so backups and
 * merges are deterministic. Schema version lives in src/storage/schema.ts.
 */

export type Id = string;
export type ISODate = string; // yyyy-mm-dd
export type ISODateTime = string;

/* ------------------------------------------------------------------ */
/* Travellers                                                          */
/* ------------------------------------------------------------------ */

export type TravellerKind = 'adult' | 'child';
export type Gender = 'male' | 'female' | 'unspecified';
export type DiaperStatus = 'diapers' | 'night-only' | 'trained';
export type CarSeatStage = 'rear-facing' | 'forward-facing' | 'booster' | 'none';

export interface AdultPrefs {
  isDriver: boolean;
  takesRegularMedication: boolean;
  wearsGlasses: boolean;
  wearsContactLenses: boolean;
  shaves: boolean;
  skincareRoutine: boolean;
  makeup: boolean;
  menstrualProducts: boolean;
  hairDryerOrStyler: boolean;
  smartwatch: boolean;
  laptop: boolean;
  jewelleryAndAccessories: boolean;
  motionSickness: boolean;
  /** Extra outfits per day beyond the global assumption (e.g. 0.5 for an evening change). */
  extraOutfitsPerDay: number;
  notes: string;
}

export interface ChildPrefs {
  diaperStatus: DiaperStatus;
  breastfed: boolean;
  formula: boolean;
  animalMilk: boolean;
  eatsSolids: boolean;
  usesStroller: boolean;
  usesCarrier: boolean;
  carSeat: CarSeatStage;
  comfortItem: string;
  takesRegularMedication: boolean;
  motionSickness: boolean;
  napsInCar: boolean;
  notes: string;
}

export interface TravellerProfile {
  id: Id;
  name: string;
  kind: TravellerKind;
  gender: Gender;
  /** Children: birth date drives age-aware rules. Adults: optional. */
  birthDate?: ISODate;
  adult?: AdultPrefs;
  child?: ChildPrefs;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

/* ------------------------------------------------------------------ */
/* Trips                                                               */
/* ------------------------------------------------------------------ */

export type Accommodation = 'hotel' | 'resort' | 'homestay' | 'camping' | 'family';
export type Laundry = 'none' | 'midway' | 'anytime';
export type Temperature = 'auto' | 'hot' | 'warm' | 'mild' | 'cool' | 'cold';
export type Rain = 'auto' | 'dry' | 'showers' | 'monsoon';
export type Resupply = 'good' | 'limited' | 'poor';
export type Activity =
  | 'beach'
  | 'swimming'
  | 'hill-station'
  | 'wildlife'
  | 'hiking'
  | 'photography'
  | 'drone'
  | 'religious'
  | 'sightseeing'
  | 'work';

export type KmSource = 'manual' | 'offline-route' | 'online-route' | 'none';

export interface Place {
  name: string;
  lat?: number;
  lon?: number;
}

export interface RouteStop extends Place {
  id: Id;
  overnight: boolean;
}

/** One driving day. Optional: if absent the engine splits distance evenly. */
export interface DriveLeg {
  id: Id;
  label: string;
  km: number;
  hours?: number;
}

export interface Trip {
  id: Id;
  name: string;
  startDate?: ISODate;
  endDate?: ISODate;
  days: number;
  nights: number;
  origin: Place;
  destination: Place;
  stops: RouteStop[];
  returnSameRoute: boolean;
  totalKm: number;
  kmSource: KmSource;
  drivingDays: number;
  /** Manual override for total hours in the car; otherwise km / avg speed. */
  totalDriveHours?: number;
  legs: DriveLeg[];
  travellerIds: Id[];
  accommodation: Accommodation;
  activities: Activity[];
  laundry: Laundry;
  temperature: Temperature;
  rain: Rain;
  remote: boolean;
  mountains: boolean;
  overnightDriving: boolean;
  resupply: Resupply;
  assumptionOverrides: Partial<Assumptions>;
  /** Route, stops and places fetched from free online services, saved for offline use. */
  plan?: TripPlan;
  status: 'planning' | 'completed' | 'archived';
  generatedAt?: ISODateTime;
  engineVersion?: string;
  notes: string;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

/* ------------------------------------------------------------------ */
/* Online trip plan                                                    */
/* ------------------------------------------------------------------ */

export interface GeoPoint {
  name: string;
  lat: number;
  lon: number;
  detail?: string;
}

export interface RouteOption {
  id: string;
  label: string;
  distanceKm: number;
  /** Router estimate without traffic, hours. */
  durationH: number;
  /** Share of distance on national highways (refs starting NH/AH/NE), 0–100. */
  highwayPct: number;
  roads: { name: string; km: number }[];
  legs: { from: string; to: string; km: number; h: number }[];
  /** Simplified [lon, lat] line. */
  geometry: [number, number][];
  /** Cumulative km and hours at each geometry vertex (for time → place lookups). */
  cumKm: number[];
  cumH: number[];
}

export interface PlannedPlace {
  id: string;
  name: string;
  kind: string;
  lat: number;
  lon: number;
  alongKm: number;
  offKm: number;
  tags: Record<string, string>;
}

export interface DayForecast {
  date: string;
  tMax: number;
  tMin: number;
  rainMm: number;
  rainProb: number;
  code: number;
}

export interface TripPlan {
  fetchedAt: ISODateTime;
  origin: GeoPoint;
  destination: GeoPoint;
  via: GeoPoint[];
  options: RouteOption[];
  chosen: number;
  places?: PlannedPlace[];
  placesFetchedAt?: ISODateTime;
  placesError?: string;
  destinationSights?: PlannedPlace[];
  forecast?: DayForecast[];
  forecastFor?: string;
  elevation?: { min: number; max: number };
  offlineMap?: { tiles: number; bytes: number; savedAt: ISODateTime };
}

/* ------------------------------------------------------------------ */
/* Checklist                                                           */
/* ------------------------------------------------------------------ */

export type Category =
  | 'documents'
  | 'clothing'
  | 'footwear'
  | 'toiletries'
  | 'health'
  | 'electronics'
  | 'baby-care'
  | 'baby-feeding'
  | 'baby-sleep'
  | 'baby-gear'
  | 'food-water'
  | 'vehicle-safety'
  | 'vehicle-tools'
  | 'vehicle-checks'
  | 'comfort'
  | 'entertainment'
  | 'activity'
  | 'stay'
  | 'planning';

export type Necessity = 'essential' | 'recommended' | 'optional' | 'activity';
export type Priority = 1 | 2 | 3;
export type PackLocation =
  | 'cabin'
  | 'diaper-bag'
  | 'boot'
  | 'suitcase'
  | 'emergency-kit'
  | 'on-person'
  | 'car'
  | 'n/a';
export type Stage = 'advance' | 'night-before' | 'morning' | 'cabin' | 'verify';

/** 'shared' = family-level; 'car' = vehicle; otherwise a traveller id. */
export type AssigneeId = 'shared' | 'car' | Id;

export type OwnedState = 'unknown' | 'owned' | 'partial' | 'not-owned';

export interface ChecklistItem {
  id: Id;
  tripId: Id;
  /** Stable key: `${ruleId}@${assigneeId}` for generated items, `custom:${id}` otherwise. */
  key: string;
  ruleId?: string;
  source: 'rule' | 'custom' | 'personal';
  name: string;
  category: Category;
  assigneeId: AssigneeId;
  recommendedQty: number;
  /** User override; effective quantity = userQty ?? recommendedQty. */
  userQty?: number;
  unit: string;
  reasons: string[];
  conditions: string[];
  necessity: Necessity;
  priority: Priority;
  reusable: boolean;
  consumable: boolean;
  location: PackLocation;
  stage: Stage;
  accessibleEnRoute: boolean;
  safetyCritical: boolean;
  /** For checks/planning items there is nothing physical to pack. */
  isCheck: boolean;
  packed: boolean;
  owned: OwnedState;
  ownedQty?: number;
  unavailable: boolean;
  needsPurchase: boolean;
  purchaseReason?: string;
  forgottenBefore?: boolean;
  /** Generated item no longer produced by the rules but kept because the user touched it. */
  stale?: boolean;
  notes: string;
  order: number;
  updatedAt: ISODateTime;
}

/* ------------------------------------------------------------------ */
/* Inventory, history, personalisation                                 */
/* ------------------------------------------------------------------ */

export interface InventoryItem {
  id: Id;
  name: string;
  /** Rule id this inventory item satisfies, if any. */
  ruleId?: string;
  qty: number;
  unit: string;
  location: string;
  expiry?: ISODate;
  needsReplenish: boolean;
  assignedTo: AssigneeId;
  forgottenCount: number;
  notes: string;
  updatedAt: ISODateTime;
}

export type Outcome = 'used' | 'not-needed' | 'ran-out' | 'forgotten';

export interface TripReview {
  id: Id;
  tripId: Id;
  tripName: string;
  completedAt: ISODateTime;
  outcomes: Record<string, { ruleId?: string; name: string; outcome: Outcome }>;
  notes: string;
}

export interface ItemStats {
  ruleId: string;
  /** Multiplier applied to consumable quantities (1 = unchanged). */
  qtyFactor: number;
  used: number;
  notNeeded: number;
  ranOut: number;
  forgotten: number;
  lastTripName?: string;
  updatedAt: ISODateTime;
}

/** Items the family always wants, captured from "add next time" or manually. */
export interface AlwaysPackItem {
  id: Id;
  name: string;
  category: Category;
  assignee: 'shared' | 'car' | 'each-adult' | 'each-child' | Id;
  qty: number;
  unit: string;
  location: PackLocation;
  stage: Stage;
  notes: string;
  updatedAt: ISODateTime;
}

/* ------------------------------------------------------------------ */
/* Settings & assumptions                                              */
/* ------------------------------------------------------------------ */

export interface Assumptions {
  avgSpeedKmh: number;
  routeTimeFactor: number;
  restBreakEveryHoursWithChild: number;
  restBreakEveryHoursAdults: number;
  adultOutfitsPerDay: number;
  childOutfitsPerDay: number;
  childHotWeatherExtraOutfitsPerDay: number;
  adultSpareOutfits: number;
  childSpareOutfits: number;
  laundryEveryDays: number;
  adultSleepwearNightsPerSet: number;
  childSleepwearNightsPerSet: number;
  diapersPerDayUnder12m: number;
  diapersPerDay12to24m: number;
  diapersPerDay24to36m: number;
  diapersPerDayOver36m: number;
  diaperChangeEveryDriveHours: number;
  diaperContingencyPct: number;
  diaperMinReserve: number;
  wipesPerChange: number;
  wipesPerPack: number;
  childMilkFeedsPerDay: number;
  childSnacksPerDay: number;
  childSnacksPerDriveHour: number;
  adultSnacksPerDriveHour: number;
  waterLitresPerAdultPerDriveDay: number;
  waterLitresPerChildPerDriveDay: number;
  emergencyWaterLitresPerPerson: number;
  bottleSizeLitres: number;
  remoteReserveDays: number;
  powerBankAboveDriveHours: number;
  orsSachetsBase: number;
  emergencyCashBaseInr: number;
  emergencyCashPer100KmInr: number;
  ranOutIncreasePct: number;
  notNeededTripsBeforeOptional: number;
  longDriveDayHours: number;
}

export type ThemePref = 'system' | 'light' | 'dark';

export interface Settings {
  id: 'settings';
  theme: ThemePref;
  homeCity: string;
  assumptions: Partial<Assumptions>;
  lastBackupAt?: ISODateTime;
  persistenceRequested?: boolean;
  /** For fuel-cost estimates. */
  car?: { mileageKmpl: number; fuelPricePerLitre: number };
  onboarded: boolean;
  updatedAt: ISODateTime;
}

/* ------------------------------------------------------------------ */
/* Offline maps                                                        */
/* ------------------------------------------------------------------ */

export type BBox = [west: number, south: number, east: number, north: number];

export type MapAssetKind = 'tiles' | 'poi' | 'graph';

export type AssetStatus =
  | 'absent'
  | 'downloading'
  | 'paused'
  | 'verifying'
  | 'ready'
  | 'error';

export interface MapAssetState {
  kind: MapAssetKind;
  url?: string;
  bytes: number;
  sha256?: string;
  /** Server ETag from the first block; used with If-Range so resumes never mix file versions. */
  etag?: string;
  chunkSize: number;
  chunksDone: number;
  status: AssetStatus;
  verified: boolean;
  error?: string;
  source: 'download' | 'file-import';
  updatedAt: ISODateTime;
}

export interface MapRegion {
  id: Id;
  name: string;
  description: string;
  bbox: BBox;
  maxZoom: number;
  dataDate?: string;
  attribution: string;
  assets: Partial<Record<MapAssetKind, MapAssetState>>;
  installedAt?: ISODateTime;
  updatedAt: ISODateTime;
}

export interface SavedPlace {
  id: Id;
  name: string;
  lat: number;
  lon: number;
  kind: string;
  notes: string;
  tripId?: Id;
  updatedAt: ISODateTime;
}

/** Route computed offline (or entered) and saved against a trip. */
export interface SavedRoute {
  id: Id;
  tripId?: Id;
  name: string;
  regionId: Id;
  waypoints: { name: string; lat: number; lon: number }[];
  /** Encoded as [lon, lat] pairs. */
  geometry: [number, number][];
  roadKm: number;
  straightLineKm: number;
  estHours: number;
  legsKm: number[];
  majorRoads: string[];
  method: 'offline-road-graph';
  createdAt: ISODateTime;
}
