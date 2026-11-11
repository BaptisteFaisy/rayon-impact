#!/usr/bin/env python3
"""Orchestration du harnais de recette (SPEC §17) contre le site réel.

Lancement (tout depuis la racine du dépôt) :

    python3 scripts/acceptance/run.py                       # les 8 cas, site par défaut
    python3 scripts/acceptance/run.py --cases R1,R5,R6,R8   # sous-ensemble automatisable
    python3 scripts/acceptance/run.py --site https://… --project PAY --version 2.4 \
        --webtrigger-url https://….webtrigger.atlassian.app/public/ID

Configuration (arguments > variables d'environnement > défauts documentés) :
    --site            / RAYON_SITE              https://one-atlas-cndz.atlassian.net
    --project         / RAYON_PROJECT           PAY
    --version         / RAYON_VERSION           2.4
    --webtrigger-url  / RAYON_WEBTRIGGER_URL    ~/.rayon-webtrigger-url
    --timeout                                   300 (s, attente d'un recalcul)
    --cases                                     R1…R8

Secrets (jamais affichés) :
    Jira      : ~/.atlassian-api-token ou ATLASSIAN_API_TOKEN (+ ATLASSIAN_EMAIL)
    Webtrigger: RAYON_WEBTRIGGER_TOKEN ou ~/.rayon-webtrigger-token
                (même valeur que `forge variables set RI_WEBTRIGGER_TOKEN=…`)

Code de sortie : 0 si aucun ÉCHEC (les SAUTÉS n'en sont pas), 1 sinon,
2 si le harnais lui-même est mal configuré.
"""
import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from cases import CASES, Ctx, run_case  # noqa: E402
from client import (  # noqa: E402
    DEFAULT_EMAIL,
    DEFAULT_PROJECT,
    DEFAULT_SITE,
    DEFAULT_VERSION,
    POLL_TIMEOUT,
    HarnessError,
    JiraClient,
    WebTriggerClient,
    read_secret,
)
import report  # noqa: E402


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description="Harnais de recette SPEC §17 (R1…R8).")
    parser.add_argument("--site", default=os.environ.get("RAYON_SITE", DEFAULT_SITE))
    parser.add_argument("--project", default=os.environ.get("RAYON_PROJECT", DEFAULT_PROJECT))
    parser.add_argument("--version", default=os.environ.get("RAYON_VERSION", DEFAULT_VERSION))
    parser.add_argument(
        "--webtrigger-url",
        default=os.environ.get("RAYON_WEBTRIGGER_URL")
        or read_secret("RAYON_WEBTRIGGER_URL", ".rayon-webtrigger-url"),
    )
    parser.add_argument("--timeout", type=int, default=POLL_TIMEOUT, help="attente max d'un recalcul (s)")
    parser.add_argument("--cases", default="", help="liste R1,R5,… (défaut : tous)")
    return parser.parse_args(argv)


def selected_cases(wanted):
    if not wanted.strip():
        return CASES
    ids = {token.strip().upper() for token in wanted.split(",") if token.strip()}
    unknown = sorted(ids - {case_id for case_id, _, _ in CASES})
    if unknown:
        raise HarnessError(f"cas inconnus : {unknown} (attendus R1…R8).")
    return [case for case in CASES if case[0] in ids]


def check_health(webtrigger):
    """Vérifie le webtrigger avant tout cas : échec = configuration, pas recette."""
    status, payload = webtrigger.health()
    if status != 200 or not (payload or {}).get("ok"):
        raise HarnessError(
            f"/health -> {status} : le webtrigger n'est pas joignable ou pas déployé "
            "(forge deploy + forge webtrigger create, cf. docs/ACCEPTANCE.md)."
        )
    if not payload.get("tokenConfigured"):
        raise HarnessError(
            "le webtrigger répond mais RI_WEBTRIGGER_TOKEN n'est pas posée côté app "
            "(`forge variables set RI_WEBTRIGGER_TOKEN=… -e production`)."
        )


def main(argv=None):
    args = parse_args(argv)
    try:
        cases = selected_cases(args.cases)
        jira = JiraClient(site=args.site, email=os.environ.get("ATLASSIAN_EMAIL", DEFAULT_EMAIL))
        webtrigger = WebTriggerClient(args.webtrigger_url)
        check_health(webtrigger)
        ctx = Ctx(jira, webtrigger, args.project, args.version, args.timeout)
    except HarnessError as err:
        return report.fatal(str(err))
    results = []
    for case_id, spec_ref, fn in cases:
        print(f"… {case_id} ({spec_ref}) en cours", flush=True)
        results.append(run_case(case_id, spec_ref, fn, ctx))
    print(report.format_report(results, args.site, args.project, args.version))
    return report.exit_code(results)


if __name__ == "__main__":
    sys.exit(main())
