import { describe, expect, it, vi } from 'vitest';
import {
  onMessage,
  type ConsumerDeps,
  type RecomputeFn,
} from '../../src/triggers/consumer';
import { createMemoryGate } from '../../src/triggers/events';
import type { TrailingDeps } from '../../src/triggers/trailing';
import type {
  LogLevel,
  Logger,
  PipelineDeps,
  RecomputeMessage,
  RecomputeResult,
} from '../../src/ports';
import { snapshot } from '../fixtures/builders';

const message: RecomputeMessage = {
  projectId: 'proj-pay',
  versionId: 'ver-24',
  reason: 'event',
  requestedAt: '2026-11-11T10:00:00.000Z',
};

// The injected fake never touches the pipeline ports; only the request and the
// clock matter here (the trailing pass reads the instant the collection started).
const START = '2026-11-11T10:00:00.000Z';
const DEFERRED_AT = '2026-11-11T10:00:12.000Z';
const pipeline = { clock: { now: () => START } } as unknown as PipelineDeps;

function recordingLogger(): Logger & { entries: { level: LogLevel; message: string; meta?: Record<string, unknown> }[] } {
  const entries: { level: LogLevel; message: string; meta?: Record<string, unknown> }[] = [];
  return {
    entries,
    log(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
      entries.push({ level, message, ...(meta === undefined ? {} : { meta }) });
    },
  };
}

function result(): RecomputeResult {
  return {
    snapshot: snapshot({ versionId: 'ver-24', verdict: 'no-go', confidence: 'low' }),
    signals: [],
    narrativeFromModel: true,
    durationMs: 1_234,
  };
}

/** Passe finale inerte par défaut : rien n’est reporté, rien n’est rejoué. */
function trailingFor(
  logger: Logger,
  gate = createMemoryGate(),
  sleep: (ms: number) => Promise<void> = () => Promise.resolve(),
): TrailingDeps {
  return { gate, clock: { now: () => START }, logger, sleep };
}

function setup(recompute: RecomputeFn, overrides: Partial<ConsumerDeps> = {}) {
  const logger = recordingLogger();
  const deps: ConsumerDeps = {
    pipeline,
    recompute,
    logger,
    trailing: trailingFor(logger),
    ...overrides,
  };
  return { deps, logger };
}

describe('triggers/consumer — onMessage', () => {
  it('calls the pipeline with the message mapped to a request', async () => {
    const recompute = vi.fn<RecomputeFn>(async () => result());
    const { deps } = setup(recompute);

    const received = await onMessage(message, deps);

    expect(received).toEqual(result());
    expect(recompute).toHaveBeenCalledTimes(1);
    expect(recompute).toHaveBeenCalledWith(pipeline, {
      projectId: 'proj-pay',
      versionId: 'ver-24',
      viewerAccountId: null,
      reason: 'event',
    });
  });

  it('passes the viewer whose graph rights are used when one is given', async () => {
    const recompute = vi.fn<RecomputeFn>(async () => result());
    const { deps } = setup(recompute, { viewerAccountId: 'acc-42' });

    await onMessage({ ...message, reason: 'manual' }, deps);

    expect(recompute.mock.calls[0]?.[1].viewerAccountId).toBe('acc-42');
    expect(recompute.mock.calls[0]?.[1].reason).toBe('manual');
  });

  it('logs the duration and the verdict of the recompute', async () => {
    const { deps, logger } = setup(async () => result());

    await onMessage(message, deps);

    const finished = logger.entries.find((e) => e.message === 'recompute finished');
    expect(finished?.level).toBe('info');
    expect(finished?.meta).toMatchObject({
      versionId: 'ver-24',
      reason: 'event',
      verdict: 'no-go',
      confidence: 'low',
      durationMs: 1_234,
    });
  });

  it('logs the request before running the pipeline', async () => {
    const { deps, logger } = setup(async () => result());

    await onMessage(message, deps);

    expect(logger.entries[0]?.message).toBe('recompute started');
    expect(logger.entries[0]?.meta?.requestedAt).toBe(message.requestedAt);
  });

  it('logs and rethrows a pipeline failure so Forge retries it', async () => {
    const { deps, logger } = setup(async () => {
      throw new Error('collector unavailable');
    });

    await expect(onMessage(message, deps)).rejects.toThrow('collector unavailable');
    const failed = logger.entries.find((e) => e.level === 'error');
    expect(failed?.meta).toMatchObject({
      versionId: 'ver-24',
      error: 'collector unavailable',
    });
  });

  it('accepts every reason the queue can carry', async () => {
    const reasons: RecomputeMessage['reason'][] = [
      'event',
      'schedule',
      'manual',
      'outcome',
    ];
    for (const reason of reasons) {
      const recompute = vi.fn<RecomputeFn>(async () => result());
      const { deps } = setup(recompute);
      await onMessage({ ...message, reason }, deps);
      expect(recompute.mock.calls[0]?.[1].reason).toBe(reason);
    }
  });
});

