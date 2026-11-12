# Changelog

All notable changes to **Release Impact Radius** (*Rayon d'impact d'une release*)
are documented in this file. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
semantic versioning.

**How to read the version numbers.** This project ships as an Atlassian Forge
app, so the versions below are **Forge app versions** — the platform increments
them on every `forge deploy`, and only the major versions are queryable
(`forge version list`). They are not git tags, and `package.json` stays at
`0.1.0` because the npm package is private and never published. Every entry
corresponds to a deployment that really happened on the Codegeist demo site
`one-atlas-cndz.atlassian.net` (Jira and Confluence), app
`ari:cloud:ecosystem::app/9ab91c0c-c637-4f4c-95fe-acdadbb07039`. All times are UTC.

**Delivery.** Every change reached `main` through a pull request and the Mergify
queue — 19 PRs opened, 18 merged, 1 closed and replaced (#15 → #16). Three
checks are required by the branch ruleset: `ci`, `ci-budget`, `couche0`.
Operations (runners, queue, conflict agents, deployment) are described in
[docs/OPS.md](docs/OPS.md); the acceptance harness in
[docs/ACCEPTANCE.md](docs/ACCEPTANCE.md).

## [Unreleased]

### Merged to `main`, waiting for the next deploy

- Fixed: a Jira event falling inside the 60 s recompute window was **dropped**
  instead of deferred, so a change made right after another one waited for the
  hourly sweep — a dossier stale for up to one hour. Seen in production on
  2026-11-12 (`recompute skipped, inside the debounce window`, 12 s after a
  recompute, then nothing) and measured by the acceptance harness, where
  SPEC §17.6 (automatic recompute under 2 minutes) could not pass. The request
  is now held back in the new `recalc_deferred` table (migration
  `v004_create_recalc_deferred`, coalesced by `coalesceRequests`), replayed by a
  bounded trailing pass of the consumer (`src/triggers/trailing.ts`: 3 passes,
  480 s budget, waiting for the end of the window), with the hourly sweep as the
  safety net. 37 new tests, 580 green in total.

### Still to do before the Codegeist 2026 submission (22 December, 21:00 Paris)

- Submission video — the shot-by-shot script is written
  ([docs/VIDEO-SCRIPT.md](docs/VIDEO-SCRIPT.md)), the recording is not.
- Screenshots of the four Forge screens (project page, issue panel, settings,
  dashboard gadget): they need a browser session on the demo site, which the
  automated harness deliberately cannot provide.
- Teamwork Graph scopes (`read:graph:*`) on the evaluation site: they require an
  **organisation administrator**, and a missing scope silently omits objects
  rather than failing — the app then reports it through coverage
  (`missingScopes`, see [docs/OPS.md](docs/OPS.md) §5).
- A code repository (GitHub or Bitbucket) linked to the demo project `PAY`: as
  long as none is, the `development` source stays `unavailable` and COMP-02/03
  plus QUAL-01/02 remain silent by design ([docs/OPS.md](docs/OPS.md) §6).

### Merged to `main` after the last production deploy (21:49 UTC)

A new `forge deploy` is needed to re-sync the installed app with `main`.

- Fixed: signal history was lost on every recompute — the `signal` table used a
  content-derived `id` (`CODE:subjectType:subjectId`) as primary key, so each
  recompute overwrote the previous dossier's signals (found by the acceptance
  harness on the live site: 30 dossiers out of 31 had **zero** signal stored,
  which made the RI-14 diff and the audit trail impossible). Migrations v002
  (drop) and v003 recreate it with `row_key` = `<snapshotId>|<id>` as
  `VARCHAR(191)` primary key plus an index on `id`; `getSignalById` now reads the
  most recent dossier. 5 regression tests
  (`tests/db/signal-history.test.ts`).
- Added: `RI_DEFAULT_POLICY_JSON`, an app environment variable supplying the
  default project policy while none is saved; a policy saved through the
  settings screen always wins. Measured on the demo site: service coverage
  0/16 → 2/16, `service-map` from `empty` to `ok`.
- Changed: `DossierHeader` extracted from the project page so that every
  function stays under the 50-line rule.
