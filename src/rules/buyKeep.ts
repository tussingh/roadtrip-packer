import type { ChecklistItem, Trip } from '../types';

/**
 * "What to bring from home vs buy" advice. Deterministic and explainable:
 * every item lands in exactly one group with a one-line reason.
 */
export type BuyKeepGroup = 'buy-before' | 'bring-hard-to-find' | 'buy-there' | 'provided' | 'bring' | 'skip';

export const BUY_KEEP_LABEL: Record<BuyKeepGroup, { title: string; blurb: string }> = {
  'buy-before': { title: 'Buy before you leave', blurb: 'You told the app you do not have enough of these.' },
  'bring-hard-to-find': { title: 'Bring from home — hard to buy on the road', blurb: 'Specific, safety or health items. If you do not own one, buy it in the city before you go.' },
  'buy-there': { title: 'Carry some, buy the rest on the way', blurb: 'Everyday consumables that small-town shops and pharmacies stock. Carry enough for the drive plus a day.' },
  provided: { title: 'Your stay usually provides', blurb: 'Check with the hotel or host; skip these to save space.' },
  bring: { title: 'Bring from home', blurb: 'Things you already own. No need to buy.' },
  skip: { title: 'Optional — do not buy just for this trip', blurb: 'Pack only if you already have them.' },
};

export const BUY_KEEP_ORDER: BuyKeepGroup[] = ['buy-before', 'bring-hard-to-find', 'buy-there', 'provided', 'bring', 'skip'];

const HARD_TO_FIND = /car seat|first.?aid|medic|prescription|formula|thermometer|inflator|jump|tow|torch|reflective|warning triangle|fire extinguisher|charger|cable|power bank|glasses|lens|stroller|carrier|sippy|bottle steriliser|nasal|saline|paracetamol|syrup|ors|tyre|spare|sunshade|baby monitor|comfort/i;
const EASY_BUY = /diaper|nappy|wipe|water|snack|fruit|biscuit|banana|milk|curd|tissue|soap|toothpaste|shampoo|sunscreen|mosquito|repellent|sanitiser|sanitizer|garbage|bag|napkin|paper|juice|coconut|bread/i;
const PROVIDED = /shampoo|body wash|soap|towel|hair ?dryer|slipper|toothbrush kit|conditioner|kettle|iron/i;

export interface BuyKeepAdvice {
  item: ChecklistItem;
  group: BuyKeepGroup;
  why: string;
}

export function buyKeepAdvice(items: ChecklistItem[], trip: Pick<Trip, 'resupply' | 'accommodation' | 'remote'>): BuyKeepAdvice[] {
  const goodShops = trip.resupply === 'good' && !trip.remote;
  const hotel = trip.accommodation === 'hotel' || trip.accommodation === 'resort';
  const out: BuyKeepAdvice[] = [];
  for (const item of items) {
    if (item.isCheck || item.stale) continue;
    const name = item.name;
    const notOwned = item.needsPurchase || item.owned === 'not-owned' || item.owned === 'partial';
    let group: BuyKeepGroup;
    let why: string;
    if (item.category === 'documents' || item.category === 'vehicle-checks' || item.category === 'planning') {
      group = 'bring';
      why = item.category === 'documents' ? 'Paperwork and money — check it is in the bag or glovebox (DigiLocker copies help).' : 'A check before you leave, nothing to buy.';
    } else if (hotel && PROVIDED.test(name) && !item.safetyCritical && item.category !== 'baby-care') {
      group = 'provided';
      why = `Most ${trip.accommodation === 'resort' ? 'resorts' : 'hotels'} supply this. A travel-size one is enough as backup.`;
    } else if (notOwned && !(item.consumable && goodShops && EASY_BUY.test(name) && !item.safetyCritical)) {
      group = 'buy-before';
      why = item.purchaseReason || 'Marked as not owned or running low in your inventory.';
    } else if (item.consumable && !item.safetyCritical && EASY_BUY.test(name) && goodShops) {
      group = 'buy-there';
      why = item.category === 'baby-care' ? 'Common brands are sold in pharmacies and supermarkets in most towns. Carry the drive days’ supply plus one extra day — or all of it if your child needs a particular brand.' : 'Easy to find in towns along the way. Carry enough for the drive.';
    } else if (item.safetyCritical || HARD_TO_FIND.test(name) || item.category === 'health' || item.category.startsWith('vehicle')) {
      group = 'bring-hard-to-find';
      why = item.safetyCritical ? 'Safety item — do not rely on finding it on the road.' : item.category === 'health' ? 'Medicines and child-specific health items are best bought from a trusted city pharmacy.' : 'Specific item that highway towns rarely stock.';
    } else if (item.necessity === 'optional' && item.owned !== 'owned') {
      group = 'skip';
      why = 'Nice to have. Not worth buying for one trip.';
    } else {
      group = 'bring';
      why = item.owned === 'owned' ? 'You have this.' : item.consumable && !goodShops ? 'Shops are limited on this route — carry the full amount.' : 'Everyday item from home.';
    }
    out.push({ item, group, why });
  }
  return out;
}
