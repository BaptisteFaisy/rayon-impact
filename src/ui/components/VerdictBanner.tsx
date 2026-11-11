import Lozenge from '@atlaskit/lozenge';
import SectionMessage from '@atlaskit/section-message';
import { t } from '../../i18n/index';
import type { Confidence, Locale, Verdict } from '../../types';

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
    <div style={{ padding: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Lozenge appearance={APPEARANCE[verdict]} isBold>
          {title}
        </Lozenge>
        <span>{confidenceText}</span>
        <span style={{ color: '#6B778C' }}>{computedAt}</span>
      </div>
      {coverageNote ? (
        <div style={{ marginTop: 8 }}>
          <SectionMessage appearance="warning" title={confidenceText}>
            {coverageNote}
          </SectionMessage>
        </div>
      ) : null}
    </div>
  );
}
