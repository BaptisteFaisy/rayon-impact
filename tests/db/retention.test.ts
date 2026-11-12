import { describe, expect, it } from 'vitest';
import type { PruneReport, RetentionCandidate, RetentionPolicy } from '../../src/db/retention';
import {
  DEFAULT_RETENTION,
  PRUNE_BATCH_SIZE,
  formatRetentionReport,
  normalizePolicy,
  pruneSnapshots,
  selectSnapshotsToPrune,
} from '../../src/db/retention';
import { FakeSql } from './fake-sql';

/* ------------------------------------------------------------- fixtures */

/** Midday, so a same-day series never straddles two UTC calendar days. */
const NOW = '2026-11-12T12:00:00.000Z';
const PROJECT_ID = 'proj-1';

function policy(partial: Partial<RetentionPolicy> = {}): RetentionPolicy {
  return { keepPerVersion: 2, keepDailyAfterDays: 14, horizonDays: 180, ...partial };
}

function candidate(
  id: string,
  versionId: string,
  computedAt: string,
  isProtected = false,
): RetentionCandidate {
  return { id, versionId, computedAt, protected: isProtected };
}

function daysAgo(days: number, hours = 0): string {
  return new Date(Date.parse(NOW) - days * 86_400_000 - hours * 3_600_000).toISOString();
}

/** Forge returns TIMESTAMP as `YYYY-MM-DD HH:MM:SS[.fff]` (rows.ts). */
function forgeTimestamp(iso: string): string {
  return iso.replace('T', ' ').replace('Z', '');
}

function candidateRows(candidates: readonly RetentionCandidate[]): unknown[] {
  return candidates.map((item) => ({
    id: item.id,
    version_id: item.versionId,
    computed_at: forgeTimestamp(item.computedAt),
  }));
}

/** A fake programmed with the two reads `pruneSnapshots` performs. */
function fakeWith(
  candidates: readonly RetentionCandidate[],
  protectedIds: readonly string[] = [],
): FakeSql {
  const fake = new FakeSql();
  fake.on(/SELECT id, version_id, computed_at/, { rows: candidateRows(candidates) });
  fake.on(/FROM decision d/, {
    rows: protectedIds.map((snapshotId) => ({ snapshot_id: snapshotId })),
  });
  return fake;
}

function deletedIds(fake: FakeSql): string[] {
  return fake
    .matching(/DELETE FROM release_snapshot/)
    .flatMap((statement) => statement.params.map((param) => String(param)));
}

/* ------------------------------------------------------- règle pure */

