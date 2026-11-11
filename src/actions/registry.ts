/**
 * The 7 actions of SPEC §10, declared once.
 *
 * `ACTIONS` is the single table reused by three consumers: the Forge resolver
 * (src/index.ts), the `action` modules and the `rovo:mcp` tool list — one
 * declaration, no duplicated description or input schema (R2 §6).
 *
 * `name`, `description` and the input `title`/`description` are English on
 * purpose: they are manifest metadata read by the Rovo LLM, not UI text
 * (CONVENTIONS §3 applies to user-facing text, which stays in `MessageRef`).
 *
 * Rule: files < 500 lines, functions < 50 lines.
 */
import type { ActionDefinition, ActionDeps, ActionInputSpec, ActionKey } from './types.js';
import { ActionError, defineAction } from './types.js';
import {
  parseExplainSignalInput,
  parseGetReleaseImpactInput,
  parseGetReleaseOutcomeInput,
  parseListImpactedTeamsInput,
  parseListReleaseSignalsInput,
  parseRequestWaiverInput,
  parseSimulateWithoutInput,
} from './types.js';
import { explainSignal, getReleaseImpact, listReleaseSignals } from './release.js';
import { getReleaseOutcome, listImpactedTeams } from './teams.js';
import { requestWaiver, simulateWithout } from './decisions.js';

/** Action keys in SPEC §10 order — the order the agent and MCP expose them. */
export const ACTION_KEYS: readonly ActionKey[] = [
  'get-release-impact',
  'list-release-signals',
  'explain-signal',
  'list-impacted-teams',
  'simulate-without',
  'get-release-outcome',
  'request-waiver',
] as const;

const VERSION_ID: ActionInputSpec = {
  title: 'Version ID',
  type: 'string',
  required: true,
  description: 'Numeric ID of the Jira release version, e.g. "10042".',
};

const SIGNAL_ID: ActionInputSpec = {
  title: 'Signal ID',
  type: 'string',
  required: true,
  description: 'Identifier of a risk signal, e.g. "COMP-01:issue:id-pay-131".',
};

export const ACTIONS: Record<ActionKey, ActionDefinition> = {
  'get-release-impact': defineAction({
    key: 'get-release-impact',
    verb: 'GET',
    name: 'Get release impact',
    description:
      'Returns the impact verdict (go, conditional-go, no-go, not-applicable), the confidence level, the written summary and the signal counts of a Jira project version. Use it to answer "can we ship version X?".',
    inputs: {
      projectKey: {
        title: 'Project Key',
        type: 'string',
        required: true,
        description: 'Jira project key, e.g. "PAY".',
      },
      versionName: {
        title: 'Version Name',
        type: 'string',
        required: true,
        description: 'Name of the release version, e.g. "2.4".',
      },
    },
    parse: parseGetReleaseImpactInput,
    handler: getReleaseImpact,
  }),

  'list-release-signals': defineAction({
    key: 'list-release-signals',
    verb: 'GET',
    name: 'List release signals',
    description:
      'Returns the detailed risk signals of a release version with their evidence links, title, reason and how to clear each one. Optionally filters by severity (blocking, major, minor, info).',
    inputs: {
      versionId: VERSION_ID,
      severity: {
        title: 'Severity filter',
        type: 'string',
        required: false,
        description: 'Optional severity: blocking, major, minor or info.',
      },
    },
    parse: parseListReleaseSignalsInput,
    handler: listReleaseSignals,
  }),

  'explain-signal': defineAction({
    key: 'explain-signal',
    verb: 'GET',
    name: 'Explain a signal',
    description:
      'Explains one signal: what was observed, why it matters for the release, how it can be cleared, its evidence and any active waiver.',
    inputs: { signalId: SIGNAL_ID },
    parse: parseExplainSignalInput,
    handler: explainSignal,
  }),

  'list-impacted-teams': defineAction({
    key: 'list-impacted-teams',
    verb: 'GET',
    name: 'List impacted teams',
    description:
      'Returns the teams, services and tickets impacted by a release version, with how each team was found (teamwork graph, cross-project link or component map). Use it to answer "who is affected by version X?".',
    inputs: { versionId: VERSION_ID },
    parse: parseListImpactedTeamsInput,
    handler: listImpactedTeams,
  }),

  'simulate-without': defineAction({
    key: 'simulate-without',
    verb: 'GET',
    name: 'Simulate without issues',
    description:
      'Recomputes the verdict as if a set of tickets were removed from the release. Returns the new verdict, the signals that would disappear and the remaining conditions. Read-only: nothing is stored.',
    inputs: {
      versionId: VERSION_ID,
      issueKeys: {
        title: 'Excluded issue keys',
        type: 'string',
        required: true,
        description: 'Comma-separated Jira issue keys to exclude, e.g. "PAY-131,PAY-130".',
      },
    },
    parse: parseSimulateWithoutInput,
    handler: simulateWithout,
  }),

  'get-release-outcome': defineAction({
    key: 'get-release-outcome',
    verb: 'GET',
    name: 'Get release outcome',
    description:
      'Returns the decision that was taken on a release version (ship, hold, delay, with its note) and the 72-hour aftermath: incidents, rollback and a summary.',
    inputs: { versionId: VERSION_ID },
    parse: parseGetReleaseOutcomeInput,
    handler: getReleaseOutcome,
  }),

  'request-waiver': defineAction({
    key: 'request-waiver',
    verb: 'CREATE',
    name: 'Request waiver',
    description:
      'Creates a time-boxed waiver for one signal, with a mandatory business reason. Refuses with a motivated answer when the reason is missing, the duration is out of range or the caller is not allowed to waive. Creating a waiver does not recompute the verdict by itself.',
    inputs: {
      signalId: SIGNAL_ID,
      reason: {
        title: 'Waiver reason',
        type: 'string',
        required: true,
        description: 'Business reason explaining why this signal can be bypassed.',
      },
      hours: {
        title: 'Duration in hours',
        type: 'integer',
        required: true,
        description: 'Number of hours the waiver stays in effect, e.g. 24.',
      },
    },
    parse: parseRequestWaiverInput,
    handler: requestWaiver,
  }),
};

export function getAction(key: string): ActionDefinition | undefined {
  return ACTIONS[key as ActionKey];
}

/** Dispatch used by the router: unknown keys fail loudly, never silently. */
export async function runAction(
  key: string,
  raw: Record<string, unknown>,
  deps: ActionDeps,
): Promise<unknown> {
  const action = getAction(key);
  if (!action) {
    throw new ActionError('invalid-input', `Unknown action "${key}".`);
  }
  return action.run(raw, deps);
}

/** Tool list of the single `rovo:mcp` module (R2 §3.2, max 50 tools). */
export function mcpTools(): ActionKey[] {
  return [...ACTION_KEYS];
}

/**
 * `modules.action` entries for manifest.yml, all bound to one Forge function.
 * Generated from the same table so a new action never needs a second edit.
 */
export function toForgeActionModule(functionKey: string) {
  return ACTION_KEYS.map((key) => {
    const action = ACTIONS[key];
    return {
      key: action.key,
      name: action.name,
      function: functionKey,
      actionVerb: action.verb,
      description: action.description,
      inputs: action.inputs,
    };
  });
}
