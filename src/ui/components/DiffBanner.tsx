import Lozenge from '@atlaskit/lozenge';
import { t } from '../../i18n/index';
import type { Locale, SnapshotDiff } from '../../types';

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
      <p style={{ color: '#6B778C', padding: '0 12px' }}>
        {t({ key: 'diff.first' }, locale)}
      </p>
    );
  }
  if (isEmpty(diff)) {
    return (
      <p style={{ color: '#6B778C', padding: '0 12px' }}>
        {t({ key: 'diff.none' }, locale)}
      </p>
    );
  }
  return (
    <div style={{ padding: '4px 12px' }}>
      <strong>{t({ key: 'diff.title' }, locale)}</strong>
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
    </div>
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
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '4px 0' }}>
      <Lozenge appearance={APPEARANCE[change.from]}>{t({ key: `verdict.${change.from}` }, locale)}</Lozenge>
      <span>→</span>
      <Lozenge appearance={APPEARANCE[change.to]} isBold>
        {t({ key: `verdict.${change.to}` }, locale)}
      </Lozenge>
    </div>
  );
}

function SignalMoveList({ label, codes }: { label: string; codes: string[] }) {
  if (codes.length === 0) return null;
  return (
    <div>
      {label} ({codes.length}) : {codes.join(', ')}
    </div>
  );
}
