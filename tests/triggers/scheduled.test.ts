import { describe, expect, it } from 'vitest';
import {
  onScheduled,
  scheduledMode,
  scheduledVersion,
  type ScheduledDeps,
  type ScheduledVersion,
  type ScheduledVersionSource,
} from '../../src/triggers/scheduled';
import { createMemoryGate } from '../../src/triggers/events';
import { OUTCOME_WINDOW_HOURS, type Outcome, type Waiver } from '../../src/types';
import type { LogLevel, Logger, RecomputeMessage } from '../../src/ports';
import { version } from '../fixtures/builders';

const NOW = '2026-11-11T10:00:00.000Z';

function hoursBefore(hours: number): string {
  return new Date(Date.parse(NOW) - hours * 3_600_000).toISOString();
}

function recordingLogger(): Logger & { entries: { level: LogLevel; message: string }[] } {
  const entries: { level: LogLevel; message: string }[] = [];
  return {
    entries,
    log(level: LogLevel, message: string): void {
      entries.push({ level, message });
    },
  };
}

interface SetupOptions {
  open?: ScheduledVersion[];
  released?: ScheduledVersion[];
  outcomes?: string[];
}

function setup(options: SetupOptions = {}) {
  const published: RecomputeMessage[] = [];
  const releasedQueries: string[] = [];
  let openQueries = 0;
  const versions: ScheduledVersionSource = {
    async listOpenVersions(): Promise<ScheduledVersion[]> {
      openQueries += 1;
      return options.open ?? [];
    },
    async listReleasedVersions(beforeIso: string): Promise<ScheduledVersion[]> {
      releasedQueries.push(beforeIso);
      return options.released ?? [];
    },
  };
  const outcomes = new Set(options.outcomes ?? []);
  const waivers = new Map<string, Waiver[]>();
  const deps: ScheduledDeps = {
    queue: {
      async publish(message: RecomputeMessage): Promise<void> {
        published.push(message);
      },
    },
    gate: createMemoryGate(),
    clock: { now: () => NOW },
    logger: recordingLogger(),
    versions,
    store: {
      async getOutcome(versionId: string): Promise<Outcome | null> {
        return outcomes.has(versionId) ? ({ versionId } as Outcome) : null;
      },
      async getWaivers(versionId: string): Promise<Waiver[]> {
        return waivers.get(versionId) ?? [];
      },
      async saveWaiver(waiver: Waiver): Promise<void> {
        const list = waivers.get(waiver.versionId) ?? [];
        waivers.set(waiver.versionId, [
          ...list.filter((candidate) => candidate.id !== waiver.id),
          waiver,
        ]);
      },
    },
  };
  return {
    deps,
    published,
    releasedQueries,
    waivers,
    openQueries: () => openQueries,
  };
}

const open24 = scheduledVersion(version({ id: 'ver-24' }));
const open25 = scheduledVersion(version({ id: 'ver-25' }));
const released23 = scheduledVersion(
  version({ id: 'ver-23', released: true }),
  hoursBefore(100),
);

describe('triggers/scheduled — hourly refresh', () => {
  it('asks a recompute for every version still open', async () => {
    const { deps, published } = setup({
      open: [open24, open25, released23],
    });
    const messages = await onScheduled({ context: { moduleKey: 'hourly-refresh' } }, deps);
    expect(messages.map((m) => m.versionId)).toEqual(['ver-24', 'ver-25']);
    expect(messages.every((m) => m.reason === 'schedule')).toBe(true);
    expect(published).toHaveLength(2);
  });

  it('does not run the outcome check on the hourly module', async () => {
    const { deps, releasedQueries } = setup({ open: [open24] });
    await onScheduled({ context: { moduleKey: 'hourly-refresh' } }, deps);
    expect(releasedQueries).toEqual([]);
  });

  it('is debounced like an event: one recompute per version and per minute', async () => {
    const { deps, published } = setup({ open: [open24] });
    await onScheduled({ context: { moduleKey: 'hourly-refresh' } }, deps);
    await onScheduled({ context: { moduleKey: 'hourly-refresh' } }, deps);
    expect(published).toHaveLength(1);
  });
});

