import { useState } from 'react';
import { invoke } from '@forge/bridge';
import { useLocale, useProject, useScreen } from './hooks';
import { SeverityTable } from './components/SeverityTable';
import { ListField } from './components/ListField';
import { basePolicy, withPolicyDefaults } from '../policy';
import type { Locale, Policy } from '../types';
import { Box, Button, Checkbox, Heading, Label, SectionMessage, Text } from './kit';

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

  // La policy affichée est toujours complète : celle du résolveur, complétée
  // par les valeurs neutres si elle est venue partielle (une policy enregistrée
  // avant l'ajout d'un champ ne doit pas casser l'écran).
  const policy = withPolicyDefaults(draft ?? screen.data, project.id ?? '');

  if (screen.loading) return <Box role="status">…</Box>;
  if (screen.error) return <Text>{screen.error}</Text>;

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
    <Box>
      <StatusMessages error={error} saved={saved} locale={locale} />
      <SettingsView policy={policy} locale={locale} onChange={setDraft} onSave={save} />
    </Box>
  );
}

/**
 * The loaded settings body, taking the policy as props: `renderToStaticMarkup`
 * never runs the `useScreen` effect, so tests render this view directly.
 *
 * The policy is completed here as well as in `SettingsPage`: a half-policy
 * (`severityOverrides` missing) made this view throw on `COMP-01` and left the
 * whole module blank — a view must never crash on the data it is handed.
 */
export function SettingsView({
  policy,
  locale,
  onChange,
  onSave,
}: {
  policy: Policy;
  locale: Locale;
  onChange: (next: Policy) => void;
  onSave: () => void;
}) {
  const safe = withPolicyDefaults(policy, policy.projectId ?? '');
  return (
    <Box>
      <Heading as="h3">{locale === 'fr' ? 'Réglages du rayon d’impact' : 'Release impact settings'}</Heading>
      <SeverityTable policy={safe} locale={locale} onChange={onChange} />
      <PolicyFields policy={safe} locale={locale} onChange={onChange} />
      <Button appearance="primary" onClick={onSave}>
        {locale === 'fr' ? 'Enregistrer' : 'Save'}
      </Button>
    </Box>
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
    <Box>
      {error ? <SectionMessage appearance="error">{error}</SectionMessage> : null}
      {saved ? (
        <SectionMessage appearance="success">
          {locale === 'fr' ? 'Réglages enregistrés.' : 'Settings saved.'}
        </SectionMessage>
      ) : null}
    </Box>
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
    <Box>
      <ListField
        id="jsm-project-keys"
        label={locale === 'fr' ? 'Projets JSM surveillés (clés)' : 'Watched JSM projects (keys)'}
        values={policy.jsmProjectKeys}
        onChange={(values) => onChange({ ...policy, jsmProjectKeys: values })}
      />
      <ListField
        id="waiver-approvers"
        label={locale === 'fr' ? 'Qui peut déroger (accountId)' : 'Who may waive (accountId)'}
        values={policy.waiverApprovers}
        onChange={(values) => onChange({ ...policy, waiverApprovers: values })}
      />
      <Box>
        <Checkbox
          id="observation-mode"
          isChecked={policy.observationMode}
          onChange={(event) => onChange({ ...policy, observationMode: Boolean(event.target.checked) })}
        />
        <Label labelFor="observation-mode">
          {locale === 'fr'
            ? ' Mode observation (aucun avis sur les tickets)'
            : ' Observation mode (no verdict shown on tickets)'}
        </Label>
      </Box>
    </Box>
  );
}

/** Exported for the tests: the neutral policy the screen falls back to. */
export { basePolicy as emptyPolicy };
