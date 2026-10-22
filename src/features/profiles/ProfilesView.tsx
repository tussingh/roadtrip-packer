import { useEffect, useState } from 'react';
import { bump, navigate, showToast, useQuery } from '../../app/store';
import { Icon } from '../../components/Icon';
import { Empty, ListLink, Notice, Segmented, Sheet, Stepper, TextInput, Toggle, TopBar } from '../../components/ui';
import { defaultAdultPrefs, defaultChildPrefs, monthsAgo, nowIso, uid } from '../../data/defaults';
import { ageInMonths, describeAge } from '../../rules/context';
import { deleteProfile, listProfiles, listTrips, saveProfile } from '../../storage/repo';
import type { AdultPrefs, ChildPrefs, TravellerProfile } from '../../types';

export function ProfilesView() {
  const { data: profiles } = useQuery(listProfiles, []);
  if (!profiles) return <main className="page" aria-busy="true" />;
  const add = async (kind: 'adult' | 'child') => {
    const t = nowIso();
    const p: TravellerProfile =
      kind === 'adult'
        ? { id: uid(), name: 'New adult', kind, gender: 'unspecified', adult: defaultAdultPrefs('unspecified'), createdAt: t, updatedAt: t }
        : { id: uid(), name: 'New child', kind, gender: 'unspecified', birthDate: monthsAgo(24), child: defaultChildPrefs(24), createdAt: t, updatedAt: t };
    await saveProfile(p);
    bump();
    navigate(`/profiles/${p.id}`);
  };
  return (
    <main className="page">
      <TopBar title="Family profiles" back="#/more" />
      <p className="muted small mt0">Each person gets their own list. Ages are worked out from birth dates on the day you travel, so recommendations grow with your child.</p>
      {profiles.length === 0 ? (
        <Empty icon="users" title="No travellers yet" />
      ) : (
        <ul className="list card">
          {profiles.map((p) => {
            const age = ageInMonths(p.birthDate, new Date());
            return (
              <li key={p.id}>
                <ListLink
                  href={`#/profiles/${p.id}`}
                  icon={p.kind === 'child' ? 'child' : 'user'}
                  title={p.name}
                  meta={p.kind === 'child' ? `Child, ${describeAge(age)}` : `Adult${p.adult?.isDriver ? ', driver' : ''}`}
                />
              </li>
            );
          })}
        </ul>
      )}
      <div className="row-actions" style={{ marginTop: 16 }}>
        <button className="btn" onClick={() => add('adult')}>
          <Icon name="plus" /> Add adult
        </button>
        <button className="btn" onClick={() => add('child')}>
          <Icon name="plus" /> Add child
        </button>
      </div>
    </main>
  );
}

