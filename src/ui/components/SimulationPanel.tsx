import { useState } from 'react';
import { invoke } from '@forge/bridge';
import { t } from '../../i18n/index';
import type { SimulateWithoutOutput } from '../../actions/types';
import type { Locale } from '../../types';
import { Box, Button, List, ListItem, Lozenge, SectionMessage, Text } from '../kit';

/**
 * Simulation panel (RI-13): "what if this ticket left the release?"
 *
 * A simulation never writes anything to Jira — the panel says so explicitly,
 * because the release lead must not believe the ticket was removed.
 *
 * Rule: files < 500 lines, functions < 50 lines.
 */

const APPEARANCE = {
  go: 'success',
  'conditional-go': 'inprogress',
  'no-go': 'removed',
  'not-applicable': 'default',
} as const;

export interface SimulationPanelProps {
  versionId: string;
  issueKeys: string[];
  locale: Locale;
}

export function SimulationPanel({ versionId, issueKeys, locale }: SimulationPanelProps) {
  const [result, setResult] = useState<SimulateWithoutOutput | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function simulate(keys: string[]) {
    setBusy(true);
    setError(null);
    try {
      const output = await invoke<SimulateWithoutOutput>('simulate-without', {
        versionId,
        issueKeys: keys.join(','),
      });
      setResult(output);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setResult(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Box>
      <SimulationButtons
        keys={issueKeys}
        minimal={result?.minimalRemoval?.issueKeys ?? []}
        busy={busy}
        locale={locale}
        onSimulate={simulate}
      />
      {error ? <SectionMessage appearance="error">{error}</SectionMessage> : null}
      {result ? <SimulationResult result={result} locale={locale} /> : null}
      <Text>
        {t({ key: 'simulation.disclaimer' }, locale)}
      </Text>
    </Box>
  );
}

function SimulationButtons({
  keys,
  minimal,
  busy,
  locale,
  onSimulate,
}: {
  keys: string[];
  minimal: string[];
  busy: boolean;
  locale: Locale;
  onSimulate: (keys: string[]) => void;
}) {
  return (
    <Box>
      <Button appearance="default" isDisabled={busy || keys.length === 0} onClick={() => onSimulate(keys)}>
        {t({ key: 'simulation.run', params: { keys: keys.join(', ') } }, locale)}
      </Button>
      {minimal.length > 0 ? (
        <Button appearance="primary" isDisabled={busy} onClick={() => onSimulate(minimal)}>
          {t({ key: 'simulation.runMinimal', params: { count: minimal.length } }, locale)}
        </Button>
      ) : null}
    </Box>
  );
}

function SimulationResult({
  result,
  locale,
}: {
  result: SimulateWithoutOutput;
  locale: Locale;
}) {
  const minimal = result.minimalRemoval;
  return (
    <Box>
      <Box>
        <Lozenge appearance={APPEARANCE[result.verdictBefore]}>
          {t({ key: `verdict.${result.verdictBefore}` }, locale)}
        </Lozenge>
        <Text>→</Text>
        <Lozenge appearance={APPEARANCE[result.verdict]} isBold>
          {t({ key: `verdict.${result.verdict}` }, locale)}
        </Lozenge>
        <Text>
          {t(
            { key: 'simulation.dropped', params: { count: result.droppedSignalCount } },
            locale,
          )}
        </Text>
      </Box>
      {result.unknownIssueKeys.length > 0 ? (
        <SectionMessage appearance="warning">
          {t(
            { key: 'simulation.unknownKeys', params: { keys: result.unknownIssueKeys.join(', ') } },
            locale,
          )}
        </SectionMessage>
      ) : null}
      {minimal ? <MinimalRemovalLine minimal={minimal} locale={locale} /> : null}
      {result.conditions.length > 0 ? (
        <List type="unordered">
          {result.conditions.map((condition) => (
            <ListItem key={`${condition.signalCode}-${condition.subjectId}`}>
              {condition.signalCode} — {t(condition.text, locale)}
            </ListItem>
          ))}
        </List>
      ) : null}
    </Box>
  );
}

function MinimalRemovalLine({
  minimal,
  locale,
}: {
  minimal: NonNullable<SimulateWithoutOutput['minimalRemoval']>;
  locale: Locale;
}) {
  const key = minimal.provenMinimal ? 'simulation.minimal' : 'simulation.minimalUnproven';
  return (
    <Text>
      {t({ key, params: { keys: minimal.issueKeys.join(', '), count: minimal.issueKeys.length } }, locale)}{' '}
      <Text>
        ({t({ key: 'simulation.simulations', params: { count: minimal.simulationsRun } }, locale)})
      </Text>
    </Text>
  );
}
