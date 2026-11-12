/**
 * Queue consumer (Forge module `consumer`, R3 §3): drains one recompute message
 * and runs the pipeline (src/engine/pipeline.ts) in the background.
 *
 * The pipeline is injected instead of imported, so this adapter stays testable
 * on its own and `src/index.ts` wires it to the real function:
 *
 *   import { recomputeRelease } from './engine/pipeline';
 *   export const handler = (event: AsyncEvent) =>
 *     onMessage(event.body as RecomputeMessage, { pipeline, recompute: recomputeRelease, logger });
 *
 * R3 §3: delivery is "at least once" with no dead-letter queue, so a failed
 * recompute must be safe to replay — idempotence lives in the pipeline (a
 * snapshot is keyed by version and computedAt), not here.
 *
 * Rule: files < 500 lines, functions < 50 lines.
 */
import type {
  Logger,
  PipelineDeps,
  RecomputeMessage,
  RecomputeRequest,
  RecomputeResult,
} from '../ports';
import { runTrailingPass } from './trailing';
import type { TrailingDeps } from './trailing';

/**
 * Exact signature of `recomputeRelease` in src/engine/pipeline.ts (written in
 * parallel by another agent). Nothing here may drift from it.
 */
export type RecomputeFn = (
  deps: PipelineDeps,
  request: RecomputeRequest,
) => Promise<RecomputeResult>;

export interface ConsumerDeps {
  /** Store, collector, narrative writer and clock the pipeline runs with. */
  pipeline: PipelineDeps;
  /** `recomputeRelease` once src/engine/pipeline.ts exists. */
  recompute: RecomputeFn;
  logger: Logger;
  /**
   * Human whose Teamwork Graph rights are used. Background recomputes run as
   * the app (SPEC §12), hence `null` by default.
   */
  viewerAccountId?: string | null;
  /**
   * Passe finale des demandes retenues par la fenêtre de regroupement
   * (SPEC §12 : « regroupé, jamais jeté »). Sans elle, un événement arrivé
   * pendant la fenêtre attendrait le balayage horaire.
   */
  trailing: TrailingDeps;
}

function toRequest(
  message: RecomputeMessage,
  deps: ConsumerDeps,
): RecomputeRequest {
  return {
    projectId: message.projectId,
    versionId: message.versionId,
    viewerAccountId: deps.viewerAccountId ?? null,
    reason: message.reason,
  };
}

/**
 * La passe finale ne doit jamais faire perdre le résultat du recalcul principal :
 * un échec est journalisé en `warn`, la demande reportée reste en place (elle
 * n'est effacée qu'après un recalcul réussi) et le balayage horaire la rejoue.
 */
async function trailingQuietly(
  deps: ConsumerDeps,
  message: RecomputeMessage,
  collectStartedAt: string,
): Promise<void> {
  try {
    await runTrailingPass(deps, deps.trailing, message, collectStartedAt);
  } catch (error) {
    deps.logger.log('warn', 'recompute trailing failed', {
      versionId: message.versionId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Consumes one message: runs the pipeline, logs duration and verdict, and lets
 * an error bubble up so Forge retries it (R3 §3, retries up to 24 h).
 */
export async function onMessage(
  message: RecomputeMessage,
  deps: ConsumerDeps,
): Promise<RecomputeResult> {
  const request = toRequest(message, deps);
  const collectStartedAt = deps.pipeline.clock.now();
  deps.logger.log('info', 'recompute started', {
    versionId: request.versionId,
    reason: request.reason,
    requestedAt: message.requestedAt,
  });

  try {
    const result = await deps.recompute(deps.pipeline, request);
    deps.logger.log('info', 'recompute finished', {
      versionId: request.versionId,
      versionName: result.snapshot.versionName,
      reason: request.reason,
      verdict: result.snapshot.verdict,
      confidence: result.snapshot.confidence,
      signals: result.signals.length,
      codes: result.signals.slice(0, 8).map((signal) => signal.code).join(','),
      blocking: result.snapshot.counts.blocking,
      major: result.snapshot.counts.major,
      coverageCode: `${result.snapshot.coverage.issuesWithCode}/${result.snapshot.coverage.issueCount}`,
      coverageService: `${result.snapshot.coverage.issuesWithService}/${result.snapshot.coverage.issueCount}`,
      narrativeFromModel: result.narrativeFromModel,
      durationMs: result.durationMs,
    });
    await trailingQuietly(deps, message, collectStartedAt);
    return result;
  } catch (error) {
    deps.logger.log('error', 'recompute failed', {
      versionId: request.versionId,
      reason: request.reason,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
