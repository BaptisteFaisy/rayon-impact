import { renderToStaticMarkup } from 'react-dom/server';
import { createElement as h } from 'react';
import { DEMO_SCENARIOS, demoScenario } from '../../tests/fixtures/demo-scenarios';
import { demoRuntime } from '../../tests/demo/runtime';
import { demoDataset } from '../../tests/demo/dataset';
import type { DemoRuntime } from '../../tests/demo/runtime';
import { GadgetScreen, IssueScreen, ProjectScreen, SettingsScreen, tabOf } from './views';
import { shell } from './shell';
import type { DemoDataset } from '../../tests/demo/dataset';
import type { Confidence, Locale, SeverityCounts, Verdict } from '../../src/types';
import { ACTION_KEYS } from '../../src/actions/registry';

/**
 * Entry point of the offline demo: one bundle, four real screens, nine real
 * actions. `demo/server.mjs` (plain Node, no dependency) calls these functions
 * and streams what they return — the server holds no logic of its own, so the
 * demo cannot drift from the app.
 *
 * Rule: files < 500 lines, functions < 50 lines.
 */

/**
 * The test double of `@forge/react` draws platform props (`isBold`, `openNewTab`)
 * as DOM attributes, so React complains on every render. The complaint is noise,
 * not a defect: inside Atlassian's runtime those props are read by the platform,
 * and the demo only needs the markup. React 18 routes the message through
 * `console.error` in production builds, so both streams are filtered — and only
 * for this one pattern: anything else still reaches the console.
 */
const IGNORED_WARNING = /does not recognize the .* prop on a DOM element/;

/** Silences one known-noisy React message, keeping every other log intact. */
function mute(pattern: RegExp, stream: 'warn' | 'error'): void {
  const real = console[stream];
  console[stream] = (...args: unknown[]): void => {
    if (typeof args[0] === 'string' && pattern.test(args[0])) return;
    real(...(args as [unknown, ...unknown[]]));
  };
}

mute(IGNORED_WARNING, 'warn');
mute(IGNORED_WARNING, 'error');

/** Who is watching: the release lead (may waive) or a plain reader. */
export type DemoRole = 'lead' | 'reader';

/** Which screen of the app the URL asks for. */
export type DemoScreen = 'project' | 'settings' | 'gadget' | 'issue';

/** One runnable demo: its scenario, its runtime and its dataset. */
interface DemoEntry {
  id: string;
  label: { en: string; fr: string };
  story: { en: string; fr: string };
  runtime: DemoRuntime;
  dataset: DemoDataset;
}

/** A single runtime per scenario: viewer/locale changes must not reset writes. */
const cache = new Map<string, DemoEntry>();

/** Builds a runtime once, then refreshes the screen data from its live store. */
async function entryOf(scenarioId: string, role: DemoRole, locale: Locale): Promise<DemoEntry> {
  const cached = cache.get(scenarioId);
  if (cached) {
    cached.dataset = await demoDataset(cached.runtime, { role, locale });
    return cached;
  }
  const scenario = demoScenario(scenarioId);
  const runtime = await demoRuntime(scenario);
  const dataset = await demoDataset(runtime, { role, locale });
  const entry: DemoEntry = {
    id: scenario.id,
    label: scenario.label,
    story: scenario.story,
    runtime,
    dataset,
  };
  cache.set(scenarioId, entry);
  return entry;
}

/** Clears one in-memory demo scenario, for a fresh take. */
export function resetScenario(scenarioId: string): boolean {
  return cache.delete(scenarioId);
}

/** The scenario list of the landing page, with its measured verdict. */
export interface ScenarioSummary {
  id: string;
  label: { en: string; fr: string };
  story: { en: string; fr: string };
  verdict: Verdict;
  confidence: Confidence;
  counts: SeverityCounts;
}

export async function listScenarios(): Promise<ScenarioSummary[]> {
  const out = [];
  for (const scenario of DEMO_SCENARIOS) {
    const entry = await entryOf(scenario.id, 'lead', 'en');
    const { snapshot } = entry.dataset.dossier;
    out.push({
      id: scenario.id,
      label: scenario.label,
      story: scenario.story,
      verdict: snapshot.verdict,
      confidence: snapshot.confidence,
      counts: snapshot.counts,
    });
  }
  return out;
}

