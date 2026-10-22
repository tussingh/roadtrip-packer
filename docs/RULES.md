# Packing rules

All recommendations come from `src/rules/` — plain TypeScript, no AI, no randomness. The same trip, profiles, assumptions, inventory and history always produce the same list (`tests/unit/engine.rules.test.ts` checks this).

## How a rule works

```ts
{
  id: 'child-diapers',
  name: 'Diapers (total for trip)',
  category: 'baby-care',
  scope: 'each-child',                 // shared | car | each-adult | each-child
  when: (facts, child) => inDiapers(child) ? `In diapers (${age})` : false,   // include + first reason
  qty:  (facts, child) => ({ qty, unit: 'diapers', why: ['6/day × 2 days = 12', '+ 2 travel-day changes', …] }),
  necessity: 'essential', priority: 1, reusable: false, consumable: true,
  location: 'boot', stage: 'advance', accessibleEnRoute: false, safetyCritical: false,
  note: 'Advisory text (safety caveats, compatibility)',
}
```

Tap any item in the checklist to see `why` — the inclusion reason, each calculation step, and notes.

`TripFacts` (`context.ts`) is derived once per trip: days, nights, driving days and per-day hours (from legs, from entered total hours, or km ÷ average speed), longest drive, kilometres, laundry cycle, resolved weather (or the seasonal guess), resupply level, overnight stops, travellers with ages **on the trip start date**, activities and flags.

## Key formulas (defaults; all editable in Assumptions)

| Item | Formula |
|---|---|
| Adult day outfits | `ceil(cover_days × outfits_per_day) − 1 worn + spare(1)`; `cover_days` = trip days, ⌈days/2⌉ with laundry midway, or the laundry cycle (3) when laundry is always available |
| Child outfits | same, with 2/day + 0.5/day in hot/warm weather, spare 2; spares are kept in the diaper bag |
| Innerwear | `cover_days − 1 + 1` (+1 in hot weather on longer trips) |
| Sleepwear | adults: nights ÷ 3 per set; child: nights ÷ 2 + 1 for leaks |
| Diapers | `per_day(age) × days + Σ ceil(drive_hours ÷ 2.5) + max(4, 20%) + remote reserve days × per_day`; per day 8 / 6 / 5 / 4 by age bracket |
| Diapers in the diaper bag | `ceil(longest drive ÷ 2.5) + ceil(per_day ÷ 3) + 2` — part of the total, not extra |
| Wipes | changes × 4 ÷ 72 per pack |
| Formula | feeds/day × (days + 1 reserve + remote reserve) portions |
| UHT milk for the drive | per drive day `ceil(hours × feeds ÷ 14 waking h)`, + destination days if resupply is limited |
| Child snacks | `drive hours × 0.5` + first destination day (or all days if resupply is limited) + reserve |
| Drinking water | adults × 2 L + children × 0.75 L per driving day; carry one day if resupply is good, all driving days + reserve otherwise |
| Emergency water | occupants × 1 L, + one reserve day on limited/poor resupply — always carried |
| Emergency cash | ₹2,000 + ₹300 per 100 km, + one base amount per remote reserve day, rounded to ₹500 |
| Rest stops | per drive day `ceil(hours ÷ 2) − 1` with a child (2.5 h adults only) |
| Power banks | 1 per 2 adults (+1 remote/camping); essential when the longest drive ≥ 3 h |
| ORS | 4 + 1 per 3 days (+2 per remote reserve day) — sachets, never a dose |
| Regular medicines | days + 2 (+ remote reserve) **days of supply** — never a dose |

## Personalisation from trip reviews (`learning.ts`, `engine.ts`)

- **Ran out** → consumable quantity × (1 + 25%) per occurrence, capped at ×2.
- **Forgotten** → priority 1 and a “Forgotten before” tag; inventory items’ forgotten count increases.
- **Not needed** on 2 trips with no recorded use → shown as optional.
- **Safety-critical or essential items are never demoted**; the explanation says so.
- **Add next time** → your always-pack list, added to every future trip.
- Settings → Packing history → Reset clears learning.

