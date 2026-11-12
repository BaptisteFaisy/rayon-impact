import { t } from '../../i18n/index';
import type { Locale, SnapshotDiff } from '../../types';
import { Box, Lozenge, Text, Strong } from '../kit';

/**
 * "Since the last dossier" banner (RI-14): what appeared, what was cleared,
 * which severity moved, and whether the verdict changed.
 *
 * Rule: files < 500 lines, functions < 50 lines.
 */

const APPEARANCE = {
  go: 'success',
  'conditional-go': 'inprogress',
  'no-go': 'removed',
  'not-applicable': 'default',
} as const;

export function DiffBanner({ diff, locale }: { diff: SnapshotDiff | null; locale: Locale }) {
  if (!diff) {
    return (
      <Text>
        {t({ key: 'diff.first' }, locale)}
      </Text>
    );
  }
  if (isEmpty(diff)) {
    return (
      <Text>
        {t({ key: 'diff.none' }, locale)}
      </Text>
    );
  }
  return (
    <Box>
      <Strong>{t({ key: 'diff.title' }, locale)}</Strong>
      {diff.verdictChange ? <VerdictChange diff={diff} locale={locale} /> : null}
      <SignalMoveList
        label={t({ key: 'diff.added' }, locale)}
        codes={diff.added.map((signal) => `${signal.code} · ${signal.subjectId}`)}
      />
      <SignalMoveList
        label={t({ key: 'diff.cleared' }, locale)}
        codes={diff.cleared.map((signal) => `${signal.code} · ${signal.subjectId}`)}
      />
      <SignalMoveList
        label={t({ key: 'diff.severity' }, locale)}
        codes={diff.severityChanged.map(
          (change) => `${change.signalId}: ${change.from} → ${change.to}`,
        )}
      />
    </Box>
  );
}

function isEmpty(diff: SnapshotDiff): boolean {
  return (
    diff.added.length === 0 &&
    diff.cleared.length === 0 &&
    diff.severityChanged.length === 0 &&
    diff.verdictChange === null
  );
}

function VerdictChange({ diff, locale }: { diff: SnapshotDiff; locale: Locale }) {
  const change = diff.verdictChange;
  if (!change) return null;
  return (
    <Box>
      <Lozenge appearance={APPEARANCE[change.from]}>{t({ key: `verdict.${change.from}` }, locale)}</Lozenge>
      <Text>→</Text>
      <Lozenge appearance={APPEARANCE[change.to]} isBold>
        {t({ key: `verdict.${change.to}` }, locale)}
      </Lozenge>
    </Box>
  );
}

function SignalMoveList({ label, codes }: { label: string; codes: string[] }) {
  if (codes.length === 0) return null;
  return (
    <Box>
      {label} ({codes.length}) : {codes.join(', ')}
    </Box>
  );
}
