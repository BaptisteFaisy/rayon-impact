# Signal catalogue

The 17 signals of the release dossier. Every trigger condition below is the one
**actually implemented** in `src/signals/*.ts` — where it differs from the
specification table, the code is the reference. Default severities and lots come
from [`src/signals/registry.ts`](../src/signals/registry.ts).

Read this page next to the code: [comp.ts](../src/signals/comp.ts),
[qual.ts](../src/signals/qual.ts), [dep.ts](../src/signals/dep.ts),
[exp.ts](../src/signals/exp.ts), [doc.ts](../src/signals/doc.ts),
[future.ts](../src/signals/future.ts), and the shared helpers in
[context.ts](../src/signals/context.ts).

## How a signal is built

Every detector is a pure function `(ctx: DetectionContext) => Signal[]` built
with `makeSignal(ctx, { code, subject, finding, evidence })`. That helper applies
three things the detector never decides itself:

- **severity** = `effectiveSeverity(code, policy)` — the project override
  (`policy.severityOverrides`) wins over the catalogue default (RI-11);
- **status** = `waived` when a live waiver covers `(code, subjectId)`, else
  `active`;
- **firstSeenAt** = carried over from the previous snapshot when the same signal
  id already existed (stable diffs, RI-14).

A detector returns `[]` immediately when the code is in `policy.disabledSignals`
(`isSignalEnabled`). A signal id is `${code}:${subjectType}:${subjectId}`, with
`subjectId` the Jira id — never the key, which changes when a ticket moves.

Every signal shows four things: what was observed (`finding`, with the concrete
values), why it matters (`why`), the proof (`evidence[]`, with a URL when the
source has one), and how to clear it (`clear`). Titles, `why` and `clear` come
from the registry, never from the detector.

## Table

| Code | Signal | Default severity | Lot | Data source | Subject |
|---|---|---|---|---|---|
| COMP-01 | Unfinished ticket in release | blocking | M | Jira `fixVersion` search | issue |
| COMP-02 | Done ticket with no commit or PR | major | M | Teamwork Graph / JQL `development[...]` | issue |
| COMP-03 | Open PR on release ticket | blocking | M | Teamwork Graph / JQL `development[...]` | issue |
| COMP-04 | Ticket added to release less than 48 h ago | minor | S | Jira issue history (changelog) | issue |
| QUAL-01 | Latest build failed on release ticket | blocking | M | Teamwork Graph / JQL `development[...]` | issue |
| QUAL-02 | PR merged without approval | major | S | Teamwork Graph (reviewers) | issue |
| QUAL-03 | Bug reopened during the cycle | minor | S | Jira issue history (changelog) | issue |
| DEP-01 | Ticket blocked by an open issue | blocking | M | Jira issue links | issue |
| DEP-02 | Cross-project dependency on this release | major | M | Jira issue links (cross-project) | outside issue |
| DEP-03 | Impacted dependent service has no linked ticket | minor | S | Teamwork Graph + Compass mapping | service |
| EXP-01 | Open incident on impacted service | blocking | M | Jira Service Management | incident |
| EXP-02 | Recent incident on impacted service (< 7 days) | major | M | Jira Service Management | incident |
| EXP-03 | Deployment freeze window active | blocking | S | Release calendar held in the app | version |
| EXP-04 | Multiple releases on the same service the same day | major | S | Jira project versions | sibling version |
| DOC-01 | Linked Confluence page not updated this cycle | minor | M | Confluence pages via Jira remote links | page |
| HIST-01 | High-risk zone: past releases had incidents | major | C | Past 72 h outcomes | service |
| OBJ-01 | Release carries an approaching objective milestone | info | C | Teamwork Graph | version |

Nine signals are lot **M** (needed for the submission): COMP-01, COMP-02,
COMP-03, QUAL-01, DEP-01, DEP-02, EXP-01, EXP-02, DOC-01.

## The ticket → service mapping, shared by DEP-03, EXP and HIST

`resolveServiceId(issue, policy, graph)` in [dep.ts](../src/signals/dep.ts) is
the only implementation, in this order:

1. the graph relation `Jira work item impacts Compass component`
   (`graph.servicesByIssueId[issueId]`);
