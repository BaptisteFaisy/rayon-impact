# For the judges — five minutes, three tours

Release Impact Radius is a Forge app for Jira. It reads everything attached to a
version and returns a **go / conditional go / no-go** verdict in which every
reason points at its proof. This page tells you how to install it, how to load
the demo release, and what to look at — in five minutes per tour.

Everything the app computes is deterministic: same data, same verdict. Nothing
here is a model's opinion.

---

## 1. Install

**From the Marketplace** (after review): *Apps → Find new apps → Release Impact
Radius → Install*, then accept the requested scopes. The app needs
`read:jira-work` and, for the bonuses, the Teamwork Graph scopes your
organisation administrator grants per object type.

**From source** (what the submission repository is):

```bash
git clone <repository-url> && cd rayon-impact
npm ci
npm run typecheck          # tsc --noEmit
npm test                   # vitest run — the whole engine, no Forge runtime needed
npx forge deploy           # needs the Forge CLI logged in
npx forge install --site <your-site>.atlassian.net
```

The app targets Jira (required) and Confluence (optional, for the linked-page
signal).

## 2. Load the demo release

The demo dataset is **Paiements**, version **2.4**: 14 tickets, one still in
progress with an open pull request, one with a red build, one blocked by an open
ticket, one added six hours ago, two touching `checkout-api` where incident
**INC-52** is open, a cross-project ticket **MOB-77** from the Mobile team, and a
stale "Integration guide" page. The full description, ticket by ticket, with the
exact expected verdict, is in [DEMO-DATA.md](DEMO-DATA.md).

**In the app.** Open the project **Paiements → Release Impact Radius**, then
**Settings → Load the sample release**. This creates (or updates) version 2.4, its
tickets, the incident references, the linked page and the service map, so the
dossier can be computed without preparing a site by hand.

**Without a site.** The same dataset is a fixture:
[`tests/fixtures/paiements.ts`](../tests/fixtures/paiements.ts). `npx vitest run`
asserts it end to end, and [DEMO-DATA.md](DEMO-DATA.md) §5 shows how to print the
whole dossier from a terminal in one command.

**Expected result** on the raw 14-ticket dataset: **no-go**, high confidence, five
blocking signals (COMP-01, COMP-03, QUAL-01, DEP-01, EXP-01), two major, two
minor. If your site has no development data (no commits, no pull requests), the
code signals stay silent and confidence drops to low — that is the app being
honest, not a bug.

## 3. Three tours, five minutes each

### Tour A — the release lead, the morning of the delivery

1. **Project → Release Impact Radius**, pick version 2.4. The header shows the
   verdict, the confidence, the computation timestamp. The page reads the last
   saved dossier, so it opens fast.
2. Expand the signals, ranked by severity. Each one gives four things: what was
   observed, why it matters, the **proof** link, and how to clear it. Click the
   proofs — the incident, the ticket, the pull request, the Confluence page.
3. Look at **Coverage**: how many tickets the app can actually see code and
   services for. A low number is stated in plain words, never hidden.
4. On a ticket carrying a blocking signal, click **Simulate without this
   ticket** — the verdict is recomputed without it. If several tickets block,
   the app proposes the smallest set to remove, and says so when no removal can
   help (a version-level blocker such as an open incident cannot be fixed by
   removing a ticket).
5. **Grant a waiver**: a reason is mandatory, the approver must be allowed, the
   duration is bounded. The verdict moves to *conditional go* and the waiver
   appears in the conditions — a derogation is recorded, never erased.
6. **Record decision: ship**. The decision stores the verdict of that moment, so
   the history reads "who decided what, on which basis".

### Tour B — the developer, opening a ticket

1. Open **PAY-131** in Jira. The issue panel shows one line: this ticket holds
   version 2.4, with the reason — an open pull request — and a link to the signal.
2. Open **PAY-136** (clean): "nothing holds the release". No other screen to open.
3. Open **PAY-129**: the latest build failed. Clear it by fixing the build; the
   dossier recomputes on the next event, without anyone clicking anything.

### Tour C — the lead of the neighbouring team

1. Open **Rovo Chat** and ask *"Does Paiements 2.4 affect us?"*. The agent answers
   with the service, the ticket of your own project that depends on it (MOB-77),
   and the planned date — using the same dossier as the project page.
