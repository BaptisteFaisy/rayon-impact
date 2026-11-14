import { VerdictBanner } from '../../src/ui/components/VerdictBanner';
import { CoverageMeter } from '../../src/ui/components/CoverageMeter';
import { DiffBanner } from '../../src/ui/components/DiffBanner';
import { GraphView } from '../../src/ui/components/GraphView';
import { SimulationPanel } from '../../src/ui/components/SimulationPanel';
import { SignalsTab } from '../../src/ui/tabs/SignalsTab';
import { TeamsTab } from '../../src/ui/tabs/TeamsTab';
import { WaiversTab } from '../../src/ui/tabs/WaiversTab';
import { HistoryTab } from '../../src/ui/tabs/HistoryTab';
import { SettingsView } from '../../src/ui/settingsPage';
import { IssueContextView } from '../../src/ui/issueContext';
import { GadgetList } from '../../src/ui/gadget';
import { VersionPicker } from '../../src/ui/projectPage';
import { Box, Em, Heading, List, ListItem, Lozenge, SectionMessage, Text } from '../../src/ui/kit';
import { t } from '../../src/i18n/index';
import { describeRemoval } from '../../src/engine/simulate';
import type { DemoDataset } from '../../tests/demo/dataset';
import type { ImpactedTeam, Locale, Signal } from '../../src/types';
import type { SimulateWithoutOutput } from '../../src/actions/types';

/**
 * The bodies of the four demo screens, mounted from the PRODUCTION components
 * (verdict banner, coverage meter, diff, the five tabs, the settings table, the
 * gadget list, the ticket panel). Nothing here re-implements a screen: the demo
 * differs from the app only in how the data reaches the component.
 *
 * `DossierTabs` is not used because the platform `Tabs` renders every panel in
 * static markup; the demo shows one panel per URL, with the real tab component.
 *
 * Rule: files < 500 lines, functions < 50 lines.
 */

/** The five tabs of the project screen, in the order the app declares them. */
export const TABS = ['signals', 'graph', 'teams', 'waivers', 'history'] as const;
export type DemoTab = (typeof TABS)[number];

/** The tab of a URL, falling back to the first one (never a blank screen). */
export function tabOf(value: string | undefined): DemoTab {
  return TABS.includes(value as DemoTab) ? (value as DemoTab) : 'signals';
}

/** Verdict, coverage, what changed, the written summary: the screen header. */
function DossierHeader({ dataset, locale }: { dataset: DemoDataset; locale: Locale }) {
  const { snapshot } = dataset.dossier;
  return (
    <Box>
      <VerdictBanner
        verdict={snapshot.verdict}
        confidence={snapshot.confidence}
        computedAt={snapshot.computedAt}
        locale={locale}
      />
      <CoverageMeter coverage={snapshot.coverage} locale={locale} />
      <DiffBanner diff={dataset.diff} locale={locale} />
      <Box>
        <Heading as="h4">
          {locale === 'fr' ? 'Synthèse' : 'Summary'}
        </Heading>
        <Text>{snapshot.narrative}</Text>
        <NarrativeNote locale={locale} />
      </Box>
    </Box>
  );
}

/**
 * The app writes ONE summary per dossier, in the language the pipeline pins
 * (`src/engine/pipeline.ts`: `locale: 'en'`), so a French screen shows an English
 * summary. That is a real gap of the app, not of the demo: saying it on screen
 * beats hiding it behind a translation nobody asked for.
 */
function NarrativeNote({ locale }: { locale: Locale }) {
  return (
    <Text>
      <Em>
        {locale === 'fr'
          ? 'Une seule synthèse par dossier, écrite en anglais par le moteur : le français est un écart connu (SPEC §15).'
          : 'One summary per dossier, written in English by the engine: French is a known gap (SPEC §15).'}
      </Em>
    </Text>
  );
}

/** One tab body, rendered by the same component the app renders. */
function TabBody({ dataset, locale, tab }: {
  dataset: DemoDataset;
  locale: Locale;
  tab: DemoTab;
}) {
  const { signals, waivers, decisions, outcome } = dataset.dossier;
  if (tab === 'graph') {
    return dataset.graph
      ? <GraphView graph={dataset.graph} locale={locale} />
      : <Text>{locale === 'fr' ? 'Graphe indisponible.' : 'Graph unavailable.'}</Text>;
  }
  if (tab === 'teams') return <TeamsTab teams={dataset.teams as ImpactedTeam[]} locale={locale} />;
  if (tab === 'waivers') return <WaiversTab waivers={waivers} locale={locale} />;
  if (tab === 'history') return <HistoryTab decisions={decisions} outcome={outcome} locale={locale} />;
  return (
    <SignalsTab
      signals={signals}
      locale={locale}
      waiving={null}
      onWaive={() => {}}
      versionId={dataset.dossier.snapshot.versionId}
    />
  );
}

