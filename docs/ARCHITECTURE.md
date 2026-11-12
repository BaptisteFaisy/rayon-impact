# Architecture — Release Impact Radius

How the app is put together, why the boundary between the pure domain and the
Forge adapters sits where it does, and what each module owns. Specification:
[SPEC.md](SPEC.md) §12 to §15. Coding rules: [CONVENTIONS.md](CONVENTIONS.md).

---

## 1. Two worlds, one boundary

```
┌───────────────────────────── PURE DOMAIN ─────────────────────────────┐
│  src/types.ts        the contract: every type, no import              │
│  src/signals/*       the 17 detectors, pure functions of a context    │
│  src/engine/*        verdict, coverage, simulation, waivers, rights,  │
│                      diff, graph, outcome, decision, debounce         │
│  src/i18n/*          EN + FR dictionary, MessageRef → string          │
│                                                                       │
│  Rules: no @forge/api import, no I/O, no Date.now() — `now` is        │
│  injected through DetectionContext / function arguments.              │
└───────────────────────────────┬───────────────────────────────────────┘
                                │  src/ports.ts
┌───────────────────────────────┴───────────────────────────────────────┐
│  FORGE ADAPTERS                                                       │
│  src/db/*            Forge SQL: DDL, rows, mapping, repository        │
│  src/collect/*       Jira REST, JSM, Confluence, Teamwork Graph       │
│  src/triggers/*      event trigger, scheduled trigger, queue consumer │
│  src/actions/*       the 7 Rovo actions / MCP tools                   │
│  src/ui/*            jira:projectPage, issueContext, settings, gadget │
│  src/index.ts        wiring: handlers → pipeline with real deps       │
└───────────────────────────────────────────────────────────────────────┘
```

The rule is one-directional and absolute: **the domain never imports an
adapter**. `@forge/api`, `@forge/react`, `@forge/resolver` and `@forge/llm`
appear only in `src/collect/jira-client.ts`, `src/collect/graph.ts`, `src/db/`,
`src/triggers/`, `src/actions/`, `src/ui/` and `src/index.ts`. Everything the
domain needs from the outside world arrives as an argument.

Why this matters for a six-week submission: the whole decision path — 17
detectors, verdict, coverage, simulation, waivers, rights masking, graph — runs
in `npx vitest run` in under two seconds with no Forge runtime, no tunnel and no
demo site. A rule that is wrong is a failing unit test, not a manual repro on a
staging tenant.

## 2. Module by module

### `src/types.ts` — the contract

Every type the rest of the code codes against: `Signal`, `SignalDefinition`,
`CollectedRelease`, `Coverage`, `VerdictResult`, `Waiver`, `Decision`, `Outcome`,
`Snapshot`, `ReleaseDossier`, `ImpactGraph`, `Policy`, `Viewer`. Plus the limits
that must not drift: `ISSUE_SAMPLE_THRESHOLD` (1 000), `GRAPH_NODE_LIMIT` (150),
`CONFIDENCE_RULES` (0.9 / 0.8 / 0.7), `RECENT_ADD_HOURS` (48),
`RECENT_INCIDENT_DAYS` (7), `OUTCOME_WINDOW_HOURS` (72).

No user-facing string is a raw string anywhere: text is a `MessageRef`
(`{ key, params }`) resolved by `t(ref, locale)`. That is what lets the same
signal render in English and French, and lets tests assert on keys instead of on
prose.

### `src/ports.ts` — the boundary

| Port | Implemented by | Purpose |
|---|---|---|
| `ReleaseStore` | `src/db/repo.ts` | read/write dossiers, snapshots, signals, waivers, decisions, outcomes, policies |
| `ReleaseCollector` | `src/collect/collector.ts` | one release from Jira, JSM, Confluence and (as a user) the Teamwork Graph |
| `NarrativeWriter` | `src/collect/narrative.ts` | the only place allowed to call the hosted model |
| `Clock` | `src/index.ts` | every timestamp in the engine comes from here |
| `Logger` | `src/index.ts` | structured logs, no `console.log` scattered in the domain |
| `JobQueue` | `src/triggers/events.ts` consumer side | publishes a `RecomputeMessage` |
| `PipelineDeps` | assembled in `src/index.ts` | store + collector + narrative + clock + logger |

`RecomputeMessage` is the queue payload: `{ projectId, versionId, reason,
requestedAt }` where `reason` is `event | schedule | manual | outcome`.
`RecomputeResult` returns the snapshot, the signals, `narrativeFromModel`
(false when the summary was rejected and the deterministic fallback used) and
the duration.

### `src/signals/` — the detectors

| File | Owns |
|---|---|
| `registry.ts` | the catalogue: for each code, lot, default severity, source, `title`, `why`, `clear`, subject type, `alwaysAvailable` |
| `context.ts` | `DetectionContext` (`release`, `policy`, `now`, `waivers`, `previousSignals`, `pastOutcomes`), `Detector` type, `makeSignal`, `effectiveSeverity`, `isSignalEnabled`, `activeWaiverFor`, `signalId`, `hoursBetween`, `daysBetween` |
| `comp.ts` | COMP-01..04, plus the shared Jira URL and issue-evidence helpers |
| `qual.ts` | QUAL-01..03 |
| `dep.ts` | DEP-01..03, plus `resolveServiceId` — the single implementation of the SPEC §7 service-mapping order, reused by EXP and HIST |
| `exp.ts` | EXP-01..04, plus `impactedServices`, `serviceName`, `isoDay` |
| `doc.ts` | DOC-01, plus `linkedPages` |
| `future.ts` | HIST-01, OBJ-01 (lot C, deliberately silent today) |