- Added: public project site on GitHub Pages
  (<https://baptistefaisy.github.io/rayon-impact/>, `docs/index.html`), served
  without Jekyll (`.nojekyll`) and linked from the README.
- Added: repository hygiene — `LICENSE` (Apache-2.0), this changelog,
  `CONTRIBUTING.md`, and `scripts/check-limits.py`, an automated guard for the
  two size rules of [docs/CONVENTIONS.md](docs/CONVENTIONS.md) §1 (files under
  500 lines, functions under 50 lines) with its own `unittest` suite.

### Open point

- The JSM collector answers 200 with a user token but fails when called
  `asApp()`, so `jsm` is reported `unavailable` on the demo site. It never
  writes an empty report in its place — to be investigated with the app's
  detailed logs ([docs/OPS.md](docs/OPS.md) §6).
- The read-only webtrigger used by the acceptance harness costs the *Runs on
  Atlassian* eligibility signal (`MAJOR_VERSION_RULE`): deploying requires
  `forge deploy --approve MAJOR_VERSION_RULE`. To arbitrate before a
  Marketplace submission.

## [3.1.0] - 2026-11-11

Build installed on the demo site: development deployed at 21:47 UTC, production
at 21:49 UTC. Major version 3 was opened at 21:01 UTC by the read-only
webtrigger, which is what forced the major bump (see the open point above).
Platform summary for major 3: 17 scopes, 14 functions, **8** Rovo actions,
**1** webtrigger, 4 screens, 3 triggers, 2 scheduled triggers, 1 consumer,
`sql`, `llm`, `rovo:agent`, `rovo:mcp`.

### Added

- Read-only acceptance harness ([docs/ACCEPTANCE.md](docs/ACCEPTANCE.md)):
  `src/webtrigger.ts` exposes `/health`, `/dossier` and `/snapshots` (GET only,
  no recompute, bearer token checked inside the handler against
  `RI_WEBTRIGGER_TOKEN`), and `scripts/acceptance/` replays the 8 acceptance
  points of SPEC §17 against the real site — the same real event
  (`PUT /rest/api/3/version/{id}`) triggers the recompute.
- Eighth Rovo action `close-waiver`, plus automatic waiver closure at expiry:
  the whole waiver loop (request → grant/refuse → expiry → close) is tested.
- Real 72-hour outcome routing and the snapshot `diff` route; the project screen
  now shows the simulation ("without this ticket", minimal removal set) and the
  diff between two dossiers.
- Hardened LLM prompt for the written summary, with the model cost logged.

### Changed

- CI: `node_modules` is restored by incremental hard links (`cp -aln`) instead
  of a full copy, and its **completeness** is verified, not just its presence —
  the "Dependencies" step went from ~5 min (killed by its own budget) to ~1 s.
- Conflict agent switched to the InferHub provider: `pr-auto-merge.yml` now
  passes `FIREWORKS_BASE_URL`, so the agent no longer falls back to the
  Fireworks URL with a foreign model (HTTP 404). Proven on a real conflict over
  `docs/OPS.md`: reconciled, rebased with a lease, merged by the queue.

## [2.5.0] - 2026-11-11

The 2.x line promoted to **production** and installed on Jira and Confluence of
the demo site. Verified there by a real recompute triggered by
`PUT /rest/api/3/version/10100`: `verdict=no-go`, 3 signals
(COMP-01, DEP-01, DEP-02), 2 blocking, 1 major, coverage 0/14,
`narrativeFromModel=true`, 18.7 s, model chosen at runtime by `list()`
(`claude-haiku-4-5-20251001`). The low confidence is honest: no repository is
linked and the component → service map was still empty.

### Fixed — the seven defects only a real deployment reveals

None of these was visible locally; the unit suite was green throughout.

1. Forge SQL is TiDB: a bound `LIMIT ?` fails with `ERROR 1210 Incorrect
   arguments to LIMIT` — the limit is now inlined after integer coercion.
2. `@forge/events` 2.x hands the consumer an `AsyncEvent { body, jobId, … }`,
   not the bare message, so `versionId` was `undefined` — `body` is unwrapped.
3. Forge LLM returns `content` as blocks (`[{ type: 'text', text }]`) and not
   only as a string — both shapes are handled.
4. Narrative verification was too strict for a real model (markdown title,
   prose): hard violations (an identifier absent from the signals, SPEC §8) are
   still never published, soft ones (formatting) are retried then accepted.
5. `allowedTokens` treated `"PAY-127, PAY-128"` as a single token and rejected a
   valid summary — comma-separated lists are split.
6. `DEP-01` ignored the direction of the issue link: only `link.inward`
   ("is blocked by") counts, otherwise a ticket blocking another one was
   wrongly declared blocking.
7. `defineSchemaOnce()` was never called, so the SQL tables were never created —
   it is wired into the query path.

## [2.0.0] - 2026-11-11

First deployable bundle, at 10:29 UTC (PR #7 made it deployable at all).
Platform summary for major 2: 17 scopes, 12 functions, 7 Rovo actions, 4
screens, 3 triggers, 2 scheduled triggers, 1 consumer, `sql`, `llm`,
`rovo:agent`, `rovo:mcp`.

### Added

- The Forge adapter layer: SQL storage (`src/db/*`), the Jira / JSM / Confluence
  / Teamwork Graph collectors (`src/collect/*`), the Rovo actions, the event and
  scheduled triggers, the queue consumer and the single resolver router
  (`src/index.ts`), plus `manifest.yml` validated against the CLI schema.
- The four Forge UI screens: project page (dossier, graph, teams, waivers,
  history), issue panel ("does this ticket hold the release?"), settings page and
  dashboard gadget.
- The pure domain shipped in 1.x behind the scenes: 17 signal detectors,
  deterministic verdict and confidence, coverage, simulation, waivers,
  viewer-rights masking, impact graph, decision log, 72 h outcome, bilingual
  EN/FR dictionary.

### Fixed

- Bundler constraints discovered while deploying: extensionless relative
  imports, `tsconfig.json` without `noEmit` (the flag is passed on the command
  line by `npm run typecheck`), static import of `@forge/sql`, a resource `path`
  pointing at a directory, and the real `app.id` written by `forge create`.

## [1.0.0] - 2026-11-11

10:21 UTC — the app created by `forge create` and its first (empty) deployment:
0 scope, 0 function, no module. Kept here because it is the version the demo
site installation started from.
