import { describe, expect, it } from 'vitest';
import { CREATE_RECALC_DEFERRED, defineAllTables } from '../../src/db/schema';

/**
 * La migration v004 ajoute la table des demandes de recalcul reportées
 * (SPEC §12 : « regroupé, jamais jeté »). Les noms de migration sont stables :
 * Forge rejoue un nom déjà passé comme un no-op, donc renommer v001/v002/v003
 * recréerait tout sur une installation existante.
 *
 * Rule: files < 500 lines, functions < 50 lines.
 */

const NAMES = defineAllTables().map((migration) => migration.name);

describe('db/schema — v004_create_recalc_deferred', () => {
  it('ajoute la migration sans renommer les précédentes', () => {
    expect(NAMES).toContain('v001_create_recalc_pending');
    expect(NAMES).toContain('v002_drop_signal_legacy');
    expect(NAMES).toContain('v003_create_signal_row_key');
    expect(NAMES).toContain('v004_create_recalc_deferred');
  });

  it('la joue en dernier, après les tables et les migrations existantes', () => {
    expect(NAMES[NAMES.length - 1]).toBe('v004_create_recalc_deferred');
  });

  it('porte le DDL de la table, idempotent et borné par version', () => {
    expect(CREATE_RECALC_DEFERRED).toMatch(/CREATE TABLE IF NOT EXISTS recalc_deferred/);
    expect(CREATE_RECALC_DEFERRED).toMatch(/version_id VARCHAR\(64\) NOT NULL PRIMARY KEY/);
    for (const column of ['project_id', 'reason', 'requested_at', 'deferred_at']) {
      expect(CREATE_RECALC_DEFERRED).toContain(column);
    }
  });

  it('applique un DDL unique par nom de migration', () => {
    const unique = new Set(NAMES);
    expect(unique.size).toBe(NAMES.length);
  });
});
