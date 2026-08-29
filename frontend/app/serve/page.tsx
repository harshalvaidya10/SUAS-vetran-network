'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
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
import { BRANCH_LABELS, formatMiles, formatRange, fromLocalInput, toLocalInput } from '@/lib/format';

const STORAGE_KEY = 'vetnet.providerId';

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
    const startNewSignup = new URLSearchParams(window.location.search).get('new') === '1';
    if (startNewSignup) {
      // This forgets only which veteran this browser is viewing. The previous
      // veteran remains persisted in SQLite/Postgres and visible in the roster.
      window.localStorage.removeItem(STORAGE_KEY);
      window.history.replaceState(null, '', '/serve');
      setProviderId(null);
      setShowLogin(false);
    } else {
      setProviderId(window.localStorage.getItem(STORAGE_KEY));
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
      setProvider(profile.provider);
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
    window.localStorage.setItem(STORAGE_KEY, created.id);
    setProvider(created);
    setProviderId(created.id);
    setOnboarding(true);
  }

  function onLoggedIn(loggedIn: Provider) {
    window.localStorage.setItem(STORAGE_KEY, loggedIn.id);
    setProvider(loggedIn);
    setProviderId(loggedIn.id);
    setOnboarding(false);
  }

  function signOut() {
    window.localStorage.removeItem(STORAGE_KEY);
    setProviderId(null);
    setProvider(null);
    setSlots([]);
    setBookings([]);
    setOnboarding(false);
    setSignupComplete(false);
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
                </div>
                <button type="button" className="ghost small" onClick={signOut}>
                  Switch account
                </button>
              </div>
            </div>

            {onboarding && signupComplete ? (
              <div className="card stack" role="status">
                <div>
                  <p className="eyebrow">You&apos;re on the board</p>
                  <h2>Signup complete</h2>
                  <p className="muted" style={{ marginBottom: 0 }}>
                    Your profile and time block are saved. We&apos;ll only match you with a rider
                    during the hours you committed.
                  </p>
                </div>
                <div className="row" style={{ alignItems: 'center', gap: 12 }}>
                  <Link href="/" className="cta">
                    Done
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
            <div className="card">
              <p className="eyebrow">Committed slots</p>
              {slots.length === 0 ? (
                <p className="muted small" style={{ margin: 0 }}>
                  Nothing committed yet. Nobody can be matched to you until you do.
                </p>
              ) : (
                <ul className="list-reset">
                  {slots.map((slot) => (
                    <li key={slot.id} className="line-item">
                      <div>
                        <div>{formatRange(slot.startsAt, slot.endsAt)}</div>
                        <div className="mono muted">
                          {slot.serviceTypes
                            .map(
                              (id) =>
                                catalog?.serviceTypes.find((type) => type.id === id)?.label ?? id,
                            )
                            .join(' · ')}
                        </div>
                        {slot.note ? <div className="small muted">{slot.note}</div> : null}
                      </div>
                      <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                        <span
                          className={`tag ${
                            slot.status === 'open'
                              ? 'olive'
                              : slot.status === 'booked'
                                ? 'amber'
                                : 'muted'
                          }`}
                        >
                          {slot.status}
                        </span>
                        {slot.status === 'open' ? (
                          <button
                            type="button"
                            className="ghost small"
                            disabled={pending}
                            onClick={() => void withdrawSlot(slot.id)}
                          >
                            Withdraw
                          </button>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="card">
              <p className="eyebrow">People counting on you</p>
              {bookings.length === 0 ? (
                <p className="muted small" style={{ margin: 0 }}>
                  No bookings yet.
                </p>
              ) : (
                <ul className="list-reset">
                  {bookings.map((booking) => (
                    <li key={booking.id} className="line-item">
                      <div>
                        <div>
                          <strong>{booking.requester.name}</strong> · {booking.serviceLabel}
                        </div>
                        <div className="mono muted">
                          {formatRange(booking.startsAt, booking.endsAt)}
                        </div>
                        <div className="small muted">
                          {booking.location.address ??
                            `${booking.location.lat.toFixed(3)}, ${booking.location.lng.toFixed(3)}`}
                          {booking.requester.phone ? ` · ${booking.requester.phone}` : ''}
                          {booking.notes ? ` · “${booking.notes}”` : ''}
                        </div>
                      </div>
                      <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                        <span
                          className={`tag ${booking.status === 'confirmed' ? 'amber' : 'muted'}`}
                        >
                          {booking.status}
                        </span>
                        {booking.status === 'confirmed' ? (
                          <>
                            <button
                              type="button"
                              className="small"
                              disabled={pending}
                              onClick={() => void updateBooking(booking.id, 'completed')}
                            >
                              Done
                            </button>
                            <button
                              type="button"
                              className="ghost danger small"
                              disabled={pending}
                              onClick={() => void updateBooking(booking.id, 'cancelled')}
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
            </div>
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
  const [zip, setZip] = useState('');
  const [rateType, setRateType] = useState<Offering['rateType']>('volunteer');
  const [hourlyRateUsd, setHourlyRateUsd] = useState(0);
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
        zipCode: zip,
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
               ${formatMiles(distance.serviceRadiusKm)} of your ZIP. San Diego County for now.`
            : 'We match you to rides near here — you don\u2019t need to work out a radius. San Diego County for now.'}
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

      <div>
        <button type="submit" disabled={pending || offerings.length === 0 || zip.length !== 5}>
          {pending ? 'Enlisting…' : 'Join the network'}
        </button>
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
