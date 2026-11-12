import type { Locale } from '../../types';
import { Box, Label, TextArea, Textfield } from '../kit';

/**
 * The two inputs of the waiver dialog, extracted so `WaiverDialog` stays under
 * the 50-line function limit (project rule).
 *
 * Rule: files < 500 lines, functions < 50 lines.
 */

export interface WaiverFieldsProps {
  locale: Locale;
  reason: string;
  hours: number;
  onReason: (reason: string) => void;
  onHours: (hours: number) => void;
}

export function WaiverFields({ locale, reason, hours, onReason, onHours }: WaiverFieldsProps) {
  return (
    <Box>
      <Label labelFor="waiver-reason">
        {locale === 'fr' ? 'Motif (obligatoire) :' : 'Reason (mandatory):'}
      </Label>
      <TextArea
        id="waiver-reason"
        value={reason}
        onChange={(event) => onReason(event.target.value)}
        minimumRows={3}
      />
      <Label labelFor="waiver-hours">
        {locale === 'fr' ? 'Durée (heures) :' : 'Duration (hours):'}
      </Label>
      <Textfield
        id="waiver-hours"
        type="number"
        min={1}
        max={720}
        value={String(hours)}
        onChange={(event) => onHours(Number(event.target.value) || 48)}
      />
    </Box>
  );
}