describe('triggers/scheduled — 72 h outcome check', () => {
  it('queries only versions older than the outcome window', async () => {
    const { deps, releasedQueries } = setup({ released: [] });
    await onScheduled({ context: { moduleKey: 'daily-outcome' } }, deps);
    expect(releasedQueries).toEqual([
      new Date(Date.parse(NOW) - OUTCOME_WINDOW_HOURS * 3_600_000).toISOString(),
    ]);
  });

  it('asks an outcome recompute once the window is over', async () => {
    const { deps, published } = setup({
      released: [
        scheduledVersion(version({ id: 'ver-22', released: true }), hoursBefore(73)),
      ],
    });
    const messages = await onScheduled(
      { context: { moduleKey: 'daily-outcome' } },
      deps,
    );
    expect(messages).toHaveLength(1);
    expect(messages[0]?.reason).toBe('outcome');
    expect(published[0]?.versionId).toBe('ver-22');
  });

  it('does nothing before the 72 h mark', async () => {
    const { deps, published } = setup({
      released: [
        scheduledVersion(version({ id: 'ver-23', released: true }), hoursBefore(71)),
      ],
    });
    expect(await onScheduled({ context: { moduleKey: 'daily-outcome' } }, deps)).toEqual(
      [],
    );
    expect(published).toEqual([]);
  });

  it('never redoes an outcome already recorded', async () => {
    const { deps, published } = setup({
      released: [
        scheduledVersion(version({ id: 'ver-22', released: true }), hoursBefore(80)),
      ],
      outcomes: ['ver-22'],
    });
    expect(await onScheduled({ context: { moduleKey: 'daily-outcome' } }, deps)).toEqual(
      [],
    );
    expect(published).toEqual([]);
  });

  it('skips a released version with no publication date', async () => {
    const { deps, published } = setup({
      released: [scheduledVersion(version({ id: 'ver-21', released: true }))],
    });
    expect(await onScheduled({ context: { moduleKey: 'daily-outcome' } }, deps)).toEqual(
      [],
    );
    expect(published).toEqual([]);
  });
});

describe('triggers/scheduled — module routing and coalescing', () => {
  it('derives the mode from the manifest module key', () => {
    expect(scheduledMode({ context: { moduleKey: 'hourly-refresh' } })).toBe('hourly');
    expect(scheduledMode({ context: { moduleKey: 'daily-outcome' } })).toBe('outcome');
    expect(scheduledMode({})).toBe('both');
  });

  it('runs both jobs when the module key is unknown', async () => {
    const { deps, published } = setup({
      open: [open24],
      released: [
        scheduledVersion(version({ id: 'ver-22', released: true }), hoursBefore(73)),
      ],
    });
    await onScheduled({ context: { moduleKey: 'something-else' } }, deps);
    expect(published.map((m) => m.reason)).toEqual(['schedule', 'outcome']);
  });

  it('coalesces the two reasons for one version into the strongest', async () => {
    const { deps, published } = setup({
      open: [open24],
      released: [scheduledVersion(version({ id: 'ver-24', released: true }), hoursBefore(73))],
    });
    await onScheduled({ context: { moduleKey: 'something-else' } }, deps);
    expect(published).toHaveLength(1);
    expect(published[0]?.reason).toBe('schedule');
  });

  it('logs a debug line when there is nothing to queue', async () => {
    const { deps } = setup();
    await onScheduled({ context: { moduleKey: 'hourly-refresh' } }, deps);
    const logger = deps.logger as Logger & { entries: { message: string }[] };
    expect(logger.entries.some((e) => e.message.includes('nothing to queue'))).toBe(
      true,
    );
  });
});
