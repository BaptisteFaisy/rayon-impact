import { describe, expect, it, vi } from 'vitest';
import {
  onMessage,
  type ConsumerDeps,
  type RecomputeFn,
} from '../../src/triggers/consumer';
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

// The injected fake never touches the pipeline ports; only the request matters here.
const pipeline = {} as PipelineDeps;

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

function setup(recompute: RecomputeFn, overrides: Partial<ConsumerDeps> = {}) {
  const logger = recordingLogger();
  const deps: ConsumerDeps = { pipeline, recompute, logger, ...overrides };
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
