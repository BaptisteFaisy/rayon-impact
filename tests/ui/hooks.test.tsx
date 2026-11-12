import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('@forge/react', async () => (await import('./mocks')).forgeReactMock);
vi.mock('@forge/bridge', async () => (await import('./mocks')).forgeBridgeMock);

import { setProductContext } from './mocks';
import { useProject } from '../../src/ui/hooks';

/**
 * Le contexte de module : selon le module, Jira y met `project` ou `space`
 * (l'écran de réglages ne recevait que `space` — le résolveur n'avait donc
 * aucun projectId et l'écran restait sur son squelette de chargement).
 *
 * Rule: files < 500 lines, functions < 50 lines.
 */

function Projet() {
  const projet = useProject();
  return <span>{`${projet.id ?? '-'}/${projet.key ?? '-'}`}</span>;
}

describe('ui/hooks — useProject', () => {
  it('lit le projet quand le contexte porte `project`', () => {
    setProductContext({ extension: { project: { id: '10234', key: 'PAY' } } });
    expect(renderToStaticMarkup(<Projet />)).toContain('10234/PAY');
  });

  it('lit le projet quand le contexte ne porte que `space`', () => {
    setProductContext({ extension: { space: { id: '10234', key: 'PAY' } } });
    expect(renderToStaticMarkup(<Projet />)).toContain('10234/PAY');
  });

  it('ne suppose rien quand le contexte ne porte ni projet ni espace', () => {
    setProductContext({ extension: {} });
    expect(renderToStaticMarkup(<Projet />)).toContain('-/-');
  });
});
