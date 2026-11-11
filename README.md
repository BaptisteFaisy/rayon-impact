# Release Impact Radius — Rayon d'impact d'une release

A Forge app for Jira that reads everything attached to a version — tickets, code,
builds, services, teams, incidents, documentation — and returns a **go /
conditional go / no-go** verdict in which every reason points at its proof.

Codegeist 2026 · category **Apps for Software Teams** · submission deadline
22 December 2026.

---

## The problem

The decision to ship is taken in a meeting, from what each person happens to
remember. The facts exist but nobody joins them: Jira knows which tickets are
still in flight, the code host knows which pull requests are open and which
builds are red, JSM knows an incident is running on one of the touched services,
Compass knows which teams depend on those services, and Confluence holds the page
nobody updated. Teams therefore discover the change in production, ship on top of
an open incident, and learn about new behaviour from a customer.

## What the app does

For one Jira version, the app builds a **release dossier**: the signals it can
verify, a deterministic verdict, a confidence level derived from how much data it
actually sees, and a short written summary that is machine-checked against the
signals. It runs the same computation for the project page, the issue panel, the
Rovo agent and the MCP tools, so every surface gives the same answer.

Every signal shows four things: **what was observed**, **why it matters**, **the
proof link**, and **how to clear it**. Nothing here blocks a deployment
technically — the app informs a human decision and records it.

### The verdict

| Verdict | Rule (deterministic, `src/engine/verdict.ts`) |
|---|---|
| `no-go` | at least one **active blocking** signal |
| `conditional-go` | no active blocking signal, but at least one active **major** signal **or** at least one **waived** signal; the conditions are enumerated |
| `go` | no active blocking and no active major signal |
| `not-applicable` | the version has no ticket, or no release date |

**Confidence** comes from coverage, never from optimism: high when code is visible
for ≥ 90 % of tickets and a service is known for ≥ 80 %; low when code is visible
for < 70 %; medium in between. A missing source is reported, never read as good
news.

## Signals delivered

17 signals, 9 of them in the submission lot (M). Codes, default severities and
lots below come from `src/signals/registry.ts`; the exact trigger conditions are
in [docs/SIGNALS.md](docs/SIGNALS.md).

| Code | Signal | Default severity | Lot |
|---|---|---|---|
| COMP-01 | Unfinished ticket in the release | blocking | M |
| COMP-02 | Done ticket with no commit and no PR | major | M |
| COMP-03 | Open pull request on a release ticket | blocking | M |
| COMP-04 | Ticket added to the release less than 48 h ago | minor | S |
| QUAL-01 | Latest build failed on a release ticket | blocking | M |
| QUAL-02 | Pull request merged without approval | major | S |
| QUAL-03 | Bug reopened during the cycle | minor | S |
| DEP-01 | Ticket blocked by a still-open ticket | blocking | M |
| DEP-02 | Ticket of another project depends on this version | major | M |
| DEP-03 | Touched service whose owning team has no linked ticket | minor | S |
| EXP-01 | Open incident on a touched service | blocking | M |
| EXP-02 | Incident resolved less than 7 days ago on a touched service | major | M |
| EXP-03 | Deployment freeze covering the planned date | blocking | S |
| EXP-04 | Another version ships the same day on the same services | major | S |
| DOC-01 | Linked Confluence page untouched since the cycle started | minor | M |
| HIST-01 | Risk zone: past releases on this service were followed by incidents | major | C |
| OBJ-01 | The version carries an approaching objective milestone | info | C |

Lot M = needed for the submission, S = desirable, C = after the hackathon.

## Forge architecture

