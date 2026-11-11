# Submission video — script

**Length** 4 min 45 s (hard limit 5 min) · **Language** English · **Format**
1080p, screen recording with a voice-over, captions burned in · **Music** none,
or a quiet bed under −24 dB.

The shot list follows SPEC §18. Each sequence gives what is on screen and the
voice-over word for word; the narration is written to be read at a calm pace
(about 150 words per minute), so do not add sentences.

| Time | Sequence |
|---|---|
| 0:00 – 0:30 | The problem: a go/no-go meeting where everyone reads a different tool |
| 0:30 – 1:30 | Version 2.4 of Paiements: no-go, three reasons, proofs opened one by one |
| 1:30 – 2:15 | Graph view: the version at the centre, the Mobile team at the edge |
| 2:15 – 3:00 | Simulate without PAY-131, waive the incident, waive the doc, verdict moves |
| 3:00 – 3:40 | Rovo agent asked by the Mobile lead; the same tool called from an MCP client |
| 3:40 – 4:20 | Publish, then the 72 h outcome |
| 4:20 – 4:45 | Architecture in one diagram: Forge, Teamwork Graph, Rovo, MCP |

## Before you record

- Load the **video variant** of the demo release: 12 tickets, PAY-129 and PAY-130
  out of version 2.4, `LINKED_OUTSIDE_ISSUES` collected, PAY-127 linking the
  "Integration guide" page. Its measured verdicts, stage by stage, are in
  [DEMO-DATA.md](DEMO-DATA.md) §4 — film against those numbers, not against the
  raw 14-ticket dataset, or the simulation beat will contradict the screen.
- Use a Jira site with the demo project, the JSM project holding INC-52, and the
  Confluence space holding page 9001. Resolution 1920×1080, browser at 100 % zoom,
  no bookmarks bar, no personal tabs.
- Prepare three browser tabs in advance (project page, the INC-52 incident, the
  Confluence page) and one terminal with the MCP client ready. Nothing kills a
  demo like a cold tab.
- The Rovo and MCP beats depend on the `rovo:agent`, `action` and `rovo:mcp`
  modules; the graph beat depends on Teamwork Graph scopes being granted on the
  site. Check both the morning of the recording (see the status section of
  [../README.md](../README.md)).

---

## 0:00 – 0:30 · The problem

**On screen.** Four quick cuts, 6 seconds each, silent except the voice-over:
a calendar invite titled "2.4 go/no-go"; a Jira board with a red ticket; a build
page with a red pipeline; a JSM incident page with "INC-52 — investigating". Then
cut to black, and the product name fades in.

**Voice-over.**

> Every release decision is taken in a meeting like this one.
> Four people, four tools, four different answers to one question: can we ship?
> Jira knows a ticket is still in flight. The build server knows the last commit
> is red. The incident channel knows a service is on fire right now. Nobody puts
> the four together — so the change ships, and a neighbouring team finds out in
> production.
> This is Release Impact Radius.

## 0:30 – 1:30 · No-go, three reasons, three proofs

**On screen.** Jira project **Paiements** → *Release Impact Radius*. The header
shows **2.4**, release date 12 November, a red **NO-GO**, "high confidence" and
the timestamp of the last computation. Below, three signals are expanded one after
the other as the voice names them: the open incident, the open pull request, the
stale page. Each expansion shows four lines: what was observed, why it matters, a
**proof** link, and how to clear it. Click the incident proof: the INC-52 page
opens. Back. Click the PAY-131 proof: the Jira ticket opens, its pull request
visible in the development panel. Back.

**Voice-over.**

> Paiements 2.4 ships tomorrow. One click gives the whole picture: no-go.
> Three reasons, ranked by weight.
> First: incident 52 is open on checkout-api, and this release touches that
> service from fourteen tickets. One click opens the incident — this is not a
> score, it is a fact with a link.
> Second: PAY-131 is still in progress, and it still has an open pull request.
> The code in production would not match the ticket.
> Third: the integration guide has not been touched since this cycle started —
> so support would learn about the change from a customer.
> Notice what is not here: no dashboard to interpret, no green wall to trust. Each
> line states what was seen, why it matters, the proof, and how to clear it. And
> the confidence is high because the app can actually see the code and the
> services for nearly every ticket — when it cannot, it says so instead of
> pretending everything is fine.

## 1:30 – 2:15 · The graph

**On screen.** The **Graph** tab. The version node sits in the centre; 12 ticket
nodes orbit it; one service node `checkout-api` links to the tickets that touch
it; the two incidents hang off that service; the **Mobile** team appears at the
edge, attached to the service through PAY-127, with MOB-77 shown as the ticket of
that neighbouring team. Hover a node: the panel lists the signals it carries.
Click **List view**: the same nodes grouped by kind — the accessible equivalent.

