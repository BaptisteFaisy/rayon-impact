/**
 * A comma-separated list field, used for the watched JSM projects and the
 * waiver approvers (SPEC §11). Extracted so the settings screen stays short.
 *
 * Rule: files < 500 lines, functions < 50 lines.
 */

export interface ListFieldProps {
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
}

export function ListField({ label, values, onChange }: ListFieldProps) {
  return (
    <label style={{ display: 'block', margin: '8px 0' }}>
      <div>{label}</div>
      <input
        type="text"
        value={values.join(', ')}
        onChange={(event) => onChange(splitList(event.target.value))}
        style={{ width: '100%', boxSizing: 'border-box' }}
      />
    </label>
  );
}

function splitList(raw: string): string[] {
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}