/** The tab strip, as links: every URL is one real tab of the screen. */
function TabStrip({ base, tab, locale }: { base: string; tab: DemoTab; locale: Locale }) {
  const labels: Record<DemoTab, { en: string; fr: string }> = {
    signals: { en: 'Signals', fr: 'Signaux' },
    graph: { en: 'Graph', fr: 'Graphe' },
    teams: { en: 'Impacted teams', fr: 'Équipes touchées' },
    waivers: { en: 'Waivers', fr: 'Dérogations' },
    history: { en: 'History', fr: 'Historique' },
  };
  return (
    <div className="tab-list">
      {TABS.map((name) => (
        <a
          key={name}
          className={name === tab ? 'button button--primary' : 'button button--default'}
          href={`${base}?tab=${name}&locale=${locale}`}
        >
          {labels[name][locale]}
        </a>
      ))}
    </div>
  );
}

/** Screen 1 — the project page: version, verdict, then the selected tab. */
export function ProjectScreen({ dataset, locale, tab, base }: {
  dataset: DemoDataset;
  locale: Locale;
  tab: DemoTab;
  base: string;
}) {
  return (
    <Box>
      <VersionPicker
        rows={dataset.versionRows}
        selected={dataset.dossier.snapshot.versionId}
        onSelect={() => {}}
        locale={locale}
      />
      <DossierHeader dataset={dataset} locale={locale} />
      <TabStrip base={base} tab={tab} locale={locale} />
      <TabBody dataset={dataset} locale={locale} tab={tab} />
      <SimulationBlock dataset={dataset} locale={locale} />
    </Box>
  );
}

/**
 * The simulation the real `simulate-without` action returned, stated with the
 * real i18n keys. The in-app panel (`SimulationPanel`) is the React one: it
 * calls the resolver from the browser. Here the call already happened server
 * side, so only its result is rendered — same words, same numbers.
 */
function SimulationBlock({ dataset, locale }: { dataset: DemoDataset; locale: Locale }) {
  const result = dataset.simulate as SimulateWithoutOutput | null;
  if (!result) {
    return (
      <Box>
        <Heading as="h4">{locale === 'fr' ? 'Simulation' : 'Simulation'}</Heading>
        <Text>
          {locale === 'fr'
            ? 'Aucun ticket ne retient la version : rien à simuler.'
            : 'No ticket holds the release back: nothing to simulate.'}
        </Text>
      </Box>
    );
  }
  return (
    <Box>
      <Heading as="h4">{locale === 'fr' ? 'Simulation' : 'Simulation'}</Heading>
      <SimulationPanel
        versionId={result.versionId}
        issueKeys={result.removedIssueKeys}
        locale={locale}
      />
      <Box>
        <Lozenge appearance="removed">{t({ key: `verdict.${result.verdictBefore}` }, locale)}</Lozenge>
        <Text>→</Text>
        <Lozenge appearance="success">{t({ key: `verdict.${result.verdict}` }, locale)}</Lozenge>
        <Text>
          {t({ key: 'simulation.dropped', params: { count: result.droppedSignalCount } }, locale)}
        </Text>
      </Box>
      {result.minimalRemoval ? <MinimalLine dataset={dataset} locale={locale} /> : null}
      {result.conditions.length > 0 ? (
        <List type="unordered">
          {result.conditions.map((condition) => (
            <ListItem key={`${condition.signalCode}-${condition.subjectId}`}>
              {condition.signalCode} — {t(condition.text, locale)}
            </ListItem>
          ))}
        </List>
      ) : null}
    </Box>
  );
}

/** The smallest set of tickets that lifts the no-go, in the app's own words. */
function MinimalLine({ dataset, locale }: { dataset: DemoDataset; locale: Locale }) {
  const minimal = (dataset.simulate as SimulateWithoutOutput).minimalRemoval;
  if (!minimal) return null;
  const message = describeRemoval(minimal);
  return (
    <SectionMessage appearance="warning">
      {t(message, locale)}{' '}
      <Text>
        ({t(
          { key: 'simulation.simulations', params: { count: minimal.simulationsRun } },
          locale,
        )})
      </Text>
    </SectionMessage>
  );
}

/** Screen 3 — the project settings: the severity table and the policy fields. */
export function SettingsScreen({ dataset, locale }: { dataset: DemoDataset; locale: Locale }) {
  return (
    <SettingsView
      policy={dataset.policy}
      locale={locale}
      onChange={() => {}}
      onSave={() => {}}
    />
  );
}

/** Screen 4 — the dashboard gadget: the versions and their verdict. */
export function GadgetScreen({ dataset, locale }: { dataset: DemoDataset; locale: Locale }) {
  return <GadgetList rows={dataset.gadgetRows} locale={locale} />;
}

/** Screen 2 — the panel under a ticket: does it hold a release back? */
export function IssueScreen({ dataset, locale }: { dataset: DemoDataset; locale: Locale }) {
  return (
    <IssueContextView
      data={dataset.issueContext}
      issueId={dataset.issueContext.issueId}
      locale={locale}
    />
  );
}

/** The signal the demo opens a waiver on: the first blocking one, if any. */
export function focusSignal(dataset: DemoDataset): Signal | undefined {
  return dataset.dossier.signals.find((signal) => signal.severity === 'blocking');
}
