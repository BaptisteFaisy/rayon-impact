/**
 * Passe finale d'un recalcul terminé (SPEC §12 : « regroupé, jamais jeté »).
 *
 * Pourquoi : la fenêtre de regroupement (60 s par version) **jetait** la demande
 * qui y tombait. Mesuré en production le 2026-11-12 : « recompute skipped,
 * inside the debounce window » 12 s après un recalcul, puis plus rien avant le
 * balayage horaire — un dossier périmé jusqu'à une heure, et le cas de recette
 * §17.6 (recalcul automatique en moins de 2 min) intenable.
 *
 * La demande est maintenant conservée dans `recalc_deferred` et rejouée ici, dès
 * la fin du recalcul qui la masquait, après l'attente qu'exige la règle « un seul
 * par minute ». Double borne : `MAX_TRAILING_PASSES` passes par invocation et un
 * budget total très inférieur au `timeoutSeconds: 900` du consumer. Ce qui reste
 * est rejoué par le balayage horaire (`scheduled.ts`) : rien n'est perdu.
 *
 * Rule: files < 500 lines, functions < 50 lines.
 */
import { trailingPass } from '../engine/debounce';
import type { RecomputeGate } from './events';
import type { RecomputeFn } from './consumer';
import type {
  Clock,
  Logger,
  PipelineDeps,
  RecomputeMessage,
  RecomputeRequest,
  RecomputeResult,
} from '../ports';

/** Passes au plus par invocation : une rafale continue ne doit pas l'épuiser. */
export const MAX_TRAILING_PASSES = 3;

/**
 * Budget total d'une invocation, en ms. Le consumer Forge a `timeoutSeconds:
 * 900` ; chaque passe coûte l'attente (≤ 60 s) plus un recalcul (mesuré à 7-45 s
 * en production), donc trois passes tiennent largement dans 480 s.
 */
export const TRAILING_BUDGET_MS = 480_000;

export interface TrailingDeps {
  gate: RecomputeGate;
  clock: Clock;
  logger: Logger;
  /** Attente réelle, injectée : aucun test ne dort. */
  sleep: (ms: number) => Promise<void>;
  /** Overrides the 60 s window (SPEC §12). */
  minIntervalSeconds?: number;
  /** Overrides `TRAILING_BUDGET_MS`. */
  budgetMs?: number;
}

/** Ce qui exécute un recalcul : exactement ce que le consumer a déjà. */
export interface TrailingRun {
  pipeline: PipelineDeps;
  recompute: RecomputeFn;
  viewerAccountId?: string | null;
}

/** Attente réelle, injectée dans `TrailingDeps.sleep` par `src/index.ts`. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** Une passe de plus tient-elle dans le budget de l'invocation ? */
function withinBudget(openedAt: number, now: number, waitMs: number, budgetMs: number): boolean {
  // Horloge illisible : on fail open, comme `shouldRecompute` — la fraîcheur du
  // dossier passe avant l'économie d'une passe.
  if (Number.isNaN(openedAt) || Number.isNaN(now)) {
    return true;
  }
  return now - openedAt + waitMs <= budgetMs;
}

function requestFor(run: TrailingRun, deferred: RecomputeMessage): RecomputeRequest {
  return {
    projectId: deferred.projectId,
    versionId: deferred.versionId,
    viewerAccountId: run.viewerAccountId ?? null,
    reason: deferred.reason,
  };
}

/**
 * Sert une demande reportée : attente de la fin de la fenêtre, puis recalcul.
 *
 * La demande est effacée AVANT le recalcul, pas après : effacer après ferait
 * disparaître une demande arrivée PENDANT la passe (le même bug, un cran plus
 * loin). En cas d'échec elle est remise en place, donc rien n'est perdu non plus.
 */
async function replayDeferred(
  run: TrailingRun,
  trailing: TrailingDeps,
  message: RecomputeMessage,
  deferred: RecomputeMessage,
  waitMs: number,
  pass: number,
): Promise<{ result: RecomputeResult; startedAt: string }> {
  if (waitMs > 0) {
    await trailing.sleep(waitMs);
  }
  const startedAt = trailing.clock.now();
  await trailing.gate.clearDeferred(message.versionId);
  await trailing.gate.markQueued(message.versionId, startedAt);
  trailing.logger.log('info', 'recompute trailing', {
    versionId: message.versionId,
    reason: deferred.reason,
    pass,
    waitMs,
  });
  try {
    const result = await run.recompute(run.pipeline, requestFor(run, deferred));
    return { result, startedAt };
  } catch (error) {
    await trailing.gate.deferRequest(deferred, trailing.clock.now());
    throw error;
  }
}

/**
 * Rejoue les demandes que la fenêtre de regroupement a retenues pour cette
 * version, jusqu'à épuisement des bornes. Rendre la liste des résultats permet
 * au caller (et aux tests) de voir ce qui a réellement été recalculé.
 */
export async function runTrailingPass(
  run: TrailingRun,
  trailing: TrailingDeps,
  message: RecomputeMessage,
  collectStartedAt: string,
): Promise<RecomputeResult[]> {
  const budgetMs = trailing.budgetMs ?? TRAILING_BUDGET_MS;
  const openedAt = Date.parse(trailing.clock.now());
  const results: RecomputeResult[] = [];
  let collectedAt = collectStartedAt;
  for (let pass = 1; pass <= MAX_TRAILING_PASSES; pass += 1) {
    const deferred = await trailing.gate.deferredRequest(message.versionId);
    const decision = trailingPass(
      await trailing.gate.lastQueuedAt(message.versionId),
      deferred,
      collectedAt,
      trailing.clock.now(),
      trailing.minIntervalSeconds,
    );
    if (decision.action === 'none') {
      break;
    }
    if (decision.action === 'clear' || deferred === null) {
      // Le recalcul qui vient de finir a déjà vu ce changement : on solde.
      await trailing.gate.clearDeferred(message.versionId);
      break;
    }
    if (!withinBudget(openedAt, Date.parse(trailing.clock.now()), decision.waitMs, budgetMs)) {
      trailing.logger.log('info', 'recompute trailing laissé au balayage horaire', {
        versionId: message.versionId,
        pass,
        waitMs: decision.waitMs,
      });
      break;
    }
    const replayed = await replayDeferred(run, trailing, message, deferred, decision.waitMs, pass);
    collectedAt = replayed.startedAt;
    results.push(replayed.result);
  }
  return results;
}
