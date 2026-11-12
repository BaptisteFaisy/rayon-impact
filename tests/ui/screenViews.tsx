import type { ReactElement } from 'react';
import { DossierHeader, DossierTabs, VersionPicker } from '../../src/ui/projectPage';
import { IssueContextView } from '../../src/ui/issueContext';
import { SettingsView } from '../../src/ui/settingsPage';
import { GadgetList } from '../../src/ui/gadget';
import type { DemoDataset } from './screenData';
import type { Locale } from '../../src/types';

/**
 * Loaded-state view of each screen, composed from the PRODUCTION components
 * that receive the resolver data as props.
 *
 * Why: `renderToStaticMarkup` never runs effects, so `useScreen`'s `invoke`
 * never resolves during a static render — the screens themselves can only be
 * tested in their initial (loading) state. Each screen therefore exposes the
 * body it renders once loaded as a props-driven component (VersionPicker,
 * DossierHeader, DossierTabs, IssueContextView, SettingsView, GadgetList),
 * and the loaded state is asserted on those.
 *
 * Rule: files < 500 lines, functions < 50 lines.
 */

export function projectPageLoaded(
  d: DemoDataset,
  locale: Locale,
  tab = 0,
): ReactElement {
  const { snapshot } = d.dossier;
  return (
    <div>
      <VersionPicker
        rows={d.versionRows}
        selected={snapshot.versionId}
        onSelect={() => {}}
        locale={locale}
      />
      <DossierHeader snapshot={snapshot} diff={d.diff} locale={locale} />
      <DossierTabs
        tab={tab}
        onTab={() => {}}
        dossier={d.dossier}
        graph={d.graph}
        teams={d.teams}
        locale={locale}
        waiving={null}
        onWaive={() => {}}
        versionId={snapshot.versionId}
      />
    </div>
  );
}

export function issueContextLoaded(d: DemoDataset, locale: Locale): ReactElement {
  return (
    <IssueContextView
      data={d.issueContext}
      issueId={d.issueContext.issueId}
      locale={locale}
    />
  );
}

export function settingsLoaded(d: DemoDataset, locale: Locale): ReactElement {
  return (
    <SettingsView
      policy={d.policy}
      locale={locale}
      onChange={() => {}}
      onSave={() => {}}
    />
  );
}

export function gadgetLoaded(d: DemoDataset, locale: Locale): ReactElement {
  return <GadgetList rows={d.gadgetRows} locale={locale} />;
}
