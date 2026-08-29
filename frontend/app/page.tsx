import Link from 'next/link';
import { getCatalog, getProviders, type Provider, type ServiceType } from '@/lib/api';
import { BRANCH_LABELS } from '@/lib/format';

export const dynamic = 'force-dynamic';

async function loadNetwork(): Promise<{
  serviceTypes: ServiceType[];
  providers: Provider[];
  offline: boolean;
}> {
  try {
    const [catalog, roster] = await Promise.all([getCatalog(), getProviders()]);
    return { serviceTypes: catalog.serviceTypes, providers: roster.providers, offline: false };
  } catch {
    return { serviceTypes: [], providers: [], offline: true };
  }
}

export default async function HomePage() {
  const { serviceTypes, providers, offline } = await loadNetwork();
  const volunteers = providers.filter((p) =>
    p.offerings.some((o) => o.rateType === 'volunteer'),
  ).length;

  return (
    <>
      <section className="hero">
        <p className="eyebrow">A network that runs on people who already volunteered once</p>
        <h1>
          Veterans commit to the hours they have.
          <br />
          We find the one who can be there.
        </h1>
        <p className="lede" style={{ marginTop: 16 }}>
          Ask for a ride, a hand moving, a look at the furnace, or someone to sit with. One request
          searches the whole roster — who does that work, who is nearby, and who actually put the
          time on their calendar — and comes back with a confirmed name.
        </p>

        <div className="paths">
          <Link href="/request" className="path">
            <p className="eyebrow">For anyone who needs a hand</p>
            <h2>Request help</h2>
            <p className="muted small">
              Say what you need, where, and when you are free. You get a matched veteran and their
              number, not a queue ticket.
            </p>
            <span className="go">Find a match →</span>
          </Link>

          <Link href="/serve" className="path">
            <p className="eyebrow">For veterans</p>
            <h2>Sign up to serve</h2>
            <p className="muted small">
              List what you can do, then commit to real blocks of time. Nobody is matched to you
              outside the hours you promised.
            </p>
            <span className="go">Commit a slot →</span>
          </Link>
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
          <p className="eyebrow">How it works</p>
          <ol className="steps">
            <li>
              <strong>Veterans enlist.</strong>
              <p className="muted small">
                Branch, years, what they can do, how far they will travel, and whether they charge.
              </p>
            </li>
            <li>
              <strong>They commit slots.</strong>
              <p className="muted small">
                A slot is a promise, not a preference. One slot, one job — so a match is a real
                answer.
              </p>
            </li>
            <li>
              <strong>One request matches.</strong>
              <p className="muted small">
                The API ranks by distance, rating, how soon they can start, and who has been idle
                longest.
              </p>
            </li>
            <li>
              <strong>The slot is claimed.</strong>
              <p className="muted small">
                Contact details are exchanged only once the booking exists. The rest of the roster
                stays private.
              </p>
            </li>
          </ol>

          <hr className="section-rule" />
          <div className="match-head" style={{ marginBottom: 18 }}>
            <div>
              <p className="eyebrow">On the network right now</p>
              <h2>
                {providers.length} veterans · {volunteers} taking volunteer work ·{' '}
                {serviceTypes.length} kinds of help
              </h2>
            </div>
            <Link href="/request" className="mono">
              Ask for something →
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
                      {serviceTypes.find((s) => s.id === offering.serviceType)?.label ??
                        offering.serviceType}
                    </span>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </>
      )}
    </>
  );
}
