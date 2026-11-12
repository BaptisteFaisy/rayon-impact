import { describe, expect, it } from 'vitest';
import {
  MAX_TRAILING_PASSES,
  runTrailingPass,
  type TrailingDeps,
  type TrailingRun,
} from '../../src/triggers/trailing';
import { createMemoryGate } from '../../src/triggers/events';
import type {
  LogLevel,
  Logger,
  PipelineDeps,
  RecomputeMessage,
  RecomputeRequest,
  RecomputeResult,
} from '../../src/ports';
import { snapshot } from '../fixtures/builders';

/**
 * La passe finale du consumer (SPEC §12 : « regroupé, jamais jeté ») : ce que la
 * fenêtre de 60 s a retenu est rejoué dès la fin du recalcul qui le masquait,
 * dans les bornes de l'invocation. `sleep` et l'horloge sont injectés : aucun
 * test ne dort réellement.
 *
 * Rule: files < 500 lines, functions < 50 lines.
 */

const START = '2026-11-12T10:00:00.000Z';
const COLLECT = '2026-11-12T10:00:01.000Z';
const DEFERRED_AT = '2026-11-12T10:00:12.000Z';
const NOW = '2026-11-12T10:00:20.000Z';

const message: RecomputeMessage = {
  projectId: 'proj-pay',
  versionId: 'ver-24',
  reason: 'event',
  requestedAt: START,
};

function fakeClock(start: string): { now: () => string; advance: (ms: number) => void } {
  let current = Date.parse(start);
  return {
    now: () => new Date(current).toISOString(),
    advance: (ms: number) => {
      current += ms;
    },
  };
}

function recordingLogger(): Logger & { entries: { level: LogLevel; message: string }[] } {
  const entries: { level: LogLevel; message: string }[] = [];
  return {
    entries,
    log(level: LogLevel, text: string): void {
      entries.push({ level, message: text });
    },
  };
}

function result(): RecomputeResult {
  return {
    snapshot: snapshot({ versionId: 'ver-24', verdict: 'no-go', confidence: 'low' }),
    signals: [],
    narrativeFromModel: true,
    durationMs: 10,
  };
}

interface Options {
  budgetMs?: number;
  minIntervalSeconds?: number;
  recompute?: (deps: PipelineDeps, request: RecomputeRequest) => Promise<RecomputeResult>;
}

function setup(options: Options = {}) {
  const clock = fakeClock(NOW);
  const gate = createMemoryGate();
  const logger = recordingLogger();
  const slept: number[] = [];
  const requests: RecomputeRequest[] = [];
  const recompute =
    options.recompute ??
    (async (_deps: PipelineDeps, request: RecomputeRequest): Promise<RecomputeResult> => {
      requests.push(request);
      clock.advance(8_000);
      return result();
    });
  const run: TrailingRun = { pipeline: {} as PipelineDeps, recompute };
  const trailing: TrailingDeps = {
    gate,
    clock,
    logger,
    sleep: async (ms: number): Promise<void> => {
      slept.push(ms);
      clock.advance(ms);
    },
    ...(options.budgetMs === undefined ? {} : { budgetMs: options.budgetMs }),
    ...(options.minIntervalSeconds === undefined ? {} : { minIntervalSeconds: options.minIntervalSeconds }),
  };
  return { run, trailing, gate, clock, logger, slept, requests };
}

