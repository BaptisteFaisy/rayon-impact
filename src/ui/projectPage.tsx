import { useEffect, useState } from 'react';
import Tabs, { Tab, TabList, TabPanel } from '@atlaskit/tabs';
import { invoke } from '@forge/bridge';
import { useLocale, useProject, useScreen } from './hooks.js';
import { VerdictBanner } from './components/VerdictBanner.js';
import { SignalList } from './components/SignalList.js';
import { CoverageMeter } from './components/CoverageMeter.js';
import { WaiverDialog } from './components/WaiverDialog.js';
import { GraphView } from './components/GraphView.js';
import type {
  ImpactGraph,
  ImpactedTeam,
  Locale,
  ReleaseDossier,
  Signal,
} from '../types.js';

/**
 * The main screen: version picker, verdict, coverage, signals grouped by
 * severity, then the Graph / Impacted teams / Waivers / History tabs
 * (SPEC §11).
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
  if (rows.length === 0) {
    return (
      <p style={{ padding: 12 }}>
        {locale === 'fr'
          ? 'Aucun dossier de release pour ce projet. Ouvrez une version et laissez l’app la calculer.'
          : 'No release dossier for this project yet. Open a version and let the app compute it.'}
      </p>
    );
  }

  return (
    <div>
      <VersionPicker rows={rows} selected={versionId} onSelect={setVersionId} locale={locale} />
      {versionId ? <Dossier versionId={versionId} locale={locale} /> : null}
    </div>
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
      <label htmlFor="version-select">
        {locale === 'fr' ? 'Version :' : 'Version:'}
      </label>
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

function Dossier({ versionId, locale }: { versionId: string; locale: Locale }) {
  const dossier = useScreen<ReleaseDossier | null>('screen.projectPage', { versionId });
  const [waiving, setWaiving] = useState<Signal | null>(null);
  const [teams, setTeams] = useState<ImpactedTeam[]>([]);
  const [tab, setTab] = useState(0);

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

  if (dossier.loading) return <p>…</p>;
  if (!dossier.data) {
    return (
      <p style={{ padding: 12 }}>
        {locale === 'fr' ? 'Aucun dossier enregistré.' : 'No saved dossier.'}
      </p>
    );
  }

  const { snapshot, signals, waivers, decisions, outcome } = dossier.data;
  const graph = useScreen<ImpactGraph | null>('screen.impactGraph', { versionId });

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
      <div style={{ padding: '0 12px' }}>
        <Tabs id="rayon-impact-tabs" selected={tab} onChange={(index) => setTab(Number(index))}>
          <TabList>
            <Tab>{locale === 'fr' ? 'Signaux' : 'Signals'}</Tab>
            <Tab>{locale === 'fr' ? 'Graphe' : 'Graph'}</Tab>
            <Tab>{locale === 'fr' ? 'Équipes touchées' : 'Impacted teams'}</Tab>
            <Tab>{locale === 'fr' ? 'Dérogations' : 'Waivers'}</Tab>
            <Tab>{locale === 'fr' ? 'Historique' : 'History'}</Tab>
          </TabList>
          <TabPanel>
            <SignalList signals={signals} locale={locale} />
            {signals
              .filter((signal) => signal.severity === 'blocking' && signal.status === 'active')
              .map((signal) => (
                <button key={signal.id} type="button" onClick={() => setWaiving(signal)}>
                  {locale === 'fr' ? 'Déroger' : 'Waive'} {signal.code}
                </button>
              ))}
            {waiving ? (
              <WaiverDialog
                signal={waiving}
                locale={locale}
                onCancel={() => setWaiving(null)}
                onDone={() => setWaiving(null)}
              />
            ) : null}
          </TabPanel>
          <TabPanel>
            {graph.data ? (
              <GraphView graph={graph.data} locale={locale} />
            ) : (
              <p>{locale === 'fr' ? 'Graphe indisponible.' : 'Graph unavailable.'}</p>
            )}
          </TabPanel>
          <TabPanel>
            <TeamList teams={teams} locale={locale} />
          </TabPanel>
          <TabPanel>
            <ul>
              {waivers.map((waiver) => (
                <li key={waiver.id}>
                  {waiver.signalCode} — {waiver.reason} — {waiver.expiresAt}
                </li>
              ))}
            </ul>
          </TabPanel>
          <TabPanel>
            <ul>
              {decisions.map((decision) => (
                <li key={decision.id}>
                  {decision.decidedAt} — {decision.decision} ({decision.verdictAtDecision})
                </li>
              ))}
              {outcome ? (
                <li>
                  {locale === 'fr' ? 'Bilan 72 h : ' : '72 h outcome: '}
                  {outcome.incidents.length} {locale === 'fr' ? 'incident(s)' : 'incident(s)'}
                </li>
              ) : null}
            </ul>
          </TabPanel>
        </Tabs>
      </div>
    </div>
  );
}

function TeamList({ teams, locale }: { teams: ImpactedTeam[]; locale: Locale }) {
  if (teams.length === 0) {
    return <p style={{ color: '#6B778C' }}>{locale === 'fr' ? 'Aucune équipe identifiée.' : 'No team identified.'}</p>;
  }
  return (
    <ul>
      {teams.map((team) => (
        <li key={team.teamId}>
          <strong>{team.teamName}</strong> —{' '}
          {team.services.map((service) => service.serviceName).join(', ')} ({team.via})
          <ul>
            {team.issues.map((issue) => (
              <li key={issue.key}>
                {issue.key} — {issue.summary}
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}
