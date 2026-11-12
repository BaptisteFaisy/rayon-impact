import { describe, expect, it } from 'vitest';
import { mergeSources } from '../../src/collect/collector';
import type { SourceStatus } from '../../src/types';

/**
 * Precedence of the source statuses in the composed collector.
 *
 * Observed live on the demo site: `jsm` stayed `unavailable` forever, because the
 * Jira collector writes that placeholder when its optional incident source is not
 * wired, and the merge kept the first status it saw — the placeholder — instead
 * of the one produced by the JSM collector that really answered.
 *
 * Rule: files < 500 lines, functions < 50 lines.
 */

const status = (source: SourceStatus['source'], state: SourceStatus['state']): SourceStatus => ({
  source,
  state,
});

describe('mergeSources', () => {
  it('lets a really collected source override the Jira placeholder', () => {
    const base = [status('jira', 'ok'), status('jsm', 'unavailable'), status('confluence', 'unavailable')];
    const extra = [status('jsm', 'ok'), status('confluence', 'partial'), status('teamwork-graph', 'unavailable')];

    const merged = new Map(mergeSources(base, extra).map((entry) => [entry.source, entry.state]));

    expect(merged.get('jsm')).toBe('ok');
    expect(merged.get('confluence')).toBe('partial');
    expect(merged.get('jira')).toBe('ok');
    expect(merged.get('teamwork-graph')).toBe('unavailable');
  });

  it('keeps the sources the extra list does not mention', () => {
    const merged = mergeSources(
      [status('jira', 'ok'), status('service-map', 'empty'), status('development', 'unavailable')],
      [status('jsm', 'ok')],
    );
    const bySource = new Map(merged.map((entry) => [entry.source, entry.state]));
    expect(bySource.get('service-map')).toBe('empty');
    expect(bySource.get('development')).toBe('unavailable');
    expect(bySource.get('jsm')).toBe('ok');
  });

  it('never duplicates a source', () => {
    const merged = mergeSources([status('jira', 'ok'), status('jira', 'empty')], [status('jira', 'partial')]);
    expect(merged).toHaveLength(1);
    expect(merged[0].state).toBe('partial');
  });
});