**Voice-over.**

> The same dossier, as a graph. The version in the centre, its tickets around it,
> the service they touch, the incidents on that service — and at the edge, the
> teams that will feel this release without being in it.
> That node is the Mobile team. Their ticket MOB-77 depends on PAY-127, which is
> in 2.4. Nobody told them. The graph is read through the Teamwork Graph, as the
> person viewing it, so it shows exactly what that person is allowed to see; every
> graph has a list equivalent, for accessibility and for releases too large to
> draw.

## 2:15 – 3:00 · Simulate, then waive

**On screen.** Back to the signals list. On PAY-131, click **Simulate without
this ticket**: a banner shows the recomputed verdict and the dropped signals — the
two PAY-131 signals are gone, the incident still blocks. Then, in Jira, remove
PAY-131 from version 2.4; the page refreshes itself. The dossier now shows a
single blocking signal: INC-52. On INC-52, click **Grant a waiver**: 24 hours, a
reason typed on camera ("incident mitigated, rollback plan agreed"), confirm. The
verdict flips to **CONDITIONAL GO**, and the conditions list appears. Repeat
briefly on the documentation signal with 48 hours. Finally click **Record
decision: ship**.

**Voice-over.**

> Before touching anything, ask the app a question: what if we drop PAY-131?
> It recomputes instantly — and tells the truth: the two PAY-131 reasons are gone,
> but the incident still blocks. Removing one ticket is not enough.
> So we remove it for real, in Jira. The app recomputes by itself, within a
> minute. One blocker left.
> For that one, a derogation: 24 hours, a written reason, a named approver. The
> verdict moves to conditional go, and the conditions are listed — a waiver never
> erases a signal, it puts a name and an expiry date on it. Same for the
> documentation, with 48 hours for the technical writer.
> Then we record the human decision, with the verdict of the moment. The app
> advises. People decide.

## 3:00 – 3:40 · Rovo agent and MCP client

**On screen.** Rovo Chat. The suggested prompts are visible. Ask: "Can we ship
2.4?". The agent answers with the same verdict, the same conditions, and links.
Then cut to a terminal: an MCP client (a coding agent) calls
`get-release-impact` for `PAY` / `2.4`, and the raw JSON answer appears: verdict,
confidence, counts, signals. One more call, `simulate-without`, and the recomputed
verdict appears.

**Voice-over.**

> The same dossier answers in Rovo Chat. The Mobile lead asks: can we ship 2.4?
> Same verdict, same reasons, same links — the agent computes nothing, it calls
> the app's actions.
> And those actions are also MCP tools. Here, a coding agent asks the same
> question before merging: does my ticket hold a release? It gets the same answer
> as the release lead, from the same source of truth. One dossier, every surface.

## 3:40 – 4:20 · Publish, then the 72 hours

**On screen.** In Jira, release version 2.4. Cut forward: the scheduled check runs
and the dossier gains an **Outcome** section — "1 minor incident, resolved in 40
minutes", with the incident link and the elapsed time. Then the issue panel on a
ticket: one line saying whether it holds a version.

**Voice-over.**

> 2.4 is published. Seventy-two hours later the app goes back and reads what
> happened on the services that release touched: one minor incident, resolved in
> forty minutes.
> That record is what makes the next decision better — the same service now
> carries a risk-zone signal on the following version.
> And on any ticket, one line answers the developer's only question: does my work
> hold a release, and why?

## 4:20 – 4:45 · Architecture

**On screen.** A single clean diagram, animated in three steps: (1) Jira events →
queue → consumer; (2) the pure domain — detectors, verdict, coverage — writing to
Forge SQL; (3) the read-only surface: project page, issue panel, Rovo agent, MCP
tools, all reading the last saved dossier. Keep the Teamwork Graph and the LLM
labelled where they belong.

**Voice-over.**

> Under the hood: one Forge app. Jira events land in a queue, a background
> consumer collects the release — Jira, JSM, Confluence, and the Teamwork Graph
> read as the viewer — then a pure, deterministic engine raises the signals,
> computes the verdict and writes the dossier to Forge SQL.
> The model writes the summary; it never moves the verdict. Every surface — the
> project page, the issue panel, Rovo, MCP — reads that same saved dossier.
> Nothing leaves Atlassian.

**End card.** "Release Impact Radius — build with context, ship with confidence."
Repository link. Codegeist 2026.

---

## What the video must not claim

- The app **never blocks a deployment**: it advises, a human decides.
- The summary is written by the model but **verified against the signals**; it is
  not a second opinion on the verdict.
- No data leaves Atlassian: Forge SQL, Atlassian-hosted model, no external call.
- If a source is missing on the demo site, say it — the app reports low confidence
  rather than an all-clear. Never film a fake green verdict.