2. the "affected services" field, matched against a `serviceMap` entry's
   `serviceName` / `serviceId` / `jsmService`;
3. the Jira component field, matched against `serviceMap[].jiraComponent`;
4. the graph's Compass components, matched against `serviceMap[].compassComponentId`;
5. the service the collector already resolved, else `null`.

A `null` service is never dropped: it lowers `issuesWithService`, adds a
`coverage.service.missing` note, and keeps that ticket out of the EXP/HIST
signals — an unknown fact is not a finding.

**Important nuance.** `EXP-01`/`EXP-02`/`EXP-03`/`EXP-04` and `HIST-01` compare
against `impactedServices(release)`, which reads the collector-resolved
`issue.serviceId` — not `resolveServiceId`. The resolution order above is what the
collector uses to fill that field, and what DEP-03 recomputes at detection time.

---

## COMP — code completeness

`src/signals/comp.ts`. All four are anchored on a release ticket; the proof is
always the ticket's Jira browse URL.

### COMP-01 — Unfinished ticket in release · blocking · M

- **Fires for** every issue of the release whose `statusCategory !== 'done'`
  (`to-do` or `in-progress`). One signal per ticket.
- **Finding**: `Ticket {key} is still {status} ({category}).`
- **Clear**: move the ticket to Done, or remove it from the release.
- **Data absent**: nothing to miss — the status always exists. Never silent.

### COMP-02 — Done ticket with no commit or PR · major · M

- **Fires for** an issue with `statusCategory === 'done'` **and** `dev.known`
  **and** `commits === 0 && openPullRequests === 0 && mergedPullRequests === 0`.
- **Finding**: `Ticket {key} is marked Done but has 0 commits and 0 pull requests.`
- **Clear**: link the commits or the PR, or attach a note explaining that no code
  was needed.
- **Data absent**: `dev.known === false` → **silent**. The ticket counts as "no
  visible code" in coverage instead. This is why a ticket whose repository is not
  linked to Jira never raises COMP-02 — it lowers confidence, it does not accuse.

### COMP-03 — Open PR on release ticket · blocking · M

- **Fires for** an issue with `dev.known` **and** `openPullRequests > 0`
  (regardless of the ticket status).
- **Finding**: `Ticket {key} has {count} open pull request(s).`
- **Clear**: merge or close the PRs, or drop the ticket from the release.
- **Data absent**: `dev.known === false` → silent, coverage drops.

### COMP-04 — Ticket added to release less than 48 h ago · minor · S

- **Fires for** an issue with `addedToVersionAt` **and**
  `0 <= hoursBetween(addedToVersionAt, now) < 48` (`RECENT_ADD_HOURS`). `hours` is
  floored for display; a timestamp in the future (negative age) does not fire.
- **Finding**: `Ticket {key} joined the release {hours}h ago (under 48h).`
- **Clear**: verify test coverage for that ticket, or request a waiver with a reason.
- **Data absent**: no `addedToVersionAt` (no changelog read) → silent.

---

## QUAL — code quality

`src/signals/qual.ts`. All three hang off a release ticket; the proof is the
ticket's browse URL. The three development signals stay silent when
`dev.known === false`.

### QUAL-01 — Latest build failed on release ticket · blocking · M

- **Fires for** an issue with `dev.known` **and** (`failingBuilds > 0` **or**
  `lastBuildState === 'failing'`). The `count` parameter is `failingBuilds`, so a
  ticket flagged only by `lastBuildState` reports `0` — the state is the trigger,
  the counter is the detail.
- **Clear**: fix the build and get CI green, or revert the commit.
- **Data absent**: `dev.known === false` → silent.

### QUAL-02 — PR merged without approval · major · S

- **Fires for** an issue with `dev.known` **and** `mergedWithoutApproval > 0`.
- **Finding**: `Ticket {key} contains {count} PR(s) merged without required approvals.`
- **Clear**: run a retroactive review, or request a waiver.
- **Data absent**: `dev.known === false` → silent. Needs the reviewers relation
  from the Teamwork Graph; the JQL fallback cannot see approvals.

### QUAL-03 — Bug reopened during the cycle · minor · S

