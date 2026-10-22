import type {
  Activity,
  AdultPrefs,
  Category,
  ChildPrefs,
  Necessity,
  PackLocation,
  Settings,
  Stage,
  TravellerProfile,
  Trip,
} from '../types';

export function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export const nowIso = () => new Date().toISOString();

export function localDateIso(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function monthsAgo(months: number, from = new Date()): string {
  const d = new Date(from.getFullYear(), from.getMonth() - months, Math.min(from.getDate(), 28));
  return localDateIso(d);
}

export const defaultAdultPrefs = (gender: 'male' | 'female' | 'unspecified'): AdultPrefs => ({
  isDriver: gender === 'male',
  takesRegularMedication: false,
  wearsGlasses: false,
  wearsContactLenses: false,
  shaves: gender === 'male',
  skincareRoutine: gender === 'female',
  makeup: gender === 'female',
  menstrualProducts: gender === 'female',
  hairDryerOrStyler: false,
  smartwatch: false,
  laptop: false,
  jewelleryAndAccessories: gender === 'female',
  motionSickness: false,
  extraOutfitsPerDay: 0,
  notes: '',
});

export const defaultChildPrefs = (ageMonths: number): ChildPrefs => ({
  diaperStatus: ageMonths < 30 ? 'diapers' : ageMonths < 42 ? 'night-only' : 'trained',
  breastfed: false,
  formula: ageMonths < 12,
  animalMilk: ageMonths >= 12,
  eatsSolids: ageMonths >= 6,
  usesStroller: ageMonths < 48,
  usesCarrier: false,
  carSeat: ageMonths < 24 ? 'rear-facing' : ageMonths < 72 ? 'forward-facing' : 'booster',
  comfortItem: '',
  takesRegularMedication: false,
  motionSickness: false,
  napsInCar: true,
  notes: '',
});

/** Starter family from the brief. Every field is editable in Family Profiles. */
export function starterFamily(today = new Date()): TravellerProfile[] {
  const t = nowIso();
  return [
    { id: uid(), name: 'Me', kind: 'adult', gender: 'male', adult: defaultAdultPrefs('male'), createdAt: t, updatedAt: t },
    { id: uid(), name: 'Wife', kind: 'adult', gender: 'female', adult: defaultAdultPrefs('female'), createdAt: t, updatedAt: t },
    {
      id: uid(),
      name: 'Daughter',
      kind: 'child',
      gender: 'female',
      birthDate: monthsAgo(20, today),
      child: defaultChildPrefs(20),
      createdAt: t,
      updatedAt: t,
    },
  ];
}

export function defaultSettings(): Settings {
  return { id: 'settings', theme: 'system', homeCity: 'Bengaluru', assumptions: {}, onboarded: false, updatedAt: nowIso() };
}

export function blankTrip(travellerIds: string[], homeCity = 'Bengaluru'): Trip {
  const t = nowIso();
  return {
    id: uid(),
    name: '',
    days: 2,
    nights: 1,
    origin: { name: homeCity },
    destination: { name: '' },
    stops: [],
    returnSameRoute: true,
    totalKm: 0,
    kmSource: 'none',
    drivingDays: 2,
    legs: [],
    travellerIds,
    accommodation: 'hotel',
    activities: [],
    laundry: 'none',
    temperature: 'auto',
    rain: 'auto',
    remote: false,
    mountains: false,
    overnightDriving: false,
    resupply: 'good',
    assumptionOverrides: {},
    status: 'planning',
    notes: '',
    createdAt: t,
    updatedAt: t,
  };
}

/* ------------------------------------------------------------------ */
/* Labels                                                               */
/* ------------------------------------------------------------------ */

export const CATEGORY_LABEL: Record<Category, string> = {
  documents: 'Documents & money',
  clothing: 'Clothing',
  footwear: 'Footwear',
  toiletries: 'Toiletries',
  health: 'Health & first aid',
  electronics: 'Electronics & power',
  'baby-care': 'Diapering & care',
  'baby-feeding': 'Feeding',
  'baby-sleep': 'Sleep',
  'baby-gear': 'Child gear',
  'food-water': 'Food & water',
  'vehicle-safety': 'Vehicle safety',
  'vehicle-tools': 'Vehicle tools',
  'vehicle-checks': 'Vehicle checks',
  comfort: 'Cabin comfort',
  entertainment: 'Entertainment',
  activity: 'Activities',
  stay: 'Stay',
  planning: 'Planning',
};

export const CATEGORY_ORDER = Object.keys(CATEGORY_LABEL) as Category[];

export const LOCATION_LABEL: Record<PackLocation, string> = {
  cabin: 'Cabin',
  'diaper-bag': 'Diaper bag',
  boot: 'Boot',
  suitcase: 'Suitcase',
  'emergency-kit': 'Emergency kit',
  'on-person': 'On you',
  car: 'Stays in car',
  'n/a': 'To do',
};

export const NECESSITY_LABEL: Record<Necessity, string> = {
  essential: 'Essential',
  recommended: 'Recommended',
  optional: 'Optional',
  activity: 'For an activity',
};

export const STAGE_ORDER: Stage[] = ['advance', 'night-before', 'morning', 'cabin', 'verify'];

export const STAGE_SHORT: Record<Stage, string> = {
  advance: 'In advance',
  'night-before': 'Night before',
  morning: 'Morning of',
  cabin: 'In the cabin',
  verify: 'Verify',
};

export const ACTIVITY_LABEL: Record<Activity, string> = {
  beach: 'Beach',
  swimming: 'Swimming pool',
  'hill-station': 'Hill station',
  wildlife: 'Wildlife & nature',
  hiking: 'Hiking',
  photography: 'Photography',
  drone: 'Drone',
  religious: 'Temples & religious visits',
  sightseeing: 'Sightseeing',
  work: 'Work',
};
