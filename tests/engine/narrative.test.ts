import { describe, expect, it } from 'vitest';
import {
  allowedTokens,
  buildNarrativePayload,
  fallbackNarrative,
  findIdentifiers,
  isNarrativeUsable,
  NARRATIVE_MAX_ATTEMPTS,
  summaryLines,
  verifyNarrative,
} from '../../src/engine/narrative';
import { detectAllSignals, recomputeRelease } from '../../src/engine/pipeline';
import { computeCoverage } from '../../src/engine/coverage';
import { paiementsPolicy, paiementsRelease } from '../fixtures/paiements';
import { InMemoryReleaseStore } from './fakes';
import type { NarrativeInput } from '../../src/engine/narrative';
import type { NarrativeWriter, PipelineDeps } from '../../src/ports';
import type { CollectedRelease } from '../../src/types';

/**
 * The written summary: payload, verification and fallback (SPEC §8, RI-06).
 *
 * A real model returns prose, sometimes with a title: the verification must
 * reject a text citing something absent from the signals (hard) while tolerating
 * a layout miss (soft). Both levels are pinned here, because the distinction was
 * discovered on the live demo site.
 *
 * Rule: files < 500 lines, functions < 50 lines.
 */

const NOW = '2026-11-11T06:00:00.000Z';

function narrativeInput(release: CollectedRelease = paiementsRelease()): NarrativeInput {
  const coverage = computeCoverage(release);
  return {
    signals: [],
    verdict: 'no-go',
    confidence: 'low',
    coverage,
    versionName: release.version.name,
    projectKey: release.project.key,
    locale: 'en',
    serviceNames: paiementsPolicy().serviceMap.map((entry) => entry.serviceName),
  };
}

describe('verifyNarrative', () => {
  it('accepts a summary that cites only what the signals say', () => {
    const release = paiementsRelease();
    const input = narrativeInput(release);
    const text = [
      'COMP-01 — PAY-131 is still in progress.',
      'COMP-03 — PAY-131 has one open pull request.',
      'QUAL-01 — the last build on PAY-129 failed.',
      'EXP-01 — INC-52 is open on checkout-api.',
      'DEP-01 — PAY-130 is blocked by PAY-118.',
    ].join('\n');

    const check = verifyNarrative(text, { ...input, signals: signalsOf(release) });
    expect(check.hardViolations).toEqual([]);
    expect(check.softViolations).toEqual([]);
    expect(check.ok).toBe(true);
  });

  it('rejects a summary that invents a ticket (hard violation)', () => {
    const release = paiementsRelease();
    const check = verifyNarrative('COMP-01 — PAY-999 blocks the release.', {
      ...narrativeInput(release),
      signals: signalsOf(release),
    });

    expect(check.ok).toBe(false);
    expect(check.hardViolations.join(' ')).toContain('PAY-999');
  });

  it('rejects a summary that invents a service (hard violation)', () => {
    const release = paiementsRelease();
    const check = verifyNarrative('COMP-01 — PAY-131 is late.\nQUAL-01 — billing-api is unstable.', {
      ...narrativeInput(release),
      signals: signalsOf(release),
      serviceNames: ['checkout-api', 'billing-api'],
    });

    expect(check.ok).toBe(false);
    expect(check.hardViolations.join(' ')).toContain('billing-api');
  });

  it('tolerates a layout miss on a truthful summary (soft violation only)', () => {
    const release = paiementsRelease();
    // What the live model actually returned: a title and one paragraph.
    const text = '**PAY 2.4 Release Summary**\nCOMP-01 and COMP-03 — PAY-131 is still in progress.';
    const check = verifyNarrative(text, {
      ...narrativeInput(release),
      signals: signalsOf(release),
    });

    expect(check.ok).toBe(true);
    expect(check.hardViolations).toEqual([]);
    expect(check.softViolations.length).toBeGreaterThan(0);
  });

  it('does not treat a signal code as an unknown identifier', () => {
    const identifiers = findIdentifiers('COMP-01 and EXP-04 mention PAY-131.');
    expect(identifiers).toContain('COMP-01');
    expect(identifiers).toContain('PAY-131');
  });
});

