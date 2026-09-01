import type { PilotTerms } from '@/lib/api';

/**
 * What the pilot is and is not.
 *
 * Rendered from the terms the API serves rather than hardcoded here, so the
 * wording someone reads is the same wording recorded against their enrolment.
 */
export function PilotNotice({ terms, compact = false }: { terms: PilotTerms; compact?: boolean }) {
  if (compact) {
    return (
      <div className="alert" role="note">
        <strong>{terms.headline}.</strong> {terms.summary} No identity checks, no insurance, and no
        formal privacy program yet — and this is not a VA service.
      </div>
    );
  }

  return (
    <div className="pilot-notice" role="note">
      <p className="eyebrow" style={{ marginBottom: 6 }}>
        Before you join
      </p>
      <h3 style={{ marginBottom: 6 }}>{terms.headline}</h3>
      <p className="small muted" style={{ margin: '0 0 12px' }}>
        {terms.summary}
      </p>
      <ul className="pilot-points">
        {terms.points.map((point) => (
          <li key={point.title}>
            <strong>{point.title}.</strong> <span className="muted">{point.detail}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
