import { getSignalDefinition, listSignalCodes } from '../../signals/registry';
import { t } from '../../i18n/index';
import type { Locale, Policy, Severity, SignalCode } from '../../types';

/**
 * Severity table of the settings screen: one row per signal, with its effective
 * severity and its on/off switch (RI-11).
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

const cell = {
  border: '1px solid #DFE1E6',
  padding: '4px 8px',
  textAlign: 'left',
} as const;

export interface SeverityTableProps {
  policy: Policy;
  locale: Locale;
  onChange: (next: Policy) => void;
}

export function SeverityTable({ policy, locale, onChange }: SeverityTableProps) {
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
        {listSignalCodes().map((code) => (
          <SeverityRow key={code} code={code} policy={policy} locale={locale} onChange={onChange} />
        ))}
      </tbody>
    </table>
  );
}

function SeverityRow({ code, policy, locale, onChange }: SeverityTableProps & { code: SignalCode }) {
  const definition = getSignalDefinition(code);
  const severity = policy.severityOverrides[code] ?? definition.defaultSeverity;
  const enabled = !policy.disabledSignals.includes(code);

  const setSeverity = (next: Severity) => onChange(withSeverity(policy, code, next));
  const setEnabled = (next: boolean) => onChange(withEnabled(policy, code, next));

  return (
    <tr>
      <td style={cell}>
        {code} — {t(definition.title, locale)}
      </td>
      <td style={cell}>
        <select
          aria-label={t({ key: 'settings.severityFor', params: { code } }, locale)}
          value={severity}
          onChange={(event) => setSeverity(event.target.value as Severity)}
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
          aria-label={t({ key: 'settings.enabledFor', params: { code } }, locale)}
          checked={enabled}
          onChange={(event) => setEnabled(event.target.checked)}
        />
      </td>
    </tr>
  );
}