- **Fires for** an issue with `issueType === 'Bug'` **and**
  `reopenedDuringCycle === true`. A reopened *task* or *story* does not fire: that
  is a planning detail, not a quality one.
- **Clear**: make sure an explicit non-regression test was added.
- **Data absent**: the flag comes from the changelog; if the changelog was not
  read, it is `false` and the signal is silent.

---

## DEP — dependencies

`src/signals/dep.ts`.

### DEP-01 — Ticket blocked by an open issue · blocking · M

- **Fires for** a release ticket whose links contain one whose type matches
  `/block|bloqu/i` ("Blocks", "is blocked by", "bloque"…) **and** whose
  `targetStatusCategory` is not `done`. A missing target status is treated as
  `unknown`, which **does** fire — an unreadable blocker is not a resolved one.
  One signal per ticket (the first matching link), so the id stays stable.
- **Finding**: `Ticket {key} is blocked by {blockerKey}, which is still {blockerStatus}.`
- **Evidence**: the ticket, then the blocker — resolved from the release issues or
  from `linkedOutsideIssues`, otherwise built from the target project key and key.
- **Clear**: resolve the blocker, or remove the ticket from the release.
- **Data absent**: no links read → nothing fires; the coverage of the `jira`
  source says whether links were collected.

### DEP-02 — Cross-project dependency on this release · major · M

- **Fires for** each issue in `release.linkedOutsideIssues` whose `projectKey`
  differs from the release project **and** which links to a release issue (matched
  on `targetId === issue.subjectId` or `targetKey === issue.key`). One signal per
  outside ticket, whose **subject is the outside ticket** (so the same outside
  ticket never produces two signals).
- **Finding**: `Ticket {targetKey} ({projectKey}) depends on ticket {key} in this release.`
- **Clear**: notify the team owning that ticket before the cut.
- **Data absent**: the collector must have queried the outside issues; without
  them the signal is silent (coverage of the `jira` source says so).

### DEP-03 — Impacted dependent service has no linked ticket · minor · S

- **Requires** `release.graph !== null`: with no graph block the detector returns
  `[]` immediately — there is no way to know who owns a service, so there is no
  finding.
- **Touched services** = the resolved service of every release ticket, plus every
  `serviceMap` entry whose `compassComponentId` appears in the graph's components
  for a release ticket.
- **Fires for** a touched service that has a `serviceMap` entry, whose **owning
  teams** (teams whose `componentIds` contain the entry's `compassComponentId` or
  `jiraComponent`) are known, and **none** of which has a ticket in the release
  (`graph.teamsByIssueId` over the release issues).
- **Finding**: `Service {service} is affected by the release but owning team has 0 linked tickets.`
- **Clear**: reach out to the service owner, or link a ticket.
- **Data absent**: no graph, no owning team, or no service map entry → silent. An
  absent ownership fact is not a finding.

---

## EXP — exploitation

`src/signals/exp.ts`. Everything here depends on the ticket → service mapping: an
incident or a freeze only counts when it lands on a service the release touches.

### EXP-01 — Open incident on impacted service · blocking · M

- **Fires for** an incident with `state === 'open'`, a non-null `serviceId`, and
  that `serviceId` in `impactedServices(release)`.
- **Finding**: `Open incident {incidentKey} on service {service} (impacted by {issues}).`
  — `issues` is the comma-joined list of the release tickets touching that service.
- **Evidence**: the incident, with its JSM URL.
- **Clear**: wait for the incident to be resolved, or decouple the release from
  that service.
- **Data absent**: an incident without a `serviceId` is ignored (SPEC §16) and
  coverage mentions it; if JSM is not reachable the source state says so.

### EXP-02 — Recent incident on impacted service (< 7 days) · major · M

- **Fires for** an incident that is **not** open, has a `resolvedAt`, has a
  `serviceId` in `impactedServices`, and `0 <= daysBetween(resolvedAt, now) < 7`
  (`RECENT_INCIDENT_DAYS`). `days` is floored; a resolution in the future is
  ignored.
- **Clear**: verify the post-incident fixes are stable, or request a waiver.
- **Data absent**: same as EXP-01.

### EXP-03 — Deployment freeze window active · blocking · S

