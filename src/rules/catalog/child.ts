import type { TravellerFacts, TripFacts } from '../context';
import { describeAge } from '../context';
import type { ItemRule } from '../ruleTypes';
import { act, clothingDays, drives, fmt, isColdish, isWarmish, isWet, laundryText, n, one, pl, remoteReserve } from '../ruleTypes';

const months = (t?: TravellerFacts) => t?.ageMonths ?? 24;
const inDiapers = (t?: TravellerFacts) => (t?.child?.diaperStatus ?? 'diapers') === 'diapers';
const toiletLearning = (t?: TravellerFacts) => (t?.child?.diaperStatus ?? 'diapers') !== 'diapers';
const ageNote = (t?: TravellerFacts) => `age ${describeAge(t?.ageMonths ?? null)}`;

export function diapersPerDay(f: TripFacts, t?: TravellerFacts): { perDay: number; bracket: string } {
  const m = months(t);
  if (m < 12) return { perDay: f.a.diapersPerDayUnder12m, bracket: 'under 12 months' };
  if (m < 24) return { perDay: f.a.diapersPerDay12to24m, bracket: '12–24 months' };
  if (m < 36) return { perDay: f.a.diapersPerDay24to36m, bracket: '24–36 months' };
  return { perDay: f.a.diapersPerDayOver36m, bracket: 'over 36 months' };
}

/** Extra diaper changes caused by time in the car, per drive day. */
export function travelDayExtraChanges(f: TripFacts): number[] {
  return f.driveDays.map((d) => Math.ceil(d.hours / f.a.diaperChangeEveryDriveHours));
}

export function diaperPlan(f: TripFacts, t?: TravellerFacts) {
  const { perDay, bracket } = diapersPerDay(f, t);
  const base = perDay * f.days;
  const extras = travelDayExtraChanges(f);
  const travelExtra = extras.reduce((s, x) => s + x, 0);
  const subtotal = base + travelExtra;
  const pctReserve = Math.ceil((subtotal * f.a.diaperContingencyPct) / 100);
  const reserve = Math.max(f.a.diaperMinReserve, pctReserve);
  const remote = remoteReserve(f) * perDay;
  const total = subtotal + reserve + remote;
  const longest = f.driveDays.reduce((m, d) => Math.max(m, d.hours), 0);
  const cabin = Math.ceil(longest / f.a.diaperChangeEveryDriveHours) + Math.ceil(perDay / 3) + 2;
  return { perDay, bracket, base, travelExtra, subtotal, pctReserve, reserve, remote, total, cabin: Math.min(cabin, total), longest };
}

function feedsAvailable(t?: TravellerFacts) {
  const c = t?.child;
  return {
    formula: Boolean(c?.formula),
    animal: Boolean(c?.animalMilk),
    breast: Boolean(c?.breastfed),
    solids: c ? c.eatsSolids : true,
  };
}

const mealsDuringDrive = (f: TripFacts) => f.driveDays.reduce((s, d) => s + Math.floor(d.hours / 4), 0);