2. On the project page, open the **Impacted teams** tab: the Mobile team, the
   services it depends on, and the tickets that link it to this release.
3. Ask the agent *"What holds the next release?"* or *"What happened after 2.3?"*
   — same verdict, same reasons, no second implementation of the rules.

## 4. Where the bonuses are

**Teamwork Graph.** The graph tab is built from the cached graph facts: ticket →
commit, PR and build facts, ticket → Compass component, team → component, and
incident → service. It is read **as the viewer**, so the graph shows exactly what
that person may see, and a missing scope lowers confidence instead of failing
silently. The same facts drive COMP-02, COMP-03, QUAL-01, QUAL-02, DEP-03 and the
impacted-team view.

**Rovo agent.** Module `rovo:agent`, four suggested prompts (*"Can we ship 2.4?"*,
*"What holds the next release?"*, *"Which teams are affected by 2.4?"*, *"What
happened after 2.3?"*). The agent computes nothing: it calls the app's actions and
returns their result with links, so its answer is always the screen's answer.

**MCP.** The same seven read-only actions are exposed as `rovo:mcp` tools:
`get-release-impact`, `list-release-signals`, `explain-signal`,
`list-impacted-teams`, `simulate-without`, `get-release-outcome`,
`request-waiver`. An external MCP client — a coding agent before it merges, an
on-call agent starting a shift — asks the same questions and gets the same
answers. Access from an external client is **disabled by default** on Atlassian's
side: an administrator enables it per installation. Background and platform
details: [research/R2-rovo-actions-mcp.md](research/R2-rovo-actions-mcp.md).

**Marketplace readiness.** One app, Jira required and Confluence optional; no
network egress outside Atlassian; Forge SQL for storage; the hosted model for the
summary only. The trust argument is that sentence: your release data never leaves
the platform.

## 5. Assumed limits

- **The app never blocks a deployment.** It advises; a human decides and records
  the decision. Blocking the pipeline is explicitly out of scope.
- **The verdict is deterministic, the summary is checked.** The model writes 5 to
  8 lines citing signal codes; a verification pass rejects any sentence naming a
  ticket or a service that is not in the signals. A rejected summary is replaced
  by a deterministic text and flagged.
- **Teamwork Graph is in Preview.** Scopes are granted per object type by an
  organisation administrator, and a missing scope omits objects *silently*. The
  app therefore degrades: the code signals go quiet, confidence drops, and the
  coverage panel says which source was missing. Without the graph the app still
  works, using Jira REST and the `development[...]` JQL fallback.
- **MCP access is off by default** and must be enabled per installation.
- **No development data on the site means low confidence**, not a green verdict.
- **Volume**: up to 1 000 tickets per version; above that, minor signals are
  sampled and the dossier says so. Above 150 graph nodes the graph view falls back
  to its list equivalent.
- **Lot C signals are wired but silent**: HIST-01 (risk zone from past outcomes)
  and OBJ-01 (objective milestone) need data the platform does not expose to the
  app yet. They never guess.
- **Where the code stands.** The decision engine — 17 detectors, verdict,
  coverage, simulation, waivers, rights masking, graph, outcome, diff, decision
  log, EN/FR texts — is implemented and covered by 329 tests. The Forge adapters
  (SQL schema, event trigger, scheduler, queue consumer, Jira client) are landing;
  the end-to-end pipeline, the collectors, the Rovo/MCP handlers, the screens and
  the manifest are the remaining work. The honest list is in
  [../README.md](../README.md) under "Status".

## 6. If you read code

| Start here | Why |
|---|---|
| [src/types.ts](../src/types.ts) | the whole contract, with the limits and thresholds |
| [src/ports.ts](../src/ports.ts) | the single boundary between the engine and Forge |
| [src/engine/verdict.ts](../src/engine/verdict.ts) | the verdict rules, 40 lines of logic, no model |
| [src/signals/comp.ts](../src/signals/comp.ts) | what a detector looks like: pure, no I/O, injected clock |
| [src/engine/permissions.ts](../src/engine/permissions.ts) | how a proof is masked without changing the verdict |
| [src/engine/simulate.ts](../src/engine/simulate.ts) | "without this ticket" and the smallest set to remove |
| [tests/fixtures/paiements.ts](../tests/fixtures/paiements.ts) | the demo release, with the expected verdict in comments |
