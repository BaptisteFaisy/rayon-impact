import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DICTIONARY_EN, DICTIONARY_FR } from '../../src/i18n/index';
import { SEVERITY_ORDER } from '../../src/types';
import type { Confidence, DecisionKind, Verdict } from '../../src/types';

/**
 * i18n completeness of the UI (SPEC §15: interface in English AND French).
 *
 * Static analysis of src/ui/**: every `t({ key: 'literal' })` must exist in
 * both dictionaries. This is the one test that reads files (no network, no
 * side effect) — the completeness guarantee is worth it.
 *
 * Rule: files < 500 lines, functions < 50 lines.
 */

const UI_ROOT = fileURLToPath(new URL('../../src/ui', import.meta.url));

/**
 * Keys built from a template literal (`verdict.${verdict}`): each family is
 * declared here with every member that must exist in both dictionaries.
 * Members mirror the union types of src/types/core.ts.
 */
const VERDICTS: Verdict[] = ['go', 'conditional-go', 'no-go', 'not-applicable'];
const CONFIDENCES: Confidence[] = ['high', 'medium', 'low'];
const DECISIONS: DecisionKind[] = ['ship', 'hold', 'delay'];

const DYNAMIC_KEY_FAMILIES: Record<string, string[]> = {
  'verdict.': VERDICTS,
  'severity.': [...SEVERITY_ORDER],
  'confidence.': CONFIDENCES,
  'decision.': DECISIONS,
};

/**
 * Keys passed to `t()` through a variable (ternary in SimulationPanel): the
 * literal scan cannot see them, so they are declared explicitly.
 */
const VARIABLE_KEYS = ['simulation.minimal', 'simulation.minimalUnproven'];

function uiFiles(dir: string): string[] {
  const entries = readdirSync(dir).map((name) => join(dir, name));
  return entries.flatMap((entry) =>
    statSync(entry).isDirectory()
      ? uiFiles(entry)
      : entry.endsWith('.ts') || entry.endsWith('.tsx')
        ? [entry]
        : [],
  );
}

interface LiteralKeyUse {
  file: string;
  key: string;
}

/** Every `t({ key: 'literal' })` and `t({ key: \`literal\` })` of src/ui. */
function literalKeyUses(): LiteralKeyUse[] {
  const uses: LiteralKeyUse[] = [];
  const quoted = /\bt\(\s*\{\s*key:\s*'([^']+)'/g;
  const backticked = /\bt\(\s*\{\s*key:\s*`([^`$]+)`/g;
  for (const file of uiFiles(UI_ROOT)) {
    const source = readFileSync(file, 'utf8');
    for (const regex of [quoted, backticked]) {
      regex.lastIndex = 0;
      for (const match of source.matchAll(regex)) {
        uses.push({ file, key: match[1] });
      }
    }
  }
  return uses;
}

/** Every dynamic family actually used in src/ui (`t({ key: \`prefix.${…}\` })`). */
function dynamicKeyPrefixes(): string[] {
  const prefixes = new Set<string>();
  const templated = /\bt\(\s*\{\s*key:\s*`([a-zA-Z0-9_.-]+)\.\$\{/g;
  for (const file of uiFiles(UI_ROOT)) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(templated)) {
      prefixes.add(`${match[1]}.`);
    }
  }
  return [...prefixes];
}

function missingIn(key: string): string[] {
  const missing: string[] = [];
  if (!(key in DICTIONARY_EN)) missing.push('DICTIONARY_EN');
  if (!(key in DICTIONARY_FR)) missing.push('DICTIONARY_FR');
  return missing;
}

describe('i18n completeness of src/ui', () => {
  it('every literal t({ key }) exists in the EN and FR dictionaries', () => {
    const problems = literalKeyUses()
      .map((use) => ({ ...use, missing: missingIn(use.key) }))
      .filter((use) => use.missing.length > 0)
      .map((use) => `${use.key} (${use.missing.join(', ')}) in ${use.file}`);
    expect(problems).toEqual([]);
  });

  it('the literal scan really sees the UI keys (guards the regex)', () => {
    const keys = new Set(literalKeyUses().map((use) => use.key));
    expect(keys.size).toBeGreaterThan(8);
    expect(keys.has('diff.title')).toBe(true);
    expect(keys.has('simulation.run')).toBe(true);
    expect(keys.has('signals.none.active')).toBe(true);
  });

  it('every dynamic key family used in src/ui is declared with its members', () => {
    const undeclared = dynamicKeyPrefixes().filter(
      (prefix) => !(prefix in DYNAMIC_KEY_FAMILIES),
    );
    expect(undeclared).toEqual([]);
  });

  it('every member of every declared family exists in both dictionaries', () => {
    const problems: string[] = [];
    for (const [prefix, members] of Object.entries(DYNAMIC_KEY_FAMILIES)) {
      for (const member of members) {
        for (const dict of missingIn(`${prefix}${member}`)) {
          problems.push(`${prefix}${member} missing in ${dict}`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it('keys passed to t() through a variable exist in both dictionaries', () => {
    const problems = VARIABLE_KEYS.flatMap((key) =>
      missingIn(key).map((dict) => `${key} missing in ${dict}`),
    );
    expect(problems).toEqual([]);
  });

  it('the EN and FR dictionaries carry exactly the same key set', () => {
    const en = Object.keys(DICTIONARY_EN);
    const fr = Object.keys(DICTIONARY_FR);
    expect(en.filter((key) => !fr.includes(key))).toEqual([]);
    expect(fr.filter((key) => !en.includes(key))).toEqual([]);
  });
});
