import { useState } from 'react';
import { invoke } from '@forge/bridge';
import Button from '@atlaskit/button';
import SectionMessage from '@atlaskit/section-message';
import { WaiverFields } from './WaiverFields.js';
import type { Locale, Signal } from '../../types.js';

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
    <div style={panelStyle}>
      <h4>{locale === 'fr' ? 'Accorder une dérogation' : 'Grant a waiver'}</h4>
      <p style={{ color: '#6B778C' }}>
        {signal.code} — {signal.subjectId}
      </p>
      {error ? <SectionMessage appearance="error">{error}</SectionMessage> : null}
      <WaiverFields
        locale={locale}
        reason={reason}
        hours={hours}
        onReason={setReason}
        onHours={setHours}
      />
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <Button appearance="primary" onClick={submit} isDisabled={busy}>
          {locale === 'fr' ? 'Accorder' : 'Grant'}
        </Button>
        <Button appearance="subtle" onClick={onCancel} isDisabled={busy}>
          {locale === 'fr' ? 'Annuler' : 'Cancel'}
        </Button>
      </div>
    </div>
  );
}

const panelStyle = {
  border: '1px solid #DFE1E6',
  padding: 16,
  borderRadius: 4,
  margin: '8px 12px',
} as const;
