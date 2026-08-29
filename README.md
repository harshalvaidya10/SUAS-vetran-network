# VetNet

An on-demand service network for the veteran community. Veterans sign up and **commit to
blocks of time**; a request arrives as **one API call** that searches the roster, intersects it
with committed availability, ranks the matches and books the best one.

**MVP scope: driving only.** The catalog is a single service (`rides`), so the whole product
is "a veteran needs a ride, another veteran drives them". The `serviceType` field, its type
union and the per-slot service filter all survive — a second service is one entry in
`backend/src/domain/serviceCatalog.ts`, not a schema change.

This repo is the **supply side and the brain**:

- `backend/` — Express 5 + TypeScript API: the roster, the commitments, and the matching
  engine (in-memory store, no database yet)
- `frontend/` — Next.js 16 App Router site for **onboarding veteran drivers**: sign up, commit
  blocks, manage the rides that land on them

The **demand side is a separate app** — a minimal one-button client. It doesn't need its own
matching, roster, or scheduling logic: it posts a single request here and gets back a
confirmed veteran. [The one endpoint it calls](#the-one-endpoint-the-request-app-calls) is the
whole integration surface.

## Run it

```bash
npm run install:all   # installs backend + frontend deps
npm run dev           # API on :4000, web on :3000
```

Or one at a time: `npm run dev:api` / `npm run dev:web`.

The API seeds five demo drivers in San Diego with committed slots on every boot, so
matching works the moment the API is up — open http://localhost:3000 for the veteran site, or
fire the request-app call below with curl.

Config: copy `backend/.env.example` → `backend/.env` and `frontend/.env.local.example` →
`frontend/.env.local` if you need to change ports or origins.

```bash
npm test                        # matching-engine unit tests (10)
npm run build                   # tsc for the API, next build for the web app
```

## The one endpoint the request app calls

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
  "location": { "lat": 32.7157, "lng": -117.1611, "address": "Downtown San Diego" },
  "requester": { "name": "Alice Nguyen", "phone": "+1-619-555-0999" },  // email or phone
  "window": { "startsAt": "...", "endsAt": "..." },    // default: now → +7 days
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

`diagnostics.rejections` counts why each veteran dropped out — `out_of_range`,
`no_overlapping_slot`, `service_not_offered`, and so on. That is what makes "nobody is
available" actionable instead of a dead end.

### How the ranking works

Hard filters first: verified and active, offers the service, inside both the requester's
distance cap and the veteran's own travel radius, and holding an **open committed slot** long
enough for the job inside the requested window. Survivors are scored 0–100 on six weighted
components (`src/domain/matching.ts`, returned in `scoreBreakdown` so the UI can show its work):

| Component | Weight | What it rewards |
| --- | --- | --- |
| `proximity` | 0.30 | Closer to the requester |
| `rating` | 0.20 | Community rating (unrated veterans are treated as 4.5) |
| `promptness` | 0.15 | Can start sooner in the window |
| `workloadBalance` | 0.15 | Hasn't been booked much in the last 7 days |
| `reliability` | 0.10 | Completed-job track record |
| `slotFit` | 0.10 | Job fills the block, so long slots stay free for long jobs |

`workloadBalance` is deliberate: a community network that always routes to the same three
people burns them out. Change the weights in one place and every match moves with them.

## The rest of the API

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Liveness |
| `GET` | `/api/v1/catalog` | Service types, branches, match weights — so neither client hardcodes enums |
| `POST` | `/api/v1/providers` | A veteran joins the network |
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
  "location": { "lat": 32.7157, "lng": -117.1611 },
  "requester": { "name": "Alice", "phone": "+1-619-555-0999" },
  "durationMinutes": 90
}' | jq '{status, who: .match.provider.name, score: .match.score, when: .booking.startsAt}'
```

## Design decisions worth knowing

**A slot is a promise, not a preference.** One slot yields at most one booking, and it can't
overlap another commitment. That is what lets the API answer with a name instead of "we'll try
to find someone" — and it's why booking consumes the whole block rather than splitting it.

**Contact details are withheld until a booking exists.** A search returns names, branch,
rating and bio; phone and email only travel with a confirmed booking, so the roster can't be
scraped by anyone who can POST a search.

**Data lives in `backend/src/data/store.ts` and nowhere else.** Everything goes through that
one object, so moving to Postgres means reimplementing that file (and making the methods
async), not touching the routes.

**The matcher is a pure function.** `findMatches(criteria, context)` does no I/O, which is why
the ranking rules are covered by fast unit tests.

## Known gaps before this is real

These are deliberate bootstrap cuts, roughly in the order they should be closed:

1. **The match endpoint is unauthenticated.** Now that the demand side is a separate app,
   `POST /api/v1/service-requests` is a public door into the roster: any caller can book real
   veterans' committed hours, and repeated calls can map out who is available where. The first
   thing to add is a shared secret the request app sends (`Authorization: Bearer …`), checked in
   one middleware.
2. **No veteran auth either.** Anyone who knows a provider id can edit that profile or cancel
   its bookings. The veteran identity is kept in `localStorage`. Needs real accounts + sessions.
3. **No persistence.** Restarting the API wipes everyone. In-memory only.
4. **Verification is a config flag.** `AUTO_VERIFY_PROVIDERS=1` marks sign-ups verified so the
   demo works end to end. Real deployments must gate on DD-214 / ID.me before matching anyone,
   and background checks matter for in-home work.
5. **No geocoding.** The veteran site offers preset San Diego coordinates plus manual lat/lng.
   Swapping in a geocoder touches only `frontend/components/LocationPicker.tsx`. The request
   app will need its own answer for this — device location is the obvious one.
6. **No notifications.** A booked veteran finds out by opening `/serve`. Needs SMS/email, and
   it matters more now that the requester and the veteran are in different apps.
7. **No payments.** Paid offerings produce an estimate only; money is settled off-platform.
8. **Single-process concurrency.** Double-booking is prevented by a slot re-check plus an
   `Idempotency-Key`, which holds for one process but not for a horizontally scaled API. A real
   deployment needs a transactional claim on the slot row.
9. **No ratings flow.** `rating` exists on a provider and feeds the match score, but nothing
   collects it after a completed job yet.