```
                      ┌──────────────────────── Jira events ────────────────────────┐
                      │ avi:jira:{created,updated,released,unreleased,...}:version   │
                      │ avi:jira:updated:issue   avi:jira:{created,deleted}:issuelink│
                      └───────────────────────────────┬─────────────────────────────┘
                                                      │ trigger  (src/triggers/events.ts)
                                    debounce: at most 1 recompute / version / minute
                                    (src/engine/debounce.ts)
                                                      │
                                                      v
                                             ┌────────────────┐
                                             │  queue (publish)│
                                             └────────┬───────┘
                                                      │ consumer (timeout 900 s)
                                                      v
   ┌──────────────────────────────────────────────────────────────────────────────┐
   │  collect: Jira REST (app identity) · JQL development[...] · JSM · Confluence │
   │           Teamwork Graph (as the viewer, cached with its timestamp)          │
   │                              src/collect/*                                   │
   └───────────────────────────────────┬──────────────────────────────────────────┘
                                       v
   ┌──────────────────────────────────────────────────────────────────────────────┐
   │  PURE DOMAIN — no Forge import, no I/O, injected clock                        │
   │                                                                              │
   │  src/signals/*  ── 17 detectors ──> Signal[]                                 │
   │  src/engine/coverage.ts ──────────> Coverage (code ratio, service ratio)     │
   │  src/engine/verdict.ts  ──────────> VerdictResult (verdict, counts, conds)   │
   │  src/engine/permissions.ts ───────> evidence masked per viewer (RI-10)       │
   │  src/engine/simulate.ts ──────────> "without this ticket" + minimal set      │
   │  src/engine/graph.ts    ──────────> impact graph + list equivalent           │
   │  src/engine/waiver.ts · decision.ts · outcome.ts · diff.ts                   │
   └───────────────────────────────────┬──────────────────────────────────────────┘
                                       v
                       ┌───────────────────────────────┐
                       │ Forge SQL (src/db/*)          │
                       │ release_snapshot, signal,     │
                       │ waiver, decision, outcome,    │
                       │ policy, service_map           │
                       └───────────────┬───────────────┘
                                       │  screens always read the last saved dossier
        ┌──────────────────────────────┼───────────────────────────────┐
        v                              v                               v
  jira:projectPage              jira:issueContext              jira:dashboardGadget
  (dossier, graph, teams,       (does this ticket hold          (versions of the next
   waivers, history)             the release?)                   14 days + verdict)

  rovo:agent ─┐
  action ×7 ──┼──> the same read-only tools, no second implementation of the rules
  rovo:mcp ───┘        │
                       └──> external MCP client (e.g. a coding agent before merging)

  Forge LLM writes the 5–8 line summary only; the verdict itself is deterministic.
```

Two worlds, one boundary: the pure domain (`src/types.ts`, `src/signals/*`,
`src/engine/*`) and the Forge adapters (`src/db/*`, `src/collect/*`,
`src/triggers/*`, `src/actions/*`, `src/ui/*`). They meet at
[`src/ports.ts`](src/ports.ts) — `ReleaseStore`, `ReleaseCollector`,
`NarrativeWriter`, `Clock`, `Logger`, `JobQueue`. The engine never imports
`@forge/api`, so the whole decision path is testable with in-memory fakes.

## Status — honest

Implemented and tested today (pure domain, no Forge runtime needed):

- `src/types.ts`, `src/ports.ts` — the contract every module codes against.
- All **17 detectors** (`src/signals/comp|qual|dep|exp|doc|future.ts`), the
  catalogue (`registry.ts`) and the shared detection context.
- The engine: verdict and confidence, coverage and minor-signal sampling,
  simulation and minimal removal set, waivers, viewer-rights masking, snapshot
  diff, impact graph plus its list equivalent, 72 h outcome, decision log,
  recompute debounce.
- Bilingual dictionary (`src/i18n/index.ts`, EN + FR); no user-facing string is
  hard-coded in the domain.
- Adapters that have landed: `src/db/schema.ts` + `src/db/sql-client.ts`
  (Forge SQL DDL), `src/triggers/events.ts`, `src/triggers/scheduled.ts`,
  `src/triggers/consumer.ts`.

Not written yet (the Forge wiring, plus the data behind the two lot C signals):

- `src/engine/pipeline.ts` (the end-to-end recompute), `src/collect/*` (Jira,
  JSM, Confluence, Teamwork Graph collectors), `src/db/repo.ts` + `mapping.ts`,
  `src/actions/*` (the 7 Rovo actions / MCP tools), `src/ui/*`, `src/index.ts`
  and `manifest.yml`.