describe('triggers/trailing — runTrailingPass', () => {
  it('ne recalcule rien quand aucune demande n’est reportée', async () => {
    const { run, trailing, gate, slept, requests } = setup();
    await gate.markQueued(message.versionId, START);

    const results = await runTrailingPass(run, trailing, message, COLLECT);

    expect(results).toEqual([]);
    expect(slept).toEqual([]);
    expect(requests).toEqual([]);
  });

  it('rejoue la demande reportée en attendant la fin de la fenêtre', async () => {
    const { run, trailing, gate, slept, requests } = setup();
    await gate.markQueued(message.versionId, START);
    await gate.deferRequest({ ...message, requestedAt: DEFERRED_AT }, DEFERRED_AT);

    const results = await runTrailingPass(run, trailing, message, COLLECT);

    expect(results).toHaveLength(1);
    // Fenêtre de 60 s ouverte à 10:00:00, horloge à 10:00:20 → 40 s d’attente.
    expect(slept).toEqual([40_000]);
    expect(requests[0]).toEqual({
      projectId: 'proj-pay',
      versionId: 'ver-24',
      viewerAccountId: null,
      reason: 'event',
    });
    await expect(gate.deferredRequest(message.versionId)).resolves.toBeNull();
  });

  it('solde sans recalculer une demande plus ancienne que la collecte', async () => {
    const { run, trailing, gate, slept, requests } = setup();
    await gate.markQueued(message.versionId, START);
    await gate.deferRequest({ ...message, requestedAt: START }, START);

    const results = await runTrailingPass(run, trailing, message, COLLECT);

    expect(results).toEqual([]);
    expect(slept).toEqual([]);
    expect(requests).toEqual([]);
    await expect(gate.deferredRequest(message.versionId)).resolves.toBeNull();
  });

  it('ne dort pas quand la fenêtre est déjà écoulée', async () => {
    const { run, trailing, gate, clock, slept } = setup();
    clock.advance(120_000);
    await gate.markQueued(message.versionId, START);
    await gate.deferRequest({ ...message, requestedAt: DEFERRED_AT }, DEFERRED_AT);

    const results = await runTrailingPass(run, trailing, message, COLLECT);

    expect(results).toHaveLength(1);
    expect(slept).toEqual([]);
  });

  it('borne le nombre de passes d’une rafale continue', async () => {
    const { run, trailing, gate, clock } = setup({
      recompute: async (_deps: PipelineDeps, _request: RecomputeRequest) => {
        // Chaque passe voit arriver une nouvelle demande pendant sa collecte :
        // la rafale ne doit jamais épuiser l’invocation.
        clock.advance(5_000);
        const at = clock.now();
        await gate.deferRequest({ ...message, requestedAt: at }, at);
        return result();
      },
    });
    await gate.markQueued(message.versionId, START);
    await gate.deferRequest({ ...message, requestedAt: DEFERRED_AT }, DEFERRED_AT);

    const results = await runTrailingPass(run, trailing, message, COLLECT);

    expect(results).toHaveLength(MAX_TRAILING_PASSES);
  });

  it('laisse la demande au balayage horaire quand le budget est épuisé', async () => {
    const { run, trailing, gate, logger, slept, requests } = setup({ budgetMs: 1_000 });
    await gate.markQueued(message.versionId, START);
    await gate.deferRequest({ ...message, requestedAt: DEFERRED_AT }, DEFERRED_AT);

    const results = await runTrailingPass(run, trailing, message, COLLECT);

    expect(results).toEqual([]);
    expect(slept).toEqual([]);
    expect(requests).toEqual([]);
    expect(logger.entries.some((entry) => entry.message.includes('balayage horaire'))).toBe(true);
    await expect(gate.deferredRequest(message.versionId)).resolves.not.toBeNull();
  });

  it('conserve la demande quand le recalcul final échoue', async () => {
    const { run, trailing, gate } = setup({
      recompute: async () => {
        throw new Error('LLM indisponible');
      },
    });
    await gate.markQueued(message.versionId, START);
    await gate.deferRequest({ ...message, requestedAt: DEFERRED_AT }, DEFERRED_AT);

    await expect(runTrailingPass(run, trailing, message, COLLECT)).rejects.toThrow('LLM indisponible');
    await expect(gate.deferredRequest(message.versionId)).resolves.not.toBeNull();
  });

  it('marque la fenêtre avant de recalculer, pour ne pas doubler la passe', async () => {
    const { run, trailing, gate } = setup();
    await gate.markQueued(message.versionId, START);
    await gate.deferRequest({ ...message, requestedAt: DEFERRED_AT }, DEFERRED_AT);

    await runTrailingPass(run, trailing, message, COLLECT);

    // lastQueuedAt a suivi la passe : un événement immédiat sera reporté, pas publié.
    const lastQueuedAt = await gate.lastQueuedAt(message.versionId);
    expect(lastQueuedAt).not.toBe(START);
  });
});
