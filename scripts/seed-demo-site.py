#!/usr/bin/env python3
"""Seed du jeu de démonstration « Paiements 2.4 » (SPEC §18) sur le site de démo.

Idempotent par nature : les tickets sont créés une fois, le script affiche les
clés produites. Aucun secret affiché (lu dans ~/.atlassian-api-token).
"""
import base64
import json
import pathlib
import sys
import urllib.error
import urllib.request

SITE = "https://one-atlas-cndz.atlassian.net"
EMAIL = "baptiste.faisy@gmail.com"
TOKEN = pathlib.Path.home().joinpath(".atlassian-api-token").read_text().strip()
AUTH = base64.b64encode(f"{EMAIL}:{TOKEN}".encode()).decode()
PROJECT = "PAY"
VERSION = "2.4"
TASK_TYPE = "10002"
TRANSITION_IN_PROGRESS = "11"
TRANSITION_DONE = "21"
LINK_BLOCKS = "10000"


def call(method, path, body=None):
    """Un appel REST Jira/Confluence, avec un message d'erreur lisible."""
    url = f"{SITE}{path}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", f"Basic {AUTH}")
    req.add_header("Content-Type", "application/json")
    req.add_header("Accept", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            raw = resp.read().decode()
            return resp.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as err:
        return err.code, err.read().decode()[:300]


def create_issue(summary, component=None):
    """Crée une Tâche dans PAY avec la fixVersion 2.4."""
    fields = {
        "project": {"key": PROJECT},
        "summary": summary,
        "issuetype": {"id": TASK_TYPE},
        "fixVersions": [{"name": VERSION}],
    }
    if component:
        fields["components"] = [{"name": component}]
    status, body = call("POST", "/rest/api/3/issue", {"fields": fields})
    if status != 201:
        print(f"ECHEC creation {summary!r}: {status} {body}")
        sys.exit(1)
    return body["key"], body["id"]


def transition(key, transition_id):
    status, body = call("POST", f"/rest/api/3/issue/{key}/transitions",
                        {"transition": {"id": transition_id}})
    if status not in (200, 204):
        print(f"ECHEC transition {key} -> {transition_id}: {status} {body}")


def link(inward_key, outward_key, link_type=LINK_BLOCKS):
    """inward_key « is blocked by » outward_key."""
    status, body = call("POST", "/rest/api/3/issueLink", {
        "type": {"id": link_type},
        "inwardIssue": {"key": inward_key},
        "outwardIssue": {"key": outward_key},
    })
    if status not in (200, 201):
        print(f"ECHEC lien {inward_key}<->{outward_key}: {status} {body}")


def remote_link(key, url, title):
    status, body = call("POST", f"/rest/api/3/issue/{key}/remotelink", {
        "object": {"url": url, "title": title},
        "globalId": f"rayon-impact:{key}:{title}",
    })
    if status not in (200, 201):
        print(f"ECHEC remote link {key}: {status} {body}")


def oldest_confluence_page():
    """Une page Confluence ancienne du site : DOC-01 doit se déclencher dessus."""
    status, body = call("GET", "/wiki/rest/api/content?limit=25&expand=version")
    if status != 200 or not isinstance(body, dict):
        return None
    pages = [r for r in body.get("results", []) if r.get("type") == "page"]
    pages.sort(key=lambda p: p.get("version", {}).get("when", ""))
    if not pages:
        return None
    page = pages[0]
    return {
        "url": f"{SITE}/wiki{page['_links']['base']}{page['_links']['webui']}",
        "title": page.get("title", "Page"),
        "modified": page.get("version", {}).get("when"),
    }


SUMMARIES = [
    ("Add SEPA instant credit", "checkout-api"),
    ("Harden 3DS retry path", "checkout-api"),
    ("Upgrade ledger client", None),
    ("Switch to batched settlements", None),
    ("Rework refund ledger entries", None),
    ("Document settlement SLA", None),
    ("Round-up cents on FX", None),
    ("Duplicate webhook on timeout", None),
    ("Bump crypto provider", None),
    ("Trace id propagation", None),
    ("Idempotency keys on refunds", None),
    ("Retry budget tuning", None),
    ("Settlement dashboard tiles", None),
    ("PSP contract flags", None),
]


def main():
    keys = {}
    for index, (summary, component) in enumerate(SUMMARIES, start=1):
        key, issue_id = create_issue(summary, component)
        keys[f"pay{index}"] = key
        print(f"  {key} — {summary}")

    # SPEC §18 : un ticket en cours (COMP-01), le reste terminé.
    transition(keys["pay5"], TRANSITION_IN_PROGRESS)
    for index in range(1, 15):
        if index != 5:
            transition(keys[f"pay{index}"], TRANSITION_DONE)

    # Un bloquant hors version (DEP-01) : PAY-4 « is blocked by » PAY-BLOCKER.
    blocker_key, _ = create_issue("Refactor settlement batching", None)
    link(keys["pay4"], blocker_key)
    print(f"  {blocker_key} — bloquant hors version, lié à {keys['pay4']}")

    # Un ticket d'un autre projet qui dépend de la version (DEP-02).
    status, body = call("POST", "/rest/api/3/issue", {"fields": {
        "project": {"key": "MOBL"},
        "summary": "Mobile: surface new payment methods (depends on PAY 2.4)",
        "issuetype": {"name": "Tâche"},
    }})
    if status == 201:
        mobl = body["key"]
        link(mobl, keys["pay1"])
        print(f"  {mobl} — ticket Mobile lié à {keys['pay1']}")
    else:
        print(f"  MOBL non créé ({status}): {str(body)[:120]}")

    # Une page Confluence ancienne liée à un ticket (DOC-01).
    page = oldest_confluence_page()
    if page:
        remote_link(keys["pay1"], page["url"], page["title"])
        print(f"  page liée : {page['title']} (modifiée le {page['modified']})")
    else:
        print("  aucune page Confluence trouvée pour DOC-01")

    print(json.dumps(keys, indent=1))


if __name__ == "__main__":
    main()