describe('narrative helpers', () => {
  it('builds a payload that only carries known identifiers', () => {
    const release = paiementsRelease();
    const signals = signalsOf(release);
    const payload = buildNarrativePayload({ ...narrativeInput(release), signals });
    const allowed = allowedTokens(signals);

    expect(payload.system).toContain('5 to 8 lines');
    for (const identifier of findIdentifiers(payload.user)) {
      const isCode = signals.some((signal) => signal.code === identifier);
      expect(isCode || allowed.has(identifier), identifier).toBe(true);
    }
  });

  it('writes a fallback that passes its own verification, in both languages', () => {
    const release = paiementsRelease();
    const signals = signalsOf(release);
    for (const locale of ['en', 'fr'] as const) {
      const input = { ...narrativeInput(release), signals, locale };
      const text = fallbackNarrative(input);
      expect(isNarrativeUsable(text)).toBe(true);
      expect(verifyNarrative(text, input).ok).toBe(true);
      expect(summaryLines(text).length).toBeLessThanOrEqual(8);
    }
  });

  it('bounds the number of model attempts', () => {
    expect(NARRATIVE_MAX_ATTEMPTS).toBe(3);
    expect(isNarrativeUsable('   ')).toBe(false);
  });
});

describe('recomputeRelease and the narrative', () => {
  it('publishes a truthful summary whose layout is off', async () => {
    const release = paiementsRelease();
    const writer: NarrativeWriter = {
      async write() {
        return 'COMP-01 — PAY-131 is still in progress, with one open pull request (COMP-03).';
      },
    };
    const result = await run(writer, release);

    expect(result.narrativeFromModel).toBe(true);
    expect(result.snapshot.narrativeRejections.length).toBeGreaterThan(0);
  });

  it('never publishes a summary that invents a ticket', async () => {
    const release = paiementsRelease();
    const writer: NarrativeWriter = {
      async write() {
        return 'COMP-01 — PAY-999 is blocking the release.';
      },
    };
    const result = await run(writer, release);

    expect(result.narrativeFromModel).toBe(false);
    expect(result.snapshot.narrative).not.toContain('PAY-999');
  });
});

/* ------------------------------------------------------------------ helpers */

function signalsOf(release: CollectedRelease) {
  return detectAllSignals({
    release,
    policy: paiementsPolicy(),
    now: NOW,
    waivers: [],
    previousSignals: [],
    pastOutcomes: [],
  });
}

async function run(narrative: NarrativeWriter, release: CollectedRelease) {
  const store = new InMemoryReleaseStore();
  const deps: PipelineDeps = {
    store,
    collector: { async collect() { return release; } },
    narrative,
    clock: { now: () => NOW },
    logger: { log() {} },
  };
  return recomputeRelease(deps, {
    projectId: 'proj-pay',
    versionId: 'ver-24',
    viewerAccountId: null,
    reason: 'event',
  });
}

describe('hallucinated signal codes', () => {
  it('rejects an invented code as a hard violation', () => {
    const release = paiementsRelease();
    const check = verifyNarrative('CVRG-01 — coverage is low.', {
      ...narrativeInput(release),
      signals: signalsOf(release),
    });
    expect(check.ok).toBe(false);
    expect(check.hardViolations.join(' ')).toContain('CVRG-01');
  });

  it('accepts a COVERAGE line without a signal code as a soft matter only', () => {
    const release = paiementsRelease();
    const text = [
      'COMP-01 — PAY-131 is still in progress.',
      'COVERAGE — no commit is visible for 14 of 14 tickets.',
      'QUAL-01 — the last build on PAY-129 failed.',
      'EXP-01 — INC-52 is open on checkout-api.',
      'DEP-01 — PAY-130 is blocked by PAY-118.',
    ].join('\n');
    const check = verifyNarrative(text, {
      ...narrativeInput(release),
      signals: signalsOf(release),
    });
    expect(check.hardViolations).toEqual([]);
    expect(check.softViolations).toEqual([]);
    expect(check.ok).toBe(true);
  });

  it('asks the model never to invent a code', () => {
    const release = paiementsRelease();
    const payload = buildNarrativePayload({
      ...narrativeInput(release),
      signals: signalsOf(release),
    });
    expect(payload.system).toContain('never invent a code');
    expect(payload.system).toContain('COVERAGE');
  });
});
