/**
 * Queue consumer (Forge module `consumer`, R3 §3): drains one recompute message
 * and runs the pipeline (src/engine/pipeline.ts) in the background.
 *
 * The pipeline is injected instead of imported, so this adapter stays testable
 * on its own and `src/index.ts` wires it to the real function:
 *
 *   import { recomputeRelease } from './engine/pipeline.js';
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
} from '../ports.js';

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
 * Consumes one message: runs the pipeline, logs duration and verdict, and lets
 * an error bubble up so Forge retries it (R3 §3, retries up to 24 h).
 */
export async function onMessage(
  message: RecomputeMessage,
  deps: ConsumerDeps,
): Promise<RecomputeResult> {
  const request = toRequest(message, deps);
  deps.logger.log('info', 'recompute started', {
    versionId: request.versionId,
    reason: request.reason,
    requestedAt: message.requestedAt,
  });

  try {
    const result = await deps.recompute(deps.pipeline, request);
    deps.logger.log('info', 'recompute finished', {
      versionId: request.versionId,
      reason: request.reason,
      verdict: result.snapshot.verdict,
      confidence: result.snapshot.confidence,
      signals: result.signals.length,
      durationMs: result.durationMs,
    });
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
