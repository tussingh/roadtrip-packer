import type { ItemRule } from '../ruleTypes';
import { act, drives, fmt, hasChild, isColdish, isWarmish, n, one, pl, remoteReserve } from '../ruleTypes';
import type { TripFacts } from '../context';

const providedByStay = (f: TripFacts) => f.accommodation === 'hotel' || f.accommodation === 'resort';

export function restBreaksPerDay(f: TripFacts) {
  const interval = hasChild(f) ? f.a.restBreakEveryHoursWithChild : f.a.restBreakEveryHoursAdults;
  return f.driveDays.map((d) => ({ ...d, breaks: Math.max(0, Math.ceil(d.hours / interval) - 1), interval }));
}

const deviceCount = (f: TripFacts) => f.adults.length + f.adults.filter((a) => a.adult?.smartwatch).length;

/** Family-level items: shared toiletries, power, food & water, health, planning. */
export const sharedRules: ItemRule[] = [
  /* ---------------- shared toiletries ---------------- */
  {
    id: 'shared-toothpaste',
    name: 'Toothpaste',
    category: 'toiletries',
    scope: 'shared',
    when: (f) => (f.nights > 0 ? 'Shared by the family' : false),
    qty: (f) => n(f.nights > 10 ? 2 : 1, 'tubes', ['one tube is shared — not one per person']),
    necessity: 'essential',
    reusable: false,
    consumable: true,
    location: 'suitcase',
    stage: 'morning',
  },
  {
    id: 'shared-shampoo-soap',
    name: 'Shampoo and body wash (travel size)',
    category: 'toiletries',
    scope: 'shared',
    when: (f) => (f.nights > 0 ? (providedByStay(f) ? 'Hotels usually supply these — pack if you prefer your own' : 'Homestays and camps may not supply toiletries') : false),
    qty: () => one('set'),
    necessity: (f) => (providedByStay(f) ? 'optional' : 'recommended'),
    reusable: false,
    consumable: true,
    location: 'suitcase',
    stage: 'night-before',
  },
  {
    id: 'shared-sanitiser',
    name: 'Hand sanitiser',
    category: 'toiletries',
    scope: 'shared',
    when: () => 'Clean hands at roadside stops',
    qty: (f) => n(drives(f) ? 2 : 1, 'bottles', drives(f) ? ['one in the cabin, one in the day bag'] : []),
    necessity: 'essential',
    reusable: false,
    consumable: true,
    location: 'cabin',
    stage: 'advance',
    accessibleEnRoute: true,
  },
  {
    id: 'shared-sunscreen',
    name: 'Adult sunscreen',
    category: 'toiletries',
    scope: 'shared',
    when: (f) => (isWarmish(f) || act(f, 'beach') || f.mountains || act(f, 'sightseeing') ? 'Sun exposure expected' : false),
    qty: (f) => {
      const q = act(f, 'beach') && f.days > 3 ? 2 : 1;
      return n(q, 'bottles', q > 1 ? ['beach trip longer than 3 days'] : ['shared by adults']);
    },
    necessity: (f) => (act(f, 'beach') ? 'essential' : 'recommended'),
    reusable: false,
    consumable: true,
    location: 'suitcase',
    stage: 'advance',
  },
  {
    id: 'shared-insect-repellent',
    name: 'Insect repellent',
    category: 'health',
    scope: 'shared',
    when: (f) =>
      f.rain !== 'dry' || act(f, 'wildlife') || act(f, 'hiking') || f.accommodation === 'homestay' || f.accommodation === 'camping' || act(f, 'beach')
        ? 'Mosquitoes likely (rain, nature or rural stay)'
        : false,
    qty: () => one('bottle'),
    necessity: (f) => (f.rain === 'monsoon' || act(f, 'wildlife') || f.accommodation === 'camping' ? 'essential' : 'recommended'),
    reusable: false,
    consumable: true,
    location: 'suitcase',
    stage: 'advance',
  },
  {
    id: 'shared-moisturiser',
    name: 'Moisturiser and lip balm',
    category: 'toiletries',
    scope: 'shared',
    when: (f) => (isColdish(f) || f.days >= 4 ? (isColdish(f) ? 'Dry, cool air' : 'Longer trip') : false),
    qty: () => one('set'),
    necessity: (f) => (isColdish(f) ? 'recommended' : 'optional'),
    reusable: false,
    consumable: true,
    location: 'suitcase',
    stage: 'advance',
  },
  {
    id: 'shared-comb-clipper',
    name: 'Comb, nail clipper, cotton buds',
    category: 'toiletries',
    scope: 'shared',
    when: (f) => (f.nights > 0 ? 'Shared grooming basics' : false),
    qty: () => one('set'),
    necessity: 'optional',
    reusable: true,
    location: 'suitcase',
    stage: 'advance',
  },
  {
    id: 'shared-laundry-bag',
    name: 'Laundry bag for used clothes',
    category: 'stay',
    scope: 'shared',
    when: (f) => (f.nights >= 2 ? 'Separates worn clothes' : false),
    qty: () => one('bag'),
    necessity: 'recommended',
    reusable: true,
    location: 'suitcase',
    stage: 'advance',
  },
  {
    id: 'shared-detergent',
    name: 'Travel detergent sachets',
    category: 'stay',
    scope: 'shared',
    when: (f) => (f.laundryCycleDays < f.days ? 'Laundry planned during the trip' : false),
    qty: (f) => {
      const washes = Math.ceil(f.days / f.laundryCycleDays) - 1;
      return n(Math.max(1, washes) * 2, 'sachets', [`${pl(Math.max(1, washes), 'wash', 'washes')} × 2 sachets (skip if using a laundry service)`]);
    },
    necessity: 'optional',
    reusable: false,
    consumable: true,
    location: 'suitcase',
    stage: 'advance',
  },
  /* ---------------- power & navigation ---------------- */
  {
    id: 'shared-power-bank',
    name: 'Power bank (charged)',
    category: 'electronics',
    scope: 'shared',
    when: (f) => 'Phones drain fast when navigating' + (f.maxDriveHours >= f.a.powerBankAboveDriveHours ? ` — longest drive is ${fmt(f.maxDriveHours)} h` : ''),
    qty: (f) => {
      let q = Math.max(1, Math.ceil(f.adults.length / 2));
      const why = [`1 per 2 adults = ${q}`];
      if (f.remote || f.accommodation === 'camping') {
        q += 1;
        why.push('+1 for limited charging (remote route or camping)');
      }
      return n(q, 'power banks', why);
    },
    necessity: (f) => (f.maxDriveHours >= f.a.powerBankAboveDriveHours || f.remote || f.accommodation === 'camping' ? 'essential' : 'recommended'),
    reusable: true,
    location: 'cabin',
    stage: 'night-before',
    accessibleEnRoute: true,
    note: 'Charge it the night before. Keep it out of direct sun on the dashboard.',
  },
  {
    id: 'shared-car-charger',
    name: 'Multi-port car charger',
    category: 'electronics',
    scope: 'car',
    when: (f) => (drives(f) ? 'Charging while driving' : false),
    qty: (f) => {
      const ports = f.adults.length + (f.children.some((c) => (c.ageMonths ?? 0) >= 24) ? 1 : 0) + (f.maxDriveHours >= f.a.powerBankAboveDriveHours ? 1 : 0);
      return n(1, 'charger', [`needs at least ${ports} ports: ${f.adults.length} phones${f.maxDriveHours >= f.a.powerBankAboveDriveHours ? ' + power bank top-up' : ''}`]);
    },
    necessity: 'essential',
    reusable: true,
    location: 'car',
    stage: 'advance',
  },
  {
    id: 'shared-spare-cable',
    name: 'Spare charging cable',
    category: 'electronics',
    scope: 'shared',
    when: (f) => (f.totalDriveHours >= 4 || f.nights >= 2 ? 'Cables fail at the worst time' : false),
    qty: () => one('cable'),
    necessity: 'recommended',
    reusable: true,
    location: 'cabin',
    stage: 'advance',
  },
  {
    id: 'shared-wall-charger',
    name: 'Multi-port wall charger',
    category: 'electronics',
    scope: 'shared',
    when: (f) => (f.nights > 0 ? `Overnight charging for ${pl(deviceCount(f), 'device')}` : false),
    qty: () => one('charger'),
    necessity: 'essential',
    reusable: true,
    location: 'suitcase',
    stage: 'morning',
  },
  {
    id: 'shared-extension',
    name: 'Extension board or multi-plug',
    category: 'electronics',
    scope: 'shared',
    when: (f) => (f.nights > 0 ? (providedByStay(f) ? 'Hotel sockets are often few or far from the bed' : 'Rural stays may have few sockets') : false),
    qty: () => one(),
    necessity: (f) => (providedByStay(f) ? 'optional' : 'recommended'),
    reusable: true,
    location: 'suitcase',
    stage: 'advance',
  },
  /* ---------------- food, water & cabin comfort ---------------- */
  {
    id: 'shared-drinking-water',
    name: 'Drinking water for the drive',
    category: 'food-water',
    scope: 'shared',
    when: (f) => (drives(f) ? `${pl(f.drivingDays, 'driving day')}` : false),
    qty: (f) => {
      const adultL = f.adults.length * f.a.waterLitresPerAdultPerDriveDay;
      const childL = f.children.length * f.a.waterLitresPerChildPerDriveDay;
      const perDay = adultL + childL;
      const reserve = remoteReserve(f);
      const longest = Math.max(1, f.drivingDays);
      // carry for one driving day at a time when resupply is good; for all driving days + reserve otherwise
      const carryDays = f.resupply === 'good' ? 1 : longest + reserve;
      const litres = perDay * carryDays;
      const bottles = Math.ceil(litres / f.a.bottleSizeLitres);
      const why = [
        `${f.adults.length} adults × ${fmt(f.a.waterLitresPerAdultPerDriveDay)} L + ${f.children.length} children × ${fmt(f.a.waterLitresPerChildPerDriveDay)} L = ${fmt(perDay)} L per driving day`,
        f.resupply === 'good'
          ? 'good resupply → carry one day’s water and refill on the way'
          : `${f.resupply} resupply → carry for ${pl(longest, 'driving day')} + ${reserve} reserve`,
        `= ${fmt(litres)} L → ${pl(bottles, `${fmt(f.a.bottleSizeLitres)} L bottle`)}`,
      ];
      return n(bottles, 'bottles', why);
    },
    necessity: 'essential',
    reusable: false,
    consumable: true,
    location: 'cabin',
    stage: 'morning',
    accessibleEnRoute: true,
  },
  {
    id: 'shared-reusable-bottles',
    name: 'Reusable water bottles',
    category: 'food-water',
    scope: 'shared',
    when: () => 'Refill instead of buying plastic',
    qty: (f) => n(Math.max(1, f.adults.length), 'bottles', ['one per adult']),
    necessity: 'recommended',
    reusable: true,
    location: 'cabin',
    stage: 'morning',
    accessibleEnRoute: true,
  },
  {
    id: 'shared-adult-snacks',
    name: 'Snacks for the drive',
    category: 'food-water',
    scope: 'shared',
    when: (f) => (drives(f) ? 'Fewer unplanned stops, steadier energy for the driver' : false),
    qty: (f) => {
      const base = Math.ceil(f.totalDriveHours * f.a.adultSnacksPerDriveHour * f.adults.length);
      const reserve = remoteReserve(f) * 2 * f.adults.length;
      const q = Math.max(2, base + reserve);
      const why = [`${fmt(f.totalDriveHours)} h × ${fmt(f.a.adultSnacksPerDriveHour)} per hour × ${f.adults.length} adults = ${base}`];
      if (reserve) why.push(`+ ${reserve} remote reserve`);
      return n(q, 'portions', [...why, `= ${q}`]);
    },
    necessity: 'recommended',
    reusable: false,
    consumable: true,
    location: 'cabin',
    stage: 'night-before',
    accessibleEnRoute: true,
  },
  {
    id: 'shared-cooler',
    name: 'Insulated cooler bag and ice packs',
    category: 'food-water',
    scope: 'shared',
    when: (f) => {
      const perishables = f.children.some((c) => c.child?.animalMilk || c.child?.eatsSolids);
      if (drives(f) && perishables && f.maxDriveHours >= 2) return 'Keeps milk and cooked food cold';
      if (drives(f) && isWarmish(f) && f.maxDriveHours >= 4) return 'Hot weather on a long drive';
      return false;
    },
    qty: () => one('bag', ['freeze ice packs the night before']),
    necessity: 'recommended',
    reusable: true,
    location: 'cabin',
    stage: 'morning',
    accessibleEnRoute: true,
  },
  {
    id: 'shared-spill-containers',
    name: 'Spill-resistant snack containers',
    category: 'comfort',
    scope: 'shared',
    when: (f) => (drives(f) && f.totalDriveHours >= 2 ? 'Less mess in the cabin' : false),
    qty: () => n(2, 'containers'),
    necessity: 'optional',
    reusable: true,
    location: 'cabin',
    stage: 'night-before',
  },
  {
    id: 'shared-rubbish-bags',
    name: 'Cabin rubbish bags',
    category: 'comfort',
    scope: 'shared',
    when: (f) => (drives(f) ? 'Keep the cabin clean, dispose at stops' : false),
    qty: (f) => n(Math.max(2, f.drivingDays * 2), 'bags', [`2 per driving day`]),
    necessity: 'recommended',
    reusable: false,
    consumable: true,
    location: 'cabin',
    stage: 'advance',
    accessibleEnRoute: true,
  },
  {
    id: 'shared-wet-wipes',
    name: 'Wet wipes (general)',
    category: 'comfort',
    scope: 'shared',
    when: () => 'Hands, spills and seats',
    qty: (f) => n(1 + (f.drivingDays > 2 ? 1 : 0), 'packs', f.drivingDays > 2 ? ['+1 for more than two driving days'] : []),
    necessity: 'recommended',
    reusable: false,
    consumable: true,
    location: 'cabin',
    stage: 'advance',
    accessibleEnRoute: true,
  },
  {
    id: 'shared-tissues',
    name: 'Tissues',
    category: 'comfort',
    scope: 'shared',
    when: () => 'Everyday use',
    qty: (f) => n(1 + Math.max(1, f.drivingDays), 'packs', ['1 box for the car + 1 pocket pack per driving day']),
    necessity: 'recommended',
    reusable: false,
    consumable: true,
    location: 'cabin',
    stage: 'advance',
    accessibleEnRoute: true,
  },
  {
    id: 'shared-motion-sickness',
    name: 'Motion-sickness kit: sick bags, ginger or lemon sweets',
    category: 'health',
    scope: 'shared',
    when: (f) => {
      const prone = f.everyone.some((t) => t.adult?.motionSickness || t.child?.motionSickness);
      if (prone) return 'Someone in the family gets car-sick';
      if (f.mountains && drives(f)) return 'Winding hill roads';
      return false;
    },
    qty: (f) => {
      const q = Math.max(3, f.drivingDays * 3);
      return n(q, 'bags', [`3 sick bags per driving day = ${q}`]);
    },
    necessity: 'recommended',
    reusable: false,
    consumable: true,
    location: 'cabin',
    stage: 'advance',
    accessibleEnRoute: true,
    note: 'Use motion-sickness medicine only if a doctor has advised it — many are not suitable for young children.',
  },
  {
    id: 'shared-neck-pillow',
    name: 'Neck pillow for passengers',
    category: 'comfort',
    scope: 'shared',
    when: (f) => (f.hasLongDriveDay || f.overnightDriving ? `Long drive day (${fmt(f.maxDriveHours)} h)` : false),
    qty: () => one(),
    necessity: 'optional',
    reusable: true,
    location: 'cabin',
    stage: 'advance',
  },
  {
    id: 'shared-blanket',
    name: 'Light blanket or stole',
    category: 'comfort',
    scope: 'shared',
    when: (f) => (isColdish(f) || f.overnightDriving || f.maxDriveHours >= 4 ? 'AC chill, naps or cool nights' : false),
    qty: (f) => n(isColdish(f) || f.overnightDriving ? f.occupants : 1, 'blankets', isColdish(f) || f.overnightDriving ? ['one per traveller'] : ['one to share']),
    necessity: 'optional',
    reusable: true,
    location: 'cabin',
    stage: 'advance',
    note: 'For a child, lay the blanket over the buckled harness — never under it.',
  },
  {
    id: 'shared-sunshade',
    name: 'Rear window sunshades',
    category: 'comfort',
    scope: 'car',
    when: (f) => (drives(f) && hasChild(f) && (isWarmish(f) || f.maxDriveHours >= 3) ? 'Sun on the child’s seat' : false),
    qty: () => n(2, 'shades', ['one per rear side window']),
    necessity: 'recommended',
    reusable: true,
    location: 'car',
    stage: 'advance',
    note: 'Choose shades that do not block the driver’s view and comply with local window rules.',
  },
  {
    id: 'shared-offline-music',
    name: 'Offline music and podcasts downloaded',
    category: 'entertainment',
    scope: 'shared',
    when: (f) => (f.totalDriveHours >= 2 ? 'Patchy signal on highways' : false),
    qty: () => one('playlist'),
    necessity: 'optional',
    reusable: true,
    location: 'n/a',
    stage: 'night-before',
    isCheck: true,
  },
  /* ---------------- health ---------------- */
  {
    id: 'shared-thermometer',
    name: 'Digital thermometer',
    category: 'health',
    scope: 'shared',
    when: (f) => (hasChild(f) ? 'Checking a child’s temperature' : f.days > 3 ? 'Longer trip' : false),
    qty: () => one(),
    necessity: (f) => (hasChild(f) ? 'essential' : 'optional'),
    reusable: true,
    location: 'diaper-bag',
    stage: 'advance',
  },
  {
    id: 'shared-ors',
    name: 'Oral rehydration salts (ORS sachets)',
    category: 'health',
    scope: 'shared',
    when: (f) => (isWarmish(f) || hasChild(f) || f.days > 2 ? 'Heat, travel food and tummy upsets' : false),
    qty: (f) => {
      const extra = Math.floor(f.days / 3);
      const rem = remoteReserve(f) * 2;
      const q = f.a.orsSachetsBase + extra + rem;
      const why = [`${f.a.orsSachetsBase} baseline + 1 per 3 days (${extra})`];
      if (rem) why.push(`+ ${rem} remote reserve`);
      why.push(`= ${q} sachets`, 'Prepare exactly as the pack says. For young children, ask your paediatrician how much to give.');
      return n(q, 'sachets', why);
    },
    necessity: (f) => (hasChild(f) || f.remote ? 'essential' : 'recommended'),
    reusable: false,
    consumable: true,
    location: 'emergency-kit',
    stage: 'advance',
  },
  {
    id: 'shared-adult-otc',
    name: 'Adult pain / fever relief you already use',
    category: 'health',
    scope: 'shared',
    when: (f) => (f.nights > 0 ? 'Headaches and fevers away from home' : false),
    qty: () => one('pack', ['check the expiry date']),
    necessity: 'recommended',
    reusable: false,
    consumable: true,
    location: 'emergency-kit',
    stage: 'advance',
    note: 'Only medicines you have used safely before or that a doctor recommends. This app does not suggest doses.',
  },
  {
    id: 'shared-prescriptions',
    name: 'Prescription copies',
    category: 'documents',
    scope: 'shared',
    when: (f) => (f.everyone.some((t) => t.adult?.takesRegularMedication || t.child?.takesRegularMedication) ? 'Regular medicines in the family' : false),
    qty: () => one('set', ['photo on phone + paper copy']),
    necessity: 'recommended',
    reusable: true,
    location: 'cabin',
    stage: 'advance',
  },
  /* ---------------- documents & planning ---------------- */
  {
    id: 'shared-bookings',
    name: 'Booking confirmations saved offline',
    category: 'documents',
    scope: 'shared',
    when: (f) => (f.nights > 0 || act(f, 'wildlife') ? 'Stays, safaris and tickets' : false),
    qty: () => one('set', ['screenshots or PDFs on two phones']),
    necessity: 'essential',
    reusable: true,
    location: 'n/a',
    stage: 'advance',
    isCheck: true,
  },
  {
    id: 'shared-emergency-card',
    name: 'Paper emergency contact card',
    category: 'documents',
    scope: 'shared',
    when: () => 'Works when phones are dead',
    qty: () => one('card', ['family contacts, blood groups, doctor, insurer']),
    necessity: 'recommended',
    reusable: true,
    location: 'car',
    stage: 'advance',
    safetyCritical: true,
  },
  {
    id: 'plan-rest-stops',
    name: (f) => {
      const days = restBreaksPerDay(f);
      const max = days.reduce((m, d) => Math.max(m, d.breaks), 0);
      return `Plan ${pl(max, 'rest stop')} on the longest driving day`;
    },
    category: 'planning',
    scope: 'shared',
    when: (f) => (drives(f) && f.maxDriveHours >= 1.5 ? 'Breaks for the driver and the child' : false),
    qty: (f) => {
      const days = restBreaksPerDay(f);
      const total = days.reduce((s, d) => s + d.breaks, 0);
      const why = days.map((d) => `${d.label}: ${fmt(d.hours)} h ÷ ${fmt(d.interval)} h → ${pl(d.breaks, 'stop')}`);
      why.push('Use the Offline Maps tab to find fuel, toilets and food along the route.');
      return n(total, 'stops', why);
    },
    necessity: (f) => (f.hasLongDriveDay || hasChild(f) ? 'essential' : 'recommended'),
    reusable: true,
    location: 'n/a',
    stage: 'advance',
    isCheck: true,
  },
  {
    id: 'plan-offline-map',
    name: 'Offline map region downloaded for the route',
    category: 'planning',
    scope: 'shared',
    when: (f) => (drives(f) ? (f.remote ? 'No signal likely on parts of the route' : 'Backup if mobile data drops') : false),
    qty: () => one('check'),
    necessity: (f) => (f.remote ? 'essential' : 'recommended'),
    reusable: true,
    location: 'n/a',
    stage: 'advance',
    isCheck: true,
  },
  {
    id: 'plan-medical',
    name: 'Note hospitals with child care along the route',
    category: 'planning',
    scope: 'shared',
    when: (f) => (drives(f) && (hasChild(f) || f.remote) && f.totalKm >= 100 ? 'Know where to go before you need it' : false),
    qty: () => one('check'),
    necessity: (f) => (f.remote ? 'essential' : 'recommended'),
    reusable: true,
    location: 'n/a',
    stage: 'advance',
    isCheck: true,
    note: 'Offline map data shows mapped hospitals only; opening hours and paediatric services must be confirmed online or by phone.',
  },
  {
    id: 'plan-share-itinerary',
    name: 'Share itinerary with someone at home',
    category: 'planning',
    scope: 'shared',
    when: (f) => (f.totalKm >= 200 || f.remote ? 'Someone knows where to look if you are out of contact' : false),
    qty: () => one('check'),
    necessity: (f) => (f.remote ? 'essential' : 'recommended'),
    reusable: true,
    location: 'n/a',
    stage: 'night-before',
    isCheck: true,
  },
  {
    id: 'plan-weather-roads',
    name: 'Check weather and road closures (needs internet)',
    category: 'planning',
    scope: 'shared',
    when: (f) => (drives(f) && (f.rain !== 'dry' || f.mountains || f.remote) ? 'Conditions can change quickly' : false),
    qty: () => one('check'),
    necessity: (f) => (f.rain === 'monsoon' || f.mountains ? 'essential' : 'recommended'),
    reusable: true,
    location: 'n/a',
    stage: 'night-before',
    isCheck: true,
    note: 'This app has no live weather or traffic data — use an online source the day before and again before leaving.',
  },
  {
    id: 'plan-home',
    name: 'Home secured: doors, gas, taps, appliances',
    category: 'planning',
    scope: 'shared',
    when: (f) => (f.nights > 0 ? 'Leaving home overnight' : false),
    qty: () => one('check'),
    necessity: 'recommended',
    reusable: true,
    location: 'n/a',
    stage: 'verify',
    isCheck: true,
  },
  {
    id: 'plan-overnight-bag',
    name: 'One overnight bag for transit stops',
    category: 'stay',
    scope: 'shared',
    when: (f) => (f.overnightStops > 0 || f.longJourney ? 'Avoid unloading the whole boot at each stop' : false),
    qty: (f) => n(1, 'bag', [`${pl(Math.max(1, f.overnightStops), 'overnight stop')} on the way`, 'night clothes, toiletries, chargers, next day’s outfits']),
    necessity: 'recommended',
    reusable: true,
    location: 'boot',
    stage: 'night-before',
  },
];
