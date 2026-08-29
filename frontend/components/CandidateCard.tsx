'use client';

import type { Candidate } from '@/lib/api';
import { BRANCH_LABELS, formatCost, formatRange } from '@/lib/format';

const COMPONENT_LABELS: Record<string, string> = {
  proximity: 'Proximity',
  workloadFairness: 'Fair workload',
  reliability: 'Reliability',
};

/** The ranked shortlist entry, with the score broken out so the ranking is legible. */
export function CandidateCard({
  candidate,
  showBreakdown = false,
  action,
}: {
  candidate: Candidate;
  showBreakdown?: boolean;
  action?: React.ReactNode;
}) {
  const { provider } = candidate;

  return (
    <article className="card">
      <div className="match-head">
        <div>
          <h3>{provider.name}</h3>
          <p className="mono muted" style={{ margin: '4px 0 0' }}>
            {BRANCH_LABELS[provider.branch]} · {provider.yearsOfService} yrs ·{' '}
            {provider.rating ? `${provider.rating.toFixed(1)}★` : 'no rating yet'} ·{' '}
            {provider.completedJobs} jobs
          </p>
        </div>
        <div className="score">
          {candidate.score}
          <small> /100</small>
        </div>
      </div>

      {provider.bio ? (
        <p className="small muted" style={{ marginTop: 12 }}>
          {provider.bio}
        </p>
      ) : null}

      <dl className="facts">
        <div className="fact">
          <dt>When</dt>
          <dd>{formatRange(candidate.startsAt, candidate.endsAt)}</dd>
        </div>
        <div className="fact">
          <dt>Distance</dt>
          <dd>{candidate.distanceKm} km away</dd>
        </div>
        <div className="fact">
          <dt>Cost</dt>
          <dd>{formatCost(candidate.estimatedCostUsd, candidate.rateType)}</dd>
        </div>
        <div className="fact">
          <dt>Recent rides</dt>
          <dd>{candidate.recentRideCount} in 7 days</dd>
        </div>
        {provider.phone ? (
          <div className="fact">
            <dt>Contact</dt>
            <dd>{provider.phone}</dd>
          </div>
        ) : null}
      </dl>

      {showBreakdown ? (
        <div className="bars">
          {Object.entries(candidate.scoreBreakdown).map(([key, weight]) => (
            <div key={key} className="bar-row">
              <span>{COMPONENT_LABELS[key] ?? key}</span>
              <span className="bar-track">
                <span className="bar-fill" style={{ width: `${Math.round(weight * 100)}%` }} />
              </span>
              <span>{Math.round(weight * 100)}</span>
            </div>
          ))}
        </div>
      ) : null}

      {action ? <div style={{ marginTop: 16 }}>{action}</div> : null}
    </article>
  );
}
