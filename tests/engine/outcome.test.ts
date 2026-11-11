import { describe, expect, it } from 'vitest';
import {
  computeOutcome,
  outcomeSummary,
  type OutcomeInput,
} from '../../src/engine/outcome.js';
import { incident } from '../fixtures/builders.js';

describe('engine/outcome', () => {
  const releasedAt = '2026-11-08T10:00:00.000Z';
  const exactly72h = '2026-11-11T10:00:00.000Z';
  const before72h = '2026-11-11T09:59:59.000Z';

  const incMinor = incident('INC-101', {
    majorIncident: false,
    serviceId: 'svc-checkout-api',
    createdAt: '2026-11-08T12:00:00.000Z',
    resolvedAt: '2026-11-08T12:40:00.000Z',
    url: 'https://pay.atlassian.net/browse/INC-101',
  });

  const incMajor = incident('INC-102', {
    majorIncident: true,
    serviceId: 'svc-checkout-api',
    createdAt: '2026-11-09T10:00:00.000Z',
    resolvedAt: '2026-11-09T13:00:00.000Z',
  });

  const incOtherService = incident('INC-103', {
    majorIncident: false,
    serviceId: 'svc-unrelated',
    createdAt: '2026-11-09T11:00:00.000Z',
  });

  const incAfterWindow = incident('INC-104', {
    majorIncident: true,
    serviceId: 'svc-checkout-api',
    createdAt: '2026-11-11T11:00:00.000Z',
  });

  const baseInput: OutcomeInput = {
    versionId: 'ver-24',
    releasedAt,
    incidents: [incMinor, incMajor, incOtherService, incAfterWindow],
    servicesImpacted: ['svc-checkout-api'],
    rollback: false,
    notes: 'Smooth release overall',
    now: exactly72h,
  };

  it('bilan avant 72 h : null (pas encore l’heure, RI-15)', () => {
    expect(computeOutcome({ ...baseInput, now: before72h })).toBeNull();
  });

  it('à 72 h : incidents comptés dans la fenêtre et sur les services touchés, durée de résolution en minutes', () => {
    const outcome = computeOutcome(baseInput);
    expect(outcome).not.toBeNull();
    if (!outcome) return;

    expect(outcome.versionId).toBe('ver-24');
    expect(outcome.checkedAt).toBe(exactly72h);
    expect(outcome.rollback).toBe(false);
    expect(outcome.notes).toBe('Smooth release overall');

    // INC-103 (autre service) et INC-104 (créé après la fenêtre) exclus
    expect(outcome.incidents).toHaveLength(2);

    const minor = outcome.incidents.find((i) => i.key === 'INC-101');
    expect(minor?.severity).toBe('minor');
    expect(minor?.resolvedAfterMinutes).toBe(40);
    expect(minor?.url).toBe('https://pay.atlassian.net/browse/INC-101');

    const major = outcome.incidents.find((i) => i.key === 'INC-102');
    expect(major?.severity).toBe('major');
    expect(major?.resolvedAfterMinutes).toBe(180);
  });

  it('incident non résolu : pas de resolvedAfterMinutes ; rollback et notes par défaut', () => {
    const openInc = incident('INC-106', {
      serviceId: 'svc-checkout-api',
      state: 'open',
      createdAt: '2026-11-09T09:00:00.000Z',
      resolvedAt: undefined,
    });
    const outcome = computeOutcome({
      ...baseInput,
      incidents: [openInc],
      rollback: undefined,
      notes: undefined,
    });
    expect(outcome?.incidents).toHaveLength(1);
    expect(outcome?.incidents[0].resolvedAfterMinutes).toBeUndefined();
    expect(outcome?.rollback).toBe(false);
    expect(outcome?.notes).toBe('');
  });

  it('rattache par serviceName quand serviceId est absent (SPEC §16)', () => {
    const incName = incident('INC-105', {
      serviceId: null,
      serviceName: 'checkout-api',
      createdAt: '2026-11-08T15:00:00.000Z',
    });
    const outcome = computeOutcome({
      ...baseInput,
      incidents: [incName],
      servicesImpacted: ['checkout-api'],
    });
    expect(outcome?.incidents).toHaveLength(1);
    expect(outcome?.incidents[0].key).toBe('INC-105');
  });

  it('outcomeSummary produit un MessageRef réutilisable par l’UI et l’agent Rovo', () => {
    const cleanOutcome = computeOutcome({ ...baseInput, incidents: [] });
    expect(cleanOutcome).not.toBeNull();
    if (cleanOutcome) {
      expect(outcomeSummary(cleanOutcome).key).toBe('outcome.summary.clean');
      expect(outcomeSummary(cleanOutcome).params).toEqual({
        count: 0,
        majorCount: 0,
        minorCount: 0,
        rollback: 0,
      });
    }

    const dirtyOutcome = computeOutcome(baseInput);
    expect(dirtyOutcome).not.toBeNull();
    if (dirtyOutcome) {
      const summary = outcomeSummary(dirtyOutcome);
      expect(summary.key).toBe('outcome.summary.incidents');
      expect(summary.params).toEqual({
        count: 2,
        majorCount: 1,
        minorCount: 1,
        rollback: 0,
      });
    }
  });
});
