import { describe, expect, it, vi } from 'vitest';

vi.mock('@forge/llm', () => ({
  list: async () => ({ models: [{ model: 'claude-sonnet-4-5', status: 'active' }] }),
  chat: async () => ({ choices: [{ message: { content: '' } }] }),
}));
import { createLlmNarrativeWriter, extractText, NARRATIVE_MODEL_FALLBACK } from '../../src/collect/llm';

/**
 * The LLM adapter: text extraction from both response shapes, and a writer
 * that never throws (the pipeline has a deterministic fallback).
 *
 * Rule: files < 500 lines, functions < 50 lines.
 */

describe('extractText', () => {
  it('reads a plain string', () => {
    expect(extractText('NO-GO on 2.4')).toBe('NO-GO on 2.4');
  });

  it('joins content parts', () => {
    expect(
      extractText([
        { type: 'text', text: 'NO-GO ' },
        { type: 'text', text: 'on 2.4' },
      ]),
    ).toBe('NO-GO on 2.4');
  });

  it('returns an empty string for anything else', () => {
    expect(extractText(undefined)).toBe('');
    expect(extractText(null)).toBe('');
    expect(extractText(42)).toBe('');
    expect(extractText([{ type: 'image' }])).toBe('');
  });
});

describe('createLlmNarrativeWriter', () => {
  it('exposes the narrative writer port', () => {
    const writer = createLlmNarrativeWriter();
    expect(typeof writer.write).toBe('function');
    expect(NARRATIVE_MODEL_FALLBACK.length).toBeGreaterThan(0);
  });
});
