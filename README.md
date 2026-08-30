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

For a repeatable hackathon demo, set `RESET_DATABASE_ON_START=1` in `backend/.env`. Every API
restart then clears local SQLite and reloads the demo roster. This flag is deliberately ignored
on Vercel so it cannot erase Neon data. Set it back to `0` when testing persistence.

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

## Demo mode

`DEMO_REUSABLE_SLOTS` defaults to **on, in every environment including the hosted
deployment**, because the hosted deployment is what gets demoed. With it on:

- a booking does **not** consume the veteran's availability block, and
- a driver already booked at that hour can still be matched.

So the same request can be fired over and over and keep returning a real driver, instead of
exhausting the roster after one booking each. `diagnostics.rejections` stops filling with
`no_open_slot` after the first ride.

The cost is real: the API will double-book an actual person, and two riders can be promised
the same veteran at the same time. Set `DEMO_REUSABLE_SLOTS=0` the moment this stops being a
demo — that restores the atomic `claimOpenSlot` and the overlapping-booking check, both of
which are covered by tests either way. The API warns on start-up which mode it is in.

## Known gaps before this is real

These are deliberate bootstrap cuts, roughly in the order they should be closed:

1. **The match endpoint is unauthenticated.** Now that the demand side is a separate app,
   `POST /api/v1/service-requests` is a public door into the roster: any caller can book real
   veterans' committed hours, and repeated calls can map out who is available where. The first
   thing to add is a shared secret the request app sends (`Authorization: Bearer …`), checked in
   one middleware.
2. **No veteran auth either.** Anyone who knows a provider id can edit that profile or cancel
   its bookings. The veteran identity is kept in `localStorage`. Needs real accounts + sessions.
3. **Demo mode double-books.** `DEMO_REUSABLE_SLOTS=1` is the default in every environment,
   including the hosted one. Bookings do not consume availability and a driver can be promised
   to two riders at once. Turn it off before real riders use this — see **Demo mode** above.
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
