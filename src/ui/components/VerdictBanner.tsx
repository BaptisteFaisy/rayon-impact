import { t } from '../../i18n/index';
import type { Confidence, Locale, Verdict } from '../../types';
import { Box, Lozenge, SectionMessage, Text } from '../kit';

/**
 * The verdict banner: the first thing the release lead reads (SPEC §11).
 *
 * Rule: files < 500 lines, functions < 50 lines.
 */

export interface VerdictBannerProps {
  verdict: Verdict;
  confidence: Confidence;
  computedAt: string;
  locale: Locale;
  /** Low coverage is stated, never hidden (SPEC §15, honesty). */
  coverageNote?: string;
}

const APPEARANCE: Record<Verdict, 'success' | 'inprogress' | 'removed' | 'default'> = {
  go: 'success',
  'conditional-go': 'inprogress',
  'no-go': 'removed',
  'not-applicable': 'default',
};

export function VerdictBanner(props: VerdictBannerProps) {
  const { verdict, confidence, computedAt, locale, coverageNote } = props;
  const title = t({ key: `verdict.${verdict}` }, locale);
  const confidenceText = t({ key: `confidence.${confidence}` }, locale);

  return (
    <Box>
      <Box>
        <Lozenge appearance={APPEARANCE[verdict]} isBold>
          {title}
        </Lozenge>
        <Text>{confidenceText}</Text>
        <Text>{computedAt}</Text>
      </Box>
      {coverageNote ? (
        <Box>
          <SectionMessage appearance="warning" title={confidenceText}>
            {coverageNote}
          </SectionMessage>
        </Box>
      ) : null}
    </Box>
  );
}
