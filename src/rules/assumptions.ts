import type { Assumptions } from '../types';

export interface AssumptionDef {
  label: string;
  unit: string;
  group: 'Driving' | 'Clothing' | 'Child care' | 'Food & water' | 'Electronics' | 'Reserves' | 'Learning';
  min: number;
  max: number;
  step: number;
  help: string;
}

/**
 * Default assumptions. These are planning heuristics, not medical or
 * engineering facts — every value is editable globally (Settings) and per trip.
 */
export const DEFAULT_ASSUMPTIONS: Assumptions = {
  avgSpeedKmh: 50,
  restBreakEveryHoursWithChild: 2,
  restBreakEveryHoursAdults: 2.5,
  adultOutfitsPerDay: 1,
  childOutfitsPerDay: 2,
  childHotWeatherExtraOutfitsPerDay: 0.5,
  adultSpareOutfits: 1,
  childSpareOutfits: 2,
  laundryEveryDays: 3,
  adultSleepwearNightsPerSet: 3,
  childSleepwearNightsPerSet: 2,
  diapersPerDayUnder12m: 8,
  diapersPerDay12to24m: 6,
  diapersPerDay24to36m: 5,
  diapersPerDayOver36m: 4,
  diaperChangeEveryDriveHours: 2.5,
  diaperContingencyPct: 20,
  diaperMinReserve: 4,
  wipesPerChange: 4,
  wipesPerPack: 72,
  childMilkFeedsPerDay: 2,
  childSnacksPerDay: 2,
  childSnacksPerDriveHour: 0.5,
  adultSnacksPerDriveHour: 0.34,
  waterLitresPerAdultPerDriveDay: 2,
  waterLitresPerChildPerDriveDay: 0.75,
  emergencyWaterLitresPerPerson: 1,
  bottleSizeLitres: 1,
  remoteReserveDays: 1,
  powerBankAboveDriveHours: 3,
  orsSachetsBase: 4,
  emergencyCashBaseInr: 2000,
  emergencyCashPer100KmInr: 300,
  ranOutIncreasePct: 25,
  notNeededTripsBeforeOptional: 2,
  longDriveDayHours: 5,
};

