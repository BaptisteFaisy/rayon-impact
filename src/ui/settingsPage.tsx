import { useState } from 'react';
import { invoke } from '@forge/bridge';
import Button from '@atlaskit/button';
import SectionMessage from '@atlaskit/section-message';
import { useLocale, useProject, useScreen } from './hooks.js';
import { listSignalCodes, getSignalDefinition } from '../signals/registry.js';
import { t } from '../i18n/index.js';
import type { Policy, Severity } from '../types.js';

/**
 * Project settings: severity per signal (RI-11), component → service mapping,
 * watched JSM projects, who may waive, observation mode (SPEC §11).
 *
 * Rule: files < 500 lines, functions < 50 lines.
 */

const SEVERITIES: Severity[] = ['blocking', 'major', 'minor', 'info'];

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
      {error ? <SectionMessage appearance="error">{error}</SectionMessage> : null}
      {saved ? (
        <SectionMessage appearance="success">
          {locale === 'fr' ? 'Réglages enregistrés.' : 'Settings saved.'}
        </SectionMessage>
      ) : null}
      <SeverityTable policy={policy} onChange={setDraft} locale={locale} />
      <ListField
        label={locale === 'fr' ? 'Projets JSM surveillés (clés)' : 'Watched JSM projects (keys)'}
        values={policy.jsmProjectKeys}
        onChange={(values) => setDraft({ ...policy, jsmProjectKeys: values })}
      />
      <ListField
        label={locale === 'fr' ? 'Qui peut déroger (accountId)' : 'Who may waive (accountId)'}
        values={policy.waiverApprovers}
        onChange={(values) => setDraft({ ...policy, waiverApprovers: values })}
      />
      <label style={{ display: 'block', margin: '8px 0' }}>
        <input
          type="checkbox"
          checked={policy.observationMode}
          onChange={(event) => setDraft({ ...policy, observationMode: event.target.checked })}
        />
        {locale === 'fr'
          ? ' Mode observation (aucun avis sur les tickets)'
          : ' Observation mode (no verdict shown on tickets)'}
      </label>
      <Button appearance="primary" onClick={save}>
        {locale === 'fr' ? 'Enregistrer' : 'Save'}
      </Button>
    </div>
  );
}

function SeverityTable({
  policy,
  onChange,
  locale,
}: {
  policy: Policy;
  onChange: (next: Policy) => void;
  locale: 'en' | 'fr';
}) {
  return (
    <table style={{ borderCollapse: 'collapse', marginBottom: 12 }}>
      <thead>
        <tr>
          <th style={cell}>{locale === 'fr' ? 'Signal' : 'Signal'}</th>
          <th style={cell}>{locale === 'fr' ? 'Gravité' : 'Severity'}</th>
          <th style={cell}>{locale === 'fr' ? 'Activé' : 'Enabled'}</th>
        </tr>
      </thead>
      <tbody>
        {listSignalCodes().map((code) => {
          const definition = getSignalDefinition(code);
          const severity = policy.severityOverrides[code] ?? definition.defaultSeverity;
          const enabled = !policy.disabledSignals.includes(code);
          return (
            <tr key={code}>
              <td style={cell}>
                {code} — {t(definition.title, locale)}
              </td>
              <td style={cell}>
                <select
                  value={severity}
                  onChange={(event) =>
                    onChange({
                      ...policy,
                      severityOverrides: {
                        ...policy.severityOverrides,
                        [code]: event.target.value as Severity,
                      },
                    })
                  }
                >
                  {SEVERITIES.map((value) => (
                    <option key={value} value={value}>
                      {t({ key: `severity.${value}` }, locale)}
                    </option>
                  ))}
                </select>
              </td>
              <td style={cell}>
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(event) =>
                    onChange({
                      ...policy,
                      disabledSignals: event.target.checked
                        ? policy.disabledSignals.filter((item) => item !== code)
                        : [...policy.disabledSignals, code],
                    })
                  }
                />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function ListField({
  label,
  values,
  onChange,
}: {
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
}) {
  return (
    <label style={{ display: 'block', margin: '8px 0' }}>
      <div>{label}</div>
      <input
        type="text"
        value={values.join(', ')}
        onChange={(event) =>
          onChange(
            event.target.value
              .split(',')
              .map((item) => item.trim())
              .filter((item) => item.length > 0),
          )
        }
        style={{ width: '100%', boxSizing: 'border-box' }}
      />
    </label>
  );
}

const cell = { border: '1px solid #DFE1E6', padding: '4px 8px', textAlign: 'left' } as const;

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
