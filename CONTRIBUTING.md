# Contributing to Release Impact Radius

Thank you for your interest. This repository holds a **Forge app for Jira**
(Codegeist 2026, category *Apps for Software Teams*): for one Jira version it
builds a release dossier — verifiable signals, a deterministic
go / conditional go / no-go verdict, a coverage-derived confidence and a written
summary checked against the signals.

Read first: [README.md](README.md) for the product,
[docs/CONVENTIONS.md](docs/CONVENTIONS.md) for the code rules,
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the module map,
[docs/OPS.md](docs/OPS.md) for the infrastructure,
[docs/ACCEPTANCE.md](docs/ACCEPTANCE.md) for the live acceptance harness.
This guide does not repeat them — it links to them.

## Prerequisites

- **Node.js 22.x or 24.x.** The Forge CLI does not guarantee any other version
  (it prints `Forge CLI supports Node.js 22.x or 24.x` and may misbehave).
- **Python 3** for the repository guards and the acceptance harness. Standard
  library only — there is nothing to `pip install`.
- **git**.
- The **Forge CLI is not a dependency of this repository**: install it globally
  (`npm install -g @forge/cli`) and authenticate once (`forge login`, or
  `FORGE_EMAIL` + `FORGE_API_TOKEN`) — see [docs/OPS.md](docs/OPS.md) §5.

## Install and commands

```bash
git clone https://github.com/BaptisteFaisy/rayon-impact.git
cd rayon-impact
npm ci                                  # reproducible, from package-lock.json
npm run typecheck                       # tsc --noEmit
npm test                                # vitest run — 440 tests / 38 files, ~2 s, no network
npm run lint                            # forge lint (needs a Forge login)
python3 scripts/check-limits.py         # size guard: files < 500 lines, functions < 50
python3 -m unittest discover tests/scripts   # the guard's own tests
```

The unit suite is pure: no network, no filesystem, no Forge runtime.

> **Never run `npm ci` inside a tree whose `node_modules` is a symlink to
> another checkout** — `npm ci` wipes the link *target*. Install in place, or
> share dependencies with hard links (`cp -al`), which is what the CI does
> ([docs/OPS.md](docs/OPS.md) §2).

## The rules of the project

1. **Files under 500 lines, functions under 50 lines.** Beyond that: split —
   never let a file grow. This is automated by
   [`scripts/check-limits.py`](scripts/check-limits.py) (standard library,
   `--json` for machines, exit code 1 on any breach); run it before pushing.
   Rule statement and the no-duplication rule:
   [docs/CONVENTIONS.md](docs/CONVENTIONS.md) §1.
2. **Zero duplication.** A helper already exists (`src/signals/context.ts`,
   `src/types.ts`, `src/ports.ts`) — use it. In tests, compose data with
   `tests/fixtures/builders.ts` and the canonical set
   `tests/fixtures/paiements.ts`; never copy literals.
3. **Two watertight worlds.** The pure domain (`src/types.ts`, `src/signals/*`,
   `src/engine/*`: no Forge import, no I/O, clock injected through
   `DetectionContext`) and the Forge adapters (`src/db/*`, `src/collect/*`,
   `src/triggers/*`, `src/actions/*`, `src/ui/*`, `src/index.ts`), which meet at
   `src/ports.ts`. The bundler constraints that follow (extensionless relative
   imports, no `noEmit` in `tsconfig.json`, static import of `@forge/sql`) are
   listed in [docs/CONVENTIONS.md](docs/CONVENTIONS.md) §2 — they are not
   stylistic, breaking them breaks `forge deploy`.
4. **Every user-visible string is a `MessageRef`** (`{ key, params }`) resolved
   by `t(ref, locale)` from `src/i18n/index.ts` (EN + FR). Do not hard-code text
   and do not invent keys: the catalogue and the parameter names are in
   [docs/CONVENTIONS.md](docs/CONVENTIONS.md) §3. Tests assert on keys and
   params, never on translated text.
5. **Missing data is never good news** (SPEC §15): when a source is
   `unavailable` or `empty`, the detector produces nothing and the coverage says
   so. Never fill the gap with an optimistic default.
6. **Signals follow the common contract** (`makeSignal`, effective severity,
   at least one `Evidence` with a URL when the source provides one, stable
   `subjectId`): [docs/CONVENTIONS.md](docs/CONVENTIONS.md) §4.

The backbone files are frozen for contributors — `src/types.ts`,
`src/signals/registry.ts`, `src/signals/context.ts`, `src/i18n/index.ts`,
`tests/fixtures/builders.ts`, `tests/fixtures/paiements.ts`, `package.json`,
`tsconfig.json`, `vitest.config.ts`. Need a change there? Open an issue first
rather than editing.

