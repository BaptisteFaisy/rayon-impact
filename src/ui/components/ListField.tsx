import { Box, Label, Textfield } from '../kit';

/**
 * A comma-separated list field, used for the watched JSM projects and the
 * waiver approvers (SPEC §11). Extracted so the settings screen stays short.
 *
 * Rule: files < 500 lines, functions < 50 lines.
 */

export interface ListFieldProps {
  id: string;
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
}

export function ListField({ id, label, values, onChange }: ListFieldProps) {
  return (
    <Box>
      <Label labelFor={id}>{label}</Label>
      <Textfield
        id={id}
        value={values.join(', ')}
        onChange={(event) => onChange(splitList(event.target.value))}
      />
    </Box>
  );
}

function splitList(raw: string): string[] {
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}