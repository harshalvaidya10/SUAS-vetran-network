'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { CandidateCard } from '@/components/CandidateCard';
import { LocationPicker, PRESETS, type LocationValue } from '@/components/LocationPicker';
import {
  ApiError,
  getCatalog,
  patch,
  post,
  type Branch,
  type Catalog,
  type MatchResponse,
} from '@/lib/api';
import { BRANCH_LABELS, formatRange, fromLocalInput, toLocalInput } from '@/lib/format';

const REJECTION_LABELS: Record<string, string> = {
  inactive_or_unverified: 'not verified or paused',
  service_not_offered: "don't offer this service",
  rating_below_minimum: 'rated below your minimum',
  branch_mismatch: 'different branch',
  rate_too_high: 'above your rate limit',
  out_of_range: 'too far away',
  no_overlapping_slot: 'no committed slot in your window',
};

export default function RequestPage() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [serviceType, setServiceType] = useState('rides');
  const [location, setLocation] = useState<LocationValue>({ ...PRESETS[0]! });
  const [windowStart, setWindowStart] = useState('');
  const [windowEnd, setWindowEnd] = useState('');
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [maxDistanceKm, setMaxDistanceKm] = useState(40);
  const [volunteerOnly, setVolunteerOnly] = useState(false);
  const [branch, setBranch] = useState<Branch | ''>('');
  const [autoBook, setAutoBook] = useState(true);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [notes, setNotes] = useState('');

  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<MatchResponse | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  // A fresh key per edited form, so a double-click can't produce two bookings.
  const idempotencyKey = useRef<string>('');
  const newKey = () => {
    idempotencyKey.current = crypto.randomUUID();
  };

  useEffect(() => {
    newKey();
    const now = new Date();
    setWindowStart(toLocalInput(now));
    setWindowEnd(toLocalInput(new Date(now.getTime() + 7 * 24 * 3600 * 1000)));
    getCatalog().then(setCatalog).catch(setError);
  }, []);

  const selected = useMemo(
    () => catalog?.serviceTypes.find((s) => s.id === serviceType),
    [catalog, serviceType],
  );

  function onServiceTypeChange(next: string) {
    setServiceType(next);
    const type = catalog?.serviceTypes.find((s) => s.id === next);
    if (type) setDurationMinutes(type.defaultDurationMinutes);
    newKey();
  }

  async function submit(providerId?: string) {
    setPending(true);
    setError(null);
    try {
      const response = await post<MatchResponse>(
        '/api/v1/service-requests',
        {
          serviceType,
          location: { lat: location.lat, lng: location.lng, address: location.address || undefined },
          requester: {
            name,
            ...(phone ? { phone } : {}),
            ...(email ? { email } : {}),
          },
          window: { startsAt: fromLocalInput(windowStart), endsAt: fromLocalInput(windowEnd) },
          durationMinutes,
          maxDistanceKm,
          preferences: {
            ...(volunteerOnly ? { volunteerOnly: true } : {}),
            ...(branch ? { branch } : {}),
            ...(providerId ? { providerId } : {}),
          },
          autoBook: providerId ? true : autoBook,
          ...(notes ? { notes } : {}),
        },
        { 'Idempotency-Key': providerId ? crypto.randomUUID() : idempotencyKey.current },
      );
      setResult(response);
      if (response.booking) newKey();
    } catch (caught) {
      setError(caught as ApiError);
      setResult(null);
    } finally {
      setPending(false);
    }
  }

  async function cancelBooking(bookingId: string) {
    setPending(true);
    try {
      await patch(`/api/v1/bookings/${bookingId}`, { status: 'cancelled' });
      setResult(null);
      newKey();
    } catch (caught) {
      setError(caught as ApiError);
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <p className="eyebrow">Request help</p>
      <h1>What do you need, and when are you free?</h1>
      <p className="lede" style={{ marginTop: 14 }}>
        One request searches every veteran on the network against the hours they have actually
        committed to.{' '}
        {autoBook ? 'The best match is booked on the spot.' : 'You pick from the shortlist.'}
      </p>

      <hr className="section-rule" />

      <div className="split">
        <form
          className="card stack"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <label className="field">
            <span>What do you need?</span>
            <select value={serviceType} onChange={(e) => onServiceTypeChange(e.target.value)}>
              {(catalog?.serviceTypes ?? []).map((type) => (
                <option key={type.id} value={type.id}>
                  {type.label}
                </option>
              ))}
            </select>
          </label>
          {selected ? <p className="small muted">{selected.description}</p> : null}

          <LocationPicker
            label="Where"
            value={location}
            onChange={(next) => {
              setLocation(next);
              newKey();
            }}
          />

          <div className="row">
            <label className="field">
              <span>Free from</span>
              <input
                type="datetime-local"
                value={windowStart}
                onChange={(e) => {
                  setWindowStart(e.target.value);
                  newKey();
                }}
                required
              />
            </label>
            <label className="field">
              <span>Until</span>
              <input
                type="datetime-local"
                value={windowEnd}
                onChange={(e) => {
                  setWindowEnd(e.target.value);
                  newKey();
                }}
                required
              />
            </label>
          </div>

          <div className="row">
            <label className="field">
              <span>Minutes needed</span>
              <input
                type="number"
                min={15}
                max={600}
                step={15}
                value={durationMinutes}
                onChange={(e) => {
                  setDurationMinutes(Number(e.target.value));
                  newKey();
                }}
              />
            </label>
            <label className="field">
              <span>Within (km)</span>
              <input
                type="number"
                min={1}
                max={200}
                value={maxDistanceKm}
                onChange={(e) => {
                  setMaxDistanceKm(Number(e.target.value));
                  newKey();
                }}
              />
            </label>
            <label className="field">
              <span>Branch preference</span>
              <select
                value={branch}
                onChange={(e) => {
                  setBranch(e.target.value as Branch | '');
                  newKey();
                }}
              >
                <option value="">No preference</option>
                {(catalog?.branches ?? []).map((value) => (
                  <option key={value} value={value}>
                    {BRANCH_LABELS[value]}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="row">
            <label className="field checkbox">
              <input
                type="checkbox"
                checked={volunteerOnly}
                onChange={(e) => {
                  setVolunteerOnly(e.target.checked);
                  newKey();
                }}
              />
              <span>Volunteer help only</span>
            </label>
            <label className="field checkbox">
              <input
                type="checkbox"
                checked={autoBook}
                onChange={(e) => setAutoBook(e.target.checked)}
              />
              <span>Book the best match for me</span>
            </label>
          </div>

          <hr className="section-rule" style={{ margin: '6px 0' }} />

          <div className="row">
            <label className="field">
              <span>Your name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} required minLength={2} />
            </label>
            <label className="field">
              <span>Phone</span>
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+1-619-555-0100"
              />
            </label>
            <label className="field">
              <span>Email</span>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
          </div>

          <label className="field">
            <span>Anything they should know</span>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>

          <div>
            <button type="submit" disabled={pending}>
              {pending ? 'Searching…' : autoBook ? 'Find and book' : 'Show me matches'}
            </button>
          </div>
        </form>

        <div className="stack">
          {error ? (
            <div className="alert error">
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

          {!result && !error ? (
            <div className="card">
              <p className="eyebrow">Nothing requested yet</p>
              <p className="muted small" style={{ margin: 0 }}>
                Matches are ranked on six things: how close the veteran is, how they are rated, how
                soon they can start, how recently they have been booked, their track record, and how
                well the job fits the block of time they committed. The winning score is broken out
                here so you can see why they came up first.
              </p>
            </div>
          ) : null}

          {result?.status === 'no_match' ? (
            <div className="card">
              <p className="eyebrow">No match</p>
              <div className="alert">{result.message}</div>
              {result.diagnostics ? (
                <>
                  <p className="mono muted" style={{ marginTop: 16 }}>
                    {result.diagnostics.providersConsidered} veterans considered
                  </p>
                  <ul className="list-reset small">
                    {Object.entries(result.diagnostics.rejections)
                      .filter(([, count]) => count > 0)
                      .map(([reason, count]) => (
                        <li key={reason} className="line-item">
                          <span className="muted">{REJECTION_LABELS[reason] ?? reason}</span>
                          <span className="mono">{count}</span>
                        </li>
                      ))}
                  </ul>
                </>
              ) : null}
            </div>
          ) : null}

          {result?.booking && result.match ? (
            <>
              <div className="alert ok">
                <strong>Booked.</strong> {result.booking.provider?.name} is confirmed for{' '}
                {formatRange(result.booking.startsAt, result.booking.endsAt)}. Reach them at{' '}
                {result.booking.provider?.phone ?? result.booking.provider?.email}.
              </div>
              <CandidateCard
                candidate={{
                  ...result.match,
                  provider: result.booking.provider ?? result.match.provider,
                }}
                showBreakdown
                action={
                  <button
                    type="button"
                    className="ghost danger small"
                    disabled={pending}
                    onClick={() => void cancelBooking(result.booking!.id)}
                  >
                    Cancel booking
                  </button>
                }
              />
            </>
          ) : null}

          {result?.status === 'matched' && !result.booking && result.match ? (
            <>
              <p className="eyebrow">Best match</p>
              <CandidateCard
                candidate={result.match}
                showBreakdown
                action={
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => void submit(result.match!.provider.id)}
                  >
                    Book {result.match.provider.name.split(' ')[0]}
                  </button>
                }
              />
            </>
          ) : null}

          {result?.alternatives?.length ? (
            <>
              <p className="eyebrow" style={{ marginTop: 8 }}>
                Also available
              </p>
              {result.alternatives.map((candidate) => (
                <CandidateCard
                  key={candidate.provider.id}
                  candidate={candidate}
                  action={
                    <button
                      type="button"
                      className="ghost small"
                      disabled={pending}
                      onClick={() => void submit(candidate.provider.id)}
                    >
                      Book {candidate.provider.name.split(' ')[0]} instead
                    </button>
                  }
                />
              ))}
            </>
          ) : null}
        </div>
      </div>
    </>
  );
}
