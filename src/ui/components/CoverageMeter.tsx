import type { Coverage, Locale } from '../../types';
import { Box, Strong } from '../kit';

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
    <Box>
      <Box>
        <Strong>{locale === 'fr' ? 'Tickets' : 'Issues'}:</Strong> {coverage.issueCount}
      </Box>
      <Box>
        <Strong>{locale === 'fr' ? 'Code visible' : 'Code coverage'}:</Strong>{' '}
        {coverage.issuesWithCode}/{coverage.issueCount} ({codePercent}%)
      </Box>
      <Box>
        <Strong>{locale === 'fr' ? 'Services connus' : 'Service coverage'}:</Strong>{' '}
        {coverage.issuesWithService}/{coverage.issueCount} ({servicePercent}%)
      </Box>
    </Box>
  );
}