describe('selectSnapshotsToPrune', () => {
  it('conserve toujours le dernier dossier de chaque version, même hors horizon', () => {
    const rules = policy({ keepPerVersion: 1, keepDailyAfterDays: 1, horizonDays: 10 });
    const candidates = [
      candidate('s-old', 'v1', daysAgo(100)),
      candidate('s-new', 'v1', daysAgo(99)),
      candidate('s-other', 'v2', daysAgo(100)),
    ];
    const pruned = selectSnapshotsToPrune(candidates, rules, NOW);
    expect(pruned).not.toContain('s-new');
    expect(pruned).not.toContain('s-other');
    expect(pruned).toEqual(['s-old']);
  });

  it('conserve exactement keepPerVersion dossiers par version dans la fenêtre récente', () => {
    const rules = policy({ keepPerVersion: 3, keepDailyAfterDays: 14, horizonDays: 180 });
    const candidates = Array.from({ length: 10 }, (_, index) =>
      candidate(`s-${index}`, 'v1', daysAgo(0, index / 60)),
    );
    const pruned = selectSnapshotsToPrune(candidates, rules, NOW);
    expect(candidates.length - pruned.length).toBe(3);
    expect(pruned).toHaveLength(7);
  });

  it('ne garde qu’un dossier par jour calendrier au-delà du seuil de jours', () => {
    const rules = policy({ keepPerVersion: 1, keepDailyAfterDays: 2, horizonDays: 100 });
    const candidates = [
      candidate('d3-a', 'v1', daysAgo(3)),
      candidate('d3-b', 'v1', daysAgo(3, 5)),
      candidate('d2-a', 'v1', daysAgo(4)),
      candidate('d2-b', 'v1', daysAgo(4, 5)),
    ];
    const pruned = selectSnapshotsToPrune(candidates, rules, NOW);
    // Un dossier par jour : le plus récent de chaque jour survit, l’autre part.
    expect(pruned).toEqual(['d2-b', 'd3-b']);
  });

  it('supprime tout au-delà de l’horizon, sauf le dernier dossier de la version', () => {
    const rules = policy({ keepPerVersion: 2, keepDailyAfterDays: 5, horizonDays: 30 });
    const candidates = [
      candidate('h-keep', 'v1', daysAgo(99)),
      candidate('h-1', 'v1', daysAgo(100)),
      candidate('h-2', 'v1', daysAgo(101)),
      candidate('h-3', 'v1', daysAgo(102)),
    ];
    const pruned = selectSnapshotsToPrune(candidates, rules, NOW);
    expect(pruned).toEqual(['h-3', 'h-2', 'h-1']);
    expect(pruned).not.toContain('h-keep');
  });

  it('ne supprime jamais un dossier protégé (champ protected)', () => {
    const rules = policy({ keepPerVersion: 1, keepDailyAfterDays: 1, horizonDays: 5 });
    const candidates = [
      candidate('p-a', 'v1', daysAgo(10), true),
      candidate('p-b', 'v1', daysAgo(20), true),
      candidate('p-c', 'v1', daysAgo(30)),
    ];
    expect(selectSnapshotsToPrune(candidates, rules, NOW)).toEqual(['p-c']);
  });

  it('ne supprime jamais un dossier protégé (jeu d’identifiants)', () => {
    const rules = policy({ keepPerVersion: 1, keepDailyAfterDays: 1, horizonDays: 5 });
    const candidates = [
      candidate('p-a', 'v1', daysAgo(10)),
      candidate('p-b', 'v1', daysAgo(20)),
    ];
    const protectedIds = new Set(['p-b']);
    expect(selectSnapshotsToPrune(candidates, rules, NOW, protectedIds)).toEqual([]);
  });

  it('rend un résultat stable et déterministe', () => {
    const rules = policy({ keepPerVersion: 2, keepDailyAfterDays: 0, horizonDays: 30 });
    // 24 dossiers, 3 versions, 3 par jour et par version : la règle garde le
    // quota récent puis un dossier par jour, et supprime le reste.
    const candidates = Array.from({ length: 24 }, (_, index) =>
      candidate(
        `s-${String(index).padStart(2, '0')}`,
        `v${index % 3}`,
        daysAgo(Math.floor(index / 8) + 1),
      ),
    );
    const first = selectSnapshotsToPrune(candidates, rules, NOW);
    const second = selectSnapshotsToPrune(candidates, rules, NOW);
    expect(first).toEqual(second);
    expect(first.length).toBe(12);
    // Ordre du plus ancien au plus récent : les suppressions commencent par le
    // dossier le moins utile et l’ordre ne bouge pas d’une exécution à l’autre.
    const timestamps = first.map((id) =>
      Date.parse(candidates.find((item) => item.id === id)?.computedAt ?? ''),
    );
    expect([...timestamps].sort((left, right) => left - right)).toEqual(timestamps);
  });

  it('cas limites : aucun dossier, un seul dossier, tous protégés', () => {
    const rules = policy({ keepPerVersion: 1, keepDailyAfterDays: 1, horizonDays: 5 });
    expect(selectSnapshotsToPrune([], rules, NOW)).toEqual([]);
    expect(selectSnapshotsToPrune([candidate('only', 'v1', daysAgo(99))], rules, NOW)).toEqual([]);
    const allProtected = [
      candidate('a', 'v1', daysAgo(10), true),
      candidate('b', 'v1', daysAgo(20), true),
    ];
    expect(selectSnapshotsToPrune(allProtected, rules, NOW)).toEqual([]);
  });

  it('cas limites : dates identiques, horloge illisible, date illisible', () => {
    const rules = policy({ keepPerVersion: 1, keepDailyAfterDays: 0, horizonDays: 5 });
    const sameDay = [
      candidate('b-same', 'v1', NOW),
      candidate('a-same', 'v1', NOW),
    ];
    // Tri déterministe : à date égale, le plus petit identifiant gagne.
    expect(selectSnapshotsToPrune(sameDay, rules, NOW)).toEqual(['b-same']);
    // Une horloge illisible ne doit jamais effacer l'historique.
    expect(selectSnapshotsToPrune(sameDay, rules, 'not-a-date')).toEqual([]);
    // Un dossier dont la date est illisible est conservé.
    expect(selectSnapshotsToPrune([candidate('x', 'v1', '')], rules, NOW)).toEqual([]);
  });

  it('normalise une politique absurde au lieu de lever', () => {
    expect(normalizePolicy({ keepPerVersion: -3, keepDailyAfterDays: 1.7, horizonDays: NaN })).toEqual({
      keepPerVersion: 0,
      keepDailyAfterDays: 1,
      horizonDays: DEFAULT_RETENTION.horizonDays,
    });
  });
});

/* ------------------------------------------------------------- adapter */

