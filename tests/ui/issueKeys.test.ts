import { describe, expect, it } from 'vitest';
import { blockingIssueKeys, issueKeysOf } from '../../src/ui/issueKeys';
import { detectAllSignals } from '../../src/engine/pipeline';
import { paiementsPolicy, paiementsRelease, LINKED_OUTSIDE_ISSUES } from '../fixtures/paiements';

/**
 * The simulation panel needs issue KEYS while signals carry issue IDS: these
 * helpers read the keys from the signals' own finding params.
 *
 * Rule: files < 500 lines, functions < 50 lines.
 */

function signalsOfDemoRelease() {
  const release = paiementsRelease();
  release.linkedOutsideIssues = LINKED_OUTSIDE_ISSUES;
  return detectAllSignals({
    release,
    policy: paiementsPolicy(),
    now: '2026-11-11T06:00:00.000Z',
    waivers: [],
    previousSignals: [],
    pastOutcomes: [],
  });
}

describe('issueKeysOf', () => {
  it('reads the single key of an issue-level signal', () => {
    const signals = signalsOfDemoRelease();
    const comp01 = signals.find((signal) => signal.code === 'COMP-01');
    expect(comp01).toBeDefined();
    expect(issueKeysOf(comp01!)).toEqual(['PAY-131']);
  });

  it('reads the key list of a service-level signal', () => {
    const signals = signalsOfDemoRelease();
    const exp01 = signals.find((signal) => signal.code === 'EXP-01');
    expect(exp01).toBeDefined();
    const keys = issueKeysOf(exp01!);
    expect(keys.length).toBeGreaterThan(0);
    expect(keys).toContain('PAY-127');
  });

  it('returns nothing for a signal without any key param', () => {
    const signals = signalsOfDemoRelease();
    const withoutKey = signals.find(
      (signal) => (signal.finding.params ?? {}).key === undefined &&
        (signal.finding.params ?? {}).issues === undefined,
    );
    if (withoutKey) expect(issueKeysOf(withoutKey)).toEqual([]);
  });
});

describe('blockingIssueKeys', () => {
  it('lists the keys holding the demo release back, deduplicated', () => {
    const keys = blockingIssueKeys(signalsOfDemoRelease());
    expect(keys).toContain('PAY-131');
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('ignores waived and non-blocking signals', () => {
    const signals = signalsOfDemoRelease().map((signal) =>
      signal.severity === 'blocking' ? { ...signal, status: 'waived' as const } : signal,
    );
    expect(blockingIssueKeys(signals)).toEqual([]);
  });
});
