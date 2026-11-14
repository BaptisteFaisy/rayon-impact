/**
 * The HTML shell around a demo screen: Jira-like chrome (top bar, breadcrumb,
 * locale and identity switches) and an Atlaskit-flavoured stylesheet.
 *
 * The markup inside `body` comes from the production components; this file only
 * dresses it. Colours and spacing follow the tokens of `docs/index.html` so the
 * demo reads as the same product as the submission site.
 *
 * Rule: files < 500 lines, functions < 50 lines.
 */

export interface NavItem {
  href: string;
  label: string;
}

export interface ShellOptions {
  title: string;
  locale: 'en' | 'fr';
  body: string;
  nav?: NavItem[];
  scenarioId?: string;
  role?: 'lead' | 'reader';
}

/** The stylesheet: Atlaskit tokens, verdict colours, tab and table layout. */
export const CSS = `
:root{--ink:#172b4d;--muted:#6b778c;--blue:#0052cc;--green:#36b37e;--orange:#ff8b00;
--red:#de350b;--violet:#6554c0;--line:#dfe1e6;--bg:#f4f5f7;--card:#fff;}
*{box-sizing:border-box}
body{margin:0;color:var(--ink);background:var(--bg);
font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
header.bar{background:linear-gradient(135deg,#0a1b3d 0%,#0052cc 100%);color:#fff;
padding:10px 20px;display:flex;gap:16px;align-items:center;flex-wrap:wrap}
header.bar a{color:#fff;text-decoration:none;opacity:.9}
header.bar .logo{font-weight:700;letter-spacing:.2px}
main{max-width:1080px;margin:0 auto;padding:20px}
.crumb{color:var(--muted);font-size:13px;margin-bottom:12px}
.card{background:var(--card);border:1px solid var(--line);border-radius:8px;
padding:16px;margin:0 0 16px;box-shadow:0 1px 2px rgba(9,30,66,.08)}
h1{font-size:24px;margin:0 0 8px}
h1.heading,h2.heading,h3.heading,h4.heading{font-size:19px;margin:18px 0 8px;font-weight:600}
h4.heading{font-size:12px;text-transform:uppercase;letter-spacing:.5px;color:var(--muted)}
p{margin:6px 0}
.box,.stack{margin:8px 0}
.stack{display:flex;flex-direction:column;gap:6px}
.inline{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.text{font-size:14px}
.strong{font-weight:600}
.em{font-style:italic;color:var(--muted)}
.code,code{background:#ebecf0;border-radius:3px;padding:1px 5px;font-size:12px}
small,.muted,.helper{color:var(--muted)}
ul,.list{margin:6px 0;padding-left:20px}
li,.list-item{margin:10px 0;padding-left:4px;border-left:0}
.list-item{margin:12px 0;padding:8px 12px;background:#fafbfc;border-left:3px solid var(--line);
border-radius:0 4px 4px 0}
.verdict{display:inline-block;padding:3px 12px;border-radius:999px;font-weight:700;
font-size:12px;letter-spacing:.5px;text-transform:uppercase;color:#fff}
.verdict--no-go{background:var(--red)}.verdict--conditional-go{background:var(--orange)}
.verdict--go{background:var(--green)}.verdict--not-applicable{background:var(--muted)}
.button,a.button{display:inline-block;background:var(--blue);color:#fff;border:0;
border-radius:4px;padding:6px 12px;font-size:13px;text-decoration:none;margin:0 6px 0 0;cursor:pointer}
.button--default{background:#ebecf0;color:var(--ink)}
.button--primary{background:var(--blue);color:#fff}
.button--subtle{background:transparent;color:var(--blue);box-shadow:none}
.button--warning{background:var(--orange)}
.button--danger,.button--error{background:var(--red)}
nav.tabs a,.tab,.tab-list{font-size:13px}
.tab-list{display:flex;gap:6px;flex-wrap:wrap;margin:12px 0}
table,.table{border-collapse:collapse;width:100%;margin:8px 0}
th,.table th{text-align:left;padding:6px 8px;border-bottom:1px solid var(--line);font-size:13px}
th{color:var(--muted);font-weight:600;text-transform:uppercase;font-size:11px;letter-spacing:.4px}
td{padding:6px 8px;border-bottom:1px solid var(--line);font-size:13px}
.lozenge{display:inline-block;padding:2px 9px;border-radius:3px;font-size:11px;
font-weight:700;text-transform:uppercase;letter-spacing:.4px;margin-right:6px}
.lozenge--removed{background:#ffebe6;color:var(--red)}
.lozenge--inprogress{background:#deeeff;color:var(--blue)}
.lozenge--success{background:#e3fcef;color:#006644}
.lozenge--new{background:#e6fcff;color:#00a3bf}
.lozenge--default,.lozenge--strong{background:#ebecf0;color:var(--muted)}
.lozenge--warning{background:#fff7e6;color:#974f0c}
.lozenge--error{background:#ffebe6;color:var(--red)}
.section-message{border:1px solid var(--line);border-left:3px solid var(--blue);
border-radius:3px;padding:10px 12px;margin:10px 0;background:#deeeff;font-size:13px}
.section-message--warning{border-left-color:var(--orange);background:#fff7e6}
.section-message--error{border-left-color:var(--red);background:#ffebe6}
.section-message--success{border-left-color:var(--green);background:#e3fcef}
.section-message--info,.section-message--notice{border-left-color:var(--blue);background:#deeeff}
a.link{color:var(--blue);text-decoration:none;font-size:13px;margin-right:10px}
a.link:hover{text-decoration:underline}
.label{display:block;font-size:12px;font-weight:600;color:var(--muted);margin:8px 0 3px}
.select,.textfield,.textarea{width:100%;padding:6px 8px;border:2px solid var(--line);
border-radius:3px;font-size:14px;background:#fafbfc}
.checkbox,.toggle{margin-right:6px}
.form-section{border:0;border-top:1px solid var(--line);margin:16px 0 0;padding:12px 0 0}
.form-footer{margin-top:14px}
.empty-state{padding:18px;text-align:center;color:var(--muted);background:#fafbfc;
border:1px dashed var(--line);border-radius:6px}
.progress{height:6px;background:#ebecf0;border-radius:3px;overflow:hidden;margin:4px 0}
.tag{display:inline-block;background:#ebecf0;border-radius:3px;padding:1px 7px;font-size:11px;margin:2px}
.switch{margin-left:auto;display:flex;gap:8px;align-items:center;font-size:12px}
.switch a{font-size:12px;color:#fff;text-decoration:underline}
footer{max-width:1080px;margin:0 auto;padding:0 20px 40px;color:var(--muted);font-size:12px}
img{max-width:100%;border:1px solid var(--line);border-radius:6px;background:#fff}
`;