A detector is a pure function `(ctx: DetectionContext) => Signal[]`. It does not
decide severity (the policy does, in `makeSignal`), does not decide status (a
live waiver does), and does not invent timestamps (`ctx.now`).

### `src/engine/` — everything that is not a detector

| File | Owns |
|---|---|
| `verdict.ts` | `computeVerdict`, `computeConfidence`, conditions, `blockingIssueKeys` |
| `coverage.ts` | code/service ratios, source states → notes, minor-signal sampling above 1 000 tickets |
| `simulate.ts` | `simulateWithout`, `minimalRemovalSet` (bounded search), `describeRemoval` |
| `waiver.ts` | validation (reason mandatory, approver allowed, 1–720 h), grant, close, expiry |
| `permissions.ts` | `sanitizeDossierForViewer` (RI-10), `canViewerWaive` |
| `diff.ts` | "since yesterday": added, cleared, severity changes, verdict change |
| `graph.ts` | `buildImpactGraph` and `graphToListView`, deterministic truncation |
| `outcome.ts` | the 72 h window: which incidents count, their duration, the summary |
| `decision.ts` | `recordDecision` (with the verdict of the moment), `latestDecision` |
| `debounce.ts` | at most one recompute per version per minute, with reason priority; what the window holds back is deferred, never dropped (`trailingPass`) |

## 3. Flows

### 3.1 Event → queue → consumer → pipeline → dossier

```
1. A Jira event fires.
   avi:jira:{created,updated,released,unreleased,archived,unarchived,moved,merged,
   deleted}:version  ·  avi:jira:{created,updated,deleted,assigned,...}:issue
   ·  avi:jira:{created,deleted}:issuelink
                    │
                    v
2. src/triggers/events.ts   recognises the event, extracts (projectId, versionId),
   asks src/engine/debounce.ts whether this version may be queued now.
   The answer is at most one message per version per minute
   (MIN_RECOMPUTE_INTERVAL_SECONDS = 60); reasons coalesce by priority
   manual > event > schedule > outcome, so a user click never gets downgraded.
   A request that falls inside the window is NOT dropped: it is held back in
   `recalc_deferred` (one row per version, coalesced) for the trailing pass of
   step 4 and, failing that, for the hourly sweep — "regroupé, jamais jeté".
                    │
                    v
3. JobQueue.publish(RecomputeMessage)     Forge queue
                    │
                    v
4. src/triggers/consumer.ts   (timeoutSeconds: 900) drains one message, calls
   recomputeRelease(deps, request) — delivery is "at least once" and there is no
   dead-letter queue, so the pipeline must be safe to replay: a snapshot is keyed
   by (version, computedAt) and the dossier read always takes the latest one.
   Right after a successful recompute it runs the TRAILING PASS
   (src/triggers/trailing.ts) and stays awake until the window closes: whatever
   the window held back — during the recompute or in the seconds after it — is
   replayed, at the instant the one-per-minute rule allows. Bounded three ways:
   MAX_TRAILING_PASSES = 3 recomputes, MAX_TRAILING_WAITS = 4 waits and a 300 s
   budget against the 900 s timeout (the budget binds first), so an invocation
   never runs away; what is left goes to the hourly sweep. Four waits and not
   two: the observed pattern is wait → recompute → wait → recompute, a burst of
   two changes each landing inside the window of the previous recompute.
                    │
                    v
5. Pipeline (src/engine/pipeline.ts, not written yet) with the injected deps:
   a. collector.collect(projectId, versionId, viewerAccountId) → CollectedRelease
      (issues, links, changelog facts, incidents, pages, teams, graph facts,
       sibling versions, freeze windows, and the SourceStatus list)
   b. the 6 detector families run in order: comp, qual, dep, exp, doc, future
   c. computeCoverage → coverage; applyMinorSampling above 1 000 issues
   d. computeVerdict → verdict, confidence, counts, conditions, blocking keys
   e. narrative.write(...) then verification; a rejected summary falls back to a
      deterministic text and sets narrativeFromModel = false
   f. store.saveSnapshot(snapshot, signals) — the screens read only this
                    │
                    v
6. Screens, Rovo agent and MCP tools read the last saved dossier.
   They never compute on the request path (SPEC §12 step 5), which is what keeps
   the project page under 2 s.
```

### 3.2 Teamwork Graph collection

