# VetNet

An on-demand ride network for the veteran community. Veteran drivers **commit availability
blocks**; a veteran rider makes **one API call** that checks exact ride coverage, ZIP proximity,
and fair workload distribution before booking one driver.

**MVP scope: driving only.** The catalog is a single service (`rides`), so the whole product
is "a veteran needs a ride, another veteran drives them". The `serviceType` field, its type
union and the per-slot service filter all survive — a second service is one entry in
`backend/src/domain/serviceCatalog.ts`, not a schema change.

This repo is the **supply side and the brain**:

- `backend/` — Express 5 + TypeScript API: the roster, the commitments, and the matching
  engine backed by SQLite locally and PostgreSQL in production
- `frontend/` — Next.js 16 App Router site for **onboarding veteran drivers**: sign up, commit
  blocks, manage the rides that land on them

The **demand side is a separate app** — a minimal one-button client. It doesn't need its own
matching, roster, or scheduling logic: it posts a single request here and gets back a
confirmed veteran. [The one endpoint it calls](#the-one-endpoint-the-request-app-calls) is the
whole integration surface.

## Run it

```bash
npm run install:all   # installs backend + frontend deps
cp backend/.env.example backend/.env
npm run dev           # API on :4000, web on :3000
```

Local development uses SQLite automatically. Veteran signups persist in
`backend/.data/vetnet.sqlite`, so there is no database service to start and `npm run dev` is
the only startup command. Demo veterans are inserted only when the database is empty.

Starting the API never touches the local database, so a veteran you sign up survives file
saves and restarts. Reseeding is an explicit command:

```bash
npm run db:reset     # wipe SQLite and lay the demo roster back down
npm run dev:fresh    # the same, then start both servers
```

It is a one-shot command rather than a startup flag on purpose: `tsx watch` reloads the app on
every file save, so a reset that ran at boot would quietly wipe the database each time you
edited a file — taking any veteran you had signed up mid-session with it.

For Vercel, provision Neon and set `DATABASE_URL` to its PostgreSQL connection string. The API
then switches to PostgreSQL and creates the same schema automatically on startup. The Docker
Compose setup remains available for developers who want a local PostgreSQL instance.

### Vercel + Neon checklist

1. In the Vercel backend project, open **Storage**, install **Neon**, and connect the database
   to both Preview and Production. Use the pooled connection string (its hostname contains
   `-pooler`); the Marketplace integration normally supplies this as `DATABASE_URL`.
2. Set `SEED_DEMO_DATA=0` in Production. This is already the Vercel default in code; set it
   explicitly if you want the dashboard to document the choice. A hackathon Preview can use
   `SEED_DEMO_DATA=1` to load the five demo drivers into an empty database.
3. Set `CORS_ORIGINS` to the deployed frontend URL and set the frontend project’s
   `NEXT_PUBLIC_API_URL` to the deployed backend URL.
4. Redeploy the backend after connecting Neon, then request `/health`. A correct deployment
   returns `{ "status": "ok", "database": "postgres" }`. Vercel deliberately refuses to
   start without a persistent database instead of silently writing to temporary SQLite.

The PostgreSQL schema and unique normalized-phone constraint are applied idempotently during
backend cold start, so a brand-new Neon database requires no separate local `psql` command.

Or one at a time: `npm run dev:api` / `npm run dev:web`.

The API seeds five demo drivers in San Diego with committed slots on every boot, so
matching works the moment the API is up — open http://localhost:3000 for the veteran site, or
fire the request-app call below with curl.

Config: copy `backend/.env.example` → `backend/.env` and `frontend/.env.local.example` →
`frontend/.env.local` if you need to change ports or origins.

```bash
npm test                        # matching-engine and route tests
npm run build                   # tsc for the API, next build for the web app
```

## The one endpoint the request app calls

### Realtime ride request

The rider frontend should use `POST /api/v1/ride-requests`. It does not send a pickup time:
the API uses the instant it receives the request and only considers drivers whose open committed
block contains that instant and the full estimated ride duration.

```http
POST /api/v1/ride-requests
Content-Type: application/json
Idempotency-Key: <uuid>        # strongly recommended for retries
```

| Field | Required | Contract |
| --- | --- | --- |
| `rider.name` | yes | 2–80 characters |
| `rider.veteran` | yes | Must be `true` for the MVP |
| `rider.phone` / `rider.email` | one required | Contact information for the assigned driver |
| `currentAddress.address` | yes | 3–200 characters |
| `currentAddress.zipCode` | yes | Supported San Diego or Bay Area pickup ZIP; used for matching |
| `destinationAddress.address` | yes | 3–200 characters; persisted on the booking |
| `destinationAddress.zipCode` | yes | Five-digit ZIP; persisted on the booking |
| `durationMinutes` | no | Integer 15–600; defaults to 60 |
| `maxDistanceKm` | no | Number 1–200; defaults to 40 |
| `notes` | no | Up to 500 characters |

```json
{
  "rider": { "name": "Alice Nguyen", "veteran": true, "phone": "+1-619-555-0999" },
  "currentAddress": { "address": "100 Broadway, San Diego", "zipCode": "92101" },
  "destinationAddress": { "address": "3350 La Jolla Village Dr", "zipCode": "92161" },
  "durationMinutes": 60,
  "maxDistanceKm": 40,
  "notes": "VA appointment"
}
```

On a confirmed match the API returns `201` and includes the rider-facing driver identity.
The full response also contains `requestId`, `booking`, the scored `match`, alternatives, and
matching diagnostics; the stable client-facing assignment is the top-level `veteran` object.

```json
{
  "status": "matched",
  "veteran": {
    "name": "Marcus Hale",
    "carModel": "2021 Toyota Sienna",
    "licensePlate": "7VET142",
    "zipCode": "92101"
  },
  "booking": {
    "status": "confirmed",
    "startsAt": "2026-08-29T23:45:00.000Z",
    "endsAt": "2026-08-30T00:45:00.000Z",
    "destination": {
      "address": "3350 La Jolla Village Dr",
      "zipCode": "92161"
    }
  }
}
```

If nobody is committed right now, it returns `200`, `status: "no_match"`, and `veteran: null`.
Send an `Idempotency-Key` header to make client retries return the original booking rather than
claiming another driver.

| HTTP status | Meaning |
| --- | --- |
| `201` | Driver matched and booking confirmed |
| `200` | No current match, or an idempotent replay of an earlier result |
| `400` | Invalid body, unsupported pickup ZIP, or invalid duration/distance |
| `409` | Availability changed during the atomic booking claim; retry with a new request key |
| `500` | Unexpected server/database failure |

Errors use the shared envelope `{ "error": { "code", "message", "details"? } }`.

### Scheduled/general service request

The entire demand side is a single call. The request app holds no roster, no availability and
no ranking logic — it posts what someone needs and gets back a confirmed veteran, so a
one-button client stays a one-button client.

```http
POST /api/v1/service-requests
Content-Type: application/json
Idempotency-Key: <uuid>        # optional; a replay returns the original result
```

```jsonc
{
  "serviceType": "rides",                              // required
  "pickupZip": "92101",                               // required demo ZIP
  "location": { "lat": 32.7157, "lng": -117.1611, "address": "Downtown San Diego" }, // optional display detail
  "requester": { "name": "Alice Nguyen", "veteran": true, "phone": "+1-619-555-0999" },
  "window": { "startsAt": "...", "endsAt": "..." },    // startsAt is the exact pickup time
  "durationMinutes": 90,                               // default: per service type
  "maxDistanceKm": 40,
  "preferences": {
    "volunteerOnly": false,
    "branch": "marines",
    "minRating": 4,
    "maxHourlyRateUsd": 50,
    "providerId": "…"                                  // ask for one specific veteran
  },
  "autoBook": true,                                    // false → shortlist only, nothing held
  "notes": "VA appointment at La Jolla"
}
```

**201** when a booking is made, **200** for a shortlist or a no-match:

```jsonc
{
  "requestId": "…",
  "status": "matched",              // or "no_match", with a `message` explaining what to relax
  "booking": { "id": "…", "startsAt": "…", "provider": { "phone": "…", "email": "…" } },
  "match": { "provider": {…}, "score": 91, "scoreBreakdown": {…}, "distanceKm": 0.3 },
  "alternatives": [ … ],
  "diagnostics": { "providersConsidered": 5, "matchedProviders": 2, "rejections": {…} }
}
```

`diagnostics.rejections` counts why each veteran dropped out — `outside_search_radius`,
`ride_exceeds_slot`, `overlapping_booking`, and so on. That is what makes "nobody is
available" actionable instead of a dead end.

### How the ranking works

Hard filters run first: active and verified, offers rides, has an **open committed slot** that
fully contains pickup through ride end, is inside both distance limits, and has no overlapping
confirmed booking. Availability can never be traded for a better score. The veteran sign-up page
reads `distance` from `GET /api/v1/catalog` (the default service radius and
`FAIRNESS_MAX_EXTRA_KM`) rather than hardcoding numbers, so the promise made at sign-up and the
matcher's behaviour can't drift apart. ZIP codes are mapped to
a small local centroid table and measured with Haversine distance; exact coordinates remain only
as a compatibility fallback.

Eligible drivers are scored 0–100 on three explainable components:

| Component | Weight | What it rewards |
| --- | --- | --- |
| `proximity` | 0.65 | Closer ZIP centroid to pickup |
| `workloadFairness` | 0.25 | Fewer confirmed/completed rides assigned in the trailing 7 days |
| `reliability` | 0.10 | Rating, with unrated drivers treated as 4.5 |

Fairness may reorder only drivers within 3.2 km (about two miles) of the closest eligible driver.
Drivers outside that competition set remain alternatives but cannot win purely because they have
less work. Ties resolve by score, distance, workload, rating, earliest valid slot, then driver ID.

## The rest of the API

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Liveness |
| `GET` | `/api/v1/catalog` | Service types, branches, match weights — so neither client hardcodes enums |
| `POST` | `/api/v1/providers` | A veteran joins the network (includes vehicle model/plate; give a `zipCode`) |
| `GET` | `/api/v1/providers?serviceType=rides` | Public roster (no contact details) |
| `GET` | `/api/v1/providers/:id` | Profile + open slots |
| `PATCH` | `/api/v1/providers/:id` | Update bio, radius, offerings, pause with `active: false` |
| `POST` | `/api/v1/providers/:id/slots` | **Commit** a block of time |
| `GET` | `/api/v1/providers/:id/slots?status=open` | Their commitments |
| `DELETE` | `/api/v1/providers/:id/slots/:slotId` | Withdraw an unbooked commitment |
| `GET` | `/api/v1/providers/:id/bookings` | Who is counting on them |
| `GET` | `/api/v1/service-requests/:id` | What happened to an earlier request |
| `GET` | `/api/v1/bookings/:id` | One booking |
| `PATCH` | `/api/v1/bookings/:id` | `completed` (grows their record) or `cancelled` (releases the slot) |

Errors are always `{ "error": { "code", "message", "details?" } }`; validation failures list
the offending fields.

### Try it from the shell — this is what the request app sends

```bash
curl -s localhost:4000/api/v1/service-requests -H 'Content-Type: application/json' -d '{
  "serviceType": "rides",
  "pickupZip": "92101",
  "location": { "lat": 32.7157, "lng": -117.1611 },
  "requester": { "name": "Alice", "veteran": true, "phone": "+1-619-555-0999" },
  "durationMinutes": 90
}' | jq '{status, who: .match.provider.name, score: .match.score, when: .booking.startsAt}'
```

## Design decisions worth knowing

**A slot is a promise, not a preference.** One slot yields at most one booking, and it can't
overlap another commitment. That is what lets the API answer with a name instead of "we'll try
to find someone" — and it's why booking consumes the whole block rather than splitting it.

**Contact details are withheld until a booking exists.** A search returns names, branch,
rating and bio; phone and email only travel with a confirmed booking, so the roster can't be
scraped by anyone who can POST a search. Vehicle model and license plate follow the same rule:
they are returned to the rider with the confirmed booking, never in the public roster or shortlist.

**Data access lives in `backend/src/data/store.ts`.** With `DATABASE_URL` configured it uses
PostgreSQL; without it, local development uses SQLite. Tests use an isolated in-memory store.

**The matcher is a pure function.** `findMatches(criteria, context)` does no I/O, which is why
the ranking rules are covered by fast unit tests.

## Pilot terms and consent

The deployed site is a **pilot**, and says so. `backend/src/domain/pilotTerms.ts` holds the
disclosures in one place, served from `GET /api/v1/catalog` and rendered by
`frontend/components/PilotNotice.tsx` — so the wording a veteran reads is the wording the API
records against them, and it cannot drift.

The notice states plainly that this is **not a VA service**, that we run **no identity, service,
background or driving-record checks**, that **no insurance is provided**, that there is **no
CCPA/CPRA program** yet (with a list of exactly what is stored and what a matched rider is
shown), that it is meant for people who already know each other, and that anyone can leave and
have their record deleted.

**Consent is enforced, not decorative.** Sign-up requires `pilotTermsVersion`, and the API
refuses a version it no longer serves, so nobody is enrolled against wording they were never
shown. What is accepted is stored on the enrolment as `pilotConsent { version, acceptedAt }`.
Anyone enrolled before a version existed is asked to accept it next time they log in — asked,
not locked out, since the point is to know who agreed to what.

**Bump `PILOT_TERMS_VERSION` whenever the wording changes materially.** Existing veterans are
then re-prompted, and stale pages are refused rather than silently accepted.

This covers the veteran side only. The separate rider app needs its own equivalent before real
riders use it — the disclosures about insurance and identity apply just as much to whoever is
getting in the car.

## API auth

Two layers, matching the two questions that actually matter: **which application
is calling**, and **which person is acting**.

### Layer 1 — the caller (`API_SERVICE_TOKENS`)

Comma-separated tokens presented as `Authorization: Bearer <token>`, guarding the
demand side — `POST /api/v1/ride-requests` and `POST /api/v1/service-requests`,
where an anonymous caller could otherwise book real veterans' committed hours.
**Empty means the check is off**, which is the local and test default.

It guards the demand side only, on purpose. The veteran site runs in a browser,
where any token shipped to the client is public — a service token there would be
security theatre. The rider app runs server-side and can hold a secret.

### Layer 2 — the person (session tokens)

`POST /api/v1/auth/verify-code` and `POST /api/v1/providers` now return
`session: { token, expiresAt }`. That token is required for every write a veteran
owns, and must belong to *that* veteran:

| | |
|---|---|
| `PATCH /providers/:id` | edit your own profile |
| `POST /providers/:id/slots` | commit your own hours |
| `DELETE /providers/:id/slots/:slotId` | withdraw your own block |
| `PATCH /bookings/:id` | end a ride assigned to you |

Provider ids are listable from the public roster, so without this anyone could
edit another veteran's profile, withdraw their blocks, or cancel their rides.
This layer is **always on** — there is no environment where that should be
allowed. Tokens are stored hashed, expire after `SESSION_TTL_HOURS`, and are held
in memory by the client only, so a session ends with the page.

Public on purpose: `/health`, `/api/v1/catalog`, the roster, `request-code`,
`verify-code`, and enrolling (a new veteran has no session yet).

### Sessions and codes in Postgres

The `sessions` and `login_challenges` tables are in `POSTGRES_SCHEMA` as
`CREATE TABLE IF NOT EXISTS`, and `initializeStore()` runs at module load — the
same path Vercel takes — so **Neon creates them on the first cold start after a
deploy.** No migration step.

**Postgres has no row TTL**, and neither does SQLite. `expiresAt` is enforced in
application code when a row is read, which means a session abandoned after it
lapsed, or a code that was never submitted, would otherwise sit in the table for
good. `store.purgeExpired()` deletes both, and runs on `request-code` — the entry
point to every login — so growth is bounded by the login rate rather than by
nothing.

If this ever runs at a scale where that sweep is not free, the fix is an index on
the expiry rather than a cron: `CREATE INDEX ON sessions (((data->>'expiresAt')::timestamptz))`.

### Known limitation: the mocked OTP undercuts layer 2

While `SMS_PROVIDER=mock`, a session can be obtained by anyone who knows an
enrolled phone number and the fixed `MOCK_OTP_CODE` — and in mock mode
`verify-code` accepts it without a prior `request-code`, so the cooldown and
attempt limit do not apply either. Layer 2 authorises correctly, but session
*issuance* is forgeable, so on the deployed pilot it should be read as a
speed bump rather than a control.

This is accepted knowingly for the pilot: the group is small and already knows
each other, and the alternatives all need dashboard access that isn't available
yet. It stops being acceptable the moment someone outside that group is expected
to sign in. The fix is a real SMS provider — see **Phone login (OTP)** — and
`request-code` becoming mandatory rather than optional.

Enrolling is unauthenticated for the same reason: an invite code or a
platform-level password lock both need Vercel dashboard access.

### Where the VA flow plugs in

Both layers are seams, not stopgaps in the wrong place. Layer 1 becomes per-app
registration. Layer 2 keeps its shape and only changes where the identity comes
from — a VA-verified identity instead of a phone code — because everything
downstream just asks whose session this is.

Two gaps this does **not** close, and should be named rather than assumed:

- **Enrolling is unauthenticated.** Anyone can add themselves to the roster;
  the pilot terms and manual verification are what stand behind it for now.
- **A ride request is not tied to a rider.** The service token proves *which app*
  asked, not *which person*. Binding a booking to an authenticated rider needs a
  login in the rider app, which is where VA verification does the most work.

## Phone login (OTP)

Veterans sign in with a code texted to the phone number they enrolled with.

`SMS_PROVIDER` picks how that code is delivered:

| | |
|---|---|
| `mock` (default) | Prints the code to the log and always uses `MOCK_OTP_CODE` (`123456`). No account, no cost, no phone needed — what local development and the tests use. |
| `twilio` | Sends a real text via Twilio Programmable SMS. Needs `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` and `TWILIO_FROM_NUMBER`. |

**We own the code lifecycle, not the SMS provider.** The code is generated here,
stored hashed (HMAC keyed to the phone, so one leaked row can't be replayed
against another number), expires after `OTP_TTL_MINUTES`, dies after
`OTP_MAX_ATTEMPTS` wrong guesses, and is single-use. `OTP_RESEND_COOLDOWN_SECONDS`
stops a double-tap re-texting and stops anyone running up an SMS bill. Challenges
live in the database, not process memory, because the instance that sends a code
on Vercel is rarely the one that checks it.

`request-code` answers identically whether or not the number is enrolled, so it
can't be used to probe who is on the network.

Message wording lives in `backend/src/sms/messages.ts`, separate from delivery,
so rider-facing texts can be added beside the driver-facing ones later.

### Turning on real texts

```bash
SMS_PROVIDER=twilio
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
TWILIO_FROM_NUMBER=+16195550142
OTP_HASH_SECRET=<something long and random>
```

No new dependency is involved — Twilio's Messages API is a form POST with basic
auth, sent with `fetch`. Two things to expect before a public demo: a **trial
account can only text numbers you have verified** in the Twilio console, and US
long-code traffic to consumers needs **A2P 10DLC registration**, which takes
days and is not something to discover on demo morning.

## Demo mode

`DEMO_SLOT_RELEASE_MINUTES` defaults to **5**, in every environment including the hosted one,
because the hosted deployment is what gets demoed. Five minutes after a ride is booked it is
treated as finished: the booking is completed, the driver's completed-jobs count goes up, and
the availability block returns to them.

The effect is that a demo can fire the same request over and over and keep getting a real
match, instead of exhausting the roster after one booking each.

**The locking itself is untouched.** A booking still claims its block atomically via
`claimOpenSlot`, and a driver already booked at that hour is still excluded by the
overlapping-booking check. While a ride is live it is genuinely held — two riders can't be
promised the same veteran. The block simply comes back when the simulated ride is over, which
is the same end state a driver produces by marking the job done.

The sweep runs lazily on request (matching, and the veteran's own slot/booking views) rather
than on a timer, because the API runs as serverless functions where a `setTimeout` does not
outlive the response that scheduled it.

Set `DEMO_SLOT_RELEASE_MINUTES=0` to switch the simulation off, so blocks stay held until
someone actually completes or cancels the ride. The API logs which mode it is in at start-up.

## Known gaps before this is real

These are deliberate bootstrap cuts, roughly in the order they should be closed:

1. **Login is a fixed code in production.** `SMS_PROVIDER=mock` means a session can be had
   by anyone who knows an enrolled number, which undercuts the session layer above it. Closing
   it needs a real SMS provider. Accepted for the pilot; not beyond it.
2. **A ride request is not tied to a rider.** The service token proves which app asked, not
   which person. Binding a booking to an authenticated rider needs a login in the rider app,
   which is where VA verification does the most work.
3. **Demo rides auto-complete.** `DEMO_SLOT_RELEASE_MINUTES=5` is the default everywhere, so a
   booking is marked completed five minutes on whether or not the ride happened, and the
   driver's completed-jobs count rises with it. Locking is honest, but the ride history is
   not. Set it to 0 before real riders use this — see **Demo mode** above.
4. **Verification is a config flag.** `AUTO_VERIFY_PROVIDERS=1` marks sign-ups verified so the
   demo works end to end. Real deployments must gate on DD-214 / ID.me before matching anyone,
   and background checks matter for in-home work.
5. **ZIP centroids instead of geocoding.** `backend/src/domain/zipGeo.ts` holds centroids for
   San Diego County and core Bay Area ZIPs, including Hacker Dojo (`94043`). Unknown ZIPs return a clean validation error; no
   external geocoder is called. Precision is ZIP-level by design — a centroid is about as exact
   as a veteran's home address should be to the matcher. Serving a second county means adding
   rows, and a real geocoder means reimplementing `getZipCoordinates` and nothing else.
6. **No notifications.** A booked veteran finds out by opening `/serve`. Needs SMS/email, and
   it matters more now that the requester and the veteran are in different apps.
7. **No payments.** Paid offerings produce an estimate only; money is settled off-platform.
8. **Booking is not fully transactional.** PostgreSQL atomically claims a slot, but the slot
   claim, request creation and booking creation should become one transaction before scaling.
9. **No ratings flow.** `rating` exists on a provider and feeds the match score, but nothing
   collects it after a completed job yet.