/** The identity and locale switches, shown on every scenario page. */
function switches(options: ShellOptions): string {
  if (!options.scenarioId) return '';
  const { scenarioId } = options;
  const flip = (locale: string, role: string) =>
    `/s/${scenarioId}/project?locale=${locale}&role=${role}&tab=signals`;
  const otherLocale = options.locale === 'fr' ? 'en' : 'fr';
  const otherRole = options.role === 'reader' ? 'lead' : 'reader';
  return `<span class="switch">
<a href="${flip(otherLocale, options.role ?? 'lead')}">${otherLocale.toUpperCase()}</a>
<a href="${flip(options.locale, otherRole)}">${otherRole}</a>
</span>`;
}

/** The top bar: product name, screen links, locale and identity switches. */
function bar(options: ShellOptions): string {
  const links = (options.nav ?? [])
    .map((item) => `<a href="${item.href}">${escape(item.label)}</a>`)
    .join('');
  const home = options.locale === 'fr' ? 'Toutes les releases' : 'All releases';
  return `<header class="bar"><span class="logo">Rayon d’impact</span>
<a href="/?locale=${options.locale}">${escape(home)}</a>${links}${switches(options)}</header>`;
}

/** Wraps a rendered screen in the Jira-like page. */
export function shell(options: ShellOptions): string {
  const home = options.locale === 'fr' ? 'Accueil' : 'Home';
  const crumb = options.scenarioId
    ? `<div class="crumb"><a href="/?locale=${options.locale}">${escape(home)}</a> / ${escape(options.title)}</div>`
    : '';
  // A screen page shows the release it plays; the landing page brings its own h1.
  const heading = options.scenarioId ? `<h1>${escape(options.title)}</h1>` : '';
  return `<!DOCTYPE html>
<html lang="${options.locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escape(options.title)} — Rayon d’impact</title>
<style>${CSS}</style>
</head>
<body>
${bar(options)}
<main>
${crumb}
${heading}
${options.body}
</main>
<footer>${escape(footnote(options.locale))}</footer>
</body>
</html>`;
}

/** The honest footnote: what the demo does and does not stand for. */
function footnote(locale: 'en' | 'fr'): string {
  return locale === 'fr'
    ? 'Démo hors ligne : moteur, résolveurs et actions sont ceux de l\u2019app ; '
      + 'les données viennent des fixtures de test, pas d\u2019un site Jira. '
      + 'La synthèse est le repli déterministe, non un texte de modèle.'
    : 'Offline demo: the engine, the resolvers and the actions are the app\u2019s own; '
      + 'the data comes from the test fixtures, not a Jira site. '
      + 'The summary is the deterministic fallback, not model output.';
}

/** Escapes a string for HTML text and attribute positions. */
function escape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
