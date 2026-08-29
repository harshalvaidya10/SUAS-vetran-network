# VetNet

An on-demand ride network for the veteran community. Veteran drivers **commit availability
blocks**; a veteran rider makes **one API call** that checks exact ride coverage, ZIP proximity,
and fair workload distribution before booking one driver.

- `backend/` — Express 5 + TypeScript API (in-memory store, no database yet)
- `frontend/` — Next.js 16 App Router client (requester flow + veteran flow)

## Run it

```bash
npm run install:all   # installs backend + frontend deps
npm run dev           # API on :4000, web on :3000
```

Or one at a time: `npm run dev:api` / `npm run dev:web`.

The API seeds five demo veterans in San Diego with committed slots on every boot, so the
match flow works the moment you open http://localhost:3000/request.

Config: copy `backend/.env.example` → `backend/.env` and `frontend/.env.local.example` →
`frontend/.env.local` if you need to change ports or origins.

```bash
npm test                        # matching-engine and route tests
npm run build                   # tsc for the API, next build for the web app
```

## The one endpoint the client needs

Everything on the requester side is a single call. There is no search-then-book handshake to
orchestrate in the client.

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
confirmed booking. Availability can never be traded for a better score. ZIP codes are mapped to
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
| `GET` | `/api/v1/catalog` | Service types, branches, match weights — so the client hardcodes no enums |
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

### Try it from the shell

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

1. **No auth.** Anyone who knows a provider id can edit that profile or cancel its bookings.
   The veteran identity is kept in `localStorage` on the client. Needs real accounts + sessions.
2. **No persistence.** Restarting the API wipes everyone. In-memory only.
3. **Verification is a config flag.** `AUTO_VERIFY_PROVIDERS=1` marks sign-ups verified so the
   demo works end to end. Real deployments must gate on DD-214 / ID.me before matching anyone,
   and background checks matter for in-home work.
4. **Demo-only ZIP geography.** `backend/src/domain/zipGeo.ts` contains a small San Diego ZIP
   centroid table. Unknown ZIPs return a clean validation error; no external geocoder is called.
5. **No notifications.** A booked veteran finds out by opening `/serve`. Needs SMS/email.
6. **No payments.** Paid offerings produce an estimate only; money is settled off-platform.
7. **Single-process concurrency.** Double-booking is prevented by a slot re-check plus an
   `Idempotency-Key`, which holds for one process but not for a horizontally scaled API. A real
   deployment needs a transactional claim on the slot row.
8. **No ratings flow.** `rating` exists on a provider and feeds the match score, but nothing
   collects it after a completed job yet.
