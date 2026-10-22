import { memo } from 'react';
import { Icon } from '../../components/Icon';
import { LOCATION_LABEL } from '../../data/defaults';
import { effectiveQty } from '../../rules/merge';
import type { ChecklistItem } from '../../types';

function qtyText(i: ChecklistItem): { n: string; unit: string } {
  const q = effectiveQty(i);
  if (i.unit === '₹') return { n: `₹${q.toLocaleString('en-IN')}`, unit: 'cash' };
  if (i.isCheck) return { n: '', unit: '' };
  return { n: String(q), unit: i.unit };
}

export const ItemRow = memo(function ItemRow({
  item,
  who,
  showWho,
  onToggle,
  onOpen,
}: {
  item: ChecklistItem;
  who: string;
  showWho: boolean;
  onToggle: (i: ChecklistItem) => void;
  onOpen: (i: ChecklistItem) => void;
}) {
  const q = qtyText(item);
  const essential = item.necessity === 'essential' || item.safetyCritical;
  const cls = ['item', essential ? 'item--essential' : '', item.packed ? 'item--packed' : ''].filter(Boolean).join(' ');
  const verb = item.isCheck ? 'done' : 'packed';
  return (
    <li className={cls}>
      <button className="item__main" onClick={() => onOpen(item)} aria-label={`${item.name}${q.n ? `, ${q.n} ${q.unit}` : ''}. Show details`}>
        <span className="item__qty num" aria-hidden="true">
          {item.isCheck ? <Icon name={item.safetyCritical ? 'shield' : 'check'} size={22} /> : q.n}
          {q.unit && <small>{q.unit}</small>}
        </span>
        <span className="item__text">
          <span className="item__name">{item.name}</span>
          <span className="item__meta">
            {item.safetyCritical && (
              <span className="tag tag--safety">
                <Icon name="shield" size={12} /> Safety
              </span>
            )}
            {!item.safetyCritical && item.necessity === 'essential' && <span className="tag tag--safety">Essential</span>}
            {item.necessity === 'optional' && <span className="tag">Optional</span>}
            {item.needsPurchase && !item.packed && <span className="tag tag--buy">Buy</span>}
            {item.forgottenBefore && <span className="tag tag--cap">Forgotten before</span>}
            {item.unavailable && <span className="tag">Not taking</span>}
            {item.stale && <span className="tag">No longer suggested</span>}
            {showWho && <span className="tag tag--who">{who}</span>}
            {!item.isCheck && !(item.location === 'car' && item.assigneeId === 'car') && <span className="tag">{LOCATION_LABEL[item.location]}</span>}
            {item.userQty !== undefined && item.userQty !== item.recommendedQty && <span className="tag">edited</span>}
            {item.source === 'custom' && <span className="tag">Added by you</span>}
          </span>
        </span>
      </button>
      <button
        className={`check${item.unavailable ? ' check--unavailable' : ''}`}
        role="checkbox"
        aria-checked={item.packed}
        aria-label={`Mark ${item.name} as ${item.packed ? `not ${verb}` : verb}`}
        onClick={() => onToggle(item)}
      >
        <span className="check__box">
          <Icon name="check" size={20} strokeWidth={3} />
        </span>
      </button>
    </li>
  );
});
