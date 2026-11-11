# The demo dataset — Paiements 2.4

The canonical demo release of SPEC §18: project **Paiements** (`PAY`), version
**2.4**, **14 tickets**, evaluated on **11 November 2026 at 06:00 UTC**, one day
before the planned release on **12 November 2026**. It lives in
[`tests/fixtures/paiements.ts`](../tests/fixtures/paiements.ts) and is the
reference dataset of the test suite.

Everything below was produced by running the real detectors and the real verdict
engine on that fixture — not by hand.

---

## 1. How the dataset is built

The fixture composes builders from
[`tests/fixtures/builders.ts`](../tests/fixtures/builders.ts); no object literal
is re-declared. Builders default to a *healthy* release, so a signal only fires
because the fixture explicitly says so.

| Export | What it is |
|---|---|
| `paiementsIssues()` | the 14 tickets PAY-127 … PAY-140 |
| `paiementsIncidents()` | INC-52 (open) and INC-48 (resolved) |
| `paiementsPages()` | page 9001 "Integration guide" (stale) and 9002 "Runbook checkout-api" (fresh) |
| `paiementsGraph()` | cached Teamwork Graph facts: Mobile owns `cmp-mobile` on PAY-127; PAY-127/128 impact `cmp-checkout` |
| `paiementsRelease()` | the assembled `CollectedRelease`: version 2.4, `releaseDate: 2026-11-12`, `cycleStartedAt: 2026-10-29`, `collectedAt: 2026-11-11T06:00Z`, six sources `ok` |
| `paiementsPolicy()` | the `Policy`: service map for `checkout-api` and `mobile-app`, `waiverApprovers: ['user-release-lead']`, `defaultWaiverHours: 48`, JSM project `INC` |
| `LINKED_OUTSIDE_ISSUES` | `MOB-77` (depends on PAY-127) and `PAY-118` (the open blocker), for DEP-02 |

The evaluation instant used by every test and by this document is
`2026-11-11T06:00:00.000Z`. It matters: COMP-04 measures the age of a ticket
against `now`, and EXP-02 measures the age of a resolved incident.

The dataset is deliberately *broad* rather than *dramatic*: it exists to cover
every signal family and the SPEC §17 acceptance points with one shared release.
Two consequences are documented below in §4 — read them before filming.

## 2. Expected verdict on the raw dataset

```
verdict     : no-go
confidence  : high
counts      : blocking 5 · major 2 · minor 2 · info 0   (9 signals)
coverage    : 14 tickets · 13 with visible code (0.929) · 14 with a known service (1.000)
holds       : PAY-129, PAY-130, PAY-131   (tickets carrying an active blocking signal)
```

**Why `no-go`**: five active blocking signals (COMP-01, COMP-03, QUAL-01, DEP-01,
EXP-01) — the rule is "at least one blocking signal ⇒ no-go".

**Why `high` confidence**: `codeRatio = 13/14 = 0.929 ≥ 0.90` and
`serviceRatio = 14/14 = 1.000 ≥ 0.80`, both above the high thresholds of
`CONFIDENCE_RULES`. (The doc comment at the top of the fixture still says
"confidence medium"; the code and the rules say high — the code wins.)

### The nine signals, as raised

| Code | Severity | Subject | Finding (English) |
|---|---|---|---|
| COMP-01 | blocking | PAY-131 | Ticket PAY-131 is still In Progress (in-progress). |
| COMP-03 | blocking | PAY-131 | Ticket PAY-131 has 1 open pull request(s). |
| QUAL-01 | blocking | PAY-129 | Latest build on ticket PAY-129 failed (1 failing build(s) recorded). |
| DEP-01 | blocking | PAY-130 | Ticket PAY-130 is blocked by PAY-118, which is still in-progress. |
| EXP-01 | blocking | INC-52 | Open incident INC-52 on service checkout-api (impacted by PAY-127 … PAY-140). |
| QUAL-02 | major | PAY-135 | Ticket PAY-135 contains 1 PR(s) merged without required approvals. |
| EXP-02 | major | INC-48 | Incident INC-48 was resolved 2d ago on service checkout-api (under 7 days). |
| COMP-04 | minor | PAY-133 | Ticket PAY-133 joined the release 6h ago (under 48h). |
| QUAL-03 | minor | PAY-134 | Bug PAY-134 was reopened at least once during this release cycle. |

Signals **not** raised on the raw fixture, and why — this is the interesting
part:

| Code | Why it is silent |
|---|---|
| COMP-02 | PAY-132 has `dev.known = false` (no repository linked for it). The detector refuses to accuse a ticket when the code source did not answer; the ticket lowers `codeRatio` instead. |
| DEP-02 | MOB-77 lives in `linkedOutsideIssues`, which `paiementsRelease()` leaves empty. Add `LINKED_OUTSIDE_ISSUES` to see it. |
| DEP-03 | `checkout-api` has no owning team in the graph (only `Mobile` owns `cmp-mobile`), so there is no team to blame for the absence of a ticket. |
| DOC-01 | No ticket carries a Confluence remote link in the fixture, so no page is "linked" to the release. Add one to page 9001. |
| EXP-03 / EXP-04 | No freeze window and no sibling version in the fixture. |
| HIST-01 / OBJ-01 | No stored past outcome; `GraphFacts` carries no objective. |

## 3. Ticket by ticket

| Ticket | Summary | Status | Dev facts | Outcome |
|---|---|---|---|---|
| PAY-127 | Add SEPA instant credit | Done | 1 commit, 1 merged PR | clean — but it is the ticket MOB-77 depends on (DEP-02 when outside issues are collected), and it is the ticket the graph attaches the Mobile team to |
| PAY-128 | Harden 3DS retry path | Done | healthy | clean |
| PAY-129 | Upgrade ledger client | Done | `failingBuilds: 1`, `lastBuildState: 'failing'` | **QUAL-01** blocking — red CI on the last commit |
| PAY-130 | Switch to batched settlements | Done | healthy | **DEP-01** blocking — link "Blocks" (inward) to PAY-118, still In Progress |
| PAY-131 | Rework refund ledger entries | **In Progress** | 1 open PR, 0 merged | **COMP-01 + COMP-03** blocking — the ticket that the video removes |
| PAY-132 | Document settlement SLA | Done | `dev.known: false` | no signal — coverage hole, counted as "no visible code" |
| PAY-133 | Round-up cents on FX | Done | `addedToVersionAt: 2026-11-11T00:00Z` | **COMP-04** minor — joined 6 h ago |
| PAY-134 | Duplicate webhook on timeout | Done | type `Bug`, `reopenedDuringCycle: true` | **QUAL-03** minor |
| PAY-135 | Bump crypto provider | Done | `mergedWithoutApproval: 1` | **QUAL-02** major |
| PAY-136 | Trace id propagation | Done | healthy | clean |
| PAY-137 | Idempotency keys on refunds | Done | healthy | clean |
| PAY-138 | Retry budget tuning | Done | healthy | clean |
| PAY-139 | Settlement dashboard tiles | Done | healthy | clean |
| PAY-140 | PSP contract flags | Done | healthy | clean |

Outside the release: **PAY-118** (In Progress, the blocker of PAY-130) and
**MOB-77** (project `MOB`, "Mobile: surface new payment methods", depends on
PAY-127). Incidents: **INC-52** open on `checkout-api`; **INC-48** resolved on
8 November 09:40 UTC, i.e. 2 days before the evaluation instant. Pages: **9001**
"Integration guide" last modified 14 September (before the cycle start of
29 October); **9002** "Runbook checkout-api" last modified 9 November.

## 4. Two things to know before filming