The Teamwork Graph API can only be called **as a user**
(`api.asUser().requestTeamworkGraph`), and a missing scope omits objects
*silently* — no error, just fewer facts. So the graph block is collected when a
human opens the page or asks the agent, cached in the dossier as `GraphFacts`
with `fetchedAt` / `fetchedByAccountId` / `missingScopes`, and never trusted
beyond its timestamp. A background recompute runs as the app: it uses the Jira
REST API and, as a fallback, the JQL `development[...]` search. When the graph
block is `null`, every graph-dependent detector stays silent and coverage says
so — silence is never rendered as "all clear".

### 3.3 Display-time filtering

The dossier is computed in the app's name, so every proof is filtered **at
display time** against the reader's rights (`sanitizeDossierForViewer`). A hidden
item becomes `evidence.restricted` ("1 hidden item (restricted access)"), loses
its URL, and **still counts** in the verdict: filtering never changes
`snapshot.verdict`, `counts` or `confidence`.

## 4. Design decisions

### 4.1 The verdict is deterministic; the model only writes prose

`computeVerdict` is a pure function of (signals, coverage, release). Blocking →
`no-go`; major or waived → `conditional-go` with the conditions enumerated;
otherwise `go`; a version without tickets or without a release date →
`not-applicable` (never a default `go`). No model, no scoring, no learned
weights: the same dossier always yields the same verdict, and every reason is
traceable to a signal with a proof. The LLM sits *after* the verdict and cannot
move it.

### 4.2 The summary is verified, not trusted

The writer receives only the structured signal list and returns 5 to 8 lines,
each citing a signal code. A verification pass rejects any sentence naming a
ticket, service or incident that is not in the signals; rejected sentences are
kept in `narrativeRejections` for the audit trail and the snapshot is flagged
`narrativeVerified: false`. A model that hallucinates cannot reach a screen
unflagged. (The writer and the verifier are not implemented yet — see the status
section of [../README.md](../README.md).)

### 4.3 Proofs are masked, the advice is not

Rights filtering happens per viewer, per evidence item. Two cases also mask the
*finding* text, because the finding itself would leak an identifier the reader
may not see: the signal subject is invisible to them, or a finding parameter
contains the id of a hidden item (compared after stripping `id-`, `inc-`,
`svc-`, `page-`, `team-` prefixes, so `id-pay-131` matches `PAY-131`). What never
changes is the verdict — a hidden incident still blocks the release. The point of
RI-10 is "do not leak", not "let restricted data change the answer".

### 4.4 Honest degradation when a source is missing

The rule, applied in every detector and in coverage: **absent data is not good
news**. Concretely:

- `dev.known === false` → COMP-02, COMP-03, QUAL-01, QUAL-02 stay silent, and the
  ticket is counted as "no visible code", which lowers `codeRatio`.
- No `addedToVersionAt` (no changelog) → COMP-04 stays silent.
- `release.graph === null` → DEP-03 stays silent; no `cycleStartedAt` → DOC-01
  stays silent; no past outcome → HIST-01 stays silent.
- A ticket without a resolved service is not dropped: `issuesWithService` drops
  and a `coverage.service.missing` note is added.
- An incident without a service is ignored for EXP-01/02, and coverage mentions it.
- A version without a release date raises neither EXP-03 nor EXP-04.

Each `SourceStatus` (`ok | partial | empty | unavailable`) becomes a coverage
note, so "low confidence" always has a stated reason, and the low-confidence
sentence spells it out: *"I see no commits for 6 of 14 tickets: either the
repository is not linked to Jira, or nothing was coded."*

### 4.5 Stable identities across recomputes

A signal id is `${code}:${subjectType}:${subjectId}`, where `subjectId` is the
Jira id (never the key, which can change when a ticket moves project). That is
what makes `firstSeenAt` survive a recompute, and what makes the "since
yesterday" diff and the waiver binding stable. `detectedAt` moves, `firstSeenAt`
does not.

### 4.6 Waivers are closed, never deleted

A waiver carries a mandatory reason, an approver, a grant date and an expiry
(1 to 720 h). It changes a signal's status to `waived`, which by itself forces
`conditional-go` and lists the signal among the conditions — waiving does not
erase the fact. Expiry is evaluated at each recompute against `ctx.now`, so a
waiver that expires overnight puts the release back in `no-go` at the next
hourly pass. `closeWaiver` sets `closedAt` / `closedReason`; nothing is deleted
(traceability, SPEC §15).

### 4.7 Volume is bounded by design

Above 1 000 tickets, blocking and major signals are all kept while minor and info
signals are capped (`MINOR_SIGNAL_CAP = 50`) and `sampledMinorSignals` is set, so
the dossier says it sampled instead of silently dropping rows. Above 150 graph
nodes, the graph is truncated deterministically — version node first, then nodes
carrying a blocking signal, then a major one, then the rest, stable by node id —
and `graphToListView` always provides the accessible list equivalent.

### 4.8 The simulation is a search with a stated bound

`simulateWithout` drops the signals attached to the removed tickets (including a
DEP-01 whose blocker is removed) and recomputes the verdict with the same
function. `minimalRemovalSet` searches subsets of size 1, 2 then 3 among the
tickets carrying active blocking signals and returns `provenMinimal: false` when
the bound was hit or when a version-level blocking signal (an incident, a freeze)
cannot be lifted by removing any ticket — the UI then says so instead of
proposing a misleading fix.