export const ASSUMPTION_DEFS: Record<keyof Assumptions, AssumptionDef> = {
  avgSpeedKmh: { label: 'Average driving speed', unit: 'km/h', group: 'Driving', min: 20, max: 90, step: 1, help: 'Used to estimate hours in the car when you do not enter them. Includes slow stretches and towns, not just highway speed.' },
  restBreakEveryHoursWithChild: { label: 'Break interval with a child', unit: 'h', group: 'Driving', min: 1, max: 4, step: 0.25, help: 'How often to stop for changes, feeds and stretching when a young child is aboard.' },
  restBreakEveryHoursAdults: { label: 'Break interval, adults only', unit: 'h', group: 'Driving', min: 1, max: 4, step: 0.25, help: 'Driver-fatigue break interval when no child is aboard.' },
  longDriveDayHours: { label: 'Long driving day', unit: 'h', group: 'Driving', min: 3, max: 10, step: 0.5, help: 'A driving day at or above this many hours triggers long-drive comfort and fatigue items.' },
  adultOutfitsPerDay: { label: 'Adult outfits per day', unit: 'outfits', group: 'Clothing', min: 0.5, max: 3, step: 0.25, help: 'Base daytime outfits per adult per day.' },
  childOutfitsPerDay: { label: 'Child outfits per day', unit: 'outfits', group: 'Clothing', min: 1, max: 4, step: 0.25, help: 'Toddlers spill and leak — two changes a day is a common baseline.' },
  childHotWeatherExtraOutfitsPerDay: { label: 'Extra child outfits in heat', unit: 'outfits/day', group: 'Clothing', min: 0, max: 2, step: 0.25, help: 'Added in hot or humid weather (sweat, water play).' },
  adultSpareOutfits: { label: 'Adult spare outfits', unit: 'outfits', group: 'Clothing', min: 0, max: 3, step: 1, help: 'Buffer for spills, rain or a delayed return.' },
  childSpareOutfits: { label: 'Child spare outfits', unit: 'outfits', group: 'Clothing', min: 0, max: 5, step: 1, help: 'Buffer kept in the diaper bag.' },
  laundryEveryDays: { label: 'Laundry cycle when always available', unit: 'days', group: 'Clothing', min: 1, max: 7, step: 1, help: 'With laundry available throughout, pack clothing for this many days.' },
  adultSleepwearNightsPerSet: { label: 'Adult nights per sleepwear set', unit: 'nights', group: 'Clothing', min: 1, max: 7, step: 1, help: 'Sleepwear is usually reused for several nights.' },
  childSleepwearNightsPerSet: { label: 'Child nights per sleepwear set', unit: 'nights', group: 'Clothing', min: 1, max: 4, step: 1, help: 'Lower than adults because of night leaks.' },
  diapersPerDayUnder12m: { label: 'Diapers per day, under 12 months', unit: 'diapers', group: 'Child care', min: 3, max: 14, step: 1, help: 'Set this to your child’s actual usage.' },
  diapersPerDay12to24m: { label: 'Diapers per day, 12–24 months', unit: 'diapers', group: 'Child care', min: 3, max: 12, step: 1, help: 'Set this to your child’s actual usage.' },
  diapersPerDay24to36m: { label: 'Diapers per day, 24–36 months', unit: 'diapers', group: 'Child care', min: 2, max: 10, step: 1, help: 'Set this to your child’s actual usage.' },
  diapersPerDayOver36m: { label: 'Diapers per day, over 36 months', unit: 'diapers', group: 'Child care', min: 1, max: 8, step: 1, help: 'Only used while the child profile says “diapers”.' },
  diaperChangeEveryDriveHours: { label: 'Extra change every … hours in the car', unit: 'h', group: 'Child care', min: 1, max: 5, step: 0.5, help: 'Travel days add changes at rest stops on top of the normal daily count.' },
  diaperContingencyPct: { label: 'Diaper contingency', unit: '%', group: 'Child care', min: 0, max: 100, step: 5, help: 'Reserve for stomach upsets or delays.' },
  diaperMinReserve: { label: 'Minimum diaper reserve', unit: 'diapers', group: 'Child care', min: 0, max: 20, step: 1, help: 'Never pack fewer spares than this.' },
  wipesPerChange: { label: 'Wipes per change', unit: 'wipes', group: 'Child care', min: 1, max: 10, step: 1, help: 'Also covers hands and faces at stops.' },
  wipesPerPack: { label: 'Wipes per pack', unit: 'wipes', group: 'Child care', min: 10, max: 120, step: 1, help: 'Match the packs you buy.' },
  childMilkFeedsPerDay: { label: 'Child milk feeds per day', unit: 'feeds', group: 'Food & water', min: 0, max: 8, step: 1, help: 'Bottle or cup feeds that need packed milk or formula.' },
  childSnacksPerDay: { label: 'Child snacks per day (at destination)', unit: 'portions', group: 'Food & water', min: 0, max: 6, step: 1, help: 'Familiar snacks for non-driving days.' },
  childSnacksPerDriveHour: { label: 'Child snacks per hour driving', unit: 'portions/h', group: 'Food & water', min: 0, max: 2, step: 0.1, help: 'Snacks keep a toddler settled in the car seat.' },
  adultSnacksPerDriveHour: { label: 'Adult snacks per hour driving', unit: 'portions/h', group: 'Food & water', min: 0, max: 1, step: 0.05, help: 'Roughly one snack every three hours.' },
  waterLitresPerAdultPerDriveDay: { label: 'Water per adult per driving day', unit: 'L', group: 'Food & water', min: 0.5, max: 5, step: 0.25, help: 'Drinking water carried in the cabin.' },
  waterLitresPerChildPerDriveDay: { label: 'Water per child per driving day', unit: 'L', group: 'Food & water', min: 0.25, max: 3, step: 0.25, help: 'Drinking water for the child (separate cup or bottle).' },
  emergencyWaterLitresPerPerson: { label: 'Sealed emergency water per person', unit: 'L', group: 'Reserves', min: 0, max: 5, step: 0.5, help: 'Kept untouched in the boot for breakdowns.' },
  bottleSizeLitres: { label: 'Water bottle size', unit: 'L', group: 'Food & water', min: 0.25, max: 5, step: 0.25, help: 'Used to convert litres into bottles.' },
  remoteReserveDays: { label: 'Extra reserve days on remote routes', unit: 'days', group: 'Reserves', min: 0, max: 3, step: 1, help: 'Child consumables and food reserve added when resupply is limited.' },
  powerBankAboveDriveHours: { label: 'Power bank above … hours driving', unit: 'h', group: 'Electronics', min: 0, max: 8, step: 0.5, help: 'Navigation drains phones; a power bank becomes essential beyond this.' },
  orsSachetsBase: { label: 'ORS sachets baseline', unit: 'sachets', group: 'Reserves', min: 0, max: 20, step: 1, help: 'Oral rehydration salts for the family kit (not a dose).' },
  emergencyCashBaseInr: { label: 'Emergency cash baseline', unit: '₹', group: 'Reserves', min: 0, max: 50000, step: 500, help: 'For when UPI, cards or FASTag fail.' },
  emergencyCashPer100KmInr: { label: 'Emergency cash per 100 km', unit: '₹', group: 'Reserves', min: 0, max: 5000, step: 100, help: 'Covers fuel and tolls on longer drives.' },
  ranOutIncreasePct: { label: 'Increase after running out', unit: '%', group: 'Learning', min: 0, max: 100, step: 5, help: 'Consumables that ran out get this much more next time (compounding, capped at +100%).' },
  notNeededTripsBeforeOptional: { label: 'Unused trips before optional', unit: 'trips', group: 'Learning', min: 1, max: 10, step: 1, help: 'Non-safety items marked “not needed” this many times become optional. Safety items never change.' },
};

export function resolveAssumptions(
  globalOverrides: Partial<Assumptions> | undefined,
  tripOverrides: Partial<Assumptions> | undefined,
): Assumptions {
  const out: Assumptions = { ...DEFAULT_ASSUMPTIONS };
  for (const src of [globalOverrides, tripOverrides]) {
    if (!src) continue;
    for (const [k, v] of Object.entries(src)) {
      const key = k as keyof Assumptions;
      const def = ASSUMPTION_DEFS[key];
      if (!def || typeof v !== 'number' || !Number.isFinite(v)) continue;
      out[key] = Math.min(def.max, Math.max(def.min, v));
    }
  }
  return out;
}
