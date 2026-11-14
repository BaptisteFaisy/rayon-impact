import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * End-to-end of the offline demo: the bundle is built, the server answers, the
 * pages carry the measured verdict. Without this test the demo could rot
 * silently — nothing in `npm test` touches it today.
 *
 * Rule: files < 500 lines, functions < 50 lines.
 */

const ROOT = resolve(import.meta.dirname, '../..');
const PORT = 8799;
const BASE = `http://127.0.0.1:${PORT}`;

let server: ChildProcess | null = null;

/** Builds the bundle, then starts the server on a fixed port. */
async function startDemo(): Promise<void> {
  await run('node', ['demo/build.mjs'], 120_000);
  server = spawn('node', ['demo/server.mjs'], {
    cwd: ROOT,
    env: { ...process.env, DEMO_PORT: String(PORT) },
    stdio: 'ignore',
  });
  await waitForServer();
}

/** Runs a command in the repository and fails loudly on a non-zero exit. */
function run(command: string, args: string[], timeoutMs: number): Promise<void> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, { cwd: ROOT, stdio: 'ignore' });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      rejectPromise(new Error(`${command} ${args.join(' ')} exceeded ${timeoutMs} ms`));
    }, timeoutMs);
    child.on('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) resolvePromise();
      else rejectPromise(new Error(`${command} ${args.join(' ')} exited with ${code}`));
    });
  });
}

/** Polls the server until it answers, instead of sleeping a fixed delay. */
async function waitForServer(): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${BASE}/`);
      if (response.ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('the demo server did not answer within 30 s');
}

/** Fetches a page of the demo and returns its status and body. */
async function get(path: string): Promise<{ status: number; body: string }> {
  const response = await fetch(`${BASE}${path}`);
  return { status: response.status, body: await response.text() };
}

describe('offline demo — end to end', () => {
  beforeAll(async () => {
    if (!existsSync(resolve(ROOT, 'node_modules/.bin/esbuild'))) return;
    await startDemo();
  }, 180_000);

  afterAll(() => {
    server?.kill('SIGKILL');
  });

  it('the landing page lists the four scenarios with their measured verdict', async () => {
    const { status, body } = await get('/');
    expect(status).toBe(200);
    for (const id of ['paiements-24', 'paiements-24-video', 'mobile-31', 'plateforme-90']) {
      expect(body).toContain(id);
    }
    expect(body).toContain('no-go');
    expect(body).toContain('verdict--go');
  });

  it('the project screen shows the verdict, the signals and their proofs', async () => {
    const { status, body } = await get('/s/paiements-24/project?tab=signals&locale=fr');
    expect(status).toBe(200);
    expect(body).toContain('NO-GO');
    expect(body).toContain('PAY-131');
    expect(body).toContain('INC-52');
    // The placeholders of the catalogue templates are gone.
    expect(body).not.toMatch(/\{[a-zA-Z0-9_]+\}/);
  });

  it('the API answers the dossier of a scenario', async () => {
    const response = await fetch(`${BASE}/api/paiements-24/dossier`);
    expect(response.status).toBe(200);
    const dossier = await response.json();
    expect(dossier.snapshot.verdict).toBe('no-go');
    expect(dossier.snapshot.counts.blocking).toBe(5);
    expect(dossier.signals.length).toBe(10);
  });

  it('an action runs for real: simulate-without answers a verdict', async () => {
    const payload = encodeURIComponent(JSON.stringify({ versionId: 'ver-24', issueKeys: 'PAY-131' }));
    const response = await fetch(`${BASE}/api/paiements-24/action?key=simulate-without&payload=${payload}`);
    expect(response.status).toBe(200);
    const answer = await response.json();
    expect(answer.ok).toBe(true);
    expect(answer.result.verdictBefore).toBe('no-go');
    expect(answer.result.droppedSignalCount).toBe(2);
  });

  it('a waiver write is visible on the next screen read, a reader is refused', async () => {
    const dossierResponse = await fetch(`${BASE}/api/paiements-24-video/dossier`);
    const dossier = await dossierResponse.json();
    const exp01 = dossier.signals.find((signal: { code: string }) => signal.code === 'EXP-01');
    expect(dossier.snapshot.verdict).toBe('no-go');
    expect(dossier.snapshot.counts.blocking).toBe(3);
    const payload = encodeURIComponent(JSON.stringify({
      signalId: exp01.id,
      reason: 'Demo: accepted for this release.',
      hours: 24,
    }));
    const leadResponse = await fetch(
      `${BASE}/api/paiements-24-video/action?key=request-waiver&role=lead&payload=${payload}`,
    );
    const lead = await leadResponse.json();
    expect(lead.result.granted).toBe(true);
    const after = await fetch(`${BASE}/api/paiements-24-video/dossier`).then((r) => r.json());
    // The incident is now waived, and the dossier says so. The verdict stays
    // `no-go` because two blocking signals remain (COMP-01 and COMP-03 on
    // PAY-131): waiving the incident is not enough to ship. That is the engine
    // telling the truth, not a bug.
    expect(after.signals.find((signal: { code: string }) => signal.code === 'EXP-01').status)
      .toBe('waived');
    expect(after.snapshot.counts.blocking).toBe(2);
    expect(after.snapshot.verdict).toBe('no-go');
    expect(after.waivers).toHaveLength(1);
    expect(after.waivers[0].signalCode).toBe('EXP-01');

    const readerResponse = await fetch(
      `${BASE}/api/paiements-24-video/action?key=request-waiver&role=reader&payload=${payload}`,
    );
    const reader = await readerResponse.json();
    expect(reader.result.granted).toBe(false);
    expect(reader.result.refusal.key).toBe('waiver.approver.unauthorized');
  });

  it('an unknown path says what the demo serves', async () => {
    const { status, body } = await get('/nimporte/quoi');
    expect(status).toBe(404);
    expect(body).toContain('/s/paiements-24/project');
  });
});