## Safety rules built into the catalogue

- Vehicle safety baseline (first aid, triangle, spare tyre, jack, torch, emergency water, tyre and car-seat checks) appears on every car trip regardless of length.
- Car seat: within labelled limits, rear-facing as long as the seat allows; no aftermarket head supports or unapproved accessories; blanket over — never under — the harness.
- No medicine doses anywhere. Child fever relief says to confirm product and dose with the paediatrician.
- Under 6 months: shade and clothing instead of sunscreen. Under 2: audio and books rather than screens (WHO guidance).
- Tools carry compatibility notes (jack points, battery voltage, fuse ratings, tow points, tubeless-only puncture kits). No spare fuel in loose containers.
- Driver: secure footwear, no handheld phone use, no headphones while driving.

## Changing rules

1. Edit or add a rule in `src/rules/catalog/*.ts`. Keep `id` stable — it is the link to checklist items, inventory and learning.
2. Put tunable numbers in `assumptions.ts` (with label, unit, range, help) rather than in the rule.
3. Add a test in `tests/unit/`.
4. Bump `ENGINE_VERSION` in `engine.ts`. Existing trips update when you choose “Save and update list”; ticks, overrides and custom items are kept.

## Catalogue (195 rules)

| id | Item | Category | Scope | Necessity |
|---|---|---|---|---|
| `car-rc` | Vehicle registration certificate (RC) | Documents & money | car | essential, safety |
| `car-insurance` | Valid motor insurance | Documents & money | car | essential, safety |
| `car-puc` | Pollution under control (PUC) certificate | Documents & money | car | essential |
| `car-fastag` | FASTag active with enough balance | Vehicle checks | car | essential, check |
| `car-roadside-assist` | Roadside assistance and emergency numbers saved | Documents & money | car | essential, safety |
| `car-spare-tyre` | Spare tyre, inflated | Vehicle safety | car | essential, safety |
| `car-jack` | Jack and wheel spanner supplied with your car | Vehicle safety | car | essential, safety |
| `car-triangle` | Reflective warning triangle | Vehicle safety | car | essential, safety |
| `car-hi-vis` | High-visibility vest | Vehicle safety | car | depends, safety |
| `car-torch` | Torch or headlamp with spare batteries | Vehicle safety | car | essential, safety |
| `car-first-aid` | First-aid kit | Health & first aid | car | essential, safety |
| `car-extinguisher` | Small vehicle fire extinguisher | Vehicle safety | car | recommended, safety |
| `car-inflator` | 12 V tyre inflator and pressure gauge | Vehicle tools | car | depends |
| `car-puncture-kit` | Tubeless puncture repair kit | Vehicle tools | car | depends |
| `car-jump` | Jumper cables or a jump starter | Vehicle tools | car | depends |
| `car-tow-rope` | Tow rope or strap | Vehicle tools | car | depends |
| `car-tool-kit` | Basic tool kit and work gloves | Vehicle tools | car | depends |
| `car-fuses` | Spare fuses (your car’s ratings) | Vehicle tools | car | optional |
| `car-cleaning` | Microfibre cloths and windscreen cleaner | Vehicle tools | car | recommended |
| `car-umbrella` | Umbrella | Cabin comfort | car | depends |
| `car-phone-mount` | Phone mount for hands-free navigation | Electronics & power | car | essential, safety |
| `car-emergency-water` | Sealed emergency water (do not drink casually) | Food & water | car | essential, safety |
| `car-emergency-food` | Non-perishable emergency food (bars, dry snacks) | Food & water | car | depends |
| `car-emergency-cash` | Emergency cash | Documents & money | car | essential |
| `check-service` | Service or inspection if due | Vehicle checks | car | depends, check |
| `check-tyres` | Tyre pressures (including spare) and tread | Vehicle checks | car | essential, safety, check |
| `check-fluids` | Engine oil, coolant, brake and washer fluid | Vehicle checks | car | depends, check |
| `check-lights` | Lights, indicators, horn and wipers | Vehicle checks | car | depends, safety, check |
| `check-battery` | Battery terminals and age | Vehicle checks | car | recommended, check |
| `check-fuel` | check-fuel | Vehicle checks | car | essential, check |
| `check-car-seat` | Car seat installation check | Vehicle checks | car | essential, safety, check |
| `check-load` | Heavy luggage low in the boot, nothing loose in the cabin | Vehicle checks | car | essential, safety, check |
| `check-ghat` | Brakes checked; plan lower gears on hill descents | Vehicle checks | car | essential, safety, check |
| `check-night-driving` | Night-driving plan: rested drivers, shift changes | Planning | car | essential, safety, check |
| `check-monsoon-car` | Wiper blades, demister and tyre tread for wet roads | Vehicle checks | car | essential, safety, check |
| `adult-outfits` | Day outfits | Clothing | each-adult | essential |
| `adult-innerwear` | Innerwear | Clothing | each-adult | essential |
| `adult-socks` | Socks | Clothing | each-adult | depends |
| `adult-sleepwear` | Sleepwear | Clothing | each-adult | essential |
| `adult-light-layer` | Light jacket or sweatshirt | Clothing | each-adult | depends |
| `adult-thermals` | Thermal innerwear | Clothing | each-adult | essential |
| `adult-beanie-gloves` | Beanie and gloves | Clothing | each-adult | recommended |
| `adult-rainwear` | Rain jacket or poncho | Clothing | each-adult | depends |
| `adult-sun-protection` | Sunglasses and cap | Clothing | each-adult | depends |
| `adult-accessories` | Jewellery and accessories | Clothing | each-adult | optional |
| `adult-driving-shoes` | Secure driving footwear (worn) | Footwear | each-adult | essential, safety |
| `adult-walking-shoes` | Comfortable walking shoes | Footwear | each-adult | recommended |
| `adult-sandals` | Sandals or flip-flops | Footwear | each-adult | recommended |
| `adult-toothbrush` | Toothbrush | Toiletries | each-adult | essential |
| `adult-deodorant` | Deodorant | Toiletries | each-adult | recommended |
| `adult-skincare` | Personal skincare | Toiletries | each-adult | recommended |
| `adult-shaving` | Shaving or grooming kit | Toiletries | each-adult | recommended |
| `adult-makeup` | Makeup kit | Toiletries | each-adult | optional |
| `adult-hair-styling` | Hair dryer or styler | Electronics & power | each-adult | depends |
| `adult-menstrual` | Menstrual products | Toiletries | each-adult | recommended |
| `adult-glasses` | Spectacles and a spare pair | Health & first aid | each-adult | depends, safety |
| `adult-contacts` | Contact lenses, case and solution | Health & first aid | each-adult | essential |
| `adult-medication` | Regular prescribed medicines | Health & first aid | each-adult | essential, safety |
| `adult-photo-id` | Government photo ID | Documents & money | each-adult | essential, safety |
| `adult-wallet` | Wallet, payment cards and UPI phone | Documents & money | each-adult | essential |
| `adult-driving-licence` | Driving licence | Documents & money | each-adult | essential, safety |
| `adult-phone` | Phone | Electronics & power | each-adult | essential |
| `adult-phone-cable` | Phone charging cable | Electronics & power | each-adult | essential |
| `adult-headphones` | Headphones or earphones | Electronics & power | each-adult | optional |
| `adult-watch-charger` | Smartwatch charger | Electronics & power | each-adult | recommended |
| `adult-laptop` | Laptop and charger | Electronics & power | each-adult | depends |
| `child-diapers` | Diapers (total for trip) | Diapering & care | each-child | essential |
| `child-diapers-cabin` | Diapers in the diaper bag for the drive | Diapering & care | each-child | essential |
| `child-wipes` | Baby wipes | Diapering & care | each-child | essential |
| `child-rash-cream` | Diaper rash cream | Diapering & care | each-child | essential |
| `child-changing-mat` | Portable changing mat | Diapering & care | each-child | essential |
| `child-diaper-bags` | Diaper disposal bags | Diapering & care | each-child | recommended |
| `child-diaper-bag` | Diaper bag (packed and reachable) | Child gear | each-child | essential |
| `child-night-diapers` | Night-time diapers or pull-ups | Diapering & care | each-child | essential |
| `child-underwear` | Spare underwear | Clothing | each-child | essential |
| `child-travel-potty` | Travel potty or foldable seat | Child gear | each-child | recommended |
| `child-outfits` | Everyday outfits | Clothing | each-child | essential |
| `child-spare-outfits-cabin` | Spare outfits in the diaper bag | Clothing | each-child | essential |
| `child-sleepwear` | Sleepwear | Clothing | each-child | essential |
| `child-socks` | Socks | Clothing | each-child | recommended |
| `child-warm-layers` | Light warm layer | Clothing | each-child | depends |
| `child-woollen-cap` | Woollen cap and mittens | Clothing | each-child | essential |
| `child-sun-hat` | Sun hat | Clothing | each-child | recommended |
| `child-rain-cover` | Stroller rain cover | Clothing | each-child | depends |
| `child-shoes` | Shoes | Footwear | each-child | essential |
| `child-sandals` | Sandals or spare footwear | Footwear | each-child | recommended |
| `child-formula` | Formula (pre-measured portions) | Feeding | each-child | essential |
| `child-hot-water-flask` | Flask of boiled water | Feeding | each-child | recommended |
| `child-uht-milk` | Shelf-stable (UHT) milk cartons for the drive | Feeding | each-child | essential |
| `child-bottles-cups` | Sippy cup or toddler water bottle | Feeding | each-child | essential |
| `child-cleaning-kit` | Bottle brush and baby-safe dish liquid | Feeding | each-child | recommended |
| `child-sterilising` | Sterilising bags or tablets | Feeding | each-child | recommended |
| `child-snacks` | Familiar snacks | Feeding | each-child | essential |
| `child-travel-meals` | Home-cooked meals for the drive | Feeding | each-child | recommended |
| `child-feeding-set` | Bibs, spoons, bowl with lid | Feeding | each-child | essential |
| `child-food-containers` | Leak-proof food containers | Feeding | each-child | recommended |
| `child-burp-cloths` | Muslin cloths and small towels | Diapering & care | each-child | recommended |
| `child-wet-bags` | Wet bags for soiled clothes | Diapering & care | each-child | recommended |
| `child-toiletries` | Child-safe wash and moisturiser | Toiletries | each-child | recommended |
| `child-toothbrush` | Child toothbrush and toothpaste | Toiletries | each-child | recommended |
| `child-grooming` | Comb and child nail clipper | Toiletries | each-child | optional |
| `child-sunscreen` | Child sunscreen | Toiletries | each-child | depends |
| `child-mosquito` | Mosquito net for cot or stroller | Diapering & care | each-child | recommended |
| `child-medication` | Child’s regular medicines | Health & first aid | each-child | essential, safety |
| `child-fever-relief` | Child fever / pain relief your paediatrician approves | Health & first aid | each-child | depends, safety |
| `child-health-records` | Vaccination card and paediatrician’s number | Documents & money | each-child | recommended |
| `child-comfort-item` | Familiar comfort item | Sleep | each-child | essential |
| `child-sleep-sack` | Sleep sack or familiar blanket | Sleep | each-child | recommended |
| `child-travel-cot` | Travel cot / play yard | Sleep | each-child | recommended |
| `child-request-cot` | Ask the hotel for a baby cot | Stay | each-child | recommended, check |
| `child-night-light` | Night light and white-noise audio | Sleep | each-child | optional |
| `child-car-seat` | Child car seat, correctly fitted | Child gear | each-child | essential, safety |
| `child-stroller` | Stroller | Child gear | each-child | depends |
| `child-carrier` | Structured child carrier | Child gear | each-child | depends |
| `child-toys` | Small toys to rotate in the car | Entertainment | each-child | recommended |
| `child-books` | Picture books | Entertainment | each-child | optional |
| `child-offline-audio` | child-offline-audio | Entertainment | each-child | recommended, check |
| `shared-toothpaste` | Toothpaste | Toiletries | shared | essential |
| `shared-shampoo-soap` | Shampoo and body wash (travel size) | Toiletries | shared | depends |
| `shared-sanitiser` | Hand sanitiser | Toiletries | shared | essential |
| `shared-sunscreen` | Adult sunscreen | Toiletries | shared | depends |
| `shared-insect-repellent` | Insect repellent | Health & first aid | shared | depends |
| `shared-moisturiser` | Moisturiser and lip balm | Toiletries | shared | depends |
| `shared-comb-clipper` | Comb, nail clipper, cotton buds | Toiletries | shared | optional |
| `shared-laundry-bag` | Laundry bag for used clothes | Stay | shared | recommended |
| `shared-detergent` | Travel detergent sachets | Stay | shared | optional |
| `shared-power-bank` | Power bank (charged) | Electronics & power | shared | depends |
| `shared-car-charger` | Multi-port car charger | Electronics & power | car | essential |
| `shared-spare-cable` | Spare charging cable | Electronics & power | shared | recommended |
| `shared-wall-charger` | Multi-port wall charger | Electronics & power | shared | essential |
| `shared-extension` | Extension board or multi-plug | Electronics & power | shared | depends |
| `shared-drinking-water` | Drinking water for the drive | Food & water | shared | essential |
| `shared-reusable-bottles` | Reusable water bottles | Food & water | shared | recommended |
| `shared-adult-snacks` | Snacks for the drive | Food & water | shared | recommended |
| `shared-cooler` | Insulated cooler bag and ice packs | Food & water | shared | recommended |
| `shared-spill-containers` | Spill-resistant snack containers | Cabin comfort | shared | optional |
| `shared-rubbish-bags` | Cabin rubbish bags | Cabin comfort | shared | recommended |
| `shared-wet-wipes` | Wet wipes (general) | Cabin comfort | shared | recommended |
| `shared-tissues` | Tissues | Cabin comfort | shared | recommended |
| `shared-motion-sickness` | Motion-sickness kit: sick bags, ginger or lemon sweets | Health & first aid | shared | recommended |
| `shared-neck-pillow` | Neck pillow for passengers | Cabin comfort | shared | optional |
| `shared-blanket` | Light blanket or stole | Cabin comfort | shared | optional |
| `shared-sunshade` | Rear window sunshades | Cabin comfort | car | recommended |
| `shared-offline-music` | Offline music and podcasts downloaded | Entertainment | shared | optional, check |
| `shared-thermometer` | Digital thermometer | Health & first aid | shared | depends |
| `shared-ors` | Oral rehydration salts (ORS sachets) | Health & first aid | shared | depends |
| `shared-adult-otc` | Adult pain / fever relief you already use | Health & first aid | shared | recommended |
| `shared-prescriptions` | Prescription copies | Documents & money | shared | recommended |
| `shared-bookings` | Booking confirmations saved offline | Documents & money | shared | essential, check |
| `shared-emergency-card` | Paper emergency contact card | Documents & money | shared | recommended, safety |
| `plan-rest-stops` | plan-rest-stops | Planning | shared | depends, check |
| `plan-offline-map` | Offline map region downloaded for the route | Planning | shared | depends, check |
| `plan-medical` | Note hospitals with child care along the route | Planning | shared | depends, check |
| `plan-share-itinerary` | Share itinerary with someone at home | Planning | shared | depends, check |
| `plan-weather-roads` | Check weather and road closures (needs internet) | Planning | shared | depends, check |
| `plan-home` | Home secured: doors, gas, taps, appliances | Planning | shared | recommended, check |
| `plan-overnight-bag` | One overnight bag for transit stops | Stay | shared | recommended |
| `act-swimwear` | Swimwear | Activities | each-adult | activity |
| `act-child-swimwear` | Child swimwear or UV sun suit | Activities | each-child | activity |
| `act-swim-diapers` | Swim diapers | Activities | each-child | activity |
| `act-beach-towels` | Beach towels | Activities | shared | depends |
| `act-water-shoes` | Water shoes or flip-flops for sand | Activities | shared | activity |
| `act-sand-toys` | Bucket, spade and sand toys | Activities | each-child | optional |
| `act-waterproof-pouch` | Waterproof phone pouch | Activities | shared | optional |
| `act-after-sun` | After-sun gel (aloe) | Activities | shared | optional |
| `act-beach-shade` | Beach shade or UV tent | Activities | shared | optional |
| `act-hot-flask` | Flask for hot water or tea | Activities | shared | optional |
| `act-ziplocks` | Zip-lock and dry bags for documents and electronics | Activities | shared | depends |
| `act-floaters` | Quick-dry floaters / sandals | Footwear | each-adult | recommended |
| `act-leech-socks` | Leech socks | Activities | each-adult | activity |
| `act-neutral-clothes` | Neutral-coloured, long-sleeved outfit for safaris | Activities | each-adult | activity |
| `act-binoculars` | Binoculars | Activities | shared | optional |
| `act-safari-id` | ID and booking for safari / forest entry | Documents & money | shared | activity |
| `act-hiking-shoes` | Hiking shoes with grip | Footwear | each-adult | activity |
| `act-daypack` | Daypack with water and snacks | Activities | shared | activity |
| `act-camera` | Camera body and lenses | Activities | shared | activity |
| `act-camera-batteries` | Camera batteries (charged) | Activities | shared | activity |
| `act-camera-charger` | Camera battery charger | Activities | shared | activity |
| `act-memory-cards` | Memory cards and card reader | Activities | shared | activity |
| `act-tripod` | Tripod | Activities | shared | optional |
| `act-lens-cloth` | Lens cloth and blower | Activities | shared | optional |
| `act-camera-rain-cover` | Camera rain cover | Activities | shared | activity |
| `act-drone` | Drone, controller and propeller guards | Activities | shared | activity |
| `act-drone-batteries` | Drone batteries (charged) and spare propellers | Activities | shared | activity |
| `act-drone-rules` | Drone registration and airspace zones checked | Planning | shared | essential, check |
| `act-modest-clothes` | Modest outfit for temple visits | Activities | each-adult | activity |
| `act-slip-on` | Slip-on footwear and a bag to carry it | Activities | shared | activity |
| `act-small-cash` | Small change for offerings and footwear counters | Activities | shared | activity |
| `stay-homestay-torch` | Torch for the room and grounds | Stay | shared | recommended |
| `stay-host-gift` | Gift or sweets for your hosts | Stay | shared | optional |
| `stay-towels` | Bath towels | Stay | shared | depends |
| `camp-tent` | Tent with rain fly, pegs and mallet | Stay | shared | essential |
| `camp-sleeping` | Sleeping bags and mats | Stay | shared | essential |
| `camp-headlamps` | Headlamps | Stay | shared | essential |
| `camp-kitchen` | Camp stove, fuel, cookware and lighter | Stay | shared | recommended |
| `camp-water-treatment` | Water filter or purification tablets | Food & water | shared | recommended |
