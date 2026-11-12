import { getSignalDefinition, listSignalCodes } from '../../signals/registry';
import { t } from '../../i18n/index';
import { Box, Checkbox, Select, Text } from '../kit';
import type { Locale, Policy, Severity, SignalCode } from '../../types';

/**
 * Severity table of the settings screen: one row per signal, with its effective
 * severity and its on/off switch (RI-11). En UI Kit 2, un tableau est une
 * colonne de `Box` : pas de `<table>`.
 *
 * Rule: files < 500 lines, functions < 50 lines.
 */

const SEVERITIES: Severity[] = ['blocking', 'major', 'minor', 'info'];

/** Policy with one signal's severity overridden (RI-11). */
function withSeverity(policy: Policy, code: SignalCode, next: Severity): Policy {
  return { ...policy, severityOverrides: { ...policy.severityOverrides, [code]: next } };
}

/** Policy with one signal enabled or disabled. */
function withEnabled(policy: Policy, code: SignalCode, enabled: boolean): Policy {
  return {
    ...policy,
    disabledSignals: enabled
      ? policy.disabledSignals.filter((item) => item !== code)
      : [...policy.disabledSignals, code],
  };
}

export interface SeverityTableProps {
  policy: Policy;
  locale: Locale;
  onChange: (next: Policy) => void;
}

export function SeverityTable({ policy, locale, onChange }: SeverityTableProps) {
  return (
    <Box>
      {listSignalCodes().map((code) => (
        <SeverityRow key={code} code={code} policy={policy} locale={locale} onChange={onChange} />
      ))}
    </Box>
  );
}

function SeverityRow({ code, policy, locale, onChange }: SeverityTableProps & { code: SignalCode }) {
  const definition = getSignalDefinition(code);
  const severity = policy.severityOverrides[code] ?? definition.defaultSeverity;
  const enabled = !(policy.disabledSignals ?? []).includes(code);
  const options = SEVERITIES.map((value) => ({
    label: t({ key: `severity.${value}` }, locale),
    value,
  }));
  const setSeverity = (next: Severity) => onChange(withSeverity(policy, code, next));
  const setEnabled = (next: boolean) => onChange(withEnabled(policy, code, next));

  return (
    <Box>
      <Text>
        {code} — {t(definition.title, locale)}
      </Text>
      <Select
        aria-label={t({ key: 'settings.severityFor', params: { code } }, locale)}
        options={options}
        value={options.find((option) => option.value === severity) ?? null}
        onChange={(option) => option && setSeverity(option.value as Severity)}
      />
      <Checkbox
        aria-label={t({ key: 'settings.enabledFor', params: { code } }, locale)}
        isChecked={enabled}
        onChange={(event) => setEnabled(Boolean(event.target.checked))}
      />
    </Box>
  );
}