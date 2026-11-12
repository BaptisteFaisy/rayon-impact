import { useState } from 'react';
import { invoke } from '@forge/bridge';
import { WaiverFields } from './WaiverFields';
import type { Locale, Signal } from '../../types';
import { Box, Button, Heading, SectionMessage, Text } from '../kit';

/**
 * Waiver dialog: reason is mandatory, expiration delay is explicit (RI-07).
 * The form fields live in `WaiverFields.tsx` so no function exceeds 50 lines.
 *
 * Rule: files < 500 lines, functions < 50 lines.
 */

export interface WaiverDialogProps {
  signal: Signal;
  locale: Locale;
  onDone: () => void;
  onCancel: () => void;
}

export function WaiverDialog({ signal, locale, onDone, onCancel }: WaiverDialogProps) {
  const [reason, setReason] = useState('');
  const [hours, setHours] = useState(48);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!reason.trim()) {
      setError(locale === 'fr' ? 'Le motif est obligatoire.' : 'Reason is mandatory.');
      return;
    }
    setBusy(true);
    try {
      await invoke('request-waiver', { signalId: signal.id, reason: reason.trim(), hours });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <Box>
      <Heading as="h4">{locale === 'fr' ? 'Accorder une dérogation' : 'Grant a waiver'}</Heading>
      <Text>
        {signal.code} — {signal.subjectId}
      </Text>
      {error ? <SectionMessage appearance="error">{error}</SectionMessage> : null}
      <WaiverFields
        locale={locale}
        reason={reason}
        hours={hours}
        onReason={setReason}
        onHours={setHours}
      />
      <Box>
        <Button appearance="primary" onClick={submit} isDisabled={busy}>
          {locale === 'fr' ? 'Accorder' : 'Grant'}
        </Button>
        <Button appearance="subtle" onClick={onCancel} isDisabled={busy}>
          {locale === 'fr' ? 'Annuler' : 'Cancel'}
        </Button>
      </Box>
    </Box>
  );
}