/** The landing page: every playable scenario, its verdict and its screens. */
export async function indexPage(locale: Locale): Promise<string> {
  const scenarios = await listScenarios();
  const cards = scenarios
    .map((scenario) => {
      const href = `/s/${scenario.id}?locale=${locale}`;
      return `<article class="card"><h3>${escapeHtml(scenario.label[locale])}</h3>
<p>${escapeHtml(scenario.story[locale])}</p>
<p><span class="verdict verdict--${scenario.verdict}">${escapeHtml(scenario.verdict)}</span>
 · ${escapeHtml(scenario.confidence)} · ${JSON.stringify(scenario.counts)}</p>
<p><a class="button" href="${href}">${locale === 'fr' ? 'Ouvrir la release' : 'Open the release'}</a></p>
</article>`;
    })
    .join('\n');
  const title = locale === 'fr' ? 'Rayon d’impact — démo hors ligne' : 'Release Impact Radius — offline demo';
  const intro = locale === 'fr'
    ? `Quatre releases jouées par le moteur réel : pipeline, résolveurs et actions
       d’Atlassian sont appelés tels quels, sans site Jira ni modèle.<br>
       <code>node demo/server.mjs</code> puis ouvre une release.`
    : `Four releases played by the real engine: the pipeline, the resolvers and the
       nine Atlassian actions are called as they are, with no Jira site and no model.<br>
       <code>node demo/server.mjs</code>, then open a release.`;
  return shell({
    title,
    locale,
    body: `<h1>${escapeHtml(title)}</h1><p>${intro}</p>${cards}`,
    nav: [],
  });
}

/** The four screens of one scenario, rendered by the production components. */
export async function screenPage(
  scenarioId: string,
  screen: DemoScreen,
  query: Record<string, string | undefined>,
): Promise<string> {
  const locale: Locale = query.locale === 'fr' ? 'fr' : 'en';
  const role: DemoRole = query.role === 'reader' ? 'reader' : 'lead';
  const entry = await entryOf(scenarioId, role, locale);
  const base = `/s/${scenarioId}/${screen}`;
  const body = screenMarkup(entry, screen, query, locale, base);
  return shell({
    title: entry.label[locale],
    locale,
    role,
    scenarioId,
    body,
    nav: navItems(scenarioId, locale, role),
  });
}

/** One screen mounted with the real components. */
function screenMarkup(
  entry: DemoEntry,
  screen: DemoScreen,
  query: Record<string, string | undefined>,
  locale: Locale,
  base: string,
): string {
  const props = { dataset: entry.dataset, locale };
  if (screen === 'settings') return renderToStaticMarkup(h(SettingsScreen, props));
  if (screen === 'gadget') return renderToStaticMarkup(h(GadgetScreen, props));
  if (screen === 'issue') return renderToStaticMarkup(h(IssueScreen, props));
  return renderToStaticMarkup(
    h(ProjectScreen, { ...props, tab: tabOf(query.tab), base }),
  );
}

/** The nav of a scenario page: the four screens, the two identities, both clocks. */
function navItems(scenarioId: string, locale: Locale, role: DemoRole) {
  const labels = locale === 'fr'
    ? { project: 'Projet', settings: 'Réglages', gadget: 'Gadget', issue: 'Ticket' }
    : { project: 'Project', settings: 'Settings', gadget: 'Gadget', issue: 'Ticket' };
  const screens: [DemoScreen, string][] = [
    ['project', labels.project],
    ['issue', labels.issue],
    ['settings', labels.settings],
    ['gadget', labels.gadget],
  ];
  return screens.map(([screen, label]) => ({
    href: `/s/${scenarioId}/${screen}?locale=${locale}&role=${role}`,
    label,
  }));
}

/** The JSON the demo API returns for one scenario (the saved dossier). */
export async function dossierJson(
  scenarioId: string,
  role: DemoRole,
  locale: Locale,
): Promise<unknown> {
  const entry = await entryOf(scenarioId, role, locale);
  return entry.dataset.dossier;
}

/** Every read of the project screen, as the resolvers answer them. */
export async function readsJson(
  scenarioId: string,
  role: DemoRole,
  locale: Locale,
): Promise<unknown> {
  const entry = await entryOf(scenarioId, role, locale);
  return {
    versionRows: entry.dataset.versionRows,
    graph: entry.dataset.graph,
    diff: entry.dataset.diff,
    teams: entry.dataset.teams,
    gadgetRows: entry.dataset.gadgetRows,
    issueContext: entry.dataset.issueContext,
    policy: entry.dataset.policy,
    simulate: entry.dataset.simulate,
  };
}

/** Runs one real action against a scenario, and returns its answer. */
export async function actionJson(
  scenarioId: string,
  key: string,
  raw: Record<string, unknown>,
  role: DemoRole,
  locale: Locale,
): Promise<unknown> {
  if (!ACTION_KEYS.includes(key as (typeof ACTION_KEYS)[number])) {
    return { ok: false, error: { code: 'invalid-input', message: `Unknown action "${key}"` } };
  }
  const entry = await entryOf(scenarioId, role, locale);
  const viewer = {
    accountId: role === 'lead' ? 'user-release-lead' : 'user-reader',
    locale,
    canWaive: role === 'lead',
    visibility: { isVisible: () => true },
  };
  try {
    return { ok: true, action: key, result: await entry.runtime.action(key, raw, viewer) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, action: key, error: { code: 'refused', message } };
  }
}

/** The action keys the demo exposes, so the page can list them honestly. */
export function actionKeys(): string[] {
  return [...ACTION_KEYS];
}

/** Escapes text that never went through React (the landing page only). */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
