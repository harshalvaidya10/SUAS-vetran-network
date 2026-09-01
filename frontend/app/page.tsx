import Link from 'next/link';
import { getCatalog, getProviders, type Catalog, type Provider, type ServiceType } from '@/lib/api';
import { PilotNotice } from '@/components/PilotNotice';
import { BRANCH_LABELS, formatMiles } from '@/lib/format';

export const dynamic = 'force-dynamic';

async function loadNetwork(): Promise<{
  serviceTypes: ServiceType[];
  providers: Provider[];
  distance: Catalog['distance'] | null;
  pilotTerms: Catalog['pilotTerms'] | null;
  offline: boolean;
}> {
  try {
    const [catalog, roster] = await Promise.all([getCatalog(), getProviders()]);
    return {
      serviceTypes: catalog.serviceTypes,
      providers: roster.providers,
      distance: catalog.distance,
      pilotTerms: catalog.pilotTerms,
      offline: false,
    };
  } catch {
    return { serviceTypes: [], providers: [], distance: null, pilotTerms: null, offline: true };
  }
}

export default async function HomePage() {
  const { serviceTypes, providers, distance, pilotTerms, offline } = await loadNetwork();
  const committedHours = providers.length;

  return (
    <>
      {pilotTerms ? (
        <div style={{ marginTop: 24 }}>
          <PilotNotice terms={pilotTerms} compact />
        </div>
      ) : null}

      <section className="hero">
        <p className="eyebrow">For veterans who still have hours to give</p>
        <h1>
          Put your hours on the board.
          <br />
          We&apos;ll bring you the work.
        </h1>
        <p className="lede" style={{ marginTop: 16 }}>
          Somewhere nearby a veteran needs a ride — to the VA, to a job interview, to the airport at
          five in the morning. They tap one button. We find whoever committed to that hour, close
          enough to get there — and that is where you come in.
        </p>

        <div className="row" style={{ marginTop: 30, alignItems: 'center', gap: 18 }}>
          <Link href="/serve?new=1" className="cta">
            Sign up to serve →
          </Link>
          <span className="mono muted">
            {committedHours > 0 ? `${committedHours} veterans already on the board` : 'Be the first on the board'}
          </span>
        </div>
      </section>

      {offline ? (
        <>
          <hr className="section-rule" />
          <div className="alert error">
            The API isn&apos;t responding. Start it with <code>npm run dev:api</code> from the repo
            root, then reload.
          </div>
        </>
      ) : (
        <>
          <hr className="section-rule" />
          <p className="eyebrow">What you are agreeing to</p>
          <ol className="steps">
            <li>
              <strong>Say what you can do.</strong>
              <p className="muted small">
                Your branch, your years, the work you are good at, how far you will travel, and
                whether you are volunteering or charging for it.
              </p>
            </li>
            <li>
              <strong>Commit blocks of time.</strong>
              <p className="muted small">
                A block is a promise, not a preference. Nothing reaches you outside the hours you put
                on the board.
              </p>
            </li>
            <li>
              <strong>Requests route to you.</strong>
              <p className="muted small">
                One block, one job. The rider goes to whoever is nearest them. Spreading the work
                only ever picks between drivers within about{' '}
                {distance ? formatMiles(distance.fairnessMaxExtraKm) : '2 miles'} of each other, so
                nobody is sent further just to even out the load.
              </p>
            </li>
            <li>
              <strong>You get their details.</strong>
              <p className="muted small">
                Name, number, where to go, and what they need. Mark it done when it is done. Withdraw
                a block any time before someone claims it.
              </p>
            </li>
          </ol>

          <hr className="section-rule" />
          <p className="eyebrow">What people ask for</p>
          <div className="roster" style={{ marginTop: 16 }}>
            {[
              ['VA appointments', 'The most common trip by far. Often an early start and a long wait.'],
              ['Job interviews', 'Someone getting back on their feet, and one ride is what stands in the way.'],
              ['Airport runs', 'A family arriving, a deployment ending, a funeral to get to.'],
              ['Court and county offices', 'Benefits hearings, custody dates, the DMV. Places you cannot be late to.'],
            ].map(([title, detail]) => (
              <article key={title} className="card">
                <h3>{title}</h3>
                <p className="small muted" style={{ marginBottom: 0 }}>
                  {detail}
                </p>
              </article>
            ))}
          </div>
          <p className="mono muted" style={{ marginTop: 16 }}>
            {serviceTypes[0]
              ? `Typical trip: ${serviceTypes[0].defaultDurationMinutes} minutes. Pickups stay within about ${
                  distance ? formatMiles(distance.serviceRadiusKm) : '16 miles'
                } of your ZIP.`
              : 'Pickups stay close to your ZIP.'}
          </p>

          {providers.length > 0 ? (
            <>
              <hr className="section-rule" />
              <div className="match-head" style={{ marginBottom: 18 }}>
                <div>
                  <p className="eyebrow">Who is already on</p>
                  <h2>{providers.length} veterans taking work in our demo service areas</h2>
                </div>
                <Link href="/serve?new=1" className="mono">
                  Add your name →
                </Link>
              </div>

              <div className="roster">
                {providers.slice(0, 6).map((provider) => (
                  <article key={provider.id} className="card">
                    <div className="match-head">
                      <h3>{provider.name}</h3>
                      <span className="tag olive">
                        {provider.rating ? `${provider.rating.toFixed(1)}★` : 'New'}
                      </span>
                    </div>
                    <p className="mono muted" style={{ margin: '4px 0 10px' }}>
                      {BRANCH_LABELS[provider.branch]} · {provider.yearsOfService} yrs ·{' '}
                      {provider.servesFrom ?? 'location private'}
                    </p>
                    <p className="small muted">{provider.bio}</p>
                    <div className="row" style={{ gap: 6, marginTop: 12 }}>
                      {provider.offerings.map((offering) => (
                        <span
                          key={offering.serviceType}
                          className={`tag ${offering.rateType === 'volunteer' ? 'olive' : ''}`}
                        >
                          {offering.rateType === 'volunteer'
                            ? 'Volunteer'
                            : `$${offering.hourlyRateUsd}/hr`}
                        </span>
                      ))}
                    </div>
                  </article>
                ))}
              </div>
            </>
          ) : null}
        </>
      )}
    </>
  );
}
