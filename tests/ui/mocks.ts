import { vi } from 'vitest';
import * as forgeReactPrimitives from './forge-react-mock';
import { buildDemoDataset } from './screenData';
import type { DemoDataset } from './screenData';

/**
 * Shared Forge bridge mocks for the UI render tests.
 *
 * `renderToStaticMarkup` never runs effects, so `useScreen`'s `invoke` calls do
 * not fire during a static render; the responder below exists so the mocks are
 * faithful (and usable by tests that call `invoke` directly), while the loaded
 * states are rendered by passing the dataset to the components as props.
 *
 * Test files wire these singletons with:
 *   vi.mock('@forge/react', async () => await import('./mocks').then(m => m.forgeReactMock));
 *   vi.mock('@forge/bridge', async () => await import('./mocks').then(m => m.forgeBridgeMock));
 *
 * Rule: files < 500 lines, functions < 50 lines.
 */

export interface ProductContextMock {
  moduleKey: string;
  locale: string;
  extension: {
    project?: { id: string; key: string };
    issue?: { id: string; key: string };
  };
}

export type InvokeResponder = (key: string, payload: Record<string, unknown>) => Promise<unknown>;

const DEFAULT_CONTEXT: ProductContextMock = {
  moduleKey: 'rayon-impact-project-page',
  locale: 'en-US',
  extension: {
    project: { id: 'proj-pay', key: 'PAY' },
    issue: { id: 'id-pay-131', key: 'PAY-131' },
  },
};

let productContext: ProductContextMock = structuredClone(DEFAULT_CONTEXT);

/** Overwrites part of the mocked product context (moduleKey, locale, ids…). */
export function setProductContext(patch: Partial<ProductContextMock>): void {
  productContext = { ...productContext, ...patch };
}

export function useProductContext(): ProductContextMock {
  return productContext;
}

/** The dataset every `invoke` answer is built from (fixtures → engine). */
export let demoData: DemoDataset = buildDemoDataset();

/** Maps a resolver key to its answer, exactly like SCREENS in src/index.ts. */
export function demoResponder(key: string): Promise<unknown> {
  const d = demoData;
  switch (key) {
    case 'screen.projectPage':
      return Promise.resolve(d.dossier);
    case 'screen.projectVersions':
      return Promise.resolve(d.versionRows);
    case 'screen.projectDiff':
      return Promise.resolve(d.diff);
    case 'screen.impactGraph':
      return Promise.resolve(d.graph);
    case 'screen.projectSettings':
      return Promise.resolve(d.policy);
    case 'screen.issueContext':
      return Promise.resolve(d.issueContext);
    case 'screen.dashboardGadget':
      return Promise.resolve(d.gadgetRows);
    case 'screen.savePolicy':
      return Promise.resolve({ ok: true });
    case 'simulate-without':
      return Promise.resolve(d.simulate);
    case 'request-waiver':
      return Promise.resolve(d.requestWaiver);
    case 'close-waiver':
      return Promise.resolve(d.closeWaiver);
    case 'list-impacted-teams':
      return Promise.resolve({ teams: d.teams });
    default:
      return Promise.resolve(null);
  }
}

let responder: InvokeResponder = (key) => demoResponder(key);

/** Installs a custom responder (error cases, empty datasets…). */
export function setInvokeResponder(next: InvokeResponder): void {
  responder = next;
}

export const invoke = vi.fn((key: string, payload?: Record<string, unknown>) =>
  responder(key, payload ?? {}),
);

/** Elements passed to ForgeReconciler.render — the frontend test reads them. */
export const renderedRoots: unknown[] = [];

export const ForgeReconciler = {
  render(element: unknown): void {
    renderedRoots.push(element);
  },
};

/**
 * Les primitives de la plateforme (`Box`, `Text`, `Button`…) sont rendues par
 * du HTML réel : les tests inspectent le markup (rôles, libellés, ancres
 * sémantiques), pas des noms de composants.
 */
export const forgeReactMock = {
  ...forgeReactPrimitives,
  default: ForgeReconciler,
  ForgeReconciler,
  useProductContext,
};

export const forgeBridgeMock = { invoke };

/** Restores the default context and the demo responder between tests. */
export function resetForgeMocks(): void {
  productContext = structuredClone(DEFAULT_CONTEXT);
  responder = (key) => demoResponder(key);
  invoke.mockClear();
  renderedRoots.length = 0;
}
