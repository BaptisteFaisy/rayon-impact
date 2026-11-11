import { useState } from 'react';
import { invoke } from '@forge/bridge';
import Button from '@atlaskit/button';
import SectionMessage from '@atlaskit/section-message';
import { useLocale, useProject, useScreen } from './hooks.js';
import { SeverityTable } from './components/SeverityTable.js';
import { ListField } from './components/ListField.js';
import type { Locale, Policy } from '../types.js';

/**
 * Project settings: severity per signal (RI-11), watched JSM projects, who may
 * waive, observation mode (SPEC §11). The table and the list field are separate
 * components so no function exceeds 50 lines.
 *
 * Rule: files < 500 lines, functions < 50 lines.
 */

export function SettingsPage() {
  const locale = useLocale();
  const project = useProject();
  const screen = useScreen<Policy | null>('screen.projectSettings', {
    projectId: project.id ?? '',
  });
  const [draft, setDraft] = useState<Policy | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const policy = draft ?? screen.data ?? emptyPolicy(project.id ?? '');

  if (screen.loading) return <p>…</p>;

  async function save() {
    setError(null);
    setSaved(false);
    try {
      await invoke('screen.savePolicy', { policy });
      setDraft(policy);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div style={{ padding: 12 }}>
      <h3>{locale === 'fr' ? 'Réglages du rayon d’impact' : 'Release impact settings'}</h3>
      <StatusMessages error={error} saved={saved} locale={locale} />
      <SeverityTable policy={policy} locale={locale} onChange={setDraft} />
      <PolicyFields policy={policy} locale={locale} onChange={setDraft} />
      <Button appearance="primary" onClick={save}>
        {locale === 'fr' ? 'Enregistrer' : 'Save'}
      </Button>
    </div>
  );
}

function StatusMessages({
  error,
  saved,
  locale,
}: {
  error: string | null;
  saved: boolean;
  locale: Locale;
}) {
  return (
    <div>
      {error ? <SectionMessage appearance="error">{error}</SectionMessage> : null}
      {saved ? (
        <SectionMessage appearance="success">
          {locale === 'fr' ? 'Réglages enregistrés.' : 'Settings saved.'}
        </SectionMessage>
      ) : null}
    </div>
  );
}

/** The fields below the severity table, in one place. */
function PolicyFields({
  policy,
  locale,
  onChange,
}: {
  policy: Policy;
  locale: Locale;
  onChange: (next: Policy) => void;
}) {
  return (
    <div>
      <ListField
        label={locale === 'fr' ? 'Projets JSM surveillés (clés)' : 'Watched JSM projects (keys)'}
        values={policy.jsmProjectKeys}
        onChange={(values) => onChange({ ...policy, jsmProjectKeys: values })}
      />
      <ListField
        label={locale === 'fr' ? 'Qui peut déroger (accountId)' : 'Who may waive (accountId)'}
        values={policy.waiverApprovers}
        onChange={(values) => onChange({ ...policy, waiverApprovers: values })}
      />
      <label style={{ display: 'block', margin: '8px 0' }}>
        <input
          type="checkbox"
          checked={policy.observationMode}
          onChange={(event) => onChange({ ...policy, observationMode: event.target.checked })}
        />
        {locale === 'fr'
          ? ' Mode observation (aucun avis sur les tickets)'
          : ' Observation mode (no verdict shown on tickets)'}
      </label>
    </div>
  );
}

function emptyPolicy(projectId: string): Policy {
  return {
    projectId,
    severityOverrides: {},
    disabledSignals: [],
    waiverApprovers: [],
    jsmProjectKeys: [],
    serviceMap: [],
    observationMode: false,
    defaultWaiverHours: 48,
  };
}
