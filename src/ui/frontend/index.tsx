import { useProductContext } from '@forge/react';
import ForgeReconciler from '@forge/react';
import { ProjectPage } from '../projectPage.js';
import { IssueContext } from '../issueContext.js';
import { SettingsPage } from '../settingsPage.js';
import { DashboardGadget } from '../gadget.js';

/**
 * Single UI entry point for the four Forge modules (SPEC §11).
 *
 * Forge bundles one resource per module family, so this file picks the screen
 * from the module key of the host. The four screens are separate modules,
 * declared in `manifest.yml` under `resources.main`.
 *
 * Rule: files < 500 lines, functions < 50 lines.
 */

function pickScreen(moduleKey: string) {
  if (moduleKey.includes('settings')) return <SettingsPage />;
  if (moduleKey.includes('issue-context')) return <IssueContext />;
  if (moduleKey.includes('gadget')) return <DashboardGadget />;
  return <ProjectPage />;
}

function App() {
  const context = useProductContext();
  return pickScreen(context?.moduleKey ?? '');
}

ForgeReconciler.render(<App />);