describe('pruneSnapshots', () => {
  it('supprime les signals avant les dossiers, par lots bornés', async () => {
    const candidates = Array.from({ length: 120 }, (_, index) =>
      candidate(`s-${String(index).padStart(3, '0')}`, 'v1', daysAgo(0, index / 60)),
    );
    const fake = fakeWith(candidates);
    const times = [10, 25];
    let tick = 0;
    const report = await pruneSnapshots(
      fake,
      PROJECT_ID,
      policy({ keepPerVersion: 1, keepDailyAfterDays: 0, horizonDays: 180 }),
      NOW,
      { batchSize: 50, clock: () => times[tick++] ?? 25 },
    );

    expect(report.scanned).toBe(120);
    expect(report.pruned).toBe(119);
    expect(report.batches).toBe(3);
    expect(report.protected).toBe(0);
    expect(report.durationMs).toBe(15);

    const deletes = fake.statements.filter((statement) => /DELETE FROM/.test(statement.sql));
    expect(deletes).toHaveLength(6);
    for (let index = 0; index < deletes.length; index += 2) {
      expect(deletes[index].sql).toMatch(/DELETE FROM signal/);
      expect(deletes[index + 1].sql).toMatch(/DELETE FROM release_snapshot/);
    }
    for (const statement of deletes) {
      expect(statement.params.length).toBeGreaterThan(0);
      expect(statement.params.length).toBeLessThanOrEqual(PRUNE_BATCH_SIZE);
      expect(statement.sql).toMatch(/ IN \(/);
    }
  });

  it('ne touche jamais aux autres tables', async () => {
    const candidates = Array.from({ length: 10 }, (_, index) =>
      candidate(`s-${index}`, 'v1', daysAgo(0, index / 60)),
    );
    const fake = fakeWith(candidates);
    await pruneSnapshots(
      fake,
      PROJECT_ID,
      policy({ keepPerVersion: 1, keepDailyAfterDays: 0 }),
      NOW,
    );
    for (const table of ['waiver', 'decision', 'outcome', 'policy', 'service_map', 'collection']) {
      expect(fake.matching(new RegExp(`(DELETE|UPDATE|INSERT) (INTO|FROM) ${table}`))).toHaveLength(0);
    }
    // Jamais de suppression de table entière : toujours une liste d'ids.
    for (const statement of fake.matching(/DELETE FROM/)) {
      expect(statement.sql).toMatch(/WHERE .* IN \(/);
    }
  });

  it('lit des candidats bornés (LIMIT en dur, jamais LIMIT ?)', async () => {
    const fake = fakeWith([candidate('s-1', 'v1', daysAgo(1))]);
    await pruneSnapshots(fake, PROJECT_ID, policy(), NOW, { maxCandidates: 10 });
    const reads = fake.matching(/SELECT/);
    expect(reads).toHaveLength(2);
    for (const read of reads) {
      expect(read.sql).toMatch(/LIMIT \d+/);
      expect(read.sql).not.toMatch(/LIMIT \?/);
    }
    expect(reads[0].sql).toMatch(/LIMIT 10/);
  });

  it('protège les dossiers d’une décision', async () => {
    const candidates = Array.from({ length: 5 }, (_, index) =>
      candidate(`s-${index}`, 'v1', daysAgo(0, index / 60)),
    );
    const fake = fakeWith(candidates, ['s-2']);
    const report = await pruneSnapshots(
      fake,
      PROJECT_ID,
      policy({ keepPerVersion: 1, keepDailyAfterDays: 0 }),
      NOW,
    );
    expect(report.protected).toBe(1);
    expect(deletedIds(fake)).not.toContain('s-2');
    expect(deletedIds(fake)).toContain('s-3');
  });

  it('renseigne un rapport complet et ne supprime rien quand rien ne doit l’être', async () => {
    const fake = fakeWith([candidate('only', 'v1', daysAgo(1))]);
    const report: PruneReport = await pruneSnapshots(fake, PROJECT_ID, policy(), NOW);
    expect(report).toEqual({
      scanned: 1,
      pruned: 0,
      protected: 0,
      batches: 0,
      durationMs: report.durationMs,
    });
    expect(fake.matching(/DELETE FROM/)).toHaveLength(0);
  });
});

describe('formatRetentionReport', () => {
  it('rend une ligne technique pour les journaux', () => {
    const line = formatRetentionReport(
      { scanned: 31, pruned: 12, protected: 2, batches: 1, durationMs: 48 },
      'fr',
    );
    expect(line).toContain('scanned=31');
    expect(line).toContain('pruned=12');
    expect(line).toContain('protected=2');
    expect(line).toContain('batches=1');
    expect(line).toContain('durationMs=48');
  });
});
