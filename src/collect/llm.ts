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

/** Builds the narrative writer used by the pipeline. */
export function createLlmNarrativeWriter(logger?: Logger): NarrativeWriter {
  return {
    async write(payload: { system: string; user: string }): Promise<string> {
      const model = await pickModel();
      const response = await chat({
        model,
        temperature: 0.2,
        max_completion_tokens: 800,
        messages: [
          { role: 'system', content: payload.system },
          { role: 'user', content: payload.user },
        ],
      });
      const content = response.choices[0]?.message?.content;
      const text = typeof content === 'string' ? content : '';
      if (!text) {
        logger?.log('warn', 'le modèle a renvoyé une réponse vide');
      }
      return text;
    },
  };
}