- **Fires when** the version has a `releaseDate` **and** a freeze window covers it
  at **day granularity** (`isoDay(from) <= isoDay(releaseDate) <= isoDay(to)`),
  with `scope === 'all'` or at least one of its `serviceIds` in
  `impactedServices`.
- **One signal at most**, on the version (first matching window), so the id is
  stable. **No evidence URL** — a freeze is app data, not an Atlassian object.
- **Clear**: reschedule outside the window, or obtain VP-level approval.
- **Data absent**: no release date → silent (SPEC §16: a version without a date
  raises nothing).

### EXP-04 — Multiple releases on the same service the same day · major · S

- **Fires when** the version has a `releaseDate`, `impactedServices` is not empty,
  and a sibling version (`sibling.id !== version.id`) has the **same release day**
  and at least one **shared service** (a service of a sibling issue that the
  release also touches). One signal per sibling version; the subject is the
  sibling, services are joined in the finding.
- **Clear**: coordinate the rollout order with that version.
- **Data absent**: no release date, no touched service, or no sibling versions
  collected → silent. Jira versions expose no URL, so the signal has no link and
  coverage still counts it.

---

## DOC — documentation

`src/signals/doc.ts`.

### DOC-01 — Linked Confluence page not updated this cycle · minor · M

- **Fires for** a Confluence page that is linked by at least one release ticket
  (a `remoteLink` of kind `confluence`, matched by exact URL first, then by the
  page id contained in the URL) **and** whose `lastModified` is strictly before
  `release.cycleStartedAt`. Two tickets pointing at the same page produce one
  signal (deduplicated by page id).
- **Finding**: `Page "{pageTitle}" has not been modified since {cycleStart} (release cycle start).`
- **Evidence**: the page, with its Confluence URL.
- **Clear**: review and touch the page, or grant a waiver.
- **Data absent**: no `cycleStartedAt` → no reference point → silent; no Confluence
  remote links → nothing to check, and the coverage of the `confluence` source
  reports it.

---

## Vision (lot C)

`src/signals/future.ts`. Both are wired and tested but **silent by design today**:
each rests on a source the app cannot fully read yet, and guessing would break the
honesty rule.

### HIST-01 — High-risk zone · major · C

- **Fires for** each impacted service that appears in at least one stored 72 h
  outcome (`ctx.pastOutcomes`), where an incident is attributed to the service
  through `graph.servicesByIncidentId[incident.key]`, else through a collected
  incident with the same key. Each outcome is already a 72 h window, so counting
  its entries counts incidents inside such a window.
- **Finding**: `Past releases touching {service} had {count} incident(s) in their 72h window.`
- **Evidence**: the first past incident that carries a URL.
- **Clear**: extra smoke testing and a dedicated on-call engineer during rollout.
- **Data absent**: no stored outcome → silent. The 72 h outcome computation exists
  (`src/engine/outcome.ts`); what is missing is a release history to feed it.

### OBJ-01 — Approaching objective milestone · info · C

- **Fires when** the cached graph facts carry an `objective` with both `milestone`
  and `due`. `GraphFacts` does not expose that relation yet: the reader looks for
  an optional member and returns `null` while it is absent, so the signal never
  fires today. Wiring it later means adding the field to `GraphFacts` and dropping
  one cast in `objectiveFacts` — nothing else changes.
- **Finding**: `Milestone "{milestone}" is due on {due}.`
- **Clear**: informational signal, no action required. It never weighs on the
  verdict (severity `info`).

---

## Policies that change the catalogue per project

`src/engine/*` and `src/signals/context.ts`, driven by `Policy`:

| Setting | Effect |
|---|---|
| `severityOverrides[code]` | replaces the default severity — the only way a major signal becomes blocking, or an `info` one stops mattering |
| `disabledSignals[]` | the detector returns `[]`; the signal never appears in the dossier |
| `waiverApprovers[]` | account ids allowed to grant a waiver; combined with the caller's `canWaive` flag |
| `jsmProjectKeys[]` | which JSM projects are searched for incidents |
| `serviceMap[]` | the component → service → JSM service correspondence, and the ownership used by DEP-03 |
| `observationMode` | no verdict shown on tickets (SPEC §20, "verdict judged too strict") |
| `defaultWaiverHours` | duration applied when the caller does not give one (1–720 h enforced) |