export const childRules: ItemRule[] = [
  /* ---------------- diapering ---------------- */
  {
    id: 'child-diapers',
    name: 'Diapers (total for trip)',
    category: 'baby-care',
    scope: 'each-child',
    when: (_f, t) => (inDiapers(t) ? `In diapers (${ageNote(t)})` : false),
    qty: (f, t) => {
      const p = diaperPlan(f, t);
      const why = [
        `${p.perDay}/day for ${p.bracket} × ${pl(f.days, 'day')} = ${p.base}`,
        p.travelExtra ? `+ ${p.travelExtra} extra changes on travel days (1 per ${fmt(f.a.diaperChangeEveryDriveHours)} h in the car)` : 'no travel-day extras (no driving entered)',
        `+ reserve ${p.reserve} (${f.a.diaperContingencyPct}% contingency, minimum ${f.a.diaperMinReserve})`,
      ];
      if (p.remote) why.push(`+ ${p.remote} remote-route reserve (${remoteReserve(f)} extra day)`);
      why.push(`= ${p.total} diapers`);
      return n(p.total, 'diapers', why);
    },
    necessity: 'essential',
    priority: 1,
    reusable: false,
    consumable: true,
    location: 'boot',
    stage: 'advance',
    safetyCritical: false,
  },
  {
    id: 'child-diapers-cabin',
    name: 'Diapers in the diaper bag for the drive',
    category: 'baby-care',
    scope: 'each-child',
    when: (f, t) => (inDiapers(t) && drives(f) ? 'Changes at rest stops' : false),
    qty: (f, t) => {
      const p = diaperPlan(f, t);
      return n(p.cabin, 'diapers', [
        `longest drive ${fmt(p.longest)} h ÷ ${fmt(f.a.diaperChangeEveryDriveHours)} h = ${Math.ceil(p.longest / f.a.diaperChangeEveryDriveHours)} changes`,
        `+ ${Math.ceil(p.perDay / 3)} routine change(s) + 2 for leaks or delays`,
        'These come out of the trip total above — not extra.',
      ]);
    },
    necessity: 'essential',
    priority: 1,
    reusable: false,
    consumable: true,
    location: 'diaper-bag',
    stage: 'night-before',
    accessibleEnRoute: true,
  },
  {
    id: 'child-wipes',
    name: 'Baby wipes',
    category: 'baby-care',
    scope: 'each-child',
    when: () => 'Changes, hands and faces',
    qty: (f, t) => {
      const changes = inDiapers(t) ? diaperPlan(f, t).total : f.days * 3;
      const wipes = changes * f.a.wipesPerChange;
      const packs = Math.max(1, Math.ceil(wipes / f.a.wipesPerPack));
      return n(packs, 'packs', [
        `${changes} ${inDiapers(t) ? 'changes' : 'clean-ups'} × ${f.a.wipesPerChange} wipes = ${wipes} wipes`,
        `÷ ${f.a.wipesPerPack} per pack = ${packs} packs (keep one open in the diaper bag)`,
      ]);
    },
    necessity: 'essential',
    reusable: false,
    consumable: true,
    location: 'diaper-bag',
    stage: 'advance',
    accessibleEnRoute: true,
  },
  {
    id: 'child-rash-cream',
    name: 'Diaper rash cream',
    category: 'baby-care',
    scope: 'each-child',
    when: (_f, t) => (inDiapers(t) || t?.child?.diaperStatus === 'night-only' ? 'Diaper use' : false),
    qty: () => one('tube'),
    necessity: 'essential',
    reusable: false,
    consumable: true,
    location: 'diaper-bag',
    stage: 'advance',
    accessibleEnRoute: true,
  },
  {
    id: 'child-changing-mat',
    name: 'Portable changing mat',
    category: 'baby-care',
    scope: 'each-child',
    when: (_f, t) => (inDiapers(t) ? 'Changes at roadside stops rarely have changing tables' : false),
    qty: () => one(),
    necessity: 'essential',
    reusable: true,
    location: 'diaper-bag',
    stage: 'advance',
    accessibleEnRoute: true,
  },
  {
    id: 'child-diaper-bags',
    name: 'Diaper disposal bags',
    category: 'baby-care',
    scope: 'each-child',
    when: (_f, t) => (inDiapers(t) ? 'Changes away from a bin' : false),
    qty: (f) => {
      const travel = f.driveDays.reduce((s, d) => s + Math.ceil(d.hours / f.a.diaperChangeEveryDriveHours) + 1, 0);
      const q = Math.max(5, travel + 2);
      return n(q, 'bags', [`changes on drive days (+1 per day) = ${travel}, + 2 spare, minimum 5 = ${q}`]);
    },
    necessity: 'recommended',
    reusable: false,
    consumable: true,
    location: 'diaper-bag',
    stage: 'advance',
    accessibleEnRoute: true,
  },
  {
    id: 'child-diaper-bag',
    name: 'Diaper bag (packed and reachable)',
    category: 'baby-gear',
    scope: 'each-child',
    when: (_f, t) => (months(t) < 48 ? 'Holds everything needed between stops' : false),
    qty: () => one('bag'),
    necessity: 'essential',
    priority: 1,
    reusable: true,
    location: 'cabin',
    stage: 'cabin',
    accessibleEnRoute: true,
  },
  {
    id: 'child-night-diapers',
    name: 'Night-time diapers or pull-ups',
    category: 'baby-care',
    scope: 'each-child',
    when: (f, t) => (t?.child?.diaperStatus === 'night-only' && f.nights > 0 ? 'Diapers at night only' : false),
    qty: (f) => {
      const q = f.nights + 2 + remoteReserve(f);
      return n(q, 'diapers', [`${pl(f.nights, 'night')} + 2 spare${remoteReserve(f) ? ` + ${remoteReserve(f)} remote reserve` : ''} = ${q}`]);
    },
    necessity: 'essential',
    reusable: false,
    consumable: true,
    location: 'suitcase',
    stage: 'advance',
  },
  {
    id: 'child-underwear',
    name: 'Spare underwear',
    category: 'clothing',
    scope: 'each-child',
    when: (_f, t) => (toiletLearning(t) ? 'Toilet trained or learning — accidents happen on long drives' : false),
    qty: (f) => {
      const q = clothingDays(f) * 2 + 2;
      return n(q, 'pairs', [`${pl(clothingDays(f), 'day')} × 2 + 2 for the car = ${q}`]);
    },
    necessity: 'essential',
    reusable: true,
    location: 'suitcase',
    stage: 'advance',
  },
  {
    id: 'child-travel-potty',
    name: 'Travel potty or foldable seat',
    category: 'baby-gear',
    scope: 'each-child',
    when: (f, t) => (toiletLearning(t) && drives(f) ? 'Toilets on highways can be far apart' : false),
    qty: () => one(),
    necessity: 'recommended',
    reusable: true,
    location: 'cabin',
    stage: 'night-before',
    accessibleEnRoute: true,
  },
  /* ---------------- clothing ---------------- */
  {
    id: 'child-outfits',
    name: 'Everyday outfits',
    category: 'clothing',
    scope: 'each-child',
    when: () => 'Daily clothing',
    qty: (f) => {
      const hotExtra = isWarmish(f) ? f.a.childHotWeatherExtraOutfitsPerDay : 0;
      const perDay = f.a.childOutfitsPerDay + hotExtra;
      const cover = clothingDays(f);
      const raw = Math.ceil(cover * perDay);
      const q = Math.max(1, raw - 1 + f.a.childSpareOutfits);
      const why = [laundryText(f), `${pl(cover, 'day')} × ${fmt(perDay)} outfits/day${hotExtra ? ` (incl. +${fmt(hotExtra)} for ${f.temperature} weather)` : ''} = ${raw}`];
      why.push(`− 1 worn when leaving + ${f.a.childSpareOutfits} spare = ${q}`);
      return n(q, 'outfits', why);
    },
    necessity: 'essential',
    reusable: true,
    location: 'suitcase',
    stage: 'advance',
  },
  {
    id: 'child-spare-outfits-cabin',
    name: 'Spare outfits in the diaper bag',
    category: 'clothing',
    scope: 'each-child',
    when: (f) => (drives(f) ? 'Spills and leaks in the car seat' : false),
    qty: (f) => {
      const q = Math.max(1, f.a.childSpareOutfits);
      return n(q, 'outfits', ['the spare outfits from the count above — keep them in the diaper bag, not the suitcase']);
    },
    necessity: 'essential',
    reusable: true,
    location: 'diaper-bag',
    stage: 'night-before',
    accessibleEnRoute: true,
  },
  {
    id: 'child-sleepwear',
    name: 'Sleepwear',
    category: 'clothing',
    scope: 'each-child',
    when: (f) => (f.nights > 0 ? 'Overnight stay' : false),
    qty: (f) => {
      const nights = Math.min(f.nights, clothingDays(f));
      const sets = Math.ceil(nights / f.a.childSleepwearNightsPerSet) + 1;
      return n(sets, 'sets', [`${pl(nights, 'night')} ÷ ${f.a.childSleepwearNightsPerSet} nights/set + 1 spare for leaks = ${sets}`]);
    },
    necessity: 'essential',
    reusable: true,
    location: 'suitcase',
    stage: 'advance',
  },
  {
    id: 'child-socks',
    name: 'Socks',
    category: 'clothing',
    scope: 'each-child',
    when: () => 'Shoes and cool cabins',
    qty: (f) => {
      const q = isColdish(f) ? clothingDays(f) + 1 : Math.min(3, clothingDays(f) + 1);
      return n(q, 'pairs', [isColdish(f) ? `${pl(clothingDays(f), 'day')} + 1 spare` : 'a few pairs for shoes and AC']);
    },
    necessity: 'recommended',
    reusable: true,
    location: 'suitcase',
    stage: 'advance',
  },
  {
    id: 'child-warm-layers',
    name: (f) => (f.temperature === 'cold' ? 'Warm layers (fleece / woollens)' : 'Light warm layer'),
    category: 'clothing',
    scope: 'each-child',
    when: (f) => (isColdish(f) ? `${f.temperature} weather` : f.maxDriveHours >= 2 ? 'Air-conditioned cabin' : false),
    qty: (f) => (isColdish(f) ? n(f.temperature === 'cold' ? 3 : 2, 'layers', ['one on, one spare' + (f.temperature === 'cold' ? ', one for evenings' : '')]) : one('layer')),
    necessity: (f) => (isColdish(f) ? 'essential' : 'recommended'),
    reusable: true,
    location: 'diaper-bag',
    stage: 'advance',
    accessibleEnRoute: true,
    note: 'In the car seat use thin layers only — bulky jackets under the harness stop it from fitting snugly. Add a blanket over the buckled harness instead.',
  },
  {
    id: 'child-woollen-cap',
    name: 'Woollen cap and mittens',
    category: 'clothing',
    scope: 'each-child',
    when: (f) => (f.temperature === 'cold' ? 'Cold weather' : false),
    qty: () => one('set'),
    necessity: 'essential',
    reusable: true,
    location: 'suitcase',
    stage: 'advance',
  },
  {
    id: 'child-sun-hat',
    name: 'Sun hat',
    category: 'clothing',
    scope: 'each-child',
    when: (f) => (isWarmish(f) || act(f, 'beach') || act(f, 'sightseeing') ? 'Sun protection outdoors' : false),
    qty: (f) => (act(f, 'beach') ? n(2, 'hats', ['beach day hats get wet — one spare']) : one('hat')),
    necessity: 'recommended',
    reusable: true,
    location: 'diaper-bag',
    stage: 'advance',
  },
  {
    id: 'child-rain-cover',
    name: (_f, t) => (t?.child?.usesStroller ? 'Stroller rain cover' : 'Child rain poncho'),
    category: 'clothing',
    scope: 'each-child',
    when: (f) => (isWet(f) ? 'Rain expected' : false),
    qty: () => one(),
    necessity: (f) => (f.rain === 'monsoon' ? 'essential' : 'recommended'),
    reusable: true,
    location: 'boot',
    stage: 'advance',
  },
  {
    id: 'child-shoes',
    name: 'Shoes',
    category: 'footwear',
    scope: 'each-child',
    when: (_f, t) => (months(t) >= 10 ? 'Walking or cruising' : false),
    qty: () => one('pair', ['worn on departure']),
    necessity: 'essential',
    reusable: true,
    location: 'on-person',
    stage: 'verify',
  },
  {
    id: 'child-sandals',
    name: 'Sandals or spare footwear',
    category: 'footwear',
    scope: 'each-child',
    when: (f, t) => (months(t) >= 10 && (f.days > 1 || isWet(f) || act(f, 'beach')) ? 'Wet shoes or play areas' : false),
    qty: () => one('pair'),
    necessity: 'recommended',
    reusable: true,
    location: 'suitcase',
    stage: 'advance',
  },
  /* ---------------- feeding ---------------- */
  {
    id: 'child-formula',
    name: 'Formula (pre-measured portions)',
    category: 'baby-feeding',
    scope: 'each-child',
    when: (_f, t) => (feedsAvailable(t).formula ? 'Formula-fed' : false),
    qty: (f) => {
      const feeds = f.a.childMilkFeedsPerDay;
      const reserveDays = 1 + remoteReserve(f);
      const q = feeds * (f.days + reserveDays);
      return n(q, 'portions', [`${feeds} feeds/day × (${pl(f.days, 'day')} + ${reserveDays} reserve) = ${q}`, 'Bring your usual brand — it may not be sold locally.']);
    },
    necessity: 'essential',
    priority: 1,
    reusable: false,
    consumable: true,
    location: 'diaper-bag',
    stage: 'advance',
    accessibleEnRoute: true,
  },
  {
    id: 'child-hot-water-flask',
    name: 'Flask of boiled water',
    category: 'baby-feeding',
    scope: 'each-child',
    when: (f, t) => (feedsAvailable(t).formula && drives(f) ? 'Preparing formula on the road' : isColdish(f) && months(t) < 48 ? 'Warm drinks in cold weather' : false),
    qty: () => one('flask'),
    necessity: 'recommended',
    reusable: true,
    location: 'cabin',
    stage: 'morning',
    accessibleEnRoute: true,
    note: 'Follow the formula maker’s preparation instructions.',
  },
  {
    id: 'child-uht-milk',
    name: 'Shelf-stable (UHT) milk cartons for the drive',
    category: 'baby-feeding',
    scope: 'each-child',
    when: (f, t) => (feedsAvailable(t).animal && drives(f) ? 'Milk feeds in the car' : false),
    qty: (f) => {
      const feeds = f.a.childMilkFeedsPerDay;
      const driveFeeds = f.driveDays.reduce((s, d) => s + Math.max(1, Math.ceil((d.hours * feeds) / 14)), 0);
      const atDest = f.resupply === 'good' ? 0 : f.stayDays * feeds;
      const q = driveFeeds + atDest + 1;
      const why = [`per drive day: hours × ${feeds} feeds ÷ 14 waking hours (min 1) → ${driveFeeds} in total`];
      if (atDest) why.push(`+ ${atDest} for destination days (limited resupply)`);
      else why.push('buy fresh milk at the destination (good resupply)');
      why.push(`+ 1 spare = ${q}`);
      return n(q, 'cartons', why);
    },
    necessity: 'essential',
    reusable: false,
    consumable: true,
    location: 'cabin',
    stage: 'advance',
    accessibleEnRoute: true,
    note: 'UHT cartons are safe at room temperature only until opened. Fresh or opened milk must be kept cold (insulated bag with ice packs) and discarded if left warm — follow food-safety guidance.',
  },
  {
    id: 'child-bottles-cups',
    name: (_f, t) => (feedsAvailable(t).formula || months(t) < 12 ? 'Feeding bottles' : 'Sippy cup or toddler water bottle'),
    category: 'baby-feeding',
    scope: 'each-child',
    when: () => 'Drinks on the go',
    qty: (f, t) => {
      const q = feedsAvailable(t).formula ? Math.min(4, f.a.childMilkFeedsPerDay + 1) : 2;
      return n(q, 'items', [feedsAvailable(t).formula ? 'one per feed between washes + 1 spare' : 'one for water, one for milk or spare']);
    },
    necessity: 'essential',
    reusable: true,
    location: 'diaper-bag',
    stage: 'morning',
    accessibleEnRoute: true,
  },
  {
    id: 'child-cleaning-kit',
    name: 'Bottle brush and baby-safe dish liquid',
    category: 'baby-feeding',
    scope: 'each-child',
    when: (f, t) => (f.nights > 0 && (feedsAvailable(t).formula || feedsAvailable(t).animal || feedsAvailable(t).solids) ? 'Washing bottles, cups and bowls' : false),
    qty: () => one('kit'),
    necessity: 'recommended',
    reusable: true,
    location: 'suitcase',
    stage: 'night-before',
  },
  {
    id: 'child-sterilising',
    name: 'Sterilising bags or tablets',
    category: 'baby-feeding',
    scope: 'each-child',
    when: (f, t) => (months(t) < 12 && feedsAvailable(t).formula && f.nights > 0 ? 'Bottle hygiene for infants' : false),
    qty: (f) => n(f.nights + 1, 'uses', [`one per night + 1 spare`]),
    necessity: 'recommended',
    reusable: false,
    consumable: true,
    location: 'suitcase',
    stage: 'advance',
  },
  {
    id: 'child-snacks',
    name: 'Familiar snacks',
    category: 'baby-feeding',
    scope: 'each-child',
    when: (_f, t) => (feedsAvailable(t).solids && months(t) >= 8 ? 'Keeps a toddler settled' : false),
    qty: (f) => {
      const drive = Math.ceil(f.totalDriveHours * f.a.childSnacksPerDriveHour);
      const stay = f.resupply === 'good' ? Math.min(f.stayDays, 1) * f.a.childSnacksPerDay : f.stayDays * f.a.childSnacksPerDay;
      const reserve = remoteReserve(f) * f.a.childSnacksPerDay;
      const q = Math.max(2, drive + stay + reserve);
      const why = [`${fmt(f.totalDriveHours)} h driving × ${fmt(f.a.childSnacksPerDriveHour)}/h = ${drive}`];
      why.push(f.resupply === 'good' ? `+ ${stay} for the first destination day (buy more locally)` : `+ ${stay} for ${pl(f.stayDays, 'destination day')} (limited resupply)`);
      if (reserve) why.push(`+ ${reserve} remote reserve`);
      why.push(`= ${q} portions`);
      return n(q, 'portions', why);
    },
    necessity: 'essential',
    reusable: false,
    consumable: true,
    location: 'diaper-bag',
    stage: 'night-before',
    accessibleEnRoute: true,
    note: 'Choose age-appropriate, low choking-risk snacks and only offer food while the car is stopped or an adult is supervising closely.',
  },
  {
    id: 'child-travel-meals',
    name: 'Home-cooked meals for the drive',
    category: 'baby-feeding',
    scope: 'each-child',
    when: (f, t) => (feedsAvailable(t).solids && months(t) >= 8 && mealsDuringDrive(f) > 0 ? 'Meal times fall during driving' : false),
    qty: (f) => {
      const q = mealsDuringDrive(f);
      return n(q, 'meals', [`1 meal per 4 h in the car, per drive day = ${q}`]);
    },
    necessity: 'recommended',
    reusable: false,
    consumable: true,
    location: 'cabin',
    stage: 'morning',
    accessibleEnRoute: true,
    note: 'Cooked food is perishable: pack it cold in an insulated bag with ice packs and eat it within a few hours. Do not keep cooked food at room temperature all day.',
  },
  {
    id: 'child-feeding-set',
    name: 'Bibs, spoons, bowl with lid',
    category: 'baby-feeding',
    scope: 'each-child',
    when: (_f, t) => (feedsAvailable(t).solids && months(t) >= 6 ? 'Eating solids' : false),
    qty: (f) => {
      const bibs = Math.min(4, Math.max(2, clothingDays(f)));
      return n(1, 'set', [`${bibs} bibs, 2 spoons, 1–2 lidded bowls`]);
    },
    necessity: 'essential',
    reusable: true,
    location: 'diaper-bag',
    stage: 'night-before',
    accessibleEnRoute: true,
  },
  {
    id: 'child-food-containers',
    name: 'Leak-proof food containers',
    category: 'baby-feeding',
    scope: 'each-child',
    when: (_f, t) => (feedsAvailable(t).solids && months(t) >= 6 ? 'Snacks and meals' : false),
    qty: () => n(3, 'containers', ['meal, snack, cut fruit']),
    necessity: 'recommended',
    reusable: true,
    location: 'cabin',
    stage: 'night-before',
  },
  {
    id: 'child-burp-cloths',
    name: (_f, t) => (months(t) < 12 ? 'Burp cloths / muslins' : 'Muslin cloths and small towels'),
    category: 'baby-care',
    scope: 'each-child',
    when: () => 'Spills, wiping and shade',
    qty: (_f, t) => n(months(t) < 12 ? 4 : 3, 'cloths'),
    necessity: 'recommended',
    reusable: true,
    location: 'diaper-bag',
    stage: 'advance',
    accessibleEnRoute: true,
  },
  {
    id: 'child-wet-bags',
    name: 'Wet bags for soiled clothes',
    category: 'baby-care',
    scope: 'each-child',
    when: () => 'Keeps soiled clothes away from clean ones',
    qty: (f) => {
      let q = 2;
      const why = ['2 baseline'];
      if (act(f, 'beach') || act(f, 'swimming')) { q += 1; why.push('+1 for wet swimwear'); }
      if (f.rain === 'monsoon') { q += 1; why.push('+1 for monsoon'); }
      return n(q, 'bags', why);
    },
    necessity: 'recommended',
    reusable: true,
    location: 'diaper-bag',
    stage: 'advance',
  },
  /* ---------------- care & toiletries ---------------- */
  {
    id: 'child-toiletries',
    name: 'Child-safe wash and moisturiser',
    category: 'toiletries',
    scope: 'each-child',
    when: (f) => (f.nights > 0 ? 'Bath time away from home' : false),
    qty: () => one('travel set'),
    necessity: 'recommended',
    reusable: false,
    consumable: true,
    location: 'suitcase',
    stage: 'night-before',
  },
  {
    id: 'child-toothbrush',
    name: 'Child toothbrush and toothpaste',
    category: 'toiletries',
    scope: 'each-child',
    when: (f, t) => (months(t) >= 6 && f.nights > 0 ? 'Teeth cleaning' : false),
    qty: () => one('set'),
    necessity: 'recommended',
    reusable: true,
    location: 'suitcase',
    stage: 'morning',
  },
  {
    id: 'child-grooming',
    name: 'Comb and child nail clipper',
    category: 'toiletries',
    scope: 'each-child',
    when: (f) => (f.days >= 4 ? 'Longer trip' : false),
    qty: () => one('set'),
    necessity: 'optional',
    reusable: true,
    location: 'suitcase',
    stage: 'advance',
  },
  {
    id: 'child-sunscreen',
    name: (_f, t) => (months(t) < 6 ? 'Shade and covering clothes (no sunscreen under 6 months)' : 'Child sunscreen'),
    category: 'toiletries',
    scope: 'each-child',
    when: (f) => (isWarmish(f) || act(f, 'beach') || act(f, 'swimming') || f.mountains ? 'Sun exposure expected' : false),
    qty: () => one('bottle'),
    necessity: (f) => (act(f, 'beach') ? 'essential' : 'recommended'),
    reusable: false,
    consumable: true,
    location: 'diaper-bag',
    stage: 'advance',
    note: 'Use a product labelled for your child’s age and patch-test first. Ask your paediatrician if unsure.',
  },
  {
    id: 'child-mosquito',
    name: 'Mosquito net for cot or stroller',
    category: 'baby-care',
    scope: 'each-child',
    when: (f) =>
      f.accommodation === 'homestay' || f.accommodation === 'camping' || f.rain === 'monsoon' || act(f, 'wildlife') ? 'Mosquitoes likely' : false,
    qty: () => one('net'),
    necessity: 'recommended',
    reusable: true,
    location: 'boot',
    stage: 'advance',
    note: 'If you use a repellent on your child, check the label’s minimum age.',
  },
  /* ---------------- health ---------------- */
  {
    id: 'child-medication',
    name: 'Child’s regular medicines',
    category: 'health',
    scope: 'each-child',
    when: (_f, t) => (t?.child?.takesRegularMedication ? 'Enabled in the child’s profile' : false),
    qty: (f) => {
      const q = f.days + 2 + remoteReserve(f);
      return n(q, 'days’ supply', [`${pl(f.days, 'day')} + 2 reserve${remoteReserve(f) ? ` + ${remoteReserve(f)} remote` : ''}`, 'Give only as prescribed.']);
    },
    necessity: 'essential',
    priority: 1,
    reusable: false,
    consumable: true,
    location: 'diaper-bag',
    stage: 'morning',
    accessibleEnRoute: true,
    safetyCritical: true,
  },
  {
    id: 'child-fever-relief',
    name: 'Child fever / pain relief your paediatrician approves',
    category: 'health',
    scope: 'each-child',
    when: () => 'Fevers can start anywhere',
    qty: () => one('pack', ['with the dosing device it came with']),
    necessity: (f) => (f.nights > 0 ? 'essential' : 'recommended'),
    priority: 1,
    reusable: false,
    consumable: true,
    location: 'diaper-bag',
    stage: 'advance',
    accessibleEnRoute: true,
    safetyCritical: true,
    note: 'Confirm the product and the dose for your child’s current weight with your paediatrician before the trip. Never use adult medicines for a child. Check the expiry date.',
  },
  {
    id: 'child-health-records',
    name: 'Vaccination card and paediatrician’s number',
    category: 'documents',
    scope: 'each-child',
    when: (f) => (f.nights > 0 ? 'Useful if you need a doctor away from home' : false),
    qty: () => one('copy', ['photo on phone + paper copy']),
    necessity: 'recommended',
    reusable: true,
    location: 'diaper-bag',
    stage: 'advance',
  },
  /* ---------------- sleep ---------------- */
  {
    id: 'child-comfort-item',
    name: (_f, t) => (t?.child?.comfortItem ? `Comfort item: ${t.child.comfortItem}` : 'Familiar comfort item'),
    category: 'baby-sleep',
    scope: 'each-child',
    when: () => 'Familiar items help sleep in new places',
    qty: () => one(),
    necessity: 'essential',
    priority: 1,
    reusable: true,
    location: 'cabin',
    stage: 'morning',
    accessibleEnRoute: true,
  },
  {
    id: 'child-sleep-sack',
    name: 'Sleep sack or familiar blanket',
    category: 'baby-sleep',
    scope: 'each-child',
    when: (f, t) => (f.nights > 0 && months(t) < 48 ? 'Bedtime routine' : false),
    qty: () => one(),
    necessity: 'recommended',
    reusable: true,
    location: 'suitcase',
    stage: 'night-before',
  },
  {
    id: 'child-travel-cot',
    name: 'Travel cot / play yard',
    category: 'baby-sleep',
    scope: 'each-child',
    when: (f, t) =>
      f.nights > 0 && months(t) < 36 && (f.accommodation === 'homestay' || f.accommodation === 'camping' || f.accommodation === 'family')
        ? 'Stay may not have a cot'
        : false,
    qty: () => one(),
    necessity: 'recommended',
    reusable: true,
    location: 'boot',
    stage: 'advance',
  },
  {
    id: 'child-request-cot',
    name: 'Ask the hotel for a baby cot',
    category: 'stay',
    scope: 'each-child',
    when: (f, t) => (f.nights > 0 && months(t) < 36 && (f.accommodation === 'hotel' || f.accommodation === 'resort') ? 'Hotels and resorts often provide cots on request' : false),
    qty: () => one('request'),
    necessity: 'recommended',
    reusable: true,
    location: 'n/a',
    stage: 'advance',
    isCheck: true,
  },
  {
    id: 'child-night-light',
    name: 'Night light and white-noise audio',
    category: 'baby-sleep',
    scope: 'each-child',
    when: (f, t) => (f.nights > 0 && months(t) < 72 ? 'Helps settle in unfamiliar rooms' : false),
    qty: () => one('set'),
    necessity: 'optional',
    reusable: true,
    location: 'suitcase',
    stage: 'night-before',
  },
  /* ---------------- gear & entertainment ---------------- */
  {
    id: 'child-car-seat',
    name: 'Child car seat, correctly fitted',
    category: 'baby-gear',
    scope: 'each-child',
    when: (f, t) => (drives(f) && months(t) < 144 ? 'Every car journey with a child' : false),
    qty: () => one('seat'),
    necessity: 'essential',
    priority: 1,
    reusable: true,
    location: 'car',
    stage: 'verify',
    safetyCritical: true,
    note:
      'Use the seat within its labelled height and weight limits; keep a young child rear-facing for as long as the seat allows. Do not add aftermarket head supports, inserts, strap covers or toys that the seat manufacturer has not approved — they can stop the seat protecting your child.',
    conditions: (_f, t) => [t?.child?.carSeat && t.child.carSeat !== 'none' ? `profile: ${t.child.carSeat}` : 'set seat type in profile'],
  },
  {
    id: 'child-stroller',
    name: 'Stroller',
    category: 'baby-gear',
    scope: 'each-child',
    when: (f, t) => (t?.child?.usesStroller && (f.days > 1 || act(f, 'sightseeing')) ? 'Enabled in the child’s profile' : false),
    qty: () => one(),
    necessity: (f) => (act(f, 'hiking') || f.accommodation === 'camping' ? 'optional' : 'recommended'),
    reusable: true,
    location: 'boot',
    stage: 'advance',
  },
  {
    id: 'child-carrier',
    name: 'Structured child carrier',
    category: 'baby-gear',
    scope: 'each-child',
    when: (f, t) => (months(t) < 48 && (t?.child?.usesCarrier || act(f, 'hiking') || act(f, 'wildlife') || act(f, 'religious') || f.mountains) ? 'Stairs, trails or crowds where a stroller struggles' : false),
    qty: () => one(),
    necessity: (f) => (act(f, 'hiking') ? 'essential' : 'recommended'),
    reusable: true,
    location: 'boot',
    stage: 'advance',
  },
  {
    id: 'child-toys',
    name: 'Small toys to rotate in the car',
    category: 'entertainment',
    scope: 'each-child',
    when: (f) => (drives(f) ? 'Entertainment between stops' : 'Familiar play'),
    qty: (f) => {
      const q = Math.min(8, 2 + Math.ceil(f.maxDriveHours / 1.5));
      return n(q, 'toys', [`2 + one new toy every ~1.5 h of the longest drive (${fmt(f.maxDriveHours)} h), max 8 = ${q}`]);
    },
    necessity: 'recommended',
    reusable: true,
    location: 'cabin',
    stage: 'night-before',
    accessibleEnRoute: true,
    note: 'Choose soft, light toys — hard objects can injure in sudden braking.',
  },
  {
    id: 'child-books',
    name: 'Picture books',
    category: 'entertainment',
    scope: 'each-child',
    when: () => 'Quiet time and bedtime',
    qty: (f) => n(f.nights > 2 ? 3 : 2, 'books'),
    necessity: 'optional',
    reusable: true,
    location: 'cabin',
    stage: 'night-before',
  },
  {
    id: 'child-offline-audio',
    name: (_f, t) => (months(t) < 24 ? 'Downloaded rhymes and stories (audio)' : 'Downloaded audio and a few videos'),
    category: 'entertainment',
    scope: 'each-child',
    when: (f) => (f.totalDriveHours >= 1.5 ? 'No signal on some stretches' : false),
    qty: () => one('playlist'),
    necessity: 'recommended',
    reusable: true,
    location: 'n/a',
    stage: 'night-before',
    isCheck: true,
    note: 'Under age 2, WHO guidance is to avoid screen time — audio, songs and books work well. The driver should never operate a phone or screen while driving.',
  },
];