## Working in a git worktree

Parallel topics (or several agents) each get their own tree and branch, without
touching anybody else's checkout:

```bash
git worktree add ../rayon-wt/<topic> -b feat/<topic>
cd ../rayon-wt/<topic>
npm ci                      # its own node_modules — see the warning above
# … work, test …
cd - && git worktree remove ../rayon-wt/<topic>
```

## Contribution flow

1. **Branch** from `main`, named by intent: `feat/…`, `fix/…`, `docs/…`,
   `perf/…`, `refactor/…`.
2. **Open a pull request whose body declares a `## Scope` block.** The `couche0`
   check reads it:

   ```markdown
   ## Scope

   - `src/engine/pipeline.ts` — split recomputeRelease to stay under 50 lines
   - `tests/engine/*.test.ts` — coverage for the extracted helpers
   ```

   Every changed file must be declared, and every declaration must actually be
   used: an over-wide scope is refused. A pattern is an exact path, a directory
   prefix (`src/ui/`) or a glob (`src/ui/*.tsx`). When the check refuses, the job
   summary contains a ready-to-paste block — copy it, edit the reasons, push.
3. **Guard files need an explicit flag.** Touching `.github/ci-budget/`,
   `.github/couche0/`, `.github/workflows/ci.yml`,
   `.github/workflows/couche0.yml` or `.github/workflows/pr-auto-merge.yml`
   requires the literal string `SAMVISION_ALLOW_GUARD_BUMP` somewhere in the PR
   body. The guard is always fetched from `main`, never from the PR head: a PR
   cannot relax its own judge.
4. **Three checks must pass**: `ci`, `ci-budget`, `couche0`. They are required by
   the `main` ruleset and by the queue.
5. **The Mergify queue merges, nobody pushes to `main`.** Batches of up to three
   PRs, `rebase` merge method, speculation bounded to two parallel checks so the
   queue never starves PR CI. A conflicted PR is handled by the sweeper and the
   conflict agent — [docs/OPS.md](docs/OPS.md) §3 and §4.
6. **CI answers within 5 minutes**, every job (`ci-budget` fails a workflow that
   declares more, or nothing at all). Never lengthen a timeout: shorten the job.
   Context and the reasons: [docs/OPS.md](docs/OPS.md) §1.

Also refused in added lines, whatever the declared scope: a forced-side merge
(`-X` followed by `ours` or `theirs`), a force-push that is not
`--force-with-lease`, the elevated `pull_request`+`_target` trigger, anything
shaped like a secret (`sk-…`, `sk_…`, `ghp_…`), a hard-coded `sdk.dir=` line and
conflict markers in any tracked file. After a manual rebase, check before
pushing:

```bash
git grep -nE '^(<<<<<<<|>>>>>>>)'
```

Markdown documents must be UTF-8 and non-empty — the `ci` job verifies it.

## Self-hosted runners

CI runs on three self-hosted workers on the project server. A cold dependency
install costs 18 to 21 minutes there (`@forge/react` pulls the whole Atlaskit
tree), which would blow the 5-minute budget: each worker must therefore be
**pre-warmed** with a `node_modules` cache kept outside the workspace and
restored through hard links. The procedure, the exact paths and the known traps
(worker directory naming, partial installs) are in
[docs/OPS.md](docs/OPS.md) §2 — follow it there, it is not duplicated here.

## Deploying and testing against a real site

- Deploy, install, app variables, scopes and the demo-site state:
  [docs/OPS.md](docs/OPS.md) §5 and §6.
- Acceptance harness — replays the eight acceptance points of SPEC §17 against
  the live demo site through a read-only webtrigger, without a browser, and says
  honestly what it cannot cover: [docs/ACCEPTANCE.md](docs/ACCEPTANCE.md).
- Before claiming a fix works, remember what this project learned the hard way:
  seven defects were only visible once deployed
  ([CHANGELOG.md](CHANGELOG.md), version 2.5.0).

## Reporting an issue

Say what you expected, what happened, and how to reproduce. For anything that
only occurs on a deployed app, join the relevant `forge logs` excerpt and the
app version (`forge version list`). Never paste a token — app secrets live in
`~/.atlassian-api-token` (mode 600), outside the repository.

## Licence

Apache-2.0 — see [LICENSE](LICENSE). By submitting a contribution you agree that
it is licensed under the same terms (Apache-2.0 §5).