/* ------------------------------------------- passe finale (SPEC §12) */

describe('triggers/consumer — passe finale des demandes reportées', () => {
  it('rejoue la demande retenue par la fenêtre, après le recalcul principal', async () => {
    const recompute = vi.fn<RecomputeFn>(async () => result());
    const gate = createMemoryGate();
    const slept: number[] = [];
    const { deps } = setup(recompute, {
      trailing: trailingFor(recordingLogger(), gate, async (ms: number) => {
        slept.push(ms);
      }),
    });
    await gate.markQueued(message.versionId, START);
    await gate.deferRequest({ ...message, requestedAt: DEFERRED_AT }, DEFERRED_AT);

    const received = await onMessage(message, deps);

    expect(received).toEqual(result());
    expect(recompute).toHaveBeenCalledTimes(2);
    // La première attente est la fermeture de la fenêtre ; les suivantes sont
    // bornées (MAX_TRAILING_WAITS), l’invocation ne reste pas éveillée pour rien.
    expect(slept[0]).toBe(60_000);
    expect(slept.length).toBeLessThanOrEqual(3);
    await expect(gate.deferredRequest(message.versionId)).resolves.toBeNull();
  });

  it('n’enclenche aucune passe finale quand le recalcul principal échoue', async () => {
    const recompute = vi.fn<RecomputeFn>(async () => {
      throw new Error('collector unavailable');
    });
    const gate = createMemoryGate();
    const { deps } = setup(recompute, { trailing: trailingFor(recordingLogger(), gate) });
    await gate.markQueued(message.versionId, START);
    await gate.deferRequest({ ...message, requestedAt: DEFERRED_AT }, DEFERRED_AT);

    await expect(onMessage(message, deps)).rejects.toThrow('collector unavailable');

    expect(recompute).toHaveBeenCalledTimes(1);
    // La demande reste en place : le balayage horaire la rejouera.
    await expect(gate.deferredRequest(message.versionId)).resolves.not.toBeNull();
  });

  it('un échec de la passe finale ne fait pas perdre le résultat principal', async () => {
    const recompute = vi.fn<RecomputeFn>(async () => result());
    const gate = createMemoryGate();
    const { deps, logger } = setup(recompute, {
      trailing: {
        ...trailingFor(recordingLogger(), gate),
        sleep: async () => {
          throw new Error('sleep cassé');
        },
      },
    });
    await gate.markQueued(message.versionId, START);
    await gate.deferRequest({ ...message, requestedAt: DEFERRED_AT }, DEFERRED_AT);

    const received = await onMessage(message, deps);

    expect(received).toEqual(result());
    expect(recompute).toHaveBeenCalledTimes(1);
    const warned = logger.entries.find((entry) => entry.message === 'recompute trailing failed');
    expect(warned?.level).toBe('warn');
    await expect(gate.deferredRequest(message.versionId)).resolves.not.toBeNull();
  });
});
