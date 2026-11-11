import { useState } from 'react';
import { invoke } from '@forge/bridge';
import Button from '@atlaskit/button';
import SectionMessage from '@atlaskit/section-message';
import type { Locale, Signal } from '../../types.js';

/**
 * Waiver dialog: reason is mandatory, expiration delay is explicit (RI-07).
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
      await invoke('request-waiver', {
        signalId: signal.id,
        reason: reason.trim(),
        hours,
      });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <div style={{ border: '1px solid #DFE1E6', padding: 16, borderRadius: 4, marginTop: 8 }}>
      <h4>{locale === 'fr' ? 'Accorder une dérogation' : 'Grant a waiver'}</h4>
      <p style={{ color: '#6B778C' }}>{signal.code} — {signal.id}</p>
      {error ? <SectionMessage appearance="error">{error}</SectionMessage> : null}
      <div style={{ margin: '8px 0' }}>
        <label>
          <div>{locale === 'fr' ? 'Motif (obligatoire) :' : 'Reason (mandatory):'}</div>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            style={{ width: '100%', boxSizing: 'border-box' }}
          />
        </label>
      </div>
      <div style={{ margin: '8px 0' }}>
        <label>
          <div>{locale === 'fr' ? 'Durée (heures) :' : 'Duration (hours):'}</div>
          <input
            type="number"
            min={1}
            max={720}
            value={hours}
            onChange={(e) => setHours(Number(e.target.value) || 48)}
          />
        </label>
      </div>
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
