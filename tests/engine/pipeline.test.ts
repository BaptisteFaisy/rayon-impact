import { describe, it } from 'vitest';
import { detectComp } from '../../src/signals/comp.js';
import { detectQual } from '../../src/signals/qual.js';
import { detectDep } from '../../src/signals/dep.js';
import { detectExp } from '../../src/signals/exp.js';
import { detectDoc } from '../../src/signals/doc.js';
import { detectFuture } from '../../src/signals/future.js';
import { LINKED_OUTSIDE_ISSUES, paiementsPolicy, paiementsRelease } from '../fixtures/paiements.js';
import type { DetectionContext } from '../../src/signals/context.js';

describe('probe', () => {
  it('probe', () => {
    const release = paiementsRelease();
    release.linkedOutsideIssues = LINKED_OUTSIDE_ISSUES;
    const ctx: DetectionContext = {
      release,
      policy: paiementsPolicy(),
      now: '2026-11-11T06:00:00.000Z',
      waivers: [],
      previousSignals: [],
      pastOutcomes: [],
    };
    const all = [
      ...detectComp(ctx),
      ...detectQual(ctx),
      ...detectDep(ctx),
      ...detectExp(ctx),
      ...detectDoc(ctx),
      ...detectFuture(ctx),
    ];
    console.log(
      JSON.stringify(
        all.map((s) => ({ code: s.code, sev: s.severity, subj: s.subjectId, f: s.finding })),
        null,
        1,
      ),
    );
    console.log('count', all.length);
  });
});
