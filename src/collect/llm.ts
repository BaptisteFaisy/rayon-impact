import { chat, list } from '@forge/llm';
import type { Logger, NarrativeWriter } from '../ports';

/**
 * Forge LLM adapter: the only place in the app that talks to the hosted model.
 *
 * The model is chosen from the list published by the platform (only Claude
 * families are allowed by the `llm` module), and a failure never reaches the
 * pipeline: an empty text makes the engine fall back to its deterministic
 * summary (SPEC §8).
 *
 * Rule: files < 500 lines, functions < 50 lines.
 */

/** Used when the platform does not publish any active model. */
export const NARRATIVE_MODEL_FALLBACK = 'claude-sonnet-4-5';

/** The first active model published by the platform. */
export async function pickModel(): Promise<string> {
  try {
    const published = await list();
    const active = published.models.filter((entry) => entry.status === 'active');
    return active[0]?.model ?? NARRATIVE_MODEL_FALLBACK;
  } catch {
    return NARRATIVE_MODEL_FALLBACK;
  }
}

/** Cumulative cost of the hosted model, for the developer's own bill. */
export interface LlmUsage {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  failures: number;
  totalDurationMs: number;
}

let usage: LlmUsage = {
  calls: 0,
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  failures: 0,
  totalDurationMs: 0,
};

/** Read-only snapshot of what the model has cost since the runtime warmed up. */
export function llmUsageSnapshot(): LlmUsage {
  return { ...usage };
}

/** Test helper: the counters are per warm runtime, tests reset them. */
export function resetLlmUsage(): void {
  usage = {
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    failures: 0,
    totalDurationMs: 0,
  };
}

/** Builds the narrative writer used by the pipeline. */
export function createLlmNarrativeWriter(logger?: Logger): NarrativeWriter {
  return {
    async write(payload: { system: string; user: string }): Promise<string> {
      const model = await pickModel();
      const startedAt = Date.now();
      const response = await chat({
        model,
        temperature: 0.2,
        max_completion_tokens: 800,
        messages: [
          { role: 'system', content: payload.system },
          { role: 'user', content: payload.user },
        ],
      });
      const durationMs = Date.now() - startedAt;
      const choice = response.choices[0];
      const content = choice?.message?.content;
      const text = extractText(content);

      // Le LLM est la seule ligne payante sans quota gratuit : le coût de
      // chaque appel est journalisé et cumulé (SPEC §15, honnêteté des coûts).
      const tokens = response.usage ?? {};
      usage = {
        calls: usage.calls + 1,
        inputTokens: usage.inputTokens + (tokens.input_tokens ?? 0),
        outputTokens: usage.outputTokens + (tokens.output_tokens ?? 0),
        totalTokens: usage.totalTokens + (tokens.total_tokens ?? 0),
        failures: usage.failures + (text ? 0 : 1),
        totalDurationMs: usage.totalDurationMs + durationMs,
      };
      logger?.log('info', 'appel modele', {
        model,
        durationMs,
        inputTokens: tokens.input_tokens ?? 0,
        outputTokens: tokens.output_tokens ?? 0,
        cumulativeTokens: usage.totalTokens,
        calls: usage.calls,
      });
      if (!text) {
        logger?.log('warn', 'le modèle a renvoyé une réponse vide', {
          model,
          finishReason: choice?.finish_reason ?? null,
          contentType: Array.isArray(content) ? 'array' : typeof content,
        });
      }
      return text;
    },
  };
}

/** Forge LLM returns either a string or an array of `{ type: 'text', text }` parts. */
export function extractText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => {
      if (typeof part === 'string') return part;
      const item = part as { text?: unknown } | null;
      return typeof item?.text === 'string' ? item.text : '';
    })
    .join('');
}
