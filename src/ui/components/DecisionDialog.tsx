import { useState } from 'react';
import { invoke } from '@forge/bridge';
import { t } from '../../i18n/index';
import type { DecisionKind, Locale, Verdict } from '../../types';
import { Box, Button, Heading, Label, SectionMessage, Select, Text, TextArea } from '../kit';

/**
 * Decision dialog (RI-08, SPEC §6.1 step 7): records the human decision with
 * the verdict of the moment. The verdict shown is the dossier's; the action
 * side re-reads it from the saved dossier and the decider from the Forge
 * context — never from these inputs (R2 §2.3).
 *
 * Rule: files < 500 lines, functions < 50 lines, components < 100 lines.
 */

/** Mirror of `MAX_DECISION_NOTE` (src/actions/decisions.ts): the UI bundle
    does not import backend modules (CONVENTIONS §2, two sealed worlds). */
const NOTE_MAX = 500;

/** Runtime list of `DecisionKind` (src/types); the action validates it. */
const DECISION_OPTIONS: DecisionKind[] = ['ship', 'hold', 'delay'];

export interface DecisionDialogProps {
  versionId: string;
  /** Verdict of the saved dossier, displayed before deciding (SPEC §4). */
  verdict: Verdict;
  locale: Locale;
  onDone: () => void;
  onCancel: () => void;
}

interface DecisionFieldsProps {
  locale: Locale;
  decision: DecisionKind;
  note: string;
  onDecision: (decision: DecisionKind) => void;
  onNote: (note: string) => void;
}

/** Decision select + bounded note with its counter, extracted so
    `DecisionDialog` stays under the 50-line function limit. */
function DecisionFields({ locale, decision, note, onDecision, onNote }: DecisionFieldsProps) {
  const options = DECISION_OPTIONS.map((kind) => ({
    label: t({ key: `decision.option.${kind}` }, locale),
    value: kind,
  }));
  return (
    <Box>
      <Label labelFor="decision-select">{t({ key: 'decision.dialog.field' }, locale)}</Label>
      <Select
        inputId="decision-select"
        options={options}
        value={options.find((option) => option.value === decision) ?? null}
        onChange={(option) => option && onDecision(option.value)}
      />
      <Label labelFor="decision-note">
        {t({ key: 'decision.dialog.note' }, locale)}{' '}
        {t(
          { key: 'decision.dialog.noteCounter', params: { count: note.length, max: NOTE_MAX } },
          locale,
        )}
      </Label>
      <TextArea
        id="decision-note"
        value={note}
        onChange={(event) => onNote(event.target.value)}
        minimumRows={3}
        maxLength={NOTE_MAX}
      />
    </Box>
  );
}

export function DecisionDialog({
  versionId,
  verdict,
  locale,
  onDone,
  onCancel,
}: DecisionDialogProps) {
  const [decision, setDecision] = useState<DecisionKind>('ship');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (note.trim().length > NOTE_MAX) {
      setError(t({ key: 'decision.dialog.noteTooLong', params: { max: NOTE_MAX } }, locale));
      return;
    }
    setBusy(true);
    try {
      await invoke('record-decision', { versionId, decision, note: note.trim() });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <Box>
      <DecisionHeading verdict={verdict} locale={locale} />
      {error ? <SectionMessage appearance="error">{error}</SectionMessage> : null}
      <DecisionFields
        locale={locale}
        decision={decision}
        note={note}
        onDecision={setDecision}
        onNote={setNote}
      />
      <Box>
        <Button appearance="primary" onClick={submit} isDisabled={busy}>
          {t({ key: 'decision.dialog.submit' }, locale)}
        </Button>
        <Button appearance="subtle" onClick={onCancel} isDisabled={busy}>
          {t({ key: 'decision.dialog.cancel' }, locale)}
        </Button>
      </Box>
    </Box>
  );
}

/** Title and reminder of the verdict being decided on. */
function DecisionHeading({ verdict, locale }: { verdict: Verdict; locale: Locale }) {
  return (
    <Box>
      <Heading as="h4">{t({ key: 'decision.dialog.title' }, locale)}</Heading>
      <Text>
        {t(
          {
            key: 'decision.dialog.currentVerdict',
            params: { verdict: t({ key: `verdict.${verdict}` }, locale) },
          },
          locale,
        )}
      </Text>
    </Box>
  );
}