**(a) The 14-ticket dataset is broader than the video story.** SPEC §6.1 and §18
tell a three-reason story: an open incident, PAY-131's open PR, a stale
integration guide. The canonical fixture adds two more blockers (PAY-129's red
build, PAY-130's open blocker) because it has to exercise every family. On the
raw fixture, therefore, "simulate without PAY-131" does **not** reach
`conditional-go`: it drops 2 signals and the verdict stays `no-go`, because
EXP-01, QUAL-01 and DEP-01 are still active. That is the honest behaviour of the
engine, and the test `acceptance §6.1 step 4` reproduces the SPEC scenario on a
three-signal subset (COMP-01 + COMP-03 on PAY-131, DOC-01) rather than on the
full fixture.

**(b) Removing tickets cannot lift a version-level blocker.** On the raw fixture,
`minimalRemovalSet` returns an empty set with `provenMinimal: false` after 14
simulations: EXP-01 hangs off an *incident*, not a ticket, so no combination of
ticket removals can clear the no-go. The UI says so (`simulation.noSolution`)
instead of proposing a misleading fix.

### The video variant (12 tickets)

For the §18 scenario, start from the canonical fixture, drop **PAY-129** and
**PAY-130** from version 2.4 (in Jira: remove them from the version), attach
`LINKED_OUTSIDE_ISSUES`, and add a Confluence remote link from PAY-127 to page
9001. Measured sequence:

| Stage | Verdict | Counts | Signals |
|---|---|---|---|
| A. as filmed, before anything | `no-go` | blocking 3 · major 3 · minor 3 | COMP-01, COMP-03, EXP-01 blocking; QUAL-02, DEP-02, EXP-02 major; COMP-04, QUAL-03, DOC-01 minor |
| B. preview "simulate without PAY-131" | `no-go` | blocking 1 · major 3 · minor 3 | 2 signals dropped (COMP-01, COMP-03); EXP-01 remains — the preview tells the truth |
| C. PAY-131 removed from the version | `no-go` | blocking 1 · major 3 · minor 3 | only EXP-01 blocks |
| D. 24 h waiver on EXP-01, reason given | `conditional-go` | blocking 0 · major 3 · minor 3 | conditions: EXP-01 (waived), DEP-02, EXP-02, QUAL-02 |
| E. 48 h waiver on DOC-01 | `conditional-go` | blocking 0 · major 3 · minor 2 | conditions add DOC-01 (waived) |

That is exactly the SPEC §6.1 walkthrough: the release lead removes the ticket,
waives what he accepts, and the verdict moves to `conditional-go` with the
conditions enumerated. Note that a waiver never erases a signal — it stays in the
conditions list, which is the whole point of a traceable derogation.

And on the raw fixture, with a waiver on EXP-01, the minimal removal set becomes
`[PAY-131, PAY-129, PAY-130]` → `conditional-go`, `provenMinimal: true`, after 11
simulations. That is the sentence the UI renders: *"Removing 3 ticket(s)
(PAY-131, PAY-129, PAY-130) lifts the NO-GO verdict."*

## 5. How to replay it

### The test suite (the reference)

```bash
cd /home/baptiste/Bureau/rayon-impact
npm ci
npx vitest run
```

The dataset is asserted in the `jeu canonique Paiements 2.4` blocks of
[`tests/signals/comp.test.ts`](../tests/signals/comp.test.ts),
[`tests/signals/dep.test.ts`](../tests/signals/dep.test.ts),
[`tests/signals/qual.test.ts`](../tests/signals/qual.test.ts), and in
[`tests/engine/graph.test.ts`](../tests/engine/graph.test.ts),
[`tests/engine/simulate.test.ts`](../tests/engine/simulate.test.ts) and
[`tests/engine/permissions.test.ts`](../tests/engine/permissions.test.ts).

Targeted runs:

```bash
npx vitest run tests/signals          # the 6 detector families
npx vitest run tests/engine           # verdict, coverage, simulation, waivers, rights, graph
```

### Print the dossier by hand

The engine is pure, so a dossier can be printed without any Forge runtime. Write
this in `/tmp/print-dossier.ts` and run it with esbuild (already in
`node_modules`, no install needed):

```ts
import { detectComp } from '/home/baptiste/Bureau/rayon-impact/src/signals/comp.js';
import { detectQual } from '/home/baptiste/Bureau/rayon-impact/src/signals/qual.js';
import { detectDep } from '/home/baptiste/Bureau/rayon-impact/src/signals/dep.js';
import { detectExp } from '/home/baptiste/Bureau/rayon-impact/src/signals/exp.js';
import { detectDoc } from '/home/baptiste/Bureau/rayon-impact/src/signals/doc.js';
import { detectFuture } from '/home/baptiste/Bureau/rayon-impact/src/signals/future.js';
import { computeCoverage } from '/home/baptiste/Bureau/rayon-impact/src/engine/coverage.js';
import { computeVerdict } from '/home/baptiste/Bureau/rayon-impact/src/engine/verdict.js';
import { t } from '/home/baptiste/Bureau/rayon-impact/src/i18n/index.js';
import { paiementsPolicy, paiementsRelease } from '/home/baptiste/Bureau/rayon-impact/tests/fixtures/paiements.js';

const release = paiementsRelease();
const ctx = {
  release,
  policy: paiementsPolicy(),
  now: '2026-11-11T06:00:00.000Z',
  waivers: [],
  previousSignals: [],
  pastOutcomes: [],
};
const signals = [
  ...detectComp(ctx), ...detectQual(ctx), ...detectDep(ctx),
  ...detectExp(ctx), ...detectDoc(ctx), ...detectFuture(ctx),
];
const coverage = computeCoverage(release);
const verdict = computeVerdict(signals, coverage, release);

console.log(verdict.verdict, verdict.confidence, verdict.counts);
for (const s of signals) console.log(s.code, s.severity, s.status, '—', t(s.finding, 'en'));
```

```bash
cd /home/baptiste/Bureau/rayon-impact
./node_modules/.bin/esbuild /tmp/print-dossier.ts --bundle --platform=node \
  --format=esm --outfile=/tmp/print-dossier.mjs && node /tmp/print-dossier.mjs
```

Change `now` to see the time-sensitive signals move: at `2026-11-11T07:00Z`
COMP-04 reports 7 h; at `2026-11-13T00:00Z` PAY-133 is exactly 48 h old and
COMP-04 falls silent on its own; at `2026-11-15T09:40Z` INC-48 is 7 days old and
EXP-02 falls silent too — no configuration, just the clock.