- The LLM narrative writer and its verification pass: the `Snapshot` type already
  carries `narrative`, `narrativeVerified` and `narrativeRejections`, but the
  verifier itself is not implemented — the summary is not produced yet.
- `HIST-01` and `OBJ-01` are wired but stay silent by design: no past outcome is
  stored yet, and `GraphFacts` exposes no objective relation yet.
- No CI pipeline in the repository yet; the guard that rejects empty or non-UTF-8
  Markdown files is still to be added.

Acceptance points covered by named tests: SPEC §17.1 to §17.6, plus §6.1 step 4
(the "simulate without PAY-131" scenario). §17.7 (agent parity) and §17.8
(narrative never names an unknown ticket) cannot pass yet — they need the Rovo
agent and the narrative verifier.

## Run the tests

```bash
npm ci
npx vitest run
```

The suite is pure: no network, no filesystem, no Forge runtime. When this file
was written it ran 329 tests across 26 files, all green — the count only goes up
as the adapters land. Type check with `npx tsc --noEmit`.

## Documentation

| Document | Contents |
|---|---|
| [docs/SPEC.md](docs/SPEC.md) | Full specification: users, signals, verdict rules, Forge constraints, acceptance tests |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | The two worlds, module by module, the ports contract, the flows, the design decisions |
| [docs/SIGNALS.md](docs/SIGNALS.md) | The 17 signals: code, severity, source, exact trigger condition, how to clear, missing-data case |
| [docs/DEMO-DATA.md](docs/DEMO-DATA.md) | The Paiements 2.4 demo dataset, ticket by ticket, expected verdict, how to replay it |
| [docs/VIDEO-SCRIPT.md](docs/VIDEO-SCRIPT.md) | The under-5-minute submission video, shot by shot, with the verbatim voice-over |
| [docs/JUDGES.md](docs/JUDGES.md) | Install, load the demo data, three 5-minute tours, where the Teamwork Graph / Rovo / MCP bonuses are |
| [docs/CONVENTIONS.md](docs/CONVENTIONS.md) | Code rules: file and function size, no duplication, i18n, test conventions |
| [docs/research/](docs/research) | Verified platform research: R1 Jira UI modules, R2 Rovo actions and MCP, R3 events and queues, R4 SQL and LLM, R5 scopes and data APIs, R6 UI components |

---

## Résumé en français

**Le problème.** La décision de livrer se prend en réunion, à partir de ce que
chacun a en tête. L'information existe — Jira, le code, les builds, JSM,
Compass, Confluence — mais personne ne fait la jointure. Résultat : une équipe
voisine découvre le changement en production, on livre par-dessus un incident
ouvert, le support apprend la nouveauté par un client.

**Ce que fait l'app.** Pour une version Jira, elle construit un **dossier de
release** : 17 signaux vérifiables, un avis **go / go sous conditions / no-go**
calculé par des règles déterministes, un niveau de confiance qui dépend de la
couverture réelle des données, et une synthèse de 5 à 8 lignes vérifiée contre
les signaux. Chaque signal affiche ce qui est constaté, pourquoi cela compte, la
preuve cliquable et comment le lever. Aucun déploiement n'est bloqué
techniquement : l'app éclaire une décision humaine et la trace.

**État d'avancement.** Le domaine pur est complet et testé (17 détecteurs, avis,
couverture, simulation « sans ce ticket », dérogations, masquage des preuves
selon les droits, graphe, bilan à 72 h, journal des décisions, textes EN/FR) :
329 tests au vert. Les adaptateurs Forge arrivent (schéma SQL, déclencheurs
d'événements, planificateur, consommateur de file) ; il reste le pipeline de
recalcul, les collecteurs, les actions Rovo et MCP, les écrans et le manifeste.

**Pour lancer les tests** : `npm ci && npx vitest run`.

**Documents** : [architecture](docs/ARCHITECTURE.md),
[catalogue des signaux](docs/SIGNALS.md), [jeu de démonstration](docs/DEMO-DATA.md),
[script de la vidéo](docs/VIDEO-SCRIPT.md), [instructions pour les juges](docs/JUDGES.md),
[cahier des charges](docs/SPEC.md), [conventions de code](docs/CONVENTIONS.md).
