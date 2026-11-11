import { describe, expect, it } from 'vitest';
import {
  ISSUE_LINK_EVENTS,
  ISSUE_EVENTS,
  VERSION_EVENTS,
  createMemoryGate,
  onJiraEvent,
  type JiraEventLike,
  type RecomputeTarget,
  type TriggerDeps,
} from '../../src/triggers/events.js';
import type {
  LogLevel,
  Logger,
  RecomputeMessage,
} from '../../src/ports.js';

const START = '2026-11-11T10:00:00.000Z';
const AFTER_MINUTE = '2026-11-11T10:01:00.000Z';

interface LogEntry {
  level: LogLevel;
  message: string;
  meta?: Record<string, unknown>;
}

function recordingLogger(): Logger & { entries: LogEntry[] } {
  const entries: LogEntry[] = [];
  return {
    entries,
    log(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
      entries.push({ level, message, ...(meta === undefined ? {} : { meta }) });
    },
  };
}

function recordingQueue(): { published: RecomputeMessage[]; publish: (m: RecomputeMessage) => Promise<void> } {
  const published: RecomputeMessage[] = [];
  return {
    published,
    async publish(message: RecomputeMessage): Promise<void> {
      published.push(message);
    },
  };
}

function fakeClock(start: string): { now: () => string; set: (at: string) => void } {
  let current = start;
  return {
    now: () => current,
    set: (at: string) => {
      current = at;
    },
  };
}

function setup(overrides: Partial<TriggerDeps> = {}) {
  const queue = recordingQueue();
  const logger = recordingLogger();
  const clock = fakeClock(START);
  const deps: TriggerDeps = {
    queue,
    gate: createMemoryGate(),
    clock,
    logger,
    ...overrides,
  };
  return { deps, queue, logger, clock };
}

const released: JiraEventLike = {
  eventType: 'avi:jira:released:version',
  version: { id: 'ver-24', projectId: 'proj-pay' },
};

const issueUpdated: JiraEventLike = {
  eventType: 'avi:jira:updated:issue',
  issue: {
    id: '10031',
    key: 'PAY-131',
    fields: {
      project: { id: 'proj-pay' },
      fixVersions: [{ id: 'ver-24' }, { id: 'ver-25' }],
    },
  },
};

const issueLinkCreated: JiraEventLike = {
  eventType: 'avi:jira:created:issuelink',
  sourceProjectId: 'proj-pay',
  destinationProjectId: 'proj-mob',
  sourceIssueId: '10031',
  destinationIssueId: '10077',
};

describe('triggers/events — version events', () => {
  it('queues one recompute for a released version', async () => {
    const { deps, queue } = setup();
    const published = await onJiraEvent(released, deps);
    expect(published).toEqual([
      {
        projectId: 'proj-pay',
        versionId: 'ver-24',
        reason: 'event',
        requestedAt: START,
      },
    ]);
    expect(queue.published).toHaveLength(1);
  });

  it('recognises all nine version events of R3 §1.3', async () => {
    expect(VERSION_EVENTS).toHaveLength(9);
    for (const eventType of VERSION_EVENTS) {
      const { deps, queue } = setup();
      const published = await onJiraEvent({ ...released, eventType }, deps);
      expect(published).toHaveLength(1);
      expect(queue.published[0]?.reason).toBe('event');
    }
  });

  it('ignores a version event without project id, without throwing', async () => {
    const { deps, queue, logger } = setup();
    const published = await onJiraEvent(
      { eventType: 'avi:jira:updated:version', version: { id: 'ver-24' } },
      deps,
    );
    expect(published).toEqual([]);
    expect(queue.published).toEqual([]);
    expect(logger.entries[0]?.level).toBe('debug');
    expect(logger.entries[0]?.message).toContain('without version id');
  });
});

