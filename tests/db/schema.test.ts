import { describe, expect, it } from 'vitest';
import {
  ALTER_COLLECTION_MEDIUMTEXT,
  CREATE_COLLECTION,
  CREATE_RECALC_DEFERRED,
  defineAllTables,
} from '../../src/db/schema';

/**
 * Les migrations ajoutées après les tables v001 (SPEC §12 : « regroupé, jamais
 * jeté »). Les noms de migration sont stables : Forge rejoue un nom déjà passé
 * comme un no-op, donc renommer v001/v002/v003 recréerait tout sur une
 * installation existante.
 *
 * Rule: files < 500 lines, functions < 50 lines.
 */

const NAMES = defineAllTables().map((migration) => migration.name);

describe('db/schema — migrations', () => {
  it('ajoute les migrations sans renommer les précédentes', () => {
    expect(NAMES).toContain('v001_create_recalc_pending');
    expect(NAMES).toContain('v002_drop_signal_legacy');
    expect(NAMES).toContain('v003_create_signal_row_key');
    expect(NAMES).toContain('v004_create_recalc_deferred');
    expect(NAMES).toContain('v005_collection_mediumtext');
  });

  it('les joue dans l\'ordre, les tables d\'abord', () => {
    const tables = NAMES.filter((name) => name.startsWith('v001_create_'));
    const migrations = NAMES.filter((name) => !name.startsWith('v001_create_'));
    expect(NAMES.indexOf(migrations[0])).toBeGreaterThan(NAMES.indexOf(tables[tables.length - 1]));
    expect(migrations[migrations.length - 1]).toBe('v005_collection_mediumtext');
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

describe('db/schema — la collection doit garder un release entier', () => {
  it('stocke le payload dans un MEDIUMTEXT, pas un TEXT', () => {
    // Un `TEXT` MySQL s'arrête à 65 535 octets ; un release de 200 tickets
    // (avec ses versions sœurs, ses incidents, ses pages et le graphe)
    // dépasse cette limite : l'écriture échouait et la collection restait
    // vide, donc le graphe et la date de release disparaissaient (2026-11-13).
    expect(CREATE_COLLECTION).toMatch(/payload_json MEDIUMTEXT/);
    expect(CREATE_COLLECTION).not.toMatch(/payload_json TEXT/);
  });

  it('élargit la colonne des installations existantes', () => {
    expect(ALTER_COLLECTION_MEDIUMTEXT).toMatch(/ALTER TABLE collection MODIFY payload_json MEDIUMTEXT/);
  });
});
