import { getSignalDefinition } from '../../signals/registry';
import { t } from '../../i18n/index';
import type { Locale, Severity, Signal } from '../../types';
import { Box, Heading, Link, List, ListItem, Lozenge, Text, Strong, Em } from '../kit';

/**
 * Signal list grouped by severity: observation, why it matters, proof, how to clear.
 *
 * Rule: files < 500 lines, functions < 50 lines.
 */

export interface SignalListProps {
  signals: Signal[];
  locale: Locale;
}

const SEVERITY_APPEARANCE: Record<Severity, 'removed' | 'inprogress' | 'default' | 'new'> = {
  blocking: 'removed',
  major: 'inprogress',
  minor: 'default',
  info: 'new',
};

const ORDER: Severity[] = ['blocking', 'major', 'minor', 'info'];

export function SignalList(props: SignalListProps) {
  const { signals, locale } = props;
  if (signals.length === 0) {
    return (
      <Text>{t({ key: 'signals.none.active' }, locale)}</Text>
    );
  }

  const bySeverity = new Map<Severity, Signal[]>();
  for (const signal of signals) {
    const list = bySeverity.get(signal.severity) ?? [];
    list.push(signal);
    bySeverity.set(signal.severity, list);
  }

  return (
    <Box>
      {ORDER.map((severity) => {
        const list = bySeverity.get(severity) ?? [];
        if (list.length === 0) return null;
        return (
          <Box key={severity}>
            <Heading as="h4">
              <Lozenge appearance={SEVERITY_APPEARANCE[severity]} isBold>
                {t({ key: `severity.${severity}` }, locale)} ({list.length})
              </Lozenge>
            </Heading>
            <List type="unordered">
              {list.map((signal) => (
                <SignalItem key={signal.id} signal={signal} locale={locale} />
              ))}
            </List>
          </Box>
        );
      })}
    </Box>
  );
}

function SignalItem({ signal, locale }: { signal: Signal; locale: Locale }) {
  const def = getSignalDefinition(signal.code);
  const finding = t(signal.finding, locale);
  const why = t(def.why, locale);
  const clear = t(def.clear, locale);

  return (
    <ListItem>
      <Box>
        <Strong>{signal.code}</Strong> — {finding}
      </Box>
      <Box>{why}</Box>
      <Box>
        <Em>{clear}</Em>
      </Box>
      {signal.evidence.map((evidence, index) => (
        <Text key={index}>
          {evidence.url ? (
            <Link href={evidence.url} openNewTab>
              {t(evidence.label, locale)}
            </Link>
          ) : (
            <Text>{t(evidence.label, locale)}</Text>
          )}
        </Text>
      ))}
    </ListItem>
  );
}
