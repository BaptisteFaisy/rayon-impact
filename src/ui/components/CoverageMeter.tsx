import type { Coverage, Locale } from '../../types.js';

/**
 * Coverage meter: code coverage and service coverage (SPEC §4, §8, §15).
 *
 * Rule: files < 500 lines, functions < 50 lines.
 */

export interface CoverageMeterProps {
  coverage: Coverage;
  locale: Locale;
}

export function CoverageMeter({ coverage, locale }: CoverageMeterProps) {
  const codePercent = Math.round(coverage.codeRatio * 100);
  const servicePercent = Math.round(coverage.serviceRatio * 100);

  return (
    <div style={{ display: 'flex', gap: 24, padding: '8px 0', fontSize: '0.9em' }}>
      <div>
        <strong>{locale === 'fr' ? 'Tickets' : 'Issues'}:</strong> {coverage.issueCount}
      </div>
      <div>
        <strong>{locale === 'fr' ? 'Code visible' : 'Code coverage'}:</strong>{' '}
        {coverage.issuesWithCode}/{coverage.issueCount} ({codePercent}%)
      </div>
      <div>
        <strong>{locale === 'fr' ? 'Services connus' : 'Service coverage'}:</strong>{' '}
        {coverage.issuesWithService}/{coverage.issueCount} ({servicePercent}%)
      </div>
    </div>
  );
}
