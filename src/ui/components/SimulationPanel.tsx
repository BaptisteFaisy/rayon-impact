import { useState } from 'react';
import { invoke } from '@forge/bridge';
import Button from '@atlaskit/button';
import Lozenge from '@atlaskit/lozenge';
import SectionMessage from '@atlaskit/section-message';
import { t } from '../../i18n/index';
import type { SimulateWithoutOutput } from '../../actions/types';
import type { Locale } from '../../types';

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
    <div style={{ margin: '8px 0', padding: 12, border: '1px solid #DFE1E6', borderRadius: 4 }}>
      <SimulationButtons
        keys={issueKeys}
        minimal={result?.minimalRemoval?.issueKeys ?? []}
        busy={busy}
        locale={locale}
        onSimulate={simulate}
      />
      {error ? <SectionMessage appearance="error">{error}</SectionMessage> : null}
      {result ? <SimulationResult result={result} locale={locale} /> : null}
      <p style={{ color: '#6B778C', fontSize: '0.85em' }}>
        {t({ key: 'simulation.disclaimer' }, locale)}
      </p>
    </div>
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
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      <Button appearance="default" isDisabled={busy || keys.length === 0} onClick={() => onSimulate(keys)}>
        {t({ key: 'simulation.run', params: { keys: keys.join(', ') } }, locale)}
      </Button>
      {minimal.length > 0 ? (
        <Button appearance="primary" isDisabled={busy} onClick={() => onSimulate(minimal)}>
          {t({ key: 'simulation.runMinimal', params: { count: minimal.length } }, locale)}
        </Button>
      ) : null}
    </div>
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
    <div style={{ marginTop: 8 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <Lozenge appearance={APPEARANCE[result.verdictBefore]}>
          {t({ key: `verdict.${result.verdictBefore}` }, locale)}
        </Lozenge>
        <span>→</span>
        <Lozenge appearance={APPEARANCE[result.verdict]} isBold>
          {t({ key: `verdict.${result.verdict}` }, locale)}
        </Lozenge>
        <span>
          {t(
            { key: 'simulation.dropped', params: { count: result.droppedSignalCount } },
            locale,
          )}
        </span>
      </div>
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
        <ul>
          {result.conditions.map((condition) => (
            <li key={`${condition.signalCode}-${condition.subjectId}`}>
              {condition.signalCode} — {t(condition.text, locale)}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
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
    <p>
      {t({ key, params: { keys: minimal.issueKeys.join(', '), count: minimal.issueKeys.length } }, locale)}{' '}
      <span style={{ color: '#6B778C' }}>
        ({t({ key: 'simulation.simulations', params: { count: minimal.simulationsRun } }, locale)})
      </span>
    </p>
  );
}
