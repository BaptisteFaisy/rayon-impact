/**
 * Bridge stub for the offline demo: `renderToStaticMarkup` never runs effects,
 * so no screen ever calls `invoke`. A call that would slip through fails loudly
 * instead of returning invented data (SPEC §15).
 */
export async function invoke(key: string): Promise<never> {
  throw new Error(`The demo renders statically: resolver "${key}" must not be invoked`);
}

export default { invoke };
