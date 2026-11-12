import { t } from '../../i18n/index';
import type { Locale, Waiver } from '../../types';
import { Box, List, ListItem, Text, Strong } from '../kit';

/**
 * Waivers tab: every waiver with its reason and its expiration. Waivers are
 * closed, never deleted (SPEC §15, traceability).
 *
 * Rule: files < 500 lines, functions < 50 lines.
 */

export function WaiversTab({ waivers, locale }: { waivers: Waiver[]; locale: Locale }) {
  if (waivers.length === 0) {
    return <Text>—</Text>;
  }
  return (
    <List type="unordered">
      {waivers.map((waiver) => (
        <ListItem key={waiver.id}>
          <Strong>{waiver.signalCode}</Strong> — {waiver.reason}
          <Box>
            {waiver.grantedBy} ·{' '}
            {t({ key: 'waivers.expires', params: { at: waiver.expiresAt } }, locale)}
            {waiver.closedAt && waiver.closedReason
              ? ` · ${t(
                  {
                    key: 'waivers.closed',
                    params: { at: waiver.closedAt, reason: waiver.closedReason },
                  },
                  locale,
                )}`
              : ''}
          </Box>
        </ListItem>
      ))}
    </List>
  );
}
