'use client';

import Link from 'next/link';
import { PilotNotice } from '@/components/PilotNotice';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { PilotTerms } from '@/lib/api';
import {
  ApiError,
  del,
  getCatalog,
  getProvider,
  getProviderBookings,
  getProviderSlots,
  patch,
  post,
  type Booking,
  type Branch,
  type Catalog,
  type Offering,
  type Provider,
  type Slot,
} from '@/lib/api';
import {
  BRANCH_LABELS,
  formatMiles,
  formatRange,
  fromLocalInput,
  hasEnded,
  toLocalInput,
} from '@/lib/format';

/**
 * Keys this page used to persist a session in. Only read now, to clear anything
 * an earlier build left behind -- a veteran's phone and email have no business
 * outliving their session on a shared machine.
 */
const LEGACY_KEYS = ['vetnet.providerId', 'vetnet.providerProfile'];

/** Tomorrow at `hour`, as a datetime-local value. */
function tomorrowAt(hour: number): string {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(hour, 0, 0, 0);
  return toLocalInput(date);
}

export default function ServePage() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [providerId, setProviderId] = useState<string | null>(null);
  const [provider, setProvider] = useState<Provider | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [error, setError] = useState<ApiError | null>(null);
  const [pending, setPending] = useState(false);
  const [onboarding, setOnboarding] = useState(false);
  const [signupComplete, setSignupComplete] = useState(false);
  const [showLogin, setShowLogin] = useState(true);

  useEffect(() => {
    getCatalog().then(setCatalog).catch(setError);

    // A session lives in memory for exactly as long as the page does. Reloading
    // or reopening /serve asks for the phone number again, which is what you
    // want on the shared laptop this is likely to be demoed from.
    try {
      for (const key of LEGACY_KEYS) window.localStorage.removeItem(key);
    } catch {
      // Storage being unavailable is fine; there is nothing to clean up.
    }

    if (new URLSearchParams(window.location.search).get('new') === '1') {
      window.history.replaceState(null, '', '/serve');
      setShowLogin(false);
    }
  }, []);

  // Re-reads the profile too, so a reload still knows who is signed in and
  // which services this veteran may commit slots for.
  const refresh = useCallback(async (id: string) => {
    try {
      const [profile, slotList, bookingList] = await Promise.all([
        getProvider(id),
        getProviderSlots(id),
        getProviderBookings(id),
      ]);
      // The public projection omits email/phone/vehicle, so keep whatever the
      // login response already put in state rather than blanking those fields.
      setProvider((current) =>
        current && current.id === id ? { ...current, ...profile.provider } : profile.provider,
      );
      setSlots(slotList.slots);
      setBookings(bookingList.bookings);
    } catch (caught) {
      setError(caught as ApiError);
      // A stale id (the API restarted and forgot everyone) shouldn't strand
      // the page on an empty dashboard.
      if ((caught as ApiError).status === 404) signOut();
    }
  }, []);

  useEffect(() => {
    if (!providerId) return;
    void refresh(providerId);
  }, [providerId, refresh]);

  function onEnlisted(created: Provider) {
    setProvider(created);
    setProviderId(created.id);
    setOnboarding(true);
  }

  function onLoggedIn(loggedIn: Provider) {
    setProvider(loggedIn);
    setProviderId(loggedIn.id);
    setOnboarding(false);
  }

  function signOut() {
    setProviderId(null);
    setProvider(null);
    setSlots([]);
    setBookings([]);
    setError(null);
    setOnboarding(false);
    setSignupComplete(false);
    setShowLogin(true);
  }

  function finishSignup() {
    // The enrolment stays in the database; only this browser's session ends.
    signOut();
  }

  function onProfileSaved(updated: Provider) {
    setProvider(updated);
  }

  async function withdrawSlot(slotId: string) {
    if (!providerId) return;
    setPending(true);
    try {
      await del(`/api/v1/providers/${providerId}/slots/${slotId}`);
      await refresh(providerId);
    } catch (caught) {
      setError(caught as ApiError);
    } finally {
      setPending(false);
    }
  }

  async function updateBooking(bookingId: string, status: 'completed' | 'cancelled') {
    if (!providerId) return;
    setPending(true);
    try {
      await patch(`/api/v1/bookings/${bookingId}`, { status });
      await refresh(providerId);
    } catch (caught) {
      setError(caught as ApiError);
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <p className="eyebrow">For veterans</p>
      <h1>{providerId ? 'Your commitments' : showLogin ? 'Welcome back' : 'Put your hours on the board'}</h1>
      <p className="lede" style={{ marginTop: 14 }}>
        {providerId
          ? 'You are only matched inside the blocks you commit to. Withdraw a block any time before someone claims it.'
          : showLogin
            ? 'Use the phone number from your enrollment to check or withdraw your commitments.'
            : 'Tell us where you are and on what terms you drive. Then commit the blocks of time you can actually be there for.'}
      </p>

      {error ? (
        <div className="alert error" style={{ marginTop: 20 }}>
          <strong>{error.message}</strong>
          {error.details?.length ? (
            <ul>
              {error.details.map((detail) => (
                <li key={detail.field}>
                  <code>{detail.field}</code> — {detail.message}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <hr className="section-rule" />

      {!providerId ? (
        showLogin ? (
          <LoginForm
            onLoggedIn={onLoggedIn}
            onError={setError}
            onStartEnrollment={() => setShowLogin(false)}
          />
        ) : (
          <>
            <EnlistForm catalog={catalog} onEnlisted={onEnlisted} onError={setError} />
            <p className="small muted" style={{ marginTop: 14 }}>
              Already enrolled?{' '}
              <button type="button" className="ghost small" onClick={() => setShowLogin(true)}>
                Log in by phone
              </button>
            </p>
          </>
        )
      ) : (
        <div className="split">
          <div className="stack">
            <div className="card">
              <div className="match-head">
                <div>
                  <p className="eyebrow">Signed in as</p>
                  <h3>{provider?.name ?? 'this veteran'}</h3>
                  {provider?.servesFrom ? (
                    <p className="mono muted" style={{ margin: '4px 0 0' }}>
                      Matched from {provider.servesFrom}
                      {catalog?.distance
                        ? `, up to ${formatMiles(catalog.distance.serviceRadiusKm)} out`
                        : ''}
                    </p>
                  ) : (
                    <p className="mono muted" style={{ margin: '4px 0 0' }}>
                      {providerId.slice(0, 8)}…
                    </p>
                  )}
                  {provider?.vehicle ? (
                    <p className="mono muted" style={{ margin: '4px 0 0' }}>
                      {provider.vehicle.model} · {provider.vehicle.licensePlate}
                    </p>
                  ) : null}
                </div>
                {!onboarding ? (
                  <button type="button" className="ghost small" onClick={signOut}>
                    Log out
                  </button>
                ) : null}
              </div>
            </div>

            {!onboarding && provider && catalog?.pilotTerms &&
            provider.pilotConsent?.version !== catalog.pilotTerms.version ? (
              <PilotConsentPrompt
                provider={provider}
                terms={catalog.pilotTerms}
                onAccepted={onProfileSaved}
                onError={setError}
              />
            ) : null}

            {!onboarding && provider ? (
              <ProfileCard
                provider={provider}
                catalog={catalog}
                onSaved={onProfileSaved}
                onError={setError}
              />
            ) : null}

            {onboarding && signupComplete ? (
              <div className="card stack" role="status">
                <div>
                  <p className="eyebrow">You&apos;re on the board</p>
                  <h2>Signup complete</h2>
                  <p className="muted" style={{ marginBottom: 0 }}>
                    Your account and time block are saved. We&apos;ll only match you with a rider
                    during the hours you committed. Log back in with your phone whenever you want
                    to review or withdraw a commitment.
                  </p>
                </div>
                <div className="row" style={{ alignItems: 'center', gap: 12 }}>
                  <Link href="/" className="cta" onClick={finishSignup}>
                    Finish and log out
                  </Link>
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => setSignupComplete(false)}
                  >
                    Add another block
                  </button>
                </div>
              </div>
            ) : (
              <CommitSlotForm
                catalog={catalog}
                providerId={providerId}
                offerings={provider?.offerings ?? null}
                onCommitted={() => {
                  setSignupComplete(true);
                  void refresh(providerId);
                }}
                onError={setError}
              />
            )}
          </div>

          <div className="stack">
            <CommitmentBoard
              slots={slots}
              bookings={bookings}
              catalog={catalog}
              pending={pending}
              onWithdraw={(slotId) => void withdrawSlot(slotId)}
              onUpdateBooking={(bookingId, status) => void updateBooking(bookingId, status)}
            />
          </div>
        </div>
      )}
    </>
  );
}

function LoginForm({
  onLoggedIn,
  onError,
  onStartEnrollment,
}: {
  onLoggedIn: (provider: Provider) => void;
  onError: (error: ApiError) => void;
  onStartEnrollment: () => void;
}) {
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [codeRequested, setCodeRequested] = useState(false);
  const [pending, setPending] = useState(false);

  async function requestCode() {
    setPending(true);
    try {
      await post('/api/v1/auth/request-code', { phone });
      setCodeRequested(true);
    } catch (caught) { onError(caught as ApiError); } finally { setPending(false); }
  }

  async function verifyCode() {
    setPending(true);
    try {
      const { provider } = await post<{ provider: Provider }>('/api/v1/auth/verify-code', { phone, code });
      onLoggedIn(provider);
    } catch (caught) { onError(caught as ApiError); } finally { setPending(false); }
  }

  return (
    <div className="card stack" style={{ maxWidth: 560 }}>
      <label className="field">
        <span>Phone number</span>
        <input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="+1-619-555-0100" />
      </label>
      {codeRequested ? (
        <>
          <div className="alert ok">
            Local demo code: <strong className="mono">123456</strong>
          </div>
          <label className="field">
            <span>6-digit code</span>
            <input value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" />
          </label>
          <div><button type="button" disabled={pending || code.length !== 6} onClick={() => void verifyCode()}>{pending ? 'Checking…' : 'Log in'}</button></div>
        </>
      ) : (
        <div><button type="button" disabled={pending || phone.length < 7} onClick={() => void requestCode()}>{pending ? 'Sending…' : 'Text me a code'}</button></div>
      )}
      <p className="small muted" style={{ margin: 0 }}>
        Not enrolled yet? <button type="button" className="ghost small" onClick={onStartEnrollment}>Sign up to serve</button>
      </p>
    </div>
  );
}

/**
 * Shown to anyone enrolled before the pilot terms existed, or before the
 * current version. They stay matchable meanwhile -- this asks rather than locks
 * them out -- but the pilot should be able to show who has agreed to what.
 */
function PilotConsentPrompt({
  provider,
  terms,
  onAccepted,
  onError,
}: {
  provider: Provider;
  terms: PilotTerms;
  onAccepted: (updated: Provider) => void;
  onError: (error: ApiError) => void;
}) {
  const [pending, setPending] = useState(false);
  const [accepted, setAccepted] = useState(false);

  async function accept() {
    setPending(true);
    try {
      const { provider: updated } = await patch<{ provider: Provider }>(
        `/api/v1/providers/${provider.id}`,
        { pilotTermsVersion: terms.version },
      );
      onAccepted(updated);
    } catch (caught) {
      onError(caught as ApiError);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="card stack">
      <PilotNotice terms={terms} />
      <label className="field checkbox" style={{ alignItems: 'flex-start' }}>
        <input
          type="checkbox"
          checked={accepted}
          onChange={(e) => setAccepted(e.target.checked)}
          style={{ marginTop: 3 }}
        />
        <span>{terms.acknowledgement}</span>
      </label>
      <div>
        <button type="button" disabled={pending || !accepted} onClick={() => void accept()}>
          {pending ? 'Saving…' : 'I agree, keep me on the board'}
        </button>
      </div>
    </div>
  );
}

/**
 * Everything the sign-up form asked for, editable afterwards -- except the
 * phone number, which identifies the enrolment. Collapsed by default so the
 * dashboard leads with commitments rather than a wall of fields.
 */
function ProfileCard({
  provider,
  catalog,
  onSaved,
  onError,
}: {
  provider: Provider;
  catalog: Catalog | null;
  onSaved: (updated: Provider) => void;
  onError: (error: ApiError) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);

  const offering = provider.offerings[0];
  const [name, setName] = useState(provider.name);
  const [branch, setBranch] = useState<Branch>(provider.branch);
  const [yearsOfService, setYearsOfService] = useState(provider.yearsOfService);
  const [email, setEmail] = useState(provider.email ?? '');
  const [bio, setBio] = useState(provider.bio ?? '');
  const [zip, setZip] = useState(provider.servesFrom ?? '');
  const [model, setModel] = useState(provider.vehicle?.model ?? '');
  const [plate, setPlate] = useState(provider.vehicle?.licensePlate ?? '');
  const [rateType, setRateType] = useState<Offering['rateType']>(offering?.rateType ?? 'volunteer');
  const [hourlyRateUsd, setHourlyRateUsd] = useState(offering?.hourlyRateUsd ?? 0);

  /** Re-seed the form whenever a fresh record arrives, unless mid-edit. */
  useEffect(() => {
    if (editing) return;
    setName(provider.name);
    setBranch(provider.branch);
    setYearsOfService(provider.yearsOfService);
    setEmail(provider.email ?? '');
    setBio(provider.bio ?? '');
    setZip(provider.servesFrom ?? '');
    setModel(provider.vehicle?.model ?? '');
    setPlate(provider.vehicle?.licensePlate ?? '');
    setRateType(provider.offerings[0]?.rateType ?? 'volunteer');
    setHourlyRateUsd(provider.offerings[0]?.hourlyRateUsd ?? 0);
  }, [provider, editing]);

  async function save() {
    setPending(true);
    setSaved(false);
    try {
      const { provider: updated } = await patch<{ provider: Provider }>(
        `/api/v1/providers/${provider.id}`,
        {
          name,
          branch,
          yearsOfService,
          email,
          bio,
          zipCode: zip,
          vehicle: { model, licensePlate: plate },
          offerings: (provider.offerings.length ? provider.offerings : [{ serviceType: 'rides' }]).map(
            (existing) => ({
              ...existing,
              rateType,
              hourlyRateUsd: rateType === 'hourly' ? hourlyRateUsd : 0,
            }),
          ),
        },
      );
      onSaved(updated);
      setEditing(false);
      setSaved(true);
    } catch (caught) {
      onError(caught as ApiError);
    } finally {
      setPending(false);
    }
  }

  if (!editing) {
    return (
      <div className="card">
        <div className="match-head">
          <div>
            <p className="eyebrow">Your details</p>
            <p className="small muted" style={{ margin: 0 }}>
              {BRANCH_LABELS[provider.branch]} · {provider.yearsOfService} yrs · {provider.servesFrom}
              {provider.vehicle ? ` · ${provider.vehicle.model} (${provider.vehicle.licensePlate})` : ''}
            </p>
            {provider.pilotConsent ? (
              <p className="mono muted" style={{ margin: '4px 0 0' }}>
                Pilot terms {provider.pilotConsent.version} accepted{' '}
                {new Date(provider.pilotConsent.acceptedAt).toLocaleDateString()}
              </p>
            ) : null}
            {saved ? (
              <p className="small" style={{ margin: '6px 0 0', color: 'var(--olive)' }}>
                Saved.
              </p>
            ) : null}
          </div>
          <button type="button" className="ghost small" onClick={() => setEditing(true)}>
            Edit details
          </button>
        </div>
      </div>
    );
  }

  return (
    <form
      className="card stack"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <p className="eyebrow">Your details</p>

      <div className="row">
        <label className="field">
          <span>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} required minLength={2} />
        </label>
        <label className="field">
          <span>Branch</span>
          <select value={branch} onChange={(e) => setBranch(e.target.value as Branch)}>
            {(catalog?.branches ?? []).map((value) => (
              <option key={value} value={value}>
                {BRANCH_LABELS[value]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Years served</span>
          <input
            type="number"
            min={0}
            max={60}
            value={yearsOfService}
            onChange={(e) => setYearsOfService(Number(e.target.value))}
          />
        </label>
      </div>

      <div className="row">
        <label className="field">
          <span>Email</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label className="field">
          <span>Phone</span>
          <input value={provider.phone ?? ''} readOnly disabled />
        </label>
      </div>
      <p className="small muted" style={{ margin: '-4px 0 0' }}>
        Your phone number is how we recognise this enrolment, so it can&apos;t be changed here. To
        move to a new number you would need to sign up again — we&apos;ll add a proper transfer
        later so nobody has to rebuild their history.
      </p>

      <label className="field">
        <span>Short bio</span>
        <textarea value={bio} onChange={(e) => setBio(e.target.value)} />
      </label>

      <label className="field" style={{ maxWidth: 200 }}>
        <span>Your ZIP code</span>
        <input
          value={zip}
          onChange={(e) => setZip(e.target.value.replace(/\D/g, '').slice(0, 5))}
          inputMode="numeric"
          required
        />
      </label>

      <div className="row">
        <label className="field">
          <span>Car model</span>
          <input value={model} onChange={(e) => setModel(e.target.value)} required minLength={2} />
        </label>
        <label className="field">
          <span>License plate</span>
          <input
            value={plate}
            onChange={(e) => setPlate(e.target.value.toUpperCase())}
            required
            minLength={2}
            maxLength={16}
          />
        </label>
      </div>

      <div className="row">
        <label className="field" style={{ maxWidth: 170 }}>
          <span>Terms</span>
          <select
            value={rateType}
            onChange={(e) => setRateType(e.target.value as Offering['rateType'])}
          >
            <option value="volunteer">Volunteer</option>
            <option value="hourly">Paid hourly</option>
          </select>
        </label>
        {rateType === 'hourly' ? (
          <label className="field" style={{ maxWidth: 150 }}>
            <span>Your rate ($/hr)</span>
            <input
              type="number"
              min={0}
              max={500}
              value={hourlyRateUsd}
              onChange={(e) => setHourlyRateUsd(Number(e.target.value))}
            />
          </label>
        ) : null}
      </div>

      <div className="row" style={{ gap: 10 }}>
        <button type="submit" disabled={pending || zip.length !== 5}>
          {pending ? 'Saving…' : 'Save changes'}
        </button>
        <button type="button" className="ghost" disabled={pending} onClick={() => setEditing(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/**
 * Commitments, with the rides that landed on each one folded underneath.
 *
 * Blocks are never dropped from this list once they have history: a block that
 * has ended, or one the veteran withdrew after a ride was already assigned to
 * it, stays visible so the assignment history survives. Only an untouched
 * withdrawn block disappears, because there is nothing to remember about it.
 */
function CommitmentBoard({
  slots,
  bookings,
  catalog,
  pending,
  onWithdraw,
  onUpdateBooking,
}: {
  slots: Slot[];
  bookings: Booking[];
  catalog: Catalog | null;
  pending: boolean;
  onWithdraw: (slotId: string) => void;
  onUpdateBooking: (bookingId: string, status: 'completed' | 'cancelled') => void;
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const serviceLabel = (id: string) =>
    catalog?.serviceTypes.find((type) => type.id === id)?.label ?? id;

  const groups = useMemo(() => {
    const bySlot = new Map<string, Booking[]>();
    for (const booking of bookings) {
      const list = bySlot.get(booking.slotId);
      if (list) list.push(booking);
      else bySlot.set(booking.slotId, [booking]);
    }
    for (const list of bySlot.values()) list.sort((a, b) => a.startsAt.localeCompare(b.startsAt));

    const built = slots
      .map((slot) => {
        const rides = bySlot.get(slot.id) ?? [];
        bySlot.delete(slot.id);
        return { slot, rides };
      })
      // A withdrawn block with nothing assigned to it is just noise.
      .filter(({ slot, rides }) => slot.status !== 'cancelled' || rides.length > 0);

    // Any ride whose block we can't see still has to appear somewhere.
    const orphaned = [...bySlot.values()].flat();

    const upcoming = built
      .filter(({ slot }) => !hasEnded(slot.endsAt))
      .sort((a, b) => a.slot.startsAt.localeCompare(b.slot.startsAt));
    const past = built
      .filter(({ slot }) => hasEnded(slot.endsAt))
      .sort((a, b) => b.slot.startsAt.localeCompare(a.slot.startsAt));

    return { upcoming, past, orphaned };
  }, [slots, bookings]);

  // Open the blocks with someone actually waiting; the veteran needs that phone
  // number without hunting for it.
  const autoOpen = useMemo(
    () =>
      new Set(
        [...groups.upcoming, ...groups.past]
          .filter(({ rides }) => rides.some((ride) => ride.status === 'confirmed'))
          .map(({ slot }) => slot.id),
      ),
    [groups],
  );

  const isOpen = (slotId: string) => expanded[slotId] ?? autoOpen.has(slotId);
  const toggle = (slotId: string) =>
    setExpanded((current) => ({ ...current, [slotId]: !isOpen(slotId) }));

  function renderGroup({ slot, rides }: { slot: Slot; rides: Booking[] }) {
    const open = isOpen(slot.id);
    const ended = hasEnded(slot.endsAt);
    const live = rides.filter((ride) => ride.status === 'confirmed').length;
    const withdrawable = slot.status === 'open' && !ended;

    return (
      <li key={slot.id} className="block-group">
        <button
          type="button"
          className="block-head"
          aria-expanded={open}
          onClick={() => toggle(slot.id)}
        >
          <span className={`caret ${open ? 'open' : ''}`} aria-hidden="true" />
          <span className="block-when">
            <span>{formatRange(slot.startsAt, slot.endsAt)}</span>
            <span className="mono muted">
              {slot.serviceTypes.map(serviceLabel).join(' · ')}
              {slot.note ? ` · ${slot.note}` : ''}
            </span>
          </span>
          <span className="row" style={{ gap: 6, alignItems: 'center', flexWrap: 'nowrap' }}>
            {/* One count, not two: "to drive" already implies there are rides. */}
            {live > 0 ? (
              <span className="tag amber">{live} to drive</span>
            ) : (
              <span className="tag muted">
                {rides.length === 0
                  ? 'no rides'
                  : `${rides.length} ride${rides.length === 1 ? '' : 's'}`}
              </span>
            )}
            <span
              className={`tag ${
                slot.status === 'cancelled'
                  ? 'muted'
                  : ended
                    ? 'muted'
                    : slot.status === 'booked'
                      ? 'amber'
                      : 'olive'
              }`}
            >
              {slot.status === 'cancelled' ? 'withdrawn' : ended ? 'ended' : slot.status}
            </span>
          </span>
        </button>

        {open ? (
          <div className="block-body">
            {rides.length === 0 ? (
              <p className="small muted" style={{ margin: 0 }}>
                {slot.status === 'cancelled'
                  ? 'Withdrawn before anyone was matched to it.'
                  : ended
                    ? 'This block passed with nobody matched to it.'
                    : 'Nobody matched to this block yet.'}
              </p>
            ) : (
              <ul className="list-reset">
                {rides.map((ride) => (
                  <li key={ride.id} className="line-item">
                    <div>
                      <div>
                        <strong>{ride.requester.name}</strong> · {ride.serviceLabel}
                      </div>
                      <div className="mono muted">{formatRange(ride.startsAt, ride.endsAt)}</div>
                      <div className="small muted">
                        {ride.location.address ??
                          `${ride.location.lat.toFixed(3)}, ${ride.location.lng.toFixed(3)}`}
                        {ride.requester.phone ? ` · ${ride.requester.phone}` : ''}
                        {ride.notes ? ` · \u201c${ride.notes}\u201d` : ''}
                      </div>
                    </div>
                    <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                      <span className={`tag ${ride.status === 'confirmed' ? 'amber' : 'muted'}`}>
                        {ride.status}
                      </span>
                      {ride.status === 'confirmed' ? (
                        <>
                          <button
                            type="button"
                            className="small"
                            disabled={pending}
                            onClick={() => onUpdateBooking(ride.id, 'completed')}
                          >
                            Done
                          </button>
                          <button
                            type="button"
                            className="ghost danger small"
                            disabled={pending}
                            onClick={() => onUpdateBooking(ride.id, 'cancelled')}
                          >
                            Cancel
                          </button>
                        </>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {withdrawable ? (
              <div style={{ marginTop: 12 }}>
                <button
                  type="button"
                  className="ghost small"
                  disabled={pending}
                  onClick={() => onWithdraw(slot.id)}
                >
                  Withdraw this block
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </li>
    );
  }

  const nothingYet =
    groups.upcoming.length === 0 && groups.past.length === 0 && groups.orphaned.length === 0;

  return (
    <>
      <div className="card">
        <p className="eyebrow">Your commitments</p>
        {nothingYet ? (
          <p className="muted small" style={{ margin: 0 }}>
            Nothing committed yet. Nobody can be matched to you until you do.
          </p>
        ) : groups.upcoming.length === 0 ? (
          <p className="muted small" style={{ margin: 0 }}>
            No upcoming blocks. Commit one and riders can be matched to you again.
          </p>
        ) : (
          <ul className="list-reset">{groups.upcoming.map(renderGroup)}</ul>
        )}
      </div>

      {groups.past.length > 0 ? (
        <div className="card">
          <p className="eyebrow">Past blocks</p>
          <p className="small muted" style={{ margin: '0 0 8px' }}>
            Kept so you can look back at who you drove.
          </p>
          <ul className="list-reset">{groups.past.map(renderGroup)}</ul>
        </div>
      ) : null}

      {groups.orphaned.length > 0 ? (
        <div className="card">
          <p className="eyebrow">Rides without a block</p>
          <ul className="list-reset">
            {groups.orphaned.map((ride) => (
              <li key={ride.id} className="line-item">
                <div>
                  <div>
                    <strong>{ride.requester.name}</strong> · {ride.serviceLabel}
                  </div>
                  <div className="mono muted">{formatRange(ride.startsAt, ride.endsAt)}</div>
                </div>
                <span className="tag muted">{ride.status}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </>
  );
}

function EnlistForm({
  catalog,
  onEnlisted,
  onError,
}: {
  catalog: Catalog | null;
  onEnlisted: (provider: Provider) => void;
  onError: (error: ApiError) => void;
}) {
  const [name, setName] = useState('');
  const [branch, setBranch] = useState<Branch>('army');
  const [yearsOfService, setYearsOfService] = useState(4);
  const [bio, setBio] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [vehicleModel, setVehicleModel] = useState('');
  const [licensePlate, setLicensePlate] = useState('');
  const [zip, setZip] = useState('');
  const [rateType, setRateType] = useState<Offering['rateType']>('volunteer');
  const [hourlyRateUsd, setHourlyRateUsd] = useState(0);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [pending, setPending] = useState(false);

  // Driving is the whole MVP catalog, so there is nothing to pick — the offering
  // is derived rather than chosen. Reads from the catalog so a second service
  // later brings its own picker back rather than hardcoding an id here.
  const service = catalog?.serviceTypes[0] ?? null;
  const distance = catalog?.distance ?? null;
  const offerings: Offering[] = service
    ? [{ serviceType: service.id, rateType, hourlyRateUsd: rateType === 'hourly' ? hourlyRateUsd : 0 }]
    : [];

  async function submit() {
    setPending(true);
    try {
      const { provider } = await post<{ provider: Provider }>('/api/v1/providers', {
        name,
        branch,
        yearsOfService,
        bio,
        email,
        phone,
        vehicle: { model: vehicleModel, licensePlate },
        zipCode: zip,
        // The version actually rendered above, so the API can refuse a stale page.
        pilotTermsVersion: catalog?.pilotTerms.version,
        offerings,
      });
      onEnlisted(provider);
    } catch (caught) {
      onError(caught as ApiError);
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      className="card stack"
      style={{ maxWidth: 720 }}
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div className="row">
        <label className="field">
          <span>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} required minLength={2} />
        </label>
        <label className="field">
          <span>Branch</span>
          <select value={branch} onChange={(e) => setBranch(e.target.value as Branch)}>
            {(catalog?.branches ?? []).map((value) => (
              <option key={value} value={value}>
                {BRANCH_LABELS[value]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Years served</span>
          <input
            type="number"
            min={0}
            max={60}
            value={yearsOfService}
            onChange={(e) => setYearsOfService(Number(e.target.value))}
          />
        </label>
      </div>

      <div className="row">
        <label className="field">
          <span>Car model</span>
          <input
            value={vehicleModel}
            onChange={(e) => setVehicleModel(e.target.value)}
            required
            placeholder="2021 Toyota Sienna"
          />
        </label>
        <label className="field">
          <span>License plate</span>
          <input
            value={licensePlate}
            onChange={(e) => setLicensePlate(e.target.value.toUpperCase())}
            required
            maxLength={16}
            placeholder="8ABC123"
          />
        </label>
      </div>

      <div className="row">
        <label className="field">
          <span>Email</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label className="field">
          <span>Phone</span>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            required
            placeholder="+1-619-555-0100"
          />
        </label>
      </div>

      <label className="field">
        <span>Short bio</span>
        <textarea
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          placeholder="What you did in, and what you are good at now."
        />
      </label>

      <div>
        <label className="field" style={{ maxWidth: 200 }}>
          <span>Your ZIP code</span>
          <input
            value={zip}
            onChange={(e) => setZip(e.target.value.replace(/\D/g, '').slice(0, 5))}
            inputMode="numeric"
            pattern="\d{5}"
            placeholder="92101"
            required
          />
        </label>
        <p className="small muted" style={{ margin: '8px 0 0' }}>
          {distance
            ? `We match riders with whoever is nearest them. Spreading the work only ever picks
               between drivers within about ${formatMiles(distance.fairnessMaxExtraKm)} of each other,
               so it never sends you further — and you will only be offered rides within about
               ${formatMiles(distance.serviceRadiusKm)} of your ZIP. San Diego County and the Bay Area for now.`
            : 'We match you to rides near here — you don\u2019t need to work out a radius. San Diego County and the Bay Area for now.'}
        </p>
      </div>

      <div>
        <p className="eyebrow" style={{ marginBottom: 10 }}>
          How you want to drive
        </p>
        <div className="card" style={{ boxShadow: 'none', padding: 16 }}>
          <div>
            <div>
              <strong>{service?.label ?? 'Rides & transport'}</strong>
              <p className="small muted" style={{ margin: '2px 0 0' }}>
                {service?.description ?? 'Rides to VA appointments, the airport, job interviews.'}
              </p>
            </div>
          </div>

          <div className="row" style={{ gap: 10, marginTop: 14 }}>
            <label className="field" style={{ maxWidth: 170 }}>
              <span>Terms</span>
              <select
                value={rateType}
                onChange={(e) => setRateType(e.target.value as Offering['rateType'])}
              >
                <option value="volunteer">Volunteer</option>
                <option value="hourly">Paid hourly</option>
              </select>
            </label>
            {rateType === 'hourly' ? (
              <label className="field" style={{ maxWidth: 150 }}>
                <span>Your rate ($/hr)</span>
                <input
                  type="number"
                  min={0}
                  max={500}
                  value={hourlyRateUsd}
                  onChange={(e) => setHourlyRateUsd(Number(e.target.value))}
                />
              </label>
            ) : (
              <p className="small muted" style={{ alignSelf: 'center', margin: 0 }}>
                Riders are told up front that you drive for free.
              </p>
            )}
          </div>
        </div>
      </div>

      {catalog?.pilotTerms ? (
        <>
          <PilotNotice terms={catalog.pilotTerms} />
          <label className="field checkbox" style={{ alignItems: 'flex-start' }}>
            <input
              type="checkbox"
              checked={acceptedTerms}
              onChange={(e) => setAcceptedTerms(e.target.checked)}
              style={{ marginTop: 3 }}
            />
            <span>{catalog.pilotTerms.acknowledgement}</span>
          </label>
        </>
      ) : null}

      <div className="row" style={{ gap: 12, alignItems: 'center' }}>
        <button
          type="submit"
          disabled={pending || offerings.length === 0 || zip.length !== 5 || !acceptedTerms}
        >
          {pending ? 'Enlisting…' : 'Join the network'}
        </button>
        {!acceptedTerms ? (
          <span className="mono muted">accept the pilot terms to continue</span>
        ) : null}
      </div>
    </form>
  );
}

function CommitSlotForm({
  catalog,
  providerId,
  offerings,
  onCommitted,
  onError,
}: {
  catalog: Catalog | null;
  providerId: string;
  offerings: Offering[] | null;
  onCommitted: () => void;
  onError: (error: ApiError) => void;
}) {
  const [startsAt, setStartsAt] = useState(tomorrowAt(9));
  const [endsAt, setEndsAt] = useState(tomorrowAt(13));
  const [note, setNote] = useState('');
  const [pending, setPending] = useState(false);

  // Every block is a driving block in the MVP. Fall back to the catalog when the
  // profile isn't in memory yet — the API rejects anything the veteran hasn't
  // actually signed up to do.
  const serviceTypes = offerings
    ? offerings.map((offering) => offering.serviceType)
    : (catalog?.serviceTypes ?? []).map((type) => type.id);

  async function submit() {
    setPending(true);
    try {
      await post(`/api/v1/providers/${providerId}/slots`, {
        startsAt: fromLocalInput(startsAt),
        endsAt: fromLocalInput(endsAt),
        serviceTypes,
        ...(note ? { note } : {}),
      });
      setNote('');
      onCommitted();
    } catch (caught) {
      onError(caught as ApiError);
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      className="card stack"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <p className="eyebrow">Commit a block</p>
      <div className="row">
        <label className="field">
          <span>From</span>
          <input
            type="datetime-local"
            value={startsAt}
            onChange={(e) => setStartsAt(e.target.value)}
            required
          />
        </label>
        <label className="field">
          <span>Until</span>
          <input
            type="datetime-local"
            value={endsAt}
            onChange={(e) => setEndsAt(e.target.value)}
            required
          />
        </label>
      </div>

      <label className="field">
        <span>Note (optional)</span>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="I'll be near the VA that morning anyway"
        />
      </label>

      <div>
        <button type="submit" disabled={pending || serviceTypes.length === 0}>
          {pending ? 'Committing…' : 'Commit this block'}
        </button>
      </div>
    </form>
  );
}
