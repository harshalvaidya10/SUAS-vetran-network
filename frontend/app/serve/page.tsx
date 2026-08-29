'use client';

import { useCallback, useEffect, useState } from 'react';
import { LocationPicker, PRESETS, type LocationValue } from '@/components/LocationPicker';
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
import { BRANCH_LABELS, formatRange, fromLocalInput, toLocalInput } from '@/lib/format';

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

  useEffect(() => {
    getCatalog().then(setCatalog).catch(setError);
    setProviderId(window.localStorage.getItem(STORAGE_KEY));
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
  }

  function signOut() {
    window.localStorage.removeItem(STORAGE_KEY);
    setProviderId(null);
    setProvider(null);
    setSlots([]);
    setBookings([]);
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
      <h1>{providerId ? 'Your commitments' : 'Put your hours on the board'}</h1>
      <p className="lede" style={{ marginTop: 14 }}>
        {providerId
          ? 'You are only matched inside the blocks you commit to. Withdraw a block any time before someone claims it.'
          : 'Tell us how far you will drive and on what terms. Then commit the blocks of time you can actually be there for.'}
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
        <EnlistForm catalog={catalog} onEnlisted={onEnlisted} onError={setError} />
      ) : (
        <div className="split">
          <div className="stack">
            <div className="card">
              <div className="match-head">
                <div>
                  <p className="eyebrow">Signed in as</p>
                  <h3>{provider?.name ?? 'this veteran'}</h3>
                  <p className="mono muted" style={{ margin: '4px 0 0' }}>
                    {providerId.slice(0, 8)}…
                  </p>
                </div>
                <button type="button" className="ghost small" onClick={signOut}>
                  Switch account
                </button>
              </div>
            </div>

            <CommitSlotForm
              catalog={catalog}
              providerId={providerId}
              offerings={provider?.offerings ?? null}
              onCommitted={() => void refresh(providerId)}
              onError={setError}
            />
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
  const [base, setBase] = useState<LocationValue>({ ...PRESETS[0]! });
  const [zipCode, setZipCode] = useState('92101');
  const [serviceRadiusKm, setServiceRadiusKm] = useState(30);
  const [rateType, setRateType] = useState<Offering['rateType']>('volunteer');
  const [hourlyRateUsd, setHourlyRateUsd] = useState(0);
  const [pending, setPending] = useState(false);

  // Driving is the whole MVP catalog, so there is nothing to pick — the offering
  // is derived rather than chosen. Reads from the catalog so a second service
  // later brings its own picker back rather than hardcoding an id here.
  const service = catalog?.serviceTypes[0] ?? null;
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
        base: { lat: base.lat, lng: base.lng, address: base.address || undefined },
        zipCode,
        serviceRadiusKm,
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

      <LocationPicker label="Where you start from" value={base} onChange={setBase} />

      <label className="field" style={{ maxWidth: 220 }}>
        <span>Home ZIP (used for matching)</span>
        <input
          inputMode="numeric"
          pattern="[0-9]{5}"
          value={zipCode}
          onChange={(event) => setZipCode(event.target.value)}
          required
        />
      </label>

      <label className="field" style={{ maxWidth: 220 }}>
        <span>Willing to travel (km)</span>
        <input
          type="number"
          min={1}
          max={200}
          value={serviceRadiusKm}
          onChange={(e) => setServiceRadiusKm(Number(e.target.value))}
        />
      </label>

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
        <button type="submit" disabled={pending || offerings.length === 0}>
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