describe('triggers/events — one recompute per minute and per version', () => {
  it('merges two events of the same version inside the same minute', async () => {
    const { deps, queue } = setup();
    await onJiraEvent(released, deps);
    await onJiraEvent(
      { eventType: 'avi:jira:updated:version', version: released.version },
      deps,
    );
    expect(queue.published).toHaveLength(1);
  });

  it('queues again once the minute has elapsed', async () => {
    const { deps, queue, clock } = setup();
    await onJiraEvent(released, deps);
    clock.set(AFTER_MINUTE);
    await onJiraEvent(released, deps);
    expect(queue.published).toHaveLength(2);
    expect(queue.published[1]?.requestedAt).toBe(AFTER_MINUTE);
  });

  it('logs the skip at debug level', async () => {
    const { deps, logger } = setup();
    await onJiraEvent(released, deps);
    await onJiraEvent(released, deps);
    const skips = logger.entries.filter((e) => e.message.includes('debounce window'));
    expect(skips).toHaveLength(1);
    expect(skips[0]?.level).toBe('debug');
    expect(skips[0]?.meta?.versionId).toBe('ver-24');
  });

  it('honours a custom interval from the deps', async () => {
    const { deps, queue, clock } = setup({ minIntervalSeconds: 300 });
    await onJiraEvent(released, deps);
    clock.set('2026-11-11T10:04:59.000Z');
    await onJiraEvent(released, deps);
    expect(queue.published).toHaveLength(1);
  });
});

describe('triggers/events — issue events', () => {
  it('queues one recompute per fix version', async () => {
    const { deps, queue } = setup();
    await onJiraEvent(issueUpdated, deps);
    expect(queue.published.map((m) => m.versionId)).toEqual(['ver-24', 'ver-25']);
    expect(queue.published.every((m) => m.projectId === 'proj-pay')).toBe(true);
  });

  it('reads fix versions out of the changelog too, without duplicates', async () => {
    const { deps, queue } = setup();
    // Jira sends version ids (numeric strings) as the changelog `to` value.
    await onJiraEvent(
      {
        eventType: 'avi:jira:updated:issue',
        issue: {
          id: '10031',
          key: 'PAY-131',
          fields: { project: { id: 'proj-pay' }, fixVersions: [{ id: '10024' }] },
          changelog: {
            items: [
              { field: 'fixVersions', to: '10025' },
              { field: 'fixVersions', to: '10024' },
              { field: 'status', to: 'In Progress' },
            ],
          },
        },
      },
      deps,
    );
    expect(queue.published.map((m) => m.versionId)).toEqual(['10024', '10025']);
  });

  it('recognises the four issue events that can change a release', async () => {
    for (const eventType of ISSUE_EVENTS) {
      const { deps, queue } = setup();
      await onJiraEvent({ ...issueUpdated, eventType }, deps);
      expect(queue.published.length).toBeGreaterThan(0);
    }
  });
});

describe('triggers/events — issue-link events', () => {
  it('recognises the two link events of R3 §1.3', () => {
    expect(ISSUE_LINK_EVENTS).toEqual([
      'avi:jira:created:issuelink',
      'avi:jira:deleted:issuelink',
    ]);
  });

  it('drops a link event while the version lookup is not wired', async () => {
    const { deps, queue, logger } = setup();
    const published = await onJiraEvent(issueLinkCreated, deps);
    expect(published).toEqual([]);
    expect(queue.published).toEqual([]);
    expect(logger.entries[0]?.message).toContain('without version lookup');
    expect(logger.entries[0]?.level).toBe('debug');
  });

  it('queues the versions of both linked issues when the lookup is wired', async () => {
    const seen: string[][] = [];
    const lookup = async (issueIds: string[]): Promise<RecomputeTarget[]> => {
      seen.push(issueIds);
      return [
        { projectId: 'proj-pay', versionId: 'ver-24' },
        { projectId: 'proj-mob', versionId: 'ver-31' },
      ];
    };
    const { deps, queue } = setup({ versionsOfIssues: lookup });
    await onJiraEvent(issueLinkCreated, deps);
    expect(seen).toEqual([['10031', '10077']]);
    expect(queue.published.map((m) => m.versionId)).toEqual(['ver-24', 'ver-31']);
  });
});

describe('triggers/events — unrecognised events', () => {
  it('ignores an unknown event with a debug log and no throw', async () => {
    const { deps, queue, logger } = setup();
    const published = await onJiraEvent(
      { eventType: 'avi:jira:updated:project', selfGenerated: true },
      deps,
    );
    expect(published).toEqual([]);
    expect(queue.published).toEqual([]);
    expect(logger.entries).toEqual([
      {
        level: 'debug',
        message: 'ignored unrecognised Jira event',
        meta: { eventType: 'avi:jira:updated:project' },
      },
    ]);
  });

  it('ignores an event with no eventType at all', async () => {
    const { deps, queue } = setup();
    expect(await onJiraEvent({}, deps)).toEqual([]);
    expect(queue.published).toEqual([]);
  });
});