export function ProfileEditor({ profileId }: { profileId: string }) {
  const { data } = useQuery(async () => ({ profiles: await listProfiles(), trips: await listTrips() }), [profileId]);
  const [p, setP] = useState<TravellerProfile>();
  const [confirm, setConfirm] = useState(false);
  useEffect(() => {
    if (data && !p) setP(data.profiles.find((x) => x.id === profileId));
  }, [data, p, profileId]);
  if (!data) return <main className="page" aria-busy="true" />;
  if (!p) {
    return (
      <main className="page">
        <TopBar title="Profile" back="#/profiles" />
        <Empty icon="user" title="Profile not found" />
      </main>
    );
  }
  const save = async (next: TravellerProfile) => {
    setP(next);
    await saveProfile(next);
    bump();
  };
  const setAdult = (patch: Partial<AdultPrefs>) => save({ ...p, adult: { ...(p.adult ?? defaultAdultPrefs(p.gender)), ...patch } });
  const setChild = (patch: Partial<ChildPrefs>) => save({ ...p, child: { ...(p.child ?? defaultChildPrefs(24)), ...patch } });
  const age = ageInMonths(p.birthDate, new Date());
  const usedIn = data.trips.filter((t) => t.travellerIds.includes(p.id) && t.status === 'planning');

  return (
    <main className="page">
      <TopBar title={p.name} sub={p.kind === 'child' ? `Child, ${describeAge(age)}` : 'Adult'} back="#/profiles" />
      <Notice>
        <p>Changes are saved as you go. Open a trip and choose “Save and update list” to apply them to an existing checklist.</p>
      </Notice>
      <TextInput label="Name" value={p.name} onChange={(v) => setP({ ...p, name: v })} onBlur={() => save({ ...p, name: p.name.trim() || 'Traveller' })} />
      <Segmented
        label="Gender"
        hint="Only used to suggest starting preferences below — every item can be switched on or off."
        value={p.gender}
        onChange={(v) => save({ ...p, gender: v })}
        options={[
          { value: 'female', label: 'Female' },
          { value: 'male', label: 'Male' },
          { value: 'unspecified', label: 'Not specified' },
        ]}
      />
      <TextInput
        label={p.kind === 'child' ? 'Birth date' : 'Birth date (optional)'}
        type="date"
        max={new Date().toISOString().slice(0, 10)}
        hint={p.kind === 'child' ? `Today: ${describeAge(age)}. Diapers, feeding, sunscreen and car-seat advice follow this age.` : undefined}
        value={p.birthDate ?? ''}
        onChange={(v) => save({ ...p, birthDate: v || undefined })}
      />

      {p.kind === 'adult' && p.adult && (
        <>
          <h2 style={{ fontSize: 'var(--fs-l)', margin: '24px 0 4px' }}>Packing preferences</h2>
          <Toggle label="Drives on trips" hint="Adds driving licence, secure footwear and sunglasses." checked={p.adult.isDriver} onChange={(v) => setAdult({ isDriver: v })} />
          <Toggle label="Takes regular medicines" hint="Adds a days-of-supply item. Doses are never suggested." checked={p.adult.takesRegularMedication} onChange={(v) => setAdult({ takesRegularMedication: v })} />
          <Toggle label="Wears glasses" checked={p.adult.wearsGlasses} onChange={(v) => setAdult({ wearsGlasses: v })} />
          <Toggle label="Wears contact lenses" checked={p.adult.wearsContactLenses} onChange={(v) => setAdult({ wearsContactLenses: v })} />
          <Toggle label="Shaving or grooming kit" checked={p.adult.shaves} onChange={(v) => setAdult({ shaves: v })} />
          <Toggle label="Skincare routine" checked={p.adult.skincareRoutine} onChange={(v) => setAdult({ skincareRoutine: v })} />
          <Toggle label="Makeup" checked={p.adult.makeup} onChange={(v) => setAdult({ makeup: v })} />
          <Toggle label="Menstrual products" checked={p.adult.menstrualProducts} onChange={(v) => setAdult({ menstrualProducts: v })} />
          <Toggle label="Hair dryer or styler" checked={p.adult.hairDryerOrStyler} onChange={(v) => setAdult({ hairDryerOrStyler: v })} />
          <Toggle label="Jewellery and accessories" checked={p.adult.jewelleryAndAccessories} onChange={(v) => setAdult({ jewelleryAndAccessories: v })} />
          <Toggle label="Smartwatch" checked={p.adult.smartwatch} onChange={(v) => setAdult({ smartwatch: v })} />
          <Toggle label="Laptop" checked={p.adult.laptop} onChange={(v) => setAdult({ laptop: v })} />
          <Toggle label="Gets car-sick" checked={p.adult.motionSickness} onChange={(v) => setAdult({ motionSickness: v })} />
          <Stepper label="Extra outfits per day" hint="For example 0.5 if you change for evenings." value={p.adult.extraOutfitsPerDay} min={0} max={2} step={0.5} onChange={(v) => setAdult({ extraOutfitsPerDay: v })} />
        </>
      )}

      {p.kind === 'child' && p.child && (
        <>
          <h2 style={{ fontSize: 'var(--fs-l)', margin: '24px 0 4px' }}>Care and feeding</h2>
          <Segmented
            label="Toileting"
            value={p.child.diaperStatus}
            onChange={(v) => setChild({ diaperStatus: v })}
            options={[
              { value: 'diapers', label: 'Diapers' },
              { value: 'night-only', label: 'Diapers at night' },
              { value: 'trained', label: 'Toilet trained' },
            ]}
          />
          <Toggle label="Breastfed" checked={p.child.breastfed} onChange={(v) => setChild({ breastfed: v })} />
          <Toggle label="Formula" checked={p.child.formula} onChange={(v) => setChild({ formula: v })} />
          <Toggle label="Drinks milk (cow / buffalo)" hint="Adds shelf-stable cartons for the drive and a cooler." checked={p.child.animalMilk} onChange={(v) => setChild({ animalMilk: v })} />
          <Toggle label="Eats solid food" checked={p.child.eatsSolids} onChange={(v) => setChild({ eatsSolids: v })} />
          <Toggle label="Takes regular medicines" checked={p.child.takesRegularMedication} onChange={(v) => setChild({ takesRegularMedication: v })} />
          <Toggle label="Gets car-sick" checked={p.child.motionSickness} onChange={(v) => setChild({ motionSickness: v })} />
          <TextInput label="Comfort item" placeholder="e.g. Bunny, blue blanket" value={p.child.comfortItem} onChange={(v) => setP({ ...p, child: { ...p.child!, comfortItem: v } })} onBlur={() => setChild({ comfortItem: p.child!.comfortItem })} />
          <h2 style={{ fontSize: 'var(--fs-l)', margin: '24px 0 4px' }}>Gear</h2>
          <Segmented
            label="Car seat"
            hint="Follow the seat’s labelled height and weight limits. Keep a young child rear-facing as long as the seat allows."
            value={p.child.carSeat}
            onChange={(v) => setChild({ carSeat: v })}
            options={[
              { value: 'rear-facing', label: 'Rear-facing' },
              { value: 'forward-facing', label: 'Forward-facing' },
              { value: 'booster', label: 'Booster' },
              { value: 'none', label: 'None' },
            ]}
          />
          {p.child.carSeat === 'none' && (age ?? 0) < 144 && (
            <Notice kind="safety">
              <p>Children are much safer in a car seat that fits their size. The checklist keeps a car seat as a safety item.</p>
            </Notice>
          )}
          <Toggle label="Uses a stroller" checked={p.child.usesStroller} onChange={(v) => setChild({ usesStroller: v })} />
          <Toggle label="Uses a carrier" checked={p.child.usesCarrier} onChange={(v) => setChild({ usesCarrier: v })} />
        </>
      )}

      <div className="section">
        <button className="btn btn--danger" onClick={() => setConfirm(true)}>
          <Icon name="trash" /> Remove {p.name}
        </button>
      </div>
      {confirm && (
        <Sheet title={`Remove ${p.name}?`} onClose={() => setConfirm(false)}>
          <p>
            {usedIn.length
              ? `${p.name} is on ${usedIn.length} planned trip${usedIn.length === 1 ? '' : 's'}. Their items stay on those lists until you rebuild them.`
              : 'This removes the profile from this device.'}
          </p>
          <div className="row-actions">
            <button className="btn" onClick={() => setConfirm(false)}>
              Keep
            </button>
            <button
              className="btn btn--danger"
              onClick={async () => {
                await deleteProfile(p.id);
                bump();
                showToast(`${p.name} removed.`);
                navigate('/profiles');
              }}
            >
              Remove
            </button>
          </div>
        </Sheet>
      )}
    </main>
  );
}
