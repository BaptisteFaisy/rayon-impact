import { useEffect, useState } from 'react';
import Tabs, { Tab, TabList, TabPanel } from '@atlaskit/tabs';
import { invoke } from '@forge/bridge';
import { useLocale, useProject, useScreen } from './hooks.js';
import { VerdictBanner } from './components/VerdictBanner.js';
import { CoverageMeter } from './components/CoverageMeter.js';
import { WaiverDialog } from './components/WaiverDialog.js';
import { GraphView } from './components/GraphView.js';
import { SignalsTab } from './tabs/SignalsTab.js';
import { TeamsTab } from './tabs/TeamsTab.js';
import { WaiversTab } from './tabs/WaiversTab.js';
import { HistoryTab } from './tabs/HistoryTab.js';
import type { ImpactGraph, ImpactedTeam, Locale, ReleaseDossier, Signal } from '../types.js';

/**
 * The main screen: version picker, verdict, coverage, written summary, then the
 * Signals / Graph / Impacted teams / Waivers / History tabs (SPEC §11).
 *
 * Each tab is its own component: no function over 50 lines (project rule).
 *
 * Rule: files < 500 lines, functions < 50 lines.
 */

interface VersionRow {
  versionId: string;
  versionName: string;
  verdict: string;
  confidence: string;
  computedAt: string;
  released: boolean;
}

export function ProjectPage() {
  const locale = useLocale();
  const project = useProject();
  const versions = useScreen<VersionRow[]>('screen.projectVersions', {
    projectId: project.id ?? '',
  });
  const [versionId, setVersionId] = useState<string>('');

  const rows = versions.data ?? [];
  useEffect(() => {
    if (!versionId && rows.length > 0) setVersionId(rows[0].versionId);
  }, [rows, versionId]);

  if (versions.loading) return <p>…</p>;
  if (rows.length === 0) return <EmptyProject locale={locale} />;

  return (
    <div>
      <VersionPicker rows={rows} selected={versionId} onSelect={setVersionId} locale={locale} />
      {versionId ? <Dossier versionId={versionId} locale={locale} /> : null}
    </div>
  );
}

function EmptyProject({ locale }: { locale: Locale }) {
  return (
    <p style={{ padding: 12 }}>
      {locale === 'fr'
        ? 'Aucun dossier de release pour ce projet. Ouvrez une version et laissez l’app la calculer.'
        : 'No release dossier for this project yet. Open a version and let the app compute it.'}
    </p>
  );
}

function VersionPicker({
  rows,
  selected,
  onSelect,
  locale,
}: {
  rows: VersionRow[];
  selected: string;
  onSelect: (id: string) => void;
  locale: Locale;
}) {
  return (
    <div style={{ padding: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
      <label htmlFor="version-select">{locale === 'fr' ? 'Version :' : 'Version:'}</label>
      <select
        id="version-select"
        value={selected}
        onChange={(event) => onSelect(event.target.value)}
      >
        {rows.map((row) => (
          <option key={row.versionId} value={row.versionId}>
            {row.versionName} — {row.verdict}
          </option>
        ))}
      </select>
    </div>
  );
}

/** Loads the saved dossier and the impacted teams, then renders the tabs. */
function Dossier({ versionId, locale }: { versionId: string; locale: Locale }) {
  const dossier = useScreen<ReleaseDossier | null>('screen.projectPage', { versionId });
  const graph = useScreen<ImpactGraph | null>('screen.impactGraph', { versionId });
  const teams = useImpactedTeams(versionId);
  const [waiving, setWaiving] = useState<Signal | null>(null);
  const [tab, setTab] = useState(0);

  if (dossier.loading) return <p>…</p>;
  if (!dossier.data) return <p style={{ padding: 12 }}>{locale === 'fr' ? 'Aucun dossier enregistré.' : 'No saved dossier.'}</p>;

  const { snapshot } = dossier.data;
  return (
    <div>
      <VerdictBanner
        verdict={snapshot.verdict}
        confidence={snapshot.confidence}
        computedAt={snapshot.computedAt}
        locale={locale}
      />
      <CoverageMeter coverage={snapshot.coverage} locale={locale} />
      <div style={{ padding: '0 12px' }}>
        <p style={{ whiteSpace: 'pre-line' }}>{snapshot.narrative}</p>
      </div>
      <DossierTabs
        tab={tab}
        onTab={setTab}
        dossier={dossier.data}
        graph={graph.data}
        teams={teams}
        locale={locale}
        waiving={waiving}
        onWaive={setWaiving}
      />
      {waiving ? (
        <WaiverDialog
          signal={waiving}
          locale={locale}
          onCancel={() => setWaiving(null)}
          onDone={() => setWaiving(null)}
        />
      ) : null}
    </div>
  );
}


function DossierTabs(props: {
  tab: number;
  onTab: (n: number) => void;
  dossier: ReleaseDossier;
  graph: ImpactGraph | null;
  teams: ImpactedTeam[];
  locale: Locale;
  waiving: Signal | null;
  onWaive: (s: Signal | null) => void;
}) {
  const { tab, onTab, dossier, graph, teams, locale, waiving, onWaive } = props;
  const { signals, waivers, decisions, outcome } = dossier;
  return (
    <div style={{ padding: '0 12px' }}>
      <Tabs id="rayon-impact-tabs" selected={tab} onChange={(index) => onTab(Number(index))}>
        <TabList>
          <Tab>{locale === 'fr' ? 'Signaux' : 'Signals'}</Tab>
          <Tab>{locale === 'fr' ? 'Graphe' : 'Graph'}</Tab>
          <Tab>{locale === 'fr' ? 'Équipes touchées' : 'Impacted teams'}</Tab>
          <Tab>{locale === 'fr' ? 'Dérogations' : 'Waivers'}</Tab>
          <Tab>{locale === 'fr' ? 'Historique' : 'History'}</Tab>
        </TabList>
        <TabPanel>
          <SignalsTab signals={signals} locale={locale} waiving={waiving} onWaive={onWaive} />
        </TabPanel>
        <TabPanel>
          <GraphPanel graph={graph} locale={locale} />
        </TabPanel>
        <TabPanel>
          <TeamsTab teams={teams} locale={locale} />
        </TabPanel>
        <TabPanel>
          <WaiversTab waivers={waivers} />
        </TabPanel>
        <TabPanel>
          <HistoryTab decisions={decisions} outcome={outcome} locale={locale} />
        </TabPanel>
      </Tabs>
    </div>
  );
}

function GraphPanel({ graph, locale }: { graph: ImpactGraph | null; locale: Locale }) {
  if (!graph) {
    return <p>{locale === 'fr' ? 'Graphe indisponible.' : 'Graph unavailable.'}</p>;
  }
  return <GraphView graph={graph} locale={locale} />;
}

/** Impacted teams come from the Rovo action, so the screen and the agent agree. */
function useImpactedTeams(versionId: string): ImpactedTeam[] {
  const [teams, setTeams] = useState<ImpactedTeam[]>([]);
  useEffect(() => {
    let alive = true;
    invoke<{ teams: ImpactedTeam[] }>('list-impacted-teams', { versionId })
      .then((result) => {
        if (alive) setTeams(result.teams);
      })
      .catch(() => {
        if (alive) setTeams([]);
      });
    return () => {
      alive = false;
    };
  }, [versionId]);
  return teams;
}
