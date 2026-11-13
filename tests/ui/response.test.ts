import { describe, expect, it } from 'vitest';
import { readAnswer } from '../../src/ui/response';
import { basePolicy, withPolicyDefaults } from '../../src/policy';

/**
 * Ce que le pont Forge rend vraiment, et ce que l'écran doit en faire.
 *
 * Ces cas ont été constatés en production le 13/11/2026 sur le module
 * `jira:projectSettingsPage` : un résolveur qui répond `null` arrive à la vue
 * comme `{}` (truthy), et l'écran le rendait comme une policy — la property
 * `severityOverrides` manquait, le rendu plantait sur `COMP-01` et le module
 * restait vide, sans message.
 *
 * Rule: files < 500 lines, functions < 50 lines.
 */

describe('readAnswer', () => {
  it('treats a null answer as no data', () => {
    expect(readAnswer(null)).toEqual({ data: null, error: null });
  });

  it('treats the empty object the bridge sends for null as no data', () => {
    expect(readAnswer({})).toEqual({ data: null, error: null });
  });

  it('keeps a real payload', () => {
    const answer = readAnswer<{ projectId: string }>({ projectId: '10234' });
    expect(answer.data).toEqual({ projectId: '10234' });
    expect(answer.error).toBeNull();
  });

  it('keeps an array payload, empty or not', () => {
    expect(readAnswer([]).data).toEqual([]);
    expect(readAnswer([{ versionId: '1' }]).data).toEqual([{ versionId: '1' }]);
  });

  it('turns a resolver refusal into a readable error', () => {
    const answer = readAnswer({
      ok: false,
      error: { code: 'invalid-input', message: 'Screen payload needs a "projectId" string.' },
    });
    expect(answer.data).toBeNull();
    expect(answer.error).toBe('Screen payload needs a "projectId" string.');
  });

  it('turns a refusal without a message into a readable error', () => {
    const answer = readAnswer({ ok: false, error: { code: 'unknown' } });
    expect(answer.data).toBeNull();
    expect(answer.error).toBeTruthy();
  });

  it('does not mistake a payload carrying an `ok` field for a refusal', () => {
    const answer = readAnswer({ ok: true, projectId: '10234' });
    expect(answer.error).toBeNull();
    expect(answer.data).toEqual({ ok: true, projectId: '10234' });
  });
});

describe('withPolicyDefaults', () => {
  it('completes a partial policy instead of leaving holes', () => {
    const policy = withPolicyDefaults({ projectId: '10234' } as never, '10234');
    expect(policy.severityOverrides).toEqual({});
    expect(policy.disabledSignals).toEqual([]);
    expect(policy.jsmProjectKeys).toEqual([]);
    expect(policy.serviceMap).toEqual([]);
    expect(policy.defaultWaiverHours).toBe(48);
  });

  it('falls back to the neutral policy when nothing came back', () => {
    expect(withPolicyDefaults(null, '10234')).toEqual(basePolicy('10234'));
  });

  it('keeps the values it was given', () => {
    const policy = withPolicyDefaults(
      { ...basePolicy('10234'), jsmProjectKeys: ['ITO'], observationMode: true },
      '10234',
    );
    expect(policy.jsmProjectKeys).toEqual(['ITO']);
    expect(policy.observationMode).toBe(true);
  });
});
