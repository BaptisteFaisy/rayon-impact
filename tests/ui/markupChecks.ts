/**
 * Minimal regex checks over rendered markup for the basic accessibility test.
 * No DOM parser dependency: the assertions only need tag presence, attribute
 * presence, label wrapping and htmlFor/id association.
 *
 * Rule: files < 500 lines, functions < 50 lines.
 */

/** h1-h4, table, list or button: the semantic anchors an screen must have. */
export function hasSemanticElement(html: string): boolean {
  return /<(h[1-4]|table|ul|ol|button)(\s|>)/.test(html);
}

/** Form controls without any accessible name (aria-label, wrapping label, for/id). */
export function findUnlabeledControls(html: string): string[] {
  const problems: string[] = [];
  const control = /<(input|select|textarea)\b([^>]*)>/g;
  for (const match of html.matchAll(control)) {
    const attrs = match[2] ?? '';
    if (/type="hidden"/.test(attrs)) continue;
    if (hasAccessibleName(html, match.index ?? 0, attrs)) continue;
    problems.push(match[0].slice(0, 60));
  }
  return problems;
}

function hasAccessibleName(html: string, start: number, attrs: string): boolean {
  if (/aria-label=/.test(attrs)) return true;
  const before = html.slice(0, start);
  // Wrapped inside a <label>…</label>: the nearest opening tag wins.
  if (before.lastIndexOf('<label') > before.lastIndexOf('</label>')) return true;
  const id = /id="([^"]+)"/.exec(attrs);
  return Boolean(id && html.includes(`for="${id[1]}"`));
}

/** Images/SVGs without aria-label, aria-labelledby, role="img" or alt. */
export function findUnlabeledGraphics(html: string): string[] {
  const problems: string[] = [];
  const graphic = /<(img|svg)\b([^>]*)>/g;
  for (const match of html.matchAll(graphic)) {
    const attrs = match[2] ?? '';
    const labeled =
      /aria-label=/.test(attrs) ||
      /aria-labelledby=/.test(attrs) ||
      /role="img"/.test(attrs) ||
      /\balt=/.test(attrs);
    if (!labeled) problems.push(match[0].slice(0, 60));
  }
  return problems;
}